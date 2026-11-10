// Voice & tone (context source 8) generated from the agent replies the Freshdesk
// history sync stored in crmHistory. Server-only.
//
// generateVoiceTone — reads the last 12 months of stored agent replies, samples
//                     them evenly over time and asks the store's analysis model
//                     for a style guide. Returns the text; never saves it.
// seedVoiceTone     — one-time: after a history sync finishes (or once enough
//                     tickets are synced), a store whose
//                     Voice & tone is still the built-in default gets the
//                     generated guide saved. Never overwrites an edited block
//                     and never runs again once crmState.voiceSeed is set.

import { llmConfig, complete } from "./llm";
import { saveState } from "./crm";

const WINDOW_MS = 365 * 24 * 3600 * 1000;
export const VOICE_MIN_REPLIES = 20;
// Auto-seed before the backfill finishes once this many tickets are synced.
export const VOICE_SEED_REPLIES = 200;
const MAX_ROWS = 2000;
const SAMPLE = 80;
const PER_REPLY_CHARS = 1200;
const TOTAL_CHARS = 70_000;
export const VOICE_MAX_CHARS = 2500;

const SYSTEM = `You write the "Voice & tone" section of the instructions for an online store's AI support assistant. The same section is used for live chat on the storefront and for email replies to support tickets.

You get a sample of real replies the store's human support agents sent customers over the last year. Describe how these agents write, so the assistant sounds like them.

Cover only style, for example:
- overall register (formal or casual, warm or matter-of-fact) and how personal it is
- how replies open and how they get to the point; typical length and sentence length
- how agents apologize, show empathy, deliver bad news or say no
- how they explain next steps and set expectations
- recurring words and phrasings to use, and ones the agents avoid (jargon, slang, emoji, exclamation marks, all caps)
- anything consistent about formatting (lists, line breaks)

Rules:
- Describe the team's shared style. If agents differ, describe what most of them do.
- No facts or policies (prices, time frames, shipping, returns, warranty, legal): those live in a separate FAQ section.
- No names of agents or customers, no order numbers, emails, phone numbers or links.
- Nothing about signatures or sign-offs: a signature is added automatically.
- Write it as 6 to 12 short bullet points ("- ..."), imperative, addressed to the assistant ("Open with...", "Keep..."). You may quote a short typical phrase. No headings, no preamble.
- Keep it under ${VOICE_MAX_CHARS - 500} characters.

Respond with ONLY the bullet list.`;

// Freshdesk body_text keeps the quoted thread below the reply; cut it off.
export function cleanReply(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^on .{3,200}wrote:?$/i.test(t) || /^-{2,}\s*original message/i.test(t) || /^from:\s/i.test(t)) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Evenly spaced picks so every part of the year is represented.
export function spread(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

async function recentReplies(api, store) {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const rows = [];
  let page = await api.internal.crmHistory.findMany({
    // No sort: Gadget rejects nextPage() cursors on a dateTime sort
    // (GGT_INVALID_CURSOR). Rows are ordered in memory below.
    filter: { storeId: { equals: store.id }, ticketUpdatedAt: { greaterThanOrEqual: since } },
    select: { answer: true, ticketUpdatedAt: true },
    first: 250,
  });
  rows.push(...page);
  while (page.hasNextPage && rows.length < MAX_ROWS) {
    page = await page.nextPage();
    rows.push(...page);
  }
  rows.sort((a, b) => new Date(b.ticketUpdatedAt).getTime() - new Date(a.ticketUpdatedAt).getTime());
  // A synced ticket can hold several agent replies joined by "---".
  return rows.flatMap((r) =>
    String(r.answer || "")
      .split(/\n---\n/)
      .map(cleanReply)
      .filter((t) => t.length >= 40)
      .map((text) => ({ text, at: r.ticketUpdatedAt }))
  );
}

export function cleanGuide(raw) {
  let s = String(raw || "").trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  // Drop any preamble before the first bullet.
  const i = s.search(/^\s*[-*] /m);
  if (i > 0) s = s.slice(i);
  s = s.replace(/^\s*\* /gm, "- ");
  return s.slice(0, VOICE_MAX_CHARS).trim();
}

// Throws with a user-facing message when it can't run.
export async function generateVoiceTone(ctx, store) {
  const cfg = llmConfig(store, "analysis");
  if (!cfg.configured) throw new Error("Connect Anthropic (API key and model) on the Integrations tab first.");

  const replies = await recentReplies(ctx.api, store);
  if (replies.length < VOICE_MIN_REPLIES) {
    throw new Error(`Not enough agent replies yet: ${replies.length} from the last 12 months are synced (needs at least ${VOICE_MIN_REPLIES}). Run Sync now on the CRM tab first.`);
  }

  let budget = TOTAL_CHARS;
  const picked = [];
  for (const r of spread(replies, SAMPLE)) {
    const t = r.text.slice(0, PER_REPLY_CHARS);
    if (t.length > budget) break;
    budget -= t.length;
    picked.push({ ...r, text: t });
  }
  const user = `${picked.length} agent replies, sampled from ${replies.length} sent in the last 12 months:\n\n` +
    picked.map((r, i) => `#${i + 1}\n"""\n${r.text}\n"""`).join("\n\n");

  let out = await complete(cfg, { system: SYSTEM, user, maxTokens: 1500, timeoutMs: 150_000 });
  if (out.truncated) out = await complete(cfg, { system: SYSTEM, user, maxTokens: 3000, timeoutMs: 150_000 });
  const text = cleanGuide(out.text);
  if (!text || !text.startsWith("- ")) throw new Error("The analysis model's answer couldn't be read. Try again, or pick a different analysis model.");

  const dates = picked.map((r) => new Date(r.at).getTime()).filter(Number.isFinite);
  return {
    text,
    basedOn: {
      replies: replies.length,
      sampled: picked.length,
      from: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
      to: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    },
    model: cfg.model,
  };
}

export async function seedVoiceTone(ctx, store) {
  if (String(store.voiceTone || "").trim()) return { skipped: "customized" };
  if (store.crmState?.voiceSeed) return { skipped: "already seeded" };
  const g = await generateVoiceTone(ctx, store);
  await ctx.api.internal.bigcommerce.store.update(store.id, { voiceTone: g.text });
  store.voiceTone = g.text;
  await saveState(ctx.api, store, { voiceSeed: { at: new Date().toISOString(), source: "auto", model: g.model, ...g.basedOn } });
  ctx.logger.info({ storeId: store.id, ...g.basedOn }, "voice & tone seeded from agent replies");
  return { seeded: true, ...g.basedOn };
}
