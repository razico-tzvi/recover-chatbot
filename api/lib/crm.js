// CRM ticket answering (Freshdesk). Server-only.
//
// pollStore     — every 5 min: new open tickets created after the mode was turned
//                 on → human-request / blocklist check → AI draft → private note
//                 (Learning) or public reply (Live; low-confidence answers still go
//                 out as notes tagged ai-skipped; a request for a person is never
//                 answered, tagged human-requested and left open for CS).
// collectFeedback — for drafts, the reply an agent actually sent is stored with
//                 a similarity score; edited drafts are shown to later drafts.
// syncHistory   — nightly: resolved/closed tickets → agent public replies only,
//                 used as reference answers and to seed Voice & tone (voice.js).

import {
  CRM_GUARDRAILS, DEFAULT_FAQ, DEFAULT_VOICE_TONE, DEFAULT_SAFEGUARDS_INSTRUCTIONS,
  resolveBranding, resolveCrm, resolveSignature, matchBlocklist, detectHumanRequest,
} from "./defaults";
import { freshdesk, freshdeskBudget, freshdeskConnected, FreshdeskRateLimit } from "./integrations";
import { llmConfig, complete } from "./llm";

const STATUS_OPEN = 2;
const STATUS_RESOLVED = 4;
const STATUS_CLOSED = 5;
const MAX_NEW_PER_RUN = 10;
const MAX_FEEDBACK_PER_RUN = 20;
const FEEDBACK_WINDOW_MS = 14 * 24 * 3600 * 1000;
const FEEDBACK_RECHECK_MS = 60 * 60 * 1000;
// 12 months: Voice & tone is seeded from the last year of agent replies.
const HISTORY_FIRST_SYNC_MS = 365 * 24 * 3600 * 1000;
const MAX_HISTORY_PER_RUN = 150;
const HISTORY_BUDGET_SHARE = 0.4;

const block = (v, fallback) => (v && String(v).trim()) || fallback;
const clip = (s, n) => String(s || "").slice(0, n);
const isAgentReply = (c) => c && c.incoming === false && c.private === false;

// ─────────────────────────── stores & state ───────────────────────────

export async function storesFor(api, storeId) {
  const filter = storeId ? { id: { equals: String(storeId) } } : undefined;
  return api.internal.bigcommerce.store.findMany({ filter, first: 250 });
}

export async function saveState(api, store, patch) {
  const crmState = { ...(store.crmState || {}), ...patch };
  store.crmState = crmState;
  await api.internal.bigcommerce.store.update(store.id, { crmState });
}

// ─────────────────────────── polling new tickets ───────────────────────────

export async function pollStore(ctx, store) {
  const { api, logger } = ctx;
  const crm = resolveCrm(store);
  if (crm.mode === "off" || !freshdeskConnected(store)) return { skipped: true };
  const cfg = llmConfig(store, "crm");
  if (!cfg.configured) {
    await saveState(api, store, { lastPollAt: new Date().toISOString(), lastPollError: "The AI model isn't configured (Integrations › Anthropic)." });
    return { skipped: true };
  }

  const state = store.crmState || {};
  const sinceIso = crm.enabledAt || state.since;
  if (!sinceIso) {
    // Mode was turned on outside the admin: start from now, never the backlog.
    await saveState(api, store, { since: new Date().toISOString() });
    return { started: true };
  }
  const since = new Date(sinceIso);
  let cursor = state.pollCursor && new Date(state.pollCursor) > since ? new Date(state.pollCursor) : since;

  let handled = 0;
  let error = "";
  let retryAfter = 0;
  try {
    outer: for (let page = 1; page <= 3; page++) {
      const tickets = await freshdesk(
        store, "GET",
        `/tickets?updated_since=${encodeURIComponent(cursor.toISOString())}&order_by=updated_at&order_type=asc&per_page=30&page=${page}&include=requester,description`
      );
      if (!tickets?.length) break;

      const ids = tickets.map((t) => t.id);
      const seen = new Set(
        (await api.internal.crmTicket.findMany({ filter: { storeId: { equals: store.id }, ticketId: { in: ids } }, select: { ticketId: true }, first: 250 }))
          .map((r) => r.ticketId)
      );

      for (const t of tickets) {
        if (handled >= MAX_NEW_PER_RUN) break outer;
        if (!seen.has(t.id) && isCandidate(t, crm, since)) {
          await processTicket(ctx, store, crm, cfg, t);
          handled++;
        }
        cursor = new Date(t.updated_at);
      }
      if (tickets.length < 30) break;
    }
  } catch (err) {
    // A rate limit just ends this tick; the cursor is kept and the next tick resumes.
    if (err instanceof FreshdeskRateLimit) retryAfter = err.retryAfter || 60;
    else {
      error = `Polling failed: ${err?.message || err}`;
      logger.warn({ err, storeId: store.id }, "crm poll failed");
    }
  }

  await saveState(api, store, {
    pollCursor: cursor.toISOString(),
    lastPollAt: new Date().toISOString(),
    lastPollError: error,
    pollPausedUntil: retryAfter ? new Date(Date.now() + retryAfter * 1000).toISOString() : "",
  });
  return { handled, error };
}

function isCandidate(t, crm, since) {
  if (t.status !== STATUS_OPEN) return false;
  if (new Date(t.created_at) < since) return false;
  const tags = (t.tags || []).map((x) => String(x).toLowerCase());
  if (tags.some((x) => crm.skipTags.includes(x))) return false;
  if ([crm.draftTag, crm.answeredTag, crm.blockedTag, crm.skippedTag, crm.humanTag].some((x) => tags.includes(x))) return false;
  if (crm.onlyTags.length && !tags.some((x) => crm.onlyTags.includes(x))) return false;
  return true;
}

// Handles one ticket end to end and records the outcome. Any failure is recorded
// as action "error" (Retry in the admin runs it again).
export async function processTicket(ctx, store, crm, cfg, t) {
  const { api, logger } = ctx;
  const subject = clip(t.subject, 300);
  const question = clip(t.description_text || stripHtml(t.description), 4000);
  const base = { storeId: store.id, ticketId: t.id, subject, question };
  const record = (values) => api.internal.crmTicket.create({ ...base, ...values });

  try {
    const convos = (await freshdesk(store, "GET", `/tickets/${t.id}/conversations?per_page=100`)) || [];
    if (convos.some(isAgentReply)) return record({ action: "skipped", reason: "An agent already replied." });

    const askedForHuman = detectHumanRequest(`${subject}\n${question}`);
    const blocked = matchBlocklist(`${subject}\n${question}`, crm.blocklist);
    if (blocked && askedForHuman) {
      // No AI text on a blocked topic, and no set response either: they asked for a person.
      await addTag(ctx, store, t, crm.blockedTag, crm.humanTag);
      return record({ action: "human", blockedTopic: blocked.topic, reason: "The customer asked for a person (blocked topic) — left open for customer service." });
    }
    if (blocked) {
      if (!blocked.response) {
        await addTag(ctx, store, t, crm.blockedTag);
        return record({ action: "blocked", blockedTopic: blocked.topic, reason: "Blocked topic with no set response — left for a human." });
      }
      const text = withSignature(blocked.response, resolveSignature(store));
      if (crm.mode === "live") await freshdesk(store, "POST", `/tickets/${t.id}/reply`, { body: toHtml(text) });
      else await addNote(store, t.id, `Set response for blocked topic “${blocked.topic}”. Not sent to the customer.`, text);
      const row = await record({ action: "blocked", blockedTopic: blocked.topic, draft: blocked.response, confident: true, reason: crm.mode === "live" ? "Set response sent." : "Set response added as a private note.", nextCheckAt: crm.mode === "live" ? null : nextCheck(10 * 60 * 1000) });
      await addTag(ctx, store, t, crm.blockedTag);
      return row;
    }

    const d = await draftReply(ctx, store, cfg, { subject, question, name: requesterName(t.requester) });
    const text = withSignature(d.reply, resolveSignature(store));
    if (askedForHuman || d.humanRequested) {
      // Never sent, in either mode; the draft is only a head start for the agent.
      await addNote(store, t.id, "The customer asked for a person — left open for customer service. AI draft for reference only; not sent to the customer.", text);
      const row = await record({ action: "human", draft: d.reply, confident: false, reason: "The customer asked for a person — left open for customer service.", model: cfg.model, nextCheckAt: nextCheck(10 * 60 * 1000) });
      await addTag(ctx, store, t, crm.humanTag);
      return row;
    }
    if (crm.mode === "live" && d.confident) {
      await freshdesk(store, "POST", `/tickets/${t.id}/reply`, { body: toHtml(text) });
      const row = await record({ action: "replied", draft: d.reply, confident: true, reason: d.reason, model: cfg.model });
      await addTag(ctx, store, t, crm.answeredTag);
      return row;
    }
    const header = d.confident
      ? "AI draft — review and send it yourself. Not sent to the customer."
      : `AI draft, needs an agent: ${d.reason || "the AI wasn't confident"}. Not sent to the customer.`;
    await addNote(store, t.id, header, text);
    const row = await record({ action: "drafted", draft: d.reply, confident: d.confident, reason: d.reason, model: cfg.model, nextCheckAt: nextCheck(10 * 60 * 1000) });
    // Not confident = the bot couldn't answer it: also tag it for an agent.
    await addTag(ctx, store, t, ...(d.confident ? [crm.draftTag] : [crm.draftTag, crm.skippedTag]));
    return row;
  } catch (err) {
    if (err instanceof FreshdeskRateLimit) throw err;
    logger.error({ err, storeId: store.id, ticketId: t.id }, "crm ticket failed");
    return record({ action: "error", reason: clip(err?.message || String(err), 500) });
  }
}

// Freshdesk names contacts after their email's local part when no name was given
// ("ai-test-sizing"); greeting someone by their email handle reads badly, so skip it.
export function requesterName(r) {
  const name = String(r?.name || "").trim();
  const local = String(r?.email || "").split("@")[0].trim().toLowerCase();
  if (!name || (local && name.toLowerCase() === local) || name.includes("@")) return "";
  return name;
}

const nextCheck = (ms) => new Date(Date.now() + ms).toISOString();

async function addNote(store, ticketId, header, text) {
  await freshdesk(store, "POST", `/tickets/${ticketId}/notes`, {
    private: true,
    body: `<p><b>${escapeHtml(header)}</b></p><hr>${toHtml(text)}`,
  });
}

// Tags are best effort: a store with required custom ticket fields can reject the update.
// Several tags go in one PUT (it replaces the ticket's tag list).
async function addTag(ctx, store, t, ...add) {
  try {
    const tags = [...new Set([...(t.tags || []), ...add.filter(Boolean)])];
    await freshdesk(store, "PUT", `/tickets/${t.id}`, { tags });
    t.tags = tags;
  } catch (err) {
    // Never rethrow: the note/reply is already posted, and a retry would post it twice.
    ctx.logger.warn({ err, ticketId: t.id, tags: add }, "crm tag update failed");
  }
}

// ─────────────────────────── drafting ───────────────────────────

export async function draftReply(ctx, store, cfg, { subject, question, name }) {
  const [examples, corrections] = await Promise.all([similarHistory(ctx.api, store, `${subject} ${question}`), recentCorrections(ctx.api, store)]);
  const parts = [
    `You are ${resolveBranding(store).botName}, writing email replies to customer support tickets for this online store.`,
    CRM_GUARDRAILS,
    `--- VOICE & TONE ---\n${block(store.voiceTone, DEFAULT_VOICE_TONE)}`,
    `--- HOW TO WORD REFUSALS ---\n${block(store.safeguardsInstructions, DEFAULT_SAFEGUARDS_INSTRUCTIONS)}`,
    `--- STORE POLICIES & FAQ ---\n${block(store.faq, DEFAULT_FAQ)}`,
  ];
  if (examples.length) {
    parts.push(
      "--- HOW OUR AGENTS ANSWERED SIMILAR PAST TICKETS (reference only; facts about other customers' orders don't apply) ---\n" +
        examples.map((e, i) => `#${i + 1} Subject: ${e.subject}\nAgent reply:\n${clip(e.answer, 1200)}`).join("\n\n")
    );
  }
  if (corrections.length) {
    parts.push(
      "--- AGENTS EDITED THESE EARLIER AI DRAFTS BEFORE SENDING; FOLLOW THEIR STYLE AND CORRECTIONS ---\n" +
        corrections.map((c, i) => `#${i + 1} Subject: ${c.subject}\nAI draft:\n${clip(c.draft, 800)}\nWhat the agent sent:\n${clip(c.finalReply, 800)}`).join("\n\n")
    );
  }
  parts.push(
    `Respond with ONLY a JSON object, no other text:
{"confident": true or false, "human_requested": true or false, "reason": "one short sentence: why you are or aren't confident", "reply": "the email body"}
Set "human_requested" to true only when the customer explicitly asks to deal with a person (a human, a real agent, a manager, "not a bot") rather than an automated reply; then the ticket goes to customer service and your reply is only a draft for them.
The reply is plain text (no markdown), starts with a greeting${name ? " using the customer's first name" : ""}, answers every question in the ticket, and has NO sign-off or signature — one is added automatically.`
  );

  const user = `Ticket subject: ${subject || "(none)"}\n${name ? `Customer name: ${clip(name, 80)}\n` : ""}Customer message:\n"""\n${question || "(empty)"}\n"""`;
  const system = parts.join("\n\n");
  // Output cut off at the token limit is never posted: retry once with more room, else fail (Retry in the admin).
  let out = await complete(cfg, { system, user, maxTokens: 2000 });
  if (out.truncated) out = await complete(cfg, { system, user, maxTokens: 6000 });
  if (out.truncated) throw new Error("The AI's draft was cut off at the token limit; nothing was posted.");
  return parseDraft(out.text);
}

// The model is asked for {"confident","reason","reply"}. Slightly malformed JSON
// is salvaged by reading the "reply" string; anything else is refused rather
// than posting raw model output on a ticket.
export function parseDraft(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("The AI returned an empty draft.");
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try {
      const o = JSON.parse(s.slice(i, j + 1));
      if (o && typeof o.reply === "string" && o.reply.trim()) {
        return { confident: o.confident === true, humanRequested: o.human_requested === true, reason: clip(o.reason, 300), reply: o.reply.trim() };
      }
    } catch { /* try the salvage below */ }
  }
  const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s);
  if (m) {
    try {
      const reply = JSON.parse(`"${m[1]}"`).trim();
      if (reply) return { confident: false, humanRequested: /"human_requested"\s*:\s*true/.test(s), reason: "The AI's answer was slightly malformed; review carefully.", reply };
    } catch { /* fall through */ }
  }
  if (i < 0) return { confident: false, humanRequested: false, reason: "The AI answered in plain text instead of the expected format.", reply: s };
  throw new Error("The AI's draft wasn't in the expected format; nothing was posted.");
}

const STOP = new Set("the and for you your with that this have from are was were not but can our any all has had will would could should about what when where which there their them they then than into out how why who its it's i'm i've don't hi hello thanks thank please order orders".split(" "));
const terms = (s) => [...new Set(String(s || "").toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter((w) => !STOP.has(w));

async function similarHistory(api, store, text) {
  const want = terms(text);
  if (!want.length) return [];
  const rows = await api.internal.crmHistory.findMany({
    filter: { storeId: { equals: store.id } },
    sort: { ticketUpdatedAt: "Descending" },
    select: { subject: true, answer: true },
    first: 250,
  });
  return rows
    .map((r) => {
      const subj = new Set(terms(r.subject));
      const body = new Set(terms(r.answer));
      const score = want.reduce((n, w) => n + (subj.has(w) ? 2 : 0) + (body.has(w) ? 1 : 0), 0);
      return { r, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.r);
}

async function recentCorrections(api, store) {
  return api.internal.crmTicket.findMany({
    filter: { storeId: { equals: store.id }, similarity: { lessThan: APPROVED_SIMILARITY }, finalReply: { isSet: true } },
    sort: { feedbackAt: "Descending" },
    select: { subject: true, draft: true, finalReply: true },
    first: 3,
  });
}

// ─────────────────────────── feedback (Learning mode) ───────────────────────────

export async function collectFeedback(ctx, store) {
  const { api, logger } = ctx;
  if (!freshdeskConnected(store)) return { checked: 0 };
  const due = await api.internal.crmTicket.findMany({
    filter: { storeId: { equals: store.id }, nextCheckAt: { lessThanOrEqual: new Date().toISOString() } },
    sort: { nextCheckAt: "Ascending" },
    first: MAX_FEEDBACK_PER_RUN,
  });
  let captured = 0;
  for (const row of due) {
    try {
      const convos = (await freshdesk(store, "GET", `/tickets/${row.ticketId}/conversations?per_page=100`)) || [];
      const after = new Date(row.createdAt).getTime();
      const reply = convos.find((c) => isAgentReply(c) && new Date(c.created_at).getTime() > after);
      if (reply) {
        const finalReply = clip(reply.body_text || stripHtml(reply.body), 8000);
        await api.internal.crmTicket.update(row.id, {
          finalReply,
          similarity: Math.round(similarity(row.draft, finalReply) * 1000) / 1000,
          feedbackAt: new Date().toISOString(),
          nextCheckAt: null,
        });
        captured++;
      } else {
        const expired = Date.now() - after > FEEDBACK_WINDOW_MS;
        await api.internal.crmTicket.update(row.id, { nextCheckAt: expired ? null : nextCheck(FEEDBACK_RECHECK_MS) });
      }
    } catch (err) {
      if (err instanceof FreshdeskRateLimit) break;
      logger.warn({ err, ticketId: row.ticketId }, "crm feedback check failed");
      await api.internal.crmTicket.update(row.id, { nextCheckAt: nextCheck(FEEDBACK_RECHECK_MS) });
    }
  }
  return { checked: due.length, captured };
}

// An agent "approved" a draft when what they sent kept ≥ 90% of its wording
// (same threshold as the Analytics edit rate and the corrections fed to drafts).
export const APPROVED_SIMILARITY = 0.9;

// Freshdesk tab stats strip, all time for the store.
//   attempted       — tickets the bot took on (not the ones an agent had already answered)
//   drafted         — private-note drafts (Learning, or Live when not confident)
//   approvedAsIs / edited — drafts whose agent reply was captured, split at APPROVED_SIMILARITY
//   skipped         — drafts the bot wasn't confident about (tagged ai-skipped)
//   humanRequested  — customer asked for a person
//   approvalRate    — approvedAsIs / (approvedAsIs + edited); 0 until a draft is reviewed
export async function crmStats(api, store) {
  const rows = [];
  let page = await api.internal.crmTicket.findMany({
    filter: { storeId: { equals: store.id } },
    select: { action: true, confident: true, similarity: true, feedbackAt: true },
    first: 250,
  });
  for (;;) {
    rows.push(...page);
    if (!page.hasNextPage || rows.length >= 20000) break;
    page = await page.nextPage();
  }
  const drafts = rows.filter((r) => r.action === "drafted");
  const reviewed = drafts.filter((r) => r.feedbackAt && typeof r.similarity === "number");
  const approvedAsIs = reviewed.filter((r) => r.similarity >= APPROVED_SIMILARITY).length;
  return {
    attempted: rows.filter((r) => r.action !== "skipped").length,
    drafted: drafts.length,
    approvedAsIs,
    edited: reviewed.length - approvedAsIs,
    skipped: drafts.filter((r) => r.confident === false).length,
    humanRequested: rows.filter((r) => r.action === "human").length,
    replied: rows.filter((r) => r.action === "replied").length,
    reviewed: reviewed.length,
    approvalRate: reviewed.length ? approvedAsIs / reviewed.length : 0,
  };
}

// Word-level edit similarity, 0..1 (1 = sent unchanged). Signatures and greetings
// count, so small edits still land around 0.9.
export function similarity(a, b) {
  const x = (String(a || "").toLowerCase().match(/[a-z0-9']+/g) || []).slice(0, 600);
  const y = (String(b || "").toLowerCase().match(/[a-z0-9']+/g) || []).slice(0, 600);
  if (!x.length && !y.length) return 1;
  if (!x.length || !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

// ─────────────────────────── nightly history sync ───────────────────────────

export async function syncHistory(ctx, store) {
  const { api, logger } = ctx;
  if (!freshdeskConnected(store)) return { skipped: true };
  const crm = resolveCrm(store);
  const state = store.crmState || {};
  let cursor = new Date(state.historyCursor || Date.now() - HISTORY_FIRST_SYNC_MS);
  let examined = 0;
  let saved = 0;
  let error = "";
  let retryAfter = 0; // > 0: stopped by the rate limit
  let more = false; // stopped at the per-run cap with tickets left

  try {
    outer: for (let page = 1; page <= 10; page++) {
      const tickets = await freshdesk(
        store, "GET",
        `/tickets?updated_since=${encodeURIComponent(cursor.toISOString())}&order_by=updated_at&order_type=asc&per_page=100&page=${page}`
      );
      if (!tickets?.length) break;
      for (const t of tickets) {
        if (examined >= MAX_HISTORY_PER_RUN) { more = true; break outer; }
        const tags = (t.tags || []).map((x) => String(x).toLowerCase());
        // Live-mode AI replies are posted as an agent; keep them out of "how agents answer".
        if ([STATUS_RESOLVED, STATUS_CLOSED].includes(t.status) && !tags.includes(crm.answeredTag)) {
          // Backfill yields to new-ticket handling: stop below 40% of the minute's budget.
          const budget = freshdeskBudget(store);
          if (budget && budget.remaining < budget.total * HISTORY_BUDGET_SHARE) throw new FreshdeskRateLimit(60);
          examined++;
          const convos = (await freshdesk(store, "GET", `/tickets/${t.id}/conversations?per_page=100`)) || [];
          const answer = convos.filter(isAgentReply).map((c) => clip(c.body_text || stripHtml(c.body), 3000)).join("\n---\n");
          if (answer.trim()) {
            await upsertHistory(api, store, { ticketId: t.id, subject: clip(t.subject, 300), answer: clip(answer, 8000), ticketUpdatedAt: t.updated_at });
            saved++;
          }
        }
        cursor = new Date(t.updated_at);
      }
      if (tickets.length < 100) break;
    }
  } catch (err) {
    if (err instanceof FreshdeskRateLimit) retryAfter = err.retryAfter || 60;
    else {
      error = `Sync failed: ${err?.message || err}`;
      logger.warn({ err, storeId: store.id }, "crm history sync failed");
    }
  }

  await saveState(api, store, {
    historyCursor: cursor.toISOString(),
    lastSyncAt: new Date().toISOString(),
    lastSyncError: error,
    lastSyncSaved: saved,
    syncPausedUntil: retryAfter ? new Date(Date.now() + (retryAfter + 5) * 1000).toISOString() : "",
    historyCount: (state.historyCount || 0) + saved, // refreshed exactly below
  });
  await refreshHistoryCount(api, store);
  return { examined, saved, error, retryAfter, more };
}

async function upsertHistory(api, store, values) {
  const [existing] = await api.internal.crmHistory.findMany({
    filter: { storeId: { equals: store.id }, ticketId: { equals: values.ticketId } },
    first: 1,
  });
  if (existing) await api.internal.crmHistory.update(existing.id, values);
  else await api.internal.crmHistory.create({ storeId: store.id, ...values });
}

async function refreshHistoryCount(api, store) {
  let n = 0;
  let page = await api.internal.crmHistory.findMany({ filter: { storeId: { equals: store.id } }, select: { id: true }, first: 250 });
  n += page.length;
  while (page.hasNextPage && n < 50_000) {
    page = await page.nextPage();
    n += page.length;
  }
  await saveState(api, store, { historyCount: n });
}

// ─────────────────────────── formatting ───────────────────────────

export function withSignature(text, signature) {
  const sig = String(signature || "").trim();
  return sig ? `${String(text).trim()}\n\n${sig}` : String(text).trim();
}

const escapeHtml = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toHtml(text) {
  return String(text)
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function stripHtml(html) {
  return String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
