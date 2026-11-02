import { useAction, useFindMany } from "@gadgetinc/react";
import { useState } from "react";
import { api } from "../api";
import { exportConversations } from "../lib/exports";
import { Alert, Btn, Card, Tag } from "../components/ui";

type Filter = "all" | "needsHuman" | "flagged";
const FILTERS: { id: Filter; label: string; match: (s: any) => boolean; where?: Record<string, unknown> }[] = [
  { id: "all", label: "All", match: () => true },
  { id: "needsHuman", label: "Needs human", match: (s) => !!s.needsHuman, where: { needsHuman: { equals: true } } },
  { id: "flagged", label: "Flagged", match: (s) => !!s.flagged, where: { flagged: { equals: true } } },
];

export const ConversationsPage = () => {
  const [selected, setSelected] = useState<any>(null);
  if (selected) return <Conversation session={selected} onBack={() => setSelected(null)} />;
  return <SessionList onSelect={setSelected} />;
};

function fmtDate(d: any) {
  try { return new Date(d).toLocaleString(); } catch (e) { return ""; }
}

function outcome(s: any) {
  if (s.flagged) return <Tag tone="crit">Flagged</Tag>;
  if (s.needsHuman) return <Tag tone="warn">Needs human</Tag>;
  return <Tag tone="good">Answered</Tag>;
}

function SessionList({ onSelect }: { onSelect: (s: any) => void }) {
  const [q, setQ] = useState("");
  // @ts-ignore
  const [{ data, fetching, error }] = useFindMany(api.chatSession, {
    sort: { updatedAt: "Descending" },
    first: 250,
  });

  const query = q.trim().toLowerCase();
  const [filter, setFilter] = useState<Filter>("all");
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportErr, setExportErr] = useState(false);
  const active = FILTERS.find((f) => f.id === filter)!;
  const sessions = (data || []).filter(
    (s: any) =>
      active.match(s) &&
      (!query || (s.preview || "").toLowerCase().includes(query) || (s.sessionId || "").toLowerCase().includes(query))
  );

  async function runExport(format: "csv" | "json") {
    setExporting(format); setExportErr(false);
    try { await exportConversations(format, active.where); } catch (e) { setExportErr(true); }
    setExporting(null);
  }

  return (
    <>
      <div className="pills">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={filter === f.id ? "pill on" : "pill"} onClick={() => setFilter(f.id)}>
            {`${f.label} · ${(data || []).filter(f.match).length}`}
          </button>
        ))}
        <div className="spacer" />
        <input type="search" placeholder="Search conversations…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 240 }} />
        <Btn small loading={exporting === "csv"} onClick={() => runExport("csv")}>Export CSV</Btn>
        <Btn small loading={exporting === "json"} onClick={() => runExport("json")}>Export JSON</Btn>
      </div>
      {exportErr && <Alert tone="crit">Export failed. Please try again.</Alert>}
      {error && <Alert tone="crit">Couldn't load conversations.</Alert>}
      <div className="card" style={{ padding: "6px 20px" }}>
        {fetching && !data && <div className="loading">Loading…</div>}
        {data && sessions.length === 0 && !fetching && (
          <p className="hint" style={{ padding: "12px 0" }}>
            {query ? "No conversations match your search." : "No conversations yet. They'll appear here once shoppers start chatting."}
          </p>
        )}
        {sessions.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>When</th><th>Channel</th><th>Preview</th><th>Outcome</th><th className="num">Messages</th><th>Model</th></tr>
              </thead>
              <tbody>
                {sessions.map((s: any) => (
                  <tr key={s.id} className="click" onClick={() => onSelect(s)}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtDate(s.updatedAt)}</td>
                    <td><Tag tone="info">Site</Tag></td>
                    <td className="ellipsis">{s.preview ? `"${s.preview}"` : "(no preview)"}</td>
                    <td>{outcome(s)}</td>
                    <td className="num">{s.messageCount ?? 0}</td>
                    <td className="mono">{s.model || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Conversation({ session, onBack }: { session: any; onBack: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState(false);
  const [needsHuman, setNeedsHuman] = useState(!!session.needsHuman);
  const [{ fetching: resolving }, updateSession] = useAction(api.chatSession.update);
  // @ts-ignore
  const [{ data, fetching, error }] = useFindMany(api.chatMessage, {
    filter: { sessionId: { equals: session.sessionId } },
    sort: { createdAt: "Ascending" },
    first: 250, // Gadget's max page size
  });

  async function handleDelete() {
    setBusy(true); setActionErr(false);
    try {
      const ids = (data || []).map((m: any) => m.id);
      // @ts-ignore
      if (ids.length) await api.chatMessage.bulkDelete(ids);
      // @ts-ignore
      await api.chatSession.delete(session.id);
      onBack();
    } catch (e) {
      setActionErr(true); setBusy(false); setConfirming(false);
    }
  }

  async function markResolved() {
    setActionErr(false);
    // @ts-ignore
    const result = await updateSession({ id: session.id, needsHuman: false });
    if (result.error) setActionErr(true);
    else setNeedsHuman(false);
  }

  function exportCsv() {
    const rows = [["role", "content", "time", "tools"]].concat(
      (data || []).map((m: any) => [m.role, m.content || "", fmtDate(m.createdAt), Array.isArray(m.tools) ? m.tools.join("|") : ""])
    );
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "conversation-" + session.sessionId + ".csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const meta = [session.provider, session.model].filter(Boolean).join(" · ");

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <Btn small onClick={onBack}>← Back</Btn>
        <div className="spacer" />
        <Btn small onClick={exportCsv} disabled={!data || data.length === 0}>Export CSV</Btn>
        {!confirming ? (
          <Btn small danger onClick={() => setConfirming(true)}>Delete</Btn>
        ) : (
          <>
            <Btn small danger primary onClick={handleDelete} loading={busy}>Confirm delete</Btn>
            <Btn small onClick={() => setConfirming(false)} disabled={busy}>Cancel</Btn>
          </>
        )}
      </div>

      {actionErr && <Alert tone="crit">Action failed. Please try again.</Alert>}
      {needsHuman && (
        <div className="card" style={{ background: "var(--warn-soft)", borderColor: "transparent" }}>
          <div className="row between" style={{ alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}>
              <h2>{"Handoff requested " + fmtDate(session.handoffAt)}</h2>
              <p className="hint">Reply to: <a href={"mailto:" + session.handoffEmail}>{session.handoffEmail}</a></p>
              {session.handoffSummary && <p style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{session.handoffSummary}</p>}
            </div>
            <Btn small onClick={markResolved} loading={resolving}>Mark resolved</Btn>
          </div>
        </div>
      )}
      {session.flagged && (
        <Alert tone="crit">{"Flagged " + fmtDate(session.flaggedAt) + " — " + (session.flagReason || "Flagged by a safeguard.")}</Alert>
      )}

      <Card title={"Transcript · " + fmtDate(session.createdAt)} sub={"Site chat" + (meta ? " · " + meta : "") + " · every AI message carries its tool metadata."}>
        {fetching && <div className="loading">Loading…</div>}
        {error && <Alert tone="crit">Couldn't load this conversation.</Alert>}
        {(data || []).map((m: any) => {
          const isUser = m.role === "user";
          const tools = Array.isArray(m.tools) && m.tools.length ? m.tools.join(", ") : "";
          return (
            <div key={m.id} className={isUser ? "msg" : "msg bot"}>
              <div className="who">{isUser ? "Customer" : "Assistant"} · {fmtDate(m.createdAt)}</div>
              {m.content?.trim() || null}
              {Array.isArray(m.images) && m.images.length > 0 && (
                <div className="row" style={{ marginTop: 6, gap: 6 }}>
                  {m.images.map((src: string, i: number) => <img key={i} src={src} alt={`Upload ${i + 1}`} />)}
                </div>
              )}
              {!isUser && tools && <div className="meta">tools: {tools}</div>}
            </div>
          );
        })}
      </Card>
    </>
  );
}
