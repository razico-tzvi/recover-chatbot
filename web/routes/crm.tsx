import { useFindFirst, useFindMany } from "@gadgetinc/react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { freshdeskConnected, freshdeskTicketUrl } from "../../api/lib/integrations";
import { useSettings, type CrmDraft, type Draft } from "../lib/settings";
import { Alert, Btn, Card, Field, Loading, Seg, Tag, type Tone } from "../components/ui";

type OpResult = { ok: boolean; message?: string; confident?: boolean; reason?: string; reply?: string; model?: string };

async function crmOp(args: Record<string, unknown>): Promise<OpResult> {
  try {
    // @ts-ignore — global action
    return await api.crmAdmin(args);
  } catch (e: any) {
    return { ok: false, message: e?.message || "Something went wrong." };
  }
}

const fmt = (d: any) => (d ? new Date(d).toLocaleString() : "never");

export const CrmPage = () => {
  const { store, draft, loading } = useSettings();
  const navigate = useNavigate();
  if (loading || !draft) return <Loading />;

  if (!freshdeskConnected(store)) {
    return (
      <Card title="CRM ticket answering" sub="Drafts or answers Freshdesk tickets with the same store context the chat bot uses.">
        <Alert tone="warn">Freshdesk isn't connected yet. Add your Freshdesk domain and API key on the Integrations tab, then come back here.</Alert>
        <Btn primary onClick={() => navigate("/integrations")}>Open Integrations</Btn>
      </Card>
    );
  }

  return (
    <>
      <ModeCard />
      <TicketRulesCard />
      <BlocklistCard />
      <ActivityCard />
      <PreviewCard />
    </>
  );
};

function useCrm() {
  const { draft, set } = useSettings();
  const c = (draft as Draft).crm;
  return { c, setC: (patch: Partial<CrmDraft>) => set("crm", { ...c, ...patch }) };
}

function ModeCard() {
  const { store } = useSettings();
  const { c, setC } = useCrm();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<OpResult | null>(null);
  // Run state is read on its own (not from the settings draft), so it can refresh
  // while a background check/sync runs without touching unsaved edits.
  // @ts-ignore
  const [{ data: live }, refetchState] = useFindFirst(api.bigcommerce.store, { select: { id: true, crmState: true } });
  const [pollUntil, setPollUntil] = useState(0);
  useEffect(() => {
    if (!pollUntil) return;
    const t = setInterval(() => {
      if (Date.now() > pollUntil) { setPollUntil(0); return; }
      refetchState({ requestPolicy: "network-only" });
    }, 5000);
    return () => clearInterval(t);
  }, [pollUntil]);
  const st = (live as any)?.crmState || store?.crmState || {};
  const savedMode = store?.crmSettings?.mode || "off";
  const llmReady = (store?.llmProvider || "anthropic") === "anthropic" ? !!store?.llmModel && !!store?.llmApiKey : !!store?.llmModel;

  const op = async (name: string) => {
    setBusy(name); setMsg(null);
    const r = await crmOp({ op: name });
    setMsg(r);
    setBusy(null);
    if (r.ok) setPollUntil(Date.now() + 2 * 60 * 1000);
  };

  return (
    <Card
      title="CRM ticket answering · Freshdesk"
      sub="New open tickets are checked every 5 minutes. Only tickets created after you turn this on are touched — never the backlog."
    >
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Mode</label>
        <Seg
          name="crm-mode"
          label="CRM mode"
          value={c.mode}
          onChange={(v) => setC({ mode: v })}
          options={[
            { value: "off", label: "Off" },
            { value: "learning", label: "Learning" },
            { value: "live", label: "Live" },
          ]}
        />
        <p className="hint">
          {c.mode === "off" && "The bot doesn't touch tickets. History sync still runs nightly so drafts are ready when you switch on."}
          {c.mode === "learning" && <>Each new ticket gets an AI draft as a <b>private note</b> tagged <span className="mono">{c.draftTag}</span>. Nothing reaches the customer. When an agent sends their own reply, it's compared with the draft and the edits are used as feedback for later drafts.</>}
          {c.mode === "live" && <>Confident answers are <b>sent to the customer</b> as a public reply and tagged <span className="mono">{c.answeredTag}</span>. Anything the AI isn't sure about still lands as a private draft for an agent. Start in Learning mode until the drafts need few edits.</>}
        </p>
      </div>
      {c.mode !== savedMode && <Alert tone="warn">Mode change isn't saved yet — click Save settings.</Alert>}
      {!llmReady && <Alert tone="warn">Connect Anthropic (API key and model) on the Integrations tab — drafts use the CRM model set there.</Alert>}
      {st.lastPollError && <Alert tone="crit">Last check: {st.lastPollError}</Alert>}
      {st.lastSyncError && <Alert tone="crit">Last history sync: {st.lastSyncError}</Alert>}
      {st.pollPausedUntil && new Date(st.pollPausedUntil) > new Date(Date.now() - 5 * 60 * 1000) && (
        <Alert tone="info">The last ticket check paused at Freshdesk's API rate limit; the next check (within 5 minutes) picks up where it stopped.</Alert>
      )}
      {st.syncPausedUntil && new Date(st.syncPausedUntil) > new Date() && (
        <Alert tone="info">History sync is pausing for Freshdesk's API rate limit and resumes automatically around {new Date(st.syncPausedUntil).toLocaleTimeString()}.</Alert>
      )}

      <div className="grid2" style={{ marginTop: 6 }}>
        <div>
          <div className="ghead">New tickets</div>
          <p>Last checked {fmt(st.lastPollAt)}</p>
          {savedMode !== "off" && <p className="hint">Watching tickets created since {fmt(store?.crmSettings?.enabledAt || st.since)}</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <Btn small loading={busy === "checkNow"} disabled={savedMode === "off"} onClick={() => op("checkNow")}>Check now</Btn>
          </div>
        </div>
        <div>
          <div className="ghead">Ticket history</div>
          <p>{(st.historyCount ?? 0).toLocaleString()} resolved tickets synced · last sync {fmt(st.lastSyncAt)}</p>
          <p className="hint">Nightly, agent public replies only. The first sync looks back 12 months; Voice &amp; tone is seeded from it once.</p>
          <div className="row" style={{ marginTop: 8 }}>
            <Btn small loading={busy === "syncNow"} onClick={() => op("syncNow")}>Sync now</Btn>
          </div>
        </div>
      </div>
      {msg && <Alert tone={msg.ok ? "good" : "crit"}>{msg.message}</Alert>}
    </Card>
  );
}

function TicketRulesCard() {
  const { c, setC } = useCrm();
  return (
    <Card title="Tickets, tags & signature" sub="Which tickets the bot picks up, how it labels them, and how its replies are signed.">
      <div className="grid2">
        <Field label="Only answer tickets tagged" htmlFor="crm-only" hint="Comma-separated. Leave blank to handle every new open ticket.">
          <input type="text" id="crm-only" value={c.onlyTags} placeholder="e.g. shipping, returns" onChange={(e) => setC({ onlyTags: e.target.value })} />
        </Field>
        <Field label="Never answer tickets tagged" htmlFor="crm-skip" hint="Chat handoffs arrive tagged ai-handoff — the bot already couldn't help there.">
          <input type="text" id="crm-skip" value={c.skipTags} onChange={(e) => setC({ skipTags: e.target.value })} />
        </Field>
        <Field label="Draft tag" htmlFor="crm-dt" hint="Added with every private-note draft.">
          <input type="text" id="crm-dt" value={c.draftTag} onChange={(e) => setC({ draftTag: e.target.value })} />
        </Field>
        <Field label="Answered tag" htmlFor="crm-at" hint="Added when Live mode sends a reply.">
          <input type="text" id="crm-at" value={c.answeredTag} onChange={(e) => setC({ answeredTag: e.target.value })} />
        </Field>
        <Field label="Blocked-topic tag" htmlFor="crm-bt" hint="Added when a ticket hits the topic blocklist.">
          <input type="text" id="crm-bt" value={c.blockedTag} onChange={(e) => setC({ blockedTag: e.target.value })} />
        </Field>
        <Field label="Bot signature" htmlFor="crm-sig" full hint="Appended to every draft and reply. The AI never writes its own sign-off.">
          <textarea id="crm-sig" rows={3} value={c.signature} placeholder={"Best,\nThe Support Team"} onChange={(e) => setC({ signature: e.target.value })} />
        </Field>
      </div>
    </Card>
  );
}

function BlocklistCard() {
  const { c, setC } = useCrm();
  const rows = c.blocklist;
  const update = (i: number, patch: Partial<CrmDraft["blocklist"][number]>) =>
    setC({ blocklist: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const incomplete = rows.some((r) => !r.topic.trim() || !r.keywords.trim());

  return (
    <Card
      title="Topic blocklist"
      sub="Tickets and site-chat messages mentioning these keywords never get an AI-written answer. With a set response, that exact text is used instead (in chat it is sent as is; for tickets it is sent in Live mode, a private note in Learning mode). Without one, tickets are only tagged and left for a person, and the chat says customer service handles it and offers a handoff."
      action={rows.length < 50 && <Btn small onClick={() => setC({ blocklist: [...rows, { topic: "", keywords: "", response: "" }] })}>+ Add topic</Btn>}
    >
      {rows.length === 0 && <p className="hint">No blocked topics. Common ones: chargebacks, legal questions, warranty claims, wholesale pricing.</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid2" style={{ borderTop: i ? "1px solid var(--line)" : 0, paddingTop: i ? 14 : 0, marginBottom: 14 }}>
          <Field label="Topic" htmlFor={`bl-t-${i}`}>
            <input type="text" id={`bl-t-${i}`} value={r.topic} placeholder="e.g. Chargebacks" onChange={(e) => update(i, { topic: e.target.value })} />
          </Field>
          <Field label="Keywords" htmlFor={`bl-k-${i}`} hint="Comma-separated whole words or phrases.">
            <input type="text" id={`bl-k-${i}`} value={r.keywords} placeholder="chargeback, dispute, bank claim" onChange={(e) => update(i, { keywords: e.target.value })} />
          </Field>
          <Field label="Set response (optional)" htmlFor={`bl-r-${i}`} full>
            <textarea id={`bl-r-${i}`} rows={3} value={r.response} onChange={(e) => update(i, { response: e.target.value })} />
          </Field>
          <div className="full">
            <Btn small danger onClick={() => setC({ blocklist: rows.filter((_, j) => j !== i) })}>Remove topic</Btn>
          </div>
        </div>
      ))}
      {incomplete && <Alert tone="warn">Topics without a name or keywords are dropped when you save.</Alert>}
    </Card>
  );
}

const ACTIONS: Record<string, { label: string; tone: Tone }> = {
  drafted: { label: "Drafted", tone: "info" },
  replied: { label: "Replied", tone: "good" },
  blocked: { label: "Blocked topic", tone: "warn" },
  skipped: { label: "Skipped", tone: "muted" },
  error: { label: "Error", tone: "crit" },
};

function ActivityCard() {
  const { store } = useSettings();
  const [open, setOpen] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [msg, setMsg] = useState<OpResult | null>(null);
  // @ts-ignore
  const [{ data, fetching, error }, refetch] = useFindMany(api.crmTicket, { sort: { createdAt: "Descending" }, first: 100 });
  // Background checks add rows; keep the list current while the tab is open.
  useEffect(() => {
    const t = setInterval(() => refetch({ requestPolicy: "network-only" }), 15000);
    return () => clearInterval(t);
  }, []);
  const rows: any[] = data ? [...data] : [];

  const reviewed = rows.filter((r) => typeof r.similarity === "number");
  const avg = reviewed.length ? reviewed.reduce((n, r) => n + r.similarity, 0) / reviewed.length : null;
  const count = (a: string) => rows.filter((r) => r.action === a).length;

  const retry = async (ticketId: number) => {
    setRetrying(ticketId); setMsg(null);
    setMsg(await crmOp({ op: "retry", ticketId }));
    setRetrying(null);
    refetch({ requestPolicy: "network-only" });
  };

  return (
    <Card
      title="Recent tickets"
      sub={
        rows.length
          ? `Last ${rows.length}: ${count("drafted")} drafted · ${count("replied")} replied · ${count("blocked")} blocked · ${count("error")} errors` +
            (avg != null ? ` · agents kept ${Math.round(avg * 100)}% of draft wording on average (${reviewed.length} reviewed)` : "")
          : "Tickets the bot handles show up here."
      }
      action={<Btn small onClick={() => refetch({ requestPolicy: "network-only" })}>Refresh</Btn>}
    >
      {error && <Alert tone="crit">Couldn't load ticket activity.</Alert>}
      {fetching && !data && <Loading />}
      {msg && <Alert tone={msg.ok ? "good" : "crit"}>{msg.message}</Alert>}
      {rows.length > 0 && (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>When</th><th>Ticket</th><th>Subject</th><th>Outcome</th><th className="num">Kept</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const a = ACTIONS[r.action] || { label: r.action, tone: "muted" as Tone };
                return [
                  <tr key={r.id} className="click" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmt(r.createdAt)}</td>
                    <td><a href={freshdeskTicketUrl(store, r.ticketId)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>#{r.ticketId}</a></td>
                    <td className="ellipsis">{r.subject || "(no subject)"}</td>
                    <td>
                      <Tag tone={a.tone}>{a.label}</Tag>{" "}
                      {r.action === "drafted" && r.confident === false && <Tag tone="warn">Needs agent</Tag>}
                    </td>
                    <td className="num">{typeof r.similarity === "number" ? `${Math.round(r.similarity * 100)}%` : "—"}</td>
                  </tr>,
                  open === r.id && (
                    <tr key={`${r.id}-d`}>
                      <td colSpan={5} style={{ background: "var(--code)" }}>
                        {r.blockedTopic && <p><b>Blocked topic:</b> {r.blockedTopic}</p>}
                        {r.reason && <p className="hint" style={{ marginTop: 0 }}>{r.reason}</p>}
                        {r.question && <><div className="ghead">Customer</div><p style={{ whiteSpace: "pre-wrap" }}>{r.question}</p></>}
                        {r.draft && <><div className="ghead">{r.action === "replied" ? "Sent reply" : "AI draft"}</div><p style={{ whiteSpace: "pre-wrap" }}>{r.draft}</p></>}
                        {r.finalReply && <><div className="ghead">What the agent sent</div><p style={{ whiteSpace: "pre-wrap" }}>{r.finalReply}</p></>}
                        {r.action === "error" && (
                          <div style={{ marginTop: 8 }}><Btn small loading={retrying === r.ticketId} onClick={() => retry(r.ticketId)}>Retry</Btn></div>
                        )}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PreviewCard() {
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<OpResult | null>(null);
  const run = async () => {
    setBusy(true); setRes(null);
    setRes(await crmOp({ op: "preview", subject, text }));
    setBusy(false);
  };
  return (
    <Card title="Try it" sub="Paste a customer message to see the draft the bot would write, using the saved settings and synced history. Nothing is posted to Freshdesk.">
      <div className="grid2">
        <Field label="Subject" htmlFor="pv-s"><input type="text" id="pv-s" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
        <Field label="Customer message" htmlFor="pv-t" full>
          <textarea id="pv-t" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Btn primary loading={busy} disabled={!text.trim()} onClick={run}>Draft a reply</Btn>
      </div>
      {res && !res.ok && <Alert tone="crit">{res.message}</Alert>}
      {res?.ok && (
        <div style={{ marginTop: 12 }}>
          <div className="row">
            <Tag tone={res.confident ? "good" : "warn"}>{res.confident ? "Confident — Live mode would send this" : "Not confident — would stay a private draft"}</Tag>
            {res.model && <span className="hint mono">{res.model}</span>}
          </div>
          {res.reason && <p className="hint">{res.reason}</p>}
          <p style={{ whiteSpace: "pre-wrap", marginTop: 8, background: "var(--code)", padding: 12, borderRadius: 8 }}>{res.reply}</p>
        </div>
      )}
    </Card>
  );
}
