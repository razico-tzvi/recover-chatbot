import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { PLAYBOOK_MAX_CHARS } from "../../api/lib/defaults";
import { downloadRows, stamp } from "../lib/download";
import { money } from "./analytics";
import { Alert, Btn, Card, Field, Loading, Modal, Switch, Tag, type Tone } from "../components/ui";

type Stats = {
  conversations: number; settled: number; conversions: number; direct: number; assisted: number;
  revenue: Record<string, number>; conversionRate: number | null;
};
type Version = {
  id: string; version: number; status: "proposed" | "active" | "retired" | "rejected";
  content: string; rationale: string; changes: string[]; model: string; trigger: string; edited: boolean;
  basedOn: { from: string | null; to: string; settled: number; conversions: number; conversionRate: number; sampledConverted: number; sampledNotConverted: number; previousVersion: number } | null;
  createdAt: string; decidedAt: string | null; activatedAt: string | null; retiredAt: string | null;
  stats: Stats;
};
type Status = {
  settings: { auto: boolean; minSettled: number; minConversions: number };
  manualMin: { settled: number; conversions: number };
  state: { activeVersion: number; cursor: string | null; lastCheckAt: string | null; lastRunAt: string | null; lastRunError: string | null; running: string | null };
  progress: { conversations: number; settled: number; conversions: number };
  truncated: boolean;
  baseline: Stats;
  versions: Version[];
};
type Result = { ok: boolean; message?: string };

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const date = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const when = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : "never");

const STATUS_TAG: Record<Version["status"], { tone: Tone; label: string }> = {
  proposed: { tone: "warn", label: "Awaiting review" },
  active: { tone: "good", label: "Live" },
  retired: { tone: "muted", label: "Retired" },
  rejected: { tone: "crit", label: "Rejected" },
};

// @ts-ignore — global action
const call = (op: string, args: Record<string, unknown> = {}) => api.learningAdmin({ op, ...args }) as Promise<any>;

export const LearningPage = () => {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Version | null>(null);
  const [confirming, setConfirming] = useState<{ label: string; op: string; args: Record<string, unknown>; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await call("status");
      setData(r);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Couldn't load the learning loop.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // While an analysis runs in the background, refresh until it lands.
  const running = !!data?.state.running;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [running, load]);

  // Destructive steps go through a confirm dialog (window.confirm can be blocked
  // inside the control panel's iframe).
  const act = async (label: string, op: string, args: Record<string, unknown> = {}, confirmText?: string) => {
    if (confirmText) { setConfirming({ label, op, args, text: confirmText }); return; }
    setConfirming(null);
    setBusy(label);
    setNotice(null);
    try {
      const r: Result = await call(op, args);
      setNotice(r);
      if (r.ok) setViewing(null);
    } catch (e: any) {
      setNotice({ ok: false, message: e?.message || "Something went wrong." });
    }
    await load();
    setBusy(null);
  };

  if (error && !data) return <Alert tone="crit">{error}</Alert>;
  if (!data) return <Loading />;

  const proposed = data.versions.find((v) => v.status === "proposed");
  const active = data.versions.find((v) => v.status === "active");

  return (
    <>
      {notice?.message && <Alert tone={notice.ok ? "good" : "crit"}>{notice.message}</Alert>}
      <LoopCard data={data} active={active} hasProposal={!!proposed} busy={busy} act={act} onSaved={load} />
      {proposed && <ProposalCard key={proposed.id} p={proposed} active={active} busy={busy} act={act} />}
      <VersionsCard data={data} busy={busy} act={act} onView={setViewing} />
      {viewing && !confirming && <VersionModal v={viewing} busy={busy} act={act} onClose={() => setViewing(null)} />}
      {confirming && (
        <Modal
          title="Please confirm"
          onClose={() => setConfirming(null)}
          footer={<Btn primary onClick={() => act(confirming.label, confirming.op, confirming.args)}>Confirm</Btn>}
        >
          <p>{confirming.text}</p>
        </Modal>
      )}
    </>
  );
};

type Act = (label: string, op: string, args?: Record<string, unknown>, confirmText?: string) => Promise<void>;

function Meter({ label, value, target }: { label: string; value: number; target: number }) {
  const done = value >= target;
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value.toLocaleString()}<span className="desc" style={{ fontSize: 14 }}>{` / ${target.toLocaleString()}`}</span></div>
      <div className="fbar" style={{ marginTop: 8 }} role="progressbar" aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(value, target)} aria-label={label}>
        <i style={{ width: `${Math.min(100, (value / target) * 100)}%`, background: done ? "var(--good)" : undefined }} />
      </div>
    </div>
  );
}

function LoopCard({ data, active, hasProposal, busy, act, onSaved }: { data: Status; active?: Version; hasProposal: boolean; busy: string | null; act: Act; onSaved: () => void }) {
  const { settings, state, progress, manualMin } = data;
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings.auto, settings.minSettled, settings.minConversions]);
  const dirty = form.auto !== settings.auto || form.minSettled !== settings.minSettled || form.minConversions !== settings.minConversions;
  const belowManual = progress.settled < manualMin.settled || progress.conversions < manualMin.conversions;
  const ready = progress.settled >= settings.minSettled && progress.conversions >= settings.minConversions;

  let runHint = "";
  if (hasProposal) runHint = "Review the proposed version below first.";
  else if (belowManual) runHint = `Needs at least ${manualMin.settled} settled conversations with ${manualMin.conversions} conversions.`;
  else if (!ready) runHint = "Below the thresholds — a proposal from less data is less reliable.";

  return (
    <Card
      title="Sales learning loop"
      sub="Compares chats that ended in an order with chats that didn't, and proposes a new sales playbook version. Nothing goes live until you approve it, and any earlier version can be restored."
      action={
        <div style={{ textAlign: "right" }}>
          <Btn primary loading={busy === "run" || !!state.running} disabled={hasProposal || belowManual} onClick={() => act("run", "run")}>
            Run analysis now
          </Btn>
          {runHint && <div className="hint" style={{ maxWidth: 260 }}>{runHint}</div>}
        </div>
      }
    >
      {state.running && <Alert tone="info">Analysis running — started {new Date(state.running).toLocaleTimeString()}. This page refreshes when it's done.</Alert>}
      {state.lastRunError && !state.running && <Alert tone="crit">{`Last analysis failed: ${state.lastRunError}`}</Alert>}
      {data.truncated && <Alert tone="info">Per-version numbers cover the most recent 20,000 conversations.</Alert>}

      <div className="stats">
        <div className="stat">
          <div className="label">Live playbook</div>
          <div className="value">{active ? `v${active.version}` : "None"}</div>
          <div className="hint">{active ? `since ${date(active.activatedAt)}` : "the bot uses only your guidelines"}</div>
        </div>
        <Meter label="Settled conversations" value={progress.settled} target={settings.minSettled} />
        <Meter label="Conversions" value={progress.conversions} target={settings.minConversions} />
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        {`Counted since ${state.cursor ? `the last proposal (${date(state.cursor)})` : "the first chat"}. A conversation is settled once it ends in an order, or its 7-day assisted-order window passes without one. `}
        {`${progress.conversations.toLocaleString()} conversations in this period. Last automatic check: ${when(state.lastCheckAt)}.`}
      </p>

      <div className="frow" style={{ marginTop: 14 }}>
        <div className="name">
          Propose new versions automatically
          <div className="desc">Checked daily. When both thresholds are met, the loop writes a proposal for you to review.</div>
        </div>
        <Switch label="Propose automatically" checked={form.auto} onChange={() => setForm({ ...form, auto: !form.auto })} />
      </div>
      <div className="grid2" style={{ marginTop: 6 }}>
        <Field label="Settled conversations needed" htmlFor="minSettled" hint="Since the last proposal. 20 or more.">
          <input id="minSettled" type="number" min={20} value={form.minSettled} onChange={(e) => setForm({ ...form, minSettled: Number(e.target.value) })} />
        </Field>
        <Field label="Of which converted" htmlFor="minConversions" hint="Direct or assisted orders. 5 or more.">
          <input id="minConversions" type="number" min={5} value={form.minConversions} onChange={(e) => setForm({ ...form, minConversions: Number(e.target.value) })} />
        </Field>
      </div>
      {dirty && (
        <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
          <Btn onClick={() => setForm(settings)}>Discard</Btn>
          <Btn primary loading={busy === "settings"} onClick={async () => { await act("settings", "settings", form); onSaved(); }}>Save learning settings</Btn>
        </div>
      )}
    </Card>
  );
}

function BasedOn({ v }: { v: Version }) {
  const b = v.basedOn;
  if (!b) return null;
  return (
    <p className="hint">
      {`Based on ${b.settled.toLocaleString()} settled conversations with ${b.conversions.toLocaleString()} conversions (${pct(b.conversionRate)})`}
      {`${b.from ? ` from ${date(b.from)}` : ""} to ${date(b.to)}; read ${b.sampledConverted} converted and ${b.sampledNotConverted} non-converted chats. `}
      {`${v.trigger === "manual" ? "Run by hand" : "Proposed automatically"}${v.model ? ` · ${v.model}` : ""}.`}
    </p>
  );
}

function ProposalCard({ p, active, busy, act }: { p: Version; active?: Version; busy: string | null; act: Act }) {
  const [text, setText] = useState(p.content);
  const [compare, setCompare] = useState(false);
  const edited = text.trim() !== p.content.trim();
  return (
    <Card title={<span className="row">{`Proposed version ${p.version}`} <Tag tone="warn">Awaiting review</Tag></span>} sub={<BasedOn v={p} />}>
      {p.rationale && <div className="note">{p.rationale}</div>}
      {p.changes.length > 0 && (
        <>
          <div className="ghead">{active ? `Changes vs. version ${active.version}` : "What it adds"}</div>
          <ul style={{ margin: "6px 0 14px", paddingLeft: 20 }}>
            {p.changes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </>
      )}
      <div className="row between" style={{ marginBottom: 6 }}>
        <label htmlFor="proposal" style={{ margin: 0 }}>Playbook text {edited && <Tag tone="info">Edited</Tag>}</label>
        <div className="row">
          {active && <button type="button" className="btn link" onClick={() => setCompare((v) => !v)}>{compare ? "Hide live version" : `Compare with live v${active.version}`}</button>}
          {edited && <button type="button" className="btn link" onClick={() => setText(p.content)}>Undo edits</button>}
        </div>
      </div>
      <div className={compare && active ? "grid2" : undefined}>
        <textarea id="proposal" className="tall" value={text} maxLength={PLAYBOOK_MAX_CHARS} onChange={(e) => setText(e.target.value)} />
        {compare && active && <div className="codebox mono" style={{ maxHeight: 420, overflowY: "auto" }}>{active.content}</div>}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="hint">{`${text.length.toLocaleString()} / ${PLAYBOOK_MAX_CHARS.toLocaleString()} characters. Added to the bot's instructions after your guidelines; the built-in guardrails still win.`}</span>
        <div className="spacer" />
        <Btn danger loading={busy === "reject"} onClick={() => act("reject", "reject", { versionId: p.id }, `Reject version ${p.version}? The live playbook stays as it is; the next proposal learns from chats started after this one was made.`)}>Reject</Btn>
        <Btn primary loading={busy === "approve"} disabled={!text.trim()} onClick={() => act("approve", "approve", { versionId: p.id, content: text })}>
          {edited ? "Approve with edits" : "Approve & go live"}
        </Btn>
      </div>
    </Card>
  );
}

function VersionsCard({ data, busy, act, onView }: { data: Status; busy: string | null; act: Act; onView: (v: Version) => void }) {
  const decided = data.versions.filter((v) => v.status !== "proposed");
  const rows: { key: string; label: string; v?: Version; stats: Stats; period: string }[] = [
    ...decided.map((v) => ({
      key: v.id,
      label: `v${v.version}`,
      v,
      stats: v.stats,
      period: v.activatedAt ? `${date(v.activatedAt)} – ${v.status === "active" ? "now" : date(v.retiredAt)}` : "never live",
    })),
    { key: "baseline", label: "No playbook", stats: data.baseline, period: data.state.activeVersion ? "" : "now" },
  ];

  const exportRows = () =>
    rows.map((r) => ({
      version: r.v?.version ?? 0,
      status: r.v?.status ?? (data.state.activeVersion ? "baseline" : "active"),
      activatedAt: r.v?.activatedAt ?? "",
      retiredAt: r.v?.retiredAt ?? "",
      conversations: r.stats.conversations,
      settled: r.stats.settled,
      conversions: r.stats.conversions,
      direct: r.stats.direct,
      assisted: r.stats.assisted,
      conversionRate: r.stats.conversionRate ?? "",
      revenue: r.stats.revenue,
      content: r.v?.content ?? "",
      rationale: r.v?.rationale ?? "",
    }));

  return (
    <Card
      title="Versions & conversion"
      sub="Each chat counts toward the version that was live when it started. Conversion rate = conversions ÷ settled conversations."
      action={
        <div className="row">
          <Btn small onClick={() => downloadRows(`playbook-versions-${stamp()}`, "csv", exportRows())}>CSV</Btn>
          <Btn small onClick={() => downloadRows(`playbook-versions-${stamp()}`, "json", exportRows())}>JSON</Btn>
        </div>
      }
    >
      {!decided.length && <p className="hint" style={{ marginBottom: 10 }}>No approved versions yet. Until one goes live, every chat counts toward "No playbook", which is the baseline later versions are compared with.</p>}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Version</th><th>Status</th><th>Live</th>
              <th className="num">Chats</th><th className="num">Settled</th><th className="num">Orders</th><th className="num">Conv. rate</th><th className="num">Revenue</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><b>{r.label}</b>{r.v?.edited && <span className="desc"> · edited</span>}</td>
                <td>
                  {r.v ? <Tag tone={STATUS_TAG[r.v.status].tone}>{STATUS_TAG[r.v.status].label}</Tag>
                    : !data.state.activeVersion ? <Tag tone="good">Live</Tag> : <Tag>Baseline</Tag>}
                </td>
                <td className="desc">{r.period}</td>
                <td className="num">{r.stats.conversations.toLocaleString()}</td>
                <td className="num">{r.stats.settled.toLocaleString()}</td>
                <td className="num">{r.stats.conversions.toLocaleString()}</td>
                <td className="num"><b>{pct(r.stats.conversionRate)}</b></td>
                <td className="num">{money(r.stats.revenue)}</td>
                <td>
                  <div className="row" style={{ justifyContent: "flex-end", flexWrap: "nowrap" }}>
                    {r.v && <Btn small onClick={() => onView(r.v!)}>View</Btn>}
                    {r.v?.status === "retired" && (
                      <Btn small loading={busy === `restore-${r.v.id}`} onClick={() => act(`restore-${r.v!.id}`, "activate", { versionId: r.v!.id }, `Roll back to version ${r.v!.version}? New chats will use it right away.`)}>Restore</Btn>
                    )}
                    {r.v?.status === "active" && (
                      <Btn small danger loading={busy === "off"} onClick={() => act("off", "deactivate", {}, "Turn the playbook off? New chats will run without one until you restore a version.")}>Turn off</Btn>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function VersionModal({ v, busy, act, onClose }: { v: Version; busy: string | null; act: Act; onClose: () => void }) {
  return (
    <Modal
      title={`Version ${v.version}`}
      badge={<Tag tone={STATUS_TAG[v.status].tone}>{STATUS_TAG[v.status].label}</Tag>}
      sub={<BasedOn v={v} />}
      onClose={onClose}
      footer={v.status === "retired" ? (
        <Btn primary loading={busy === `restore-${v.id}`} onClick={() => act(`restore-${v.id}`, "activate", { versionId: v.id }, `Roll back to version ${v.version}? New chats will use it right away.`)}>Restore this version</Btn>
      ) : undefined}
    >
      {v.rationale && <div className="note">{v.rationale}</div>}
      {v.changes.length > 0 && (
        <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>{v.changes.map((c, i) => <li key={i}>{c}</li>)}</ul>
      )}
      {v.edited && <p className="hint" style={{ marginBottom: 6 }}>Edited before approval.</p>}
      <div className="codebox mono">{v.content}</div>
    </Modal>
  );
}
