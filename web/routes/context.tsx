import { useFindFirst } from "@gadgetinc/react";
import { Fragment, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api";
import { GUARDRAILS } from "../../api/lib/defaults";
import { freshdeskConnected } from "../../api/lib/integrations";
import { CONTEXT_DEFAULTS, useSettings, type ContextKey } from "../lib/settings";
import { download, downloadRows, stamp, textBlockRows } from "../lib/download";
import { exportConversations, feedbackRows, historyRows } from "../lib/exports";
import { Alert, Btn, Card, Loading, Tag } from "../components/ui";

type Source = {
  id: string;
  name: string;
  kind: string;
  field?: ContextKey;
  note?: string;
};

const SOURCES: Source[] = [
  { id: "guidelines", name: "General guidelines", kind: "System prompt", field: "systemPrompt" },
  { id: "faq", name: "Store FAQ & policies", kind: "One ## heading per topic", field: "faq" },
  { id: "catalog", name: "Product catalog", kind: "BigCommerce, read live by the bot's tools" },
  { id: "freshdesk", name: "Freshdesk ticket history", kind: "Nightly sync, agent replies only" },
  { id: "playbook", name: "Sales playbook", kind: "Versioned, written by the learning loop" },
  { id: "incentive", name: "Incentive instructions", kind: "Objection handling and tone", field: "incentiveInstructions", note: "Used once the closing incentive is turned on" },
  { id: "safeguards", name: "Safeguards instructions", kind: "Refusal wording only", field: "safeguardsInstructions" },
  { id: "voice", name: "Voice & tone", kind: "How the bot sounds", field: "voiceTone" },
];

const savedBlock = (store: any, k: ContextKey) => (store?.[k]?.trim() ? store[k] : CONTEXT_DEFAULTS[k]);

export const ContextPage = () => {
  const { store, draft, set, loading } = useSettings();
  const [editing, setEditing] = useState<ContextKey | null>(null);
  const [catalog, setCatalog] = useState<{ count?: number; fetchedAt?: string; error?: string; loading?: boolean }>({ loading: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showGuardrails, setShowGuardrails] = useState(false);
  const [voiceGen, setVoiceGen] = useState<{ tone: "good" | "crit"; text: string } | null>(null);
  const [syncMsg, setSyncMsg] = useState<{ tone: "good" | "crit"; text: string } | null>(null);
  const navigate = useNavigate();
  // Freshdesk sync state is read on its own (like the Freshdesk tab), so the row
  // refreshes while a background sync runs without touching unsaved edits.
  // @ts-ignore
  const [{ data: live }, refetchCrm] = useFindFirst(api.bigcommerce.store, { select: { id: true, crmState: true } });
  const [pollUntil, setPollUntil] = useState(0);
  useEffect(() => {
    if (!pollUntil) return;
    const t = setInterval(() => {
      if (Date.now() > pollUntil) { setPollUntil(0); return; }
      refetchCrm({ requestPolicy: "network-only" });
    }, 5000);
    return () => clearInterval(t);
  }, [pollUntil]);
  const crmState: any = (live as any)?.crmState || store?.crmState || {};

  const resync = async () => {
    setBusy("resync");
    setSyncMsg(null);
    try {
      // @ts-ignore — global action
      const r = await api.crmAdmin({ op: "syncNow" });
      setSyncMsg({ tone: r.ok ? "good" : "crit", text: r.message || (r.ok ? "History sync started." : "Sync failed.") });
      if (r.ok) setPollUntil(Date.now() + 3 * 60 * 1000);
    } catch (e: any) {
      setSyncMsg({ tone: "crit", text: e?.message || "Sync failed." });
    }
    setBusy(null);
  };

  const loadCatalogCount = async () => {
    setCatalog((c) => ({ ...c, loading: true, error: undefined }));
    try {
      // @ts-ignore — global action
      const r = await api.getCatalog({ full: false });
      setCatalog({ count: r.count, fetchedAt: r.fetchedAt });
    } catch (e: any) {
      setCatalog({ error: "Couldn't read the catalog from BigCommerce." });
    }
  };
  useEffect(() => { loadCatalogCount(); }, []);

  if (loading || !draft) return <Loading />;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setExportError(null);
    try { await fn(); } catch (e: any) { setExportError(`Export failed: ${e?.message || "unknown error"}`); }
    setBusy(null);
  };

  const catalogProducts = async () => {
    // @ts-ignore — global action
    const r = await api.getCatalog({ full: true });
    return r.products as Record<string, unknown>[];
  };

  // Fills the editor only; the admin reviews it and saves with the other settings.
  const generateVoice = async () => {
    setBusy("voice-gen");
    setVoiceGen(null);
    try {
      // @ts-ignore — global action
      const r = await api.crmAdmin({ op: "voiceTone" });
      if (r?.ok && r.text) {
        set("voiceTone", r.text);
        setEditing("voiceTone");
        const b = r.basedOn || {};
        const range = b.from && b.to ? ` (${new Date(b.from).toLocaleDateString()} – ${new Date(b.to).toLocaleDateString()})` : "";
        setVoiceGen({ tone: "good", text: `Generated from ${b.sampled} of ${b.replies} agent replies${range}. Review it below, then Save settings.` });
      } else {
        setVoiceGen({ tone: "crit", text: r?.message || "Generation failed." });
      }
    } catch (e: any) {
      setVoiceGen({ tone: "crit", text: e?.message || "Generation failed." });
    }
    setBusy(null);
  };

  const exportSource = (s: Source, format: "csv" | "json") =>
    run(`${s.id}-${format}`, async () => {
      if (s.field) {
        const text = savedBlock(store, s.field);
        if (format === "json") download(`${s.id}-${stamp()}.json`, JSON.stringify({ source: s.name, content: text }, null, 2), "application/json");
        else downloadRows(`${s.id}-${stamp()}`, "csv", textBlockRows(text), ["topic", "content"]);
      } else if (s.id === "catalog") {
        downloadRows(`catalog-${stamp()}`, format, await catalogProducts());
      } else if (s.id === "freshdesk") {
        downloadRows(`freshdesk-history-${stamp()}`, format, await historyRows());
      } else if (s.id === "playbook") {
        const version = store?.learningState?.activeVersion ?? null;
        if (format === "json") download(`playbook-${stamp()}.json`, JSON.stringify({ source: s.name, version, content: store.salesPlaybook }, null, 2), "application/json");
        else downloadRows(`playbook-${stamp()}`, "csv", textBlockRows(store.salesPlaybook), ["topic", "content"]);
      }
    });

  const exportAll = () =>
    run("all", async () => {
      const bundle = {
        exportedAt: new Date().toISOString(),
        store: store?.storeHash,
        builtInGuardrails: GUARDRAILS,
        sources: {
          generalGuidelines: savedBlock(store, "systemPrompt"),
          faq: savedBlock(store, "faq"),
          productCatalog: await catalogProducts(),
          freshdeskTicketHistory: await historyRows(),
          salesPlaybook: store?.salesPlaybook?.trim() ? { version: store?.learningState?.activeVersion ?? null, content: store.salesPlaybook } : null,
          incentiveInstructions: savedBlock(store, "incentiveInstructions"),
          safeguardsInstructions: savedBlock(store, "safeguardsInstructions"),
          voiceTone: savedBlock(store, "voiceTone"),
        },
      };
      download(`context-all-${stamp()}.json`, JSON.stringify(bundle, null, 2), "application/json");
    });

  const status = (s: Source) => {
    if (s.field) {
      const custom = draft[s.field].trim() !== CONTEXT_DEFAULTS[s.field].trim();
      return <Tag tone="good">{custom ? "Active · customized" : "Active · default"}</Tag>;
    }
    if (s.id === "catalog") return catalog.error ? <Tag tone="crit">Error</Tag> : <Tag tone="good">Live</Tag>;
    if (s.id === "freshdesk") {
      if (!freshdeskConnected(store)) return <Tag>Not connected</Tag>;
      if (crmState.lastSyncError) return <Tag tone="crit">Sync error</Tag>;
      if (crmState.syncPausedUntil && new Date(crmState.syncPausedUntil) > new Date()) return <Tag tone="warn">Syncing</Tag>;
      return crmState.lastSyncAt ? <Tag tone="good">Synced</Tag> : <Tag tone="warn">Waiting for first sync</Tag>;
    }
    if (s.id === "playbook") {
      return store?.salesPlaybook?.trim() ? <Tag tone="good">{`Active · v${store?.learningState?.activeVersion ?? "?"}`}</Tag> : <Tag>No version live</Tag>;
    }
    return <Tag>Not started</Tag>;
  };

  const meta = (s: Source) => {
    const parts = [s.kind];
    if (s.id === "faq") parts.push(`${draft.faq.split(/\n(?=## )/).filter((x) => x.trim()).length} topics`);
    else if (s.field) parts.push(`${draft[s.field].length.toLocaleString()} chars`);
    if (s.field && store?.updatedAt) parts.push(`saved ${new Date(store.updatedAt).toLocaleDateString()}`);
    const seed = store?.crmState?.voiceSeed;
    if (s.id === "voice" && seed?.at && store?.voiceTone?.trim()) parts.push(`seeded from ${(seed.replies ?? 0).toLocaleString()} agent replies on ${new Date(seed.at).toLocaleDateString()}`);
    if (s.id === "freshdesk" && crmState.lastSyncAt) {
      parts.push(`${(crmState.historyCount ?? 0).toLocaleString()} tickets`, `last sync ${new Date(crmState.lastSyncAt).toLocaleString()}`);
      if (crmState.historyFrom) parts.push(`since ${new Date(crmState.historyFrom).toLocaleDateString()}`);
      if (crmState.archive && !crmState.archive.done) parts.push(`backfilling archived tickets (${(crmState.archive.found ?? 0).toLocaleString()} found)`);
    }
    if (s.id === "catalog") {
      if (catalog.loading) parts.push("counting…");
      else if (catalog.count != null) parts.push(`${catalog.count.toLocaleString()} products`);
      if (catalog.fetchedAt) parts.push(`counted ${new Date(catalog.fetchedAt).toLocaleTimeString()}`);
    }
    if (s.id === "playbook" && store?.salesPlaybook?.trim()) parts.push(`${store.salesPlaybook.length.toLocaleString()} chars`);
    if (s.note) parts.push(s.note);
    return parts.join(" · ");
  };

  const exportBtns = (s: Source) => (
    <>
      <Btn small loading={busy === `${s.id}-csv`} onClick={() => exportSource(s, "csv")}>CSV</Btn>
      <Btn small loading={busy === `${s.id}-json`} onClick={() => exportSource(s, "json")}>JSON</Btn>
    </>
  );

  const actions = (s: Source) => {
    if (s.field) {
      return (
        <>
          <Btn small onClick={() => setEditing(editing === s.field ? null : s.field!)}>{editing === s.field ? "Close" : "Edit"}</Btn>
          {s.id === "voice" && freshdeskConnected(store) && (
            <Btn small loading={busy === "voice-gen"} onClick={generateVoice} title="Analyze the agent replies synced from Freshdesk in the last 12 months">Generate from tickets</Btn>
          )}
          {exportBtns(s)}
        </>
      );
    }
    if (s.id === "catalog") {
      return (
        <>
          <Btn small loading={catalog.loading} onClick={loadCatalogCount}>Refresh</Btn>
          {exportBtns(s)}
        </>
      );
    }
    if (s.id === "freshdesk") {
      if (!freshdeskConnected(store)) return <span className="hint">Connect Freshdesk under Integrations</span>;
      return (
        <>
          <Btn small loading={busy === "resync"} onClick={resync} title="Pull resolved/closed tickets from the last 12 months now">{crmState.lastSyncAt ? "Re-sync now" : "Sync now"}</Btn>
          {exportBtns(s)}
        </>
      );
    }
    if (s.id === "playbook") {
      return (
        <>
          <Btn small onClick={() => navigate("/learning")}>Manage</Btn>
          {store?.salesPlaybook?.trim() ? exportBtns(s) : null}
        </>
      );
    }
    return null;
  };

  return (
    <>
      <Card
        title="Context sources"
        sub="Everything the bot knows about your store. Each source exports on its own; Export all bundles the eight. Edits take effect after you save."
        action={<Btn loading={busy === "all"} onClick={exportAll}>Export all</Btn>}
      >
        {exportError && <Alert tone="crit">{exportError}</Alert>}
        {catalog.error && <Alert tone="warn">{catalog.error}</Alert>}
        {SOURCES.map((s, i) => (
          <Fragment key={s.id}>
            <div className={i === 0 ? "srcrow first" : "srcrow"}>
              <div className="grow"><b>{s.name}</b><div className="meta">{meta(s)}</div></div>
              {status(s)}
              {actions(s)}
            </div>
            {s.id === "voice" && voiceGen && <Alert tone={voiceGen.tone}>{voiceGen.text}</Alert>}
            {s.id === "freshdesk" && syncMsg && <Alert tone={syncMsg.tone}>{syncMsg.text}</Alert>}
            {s.field && editing === s.field && (
              <div className="editor">
                <textarea
                  className="tall"
                  aria-label={s.name}
                  value={draft[s.field]}
                  onChange={(e) => set(s.field!, e.target.value)}
                />
                <div className="row" style={{ marginTop: 6 }}>
                  <span className="hint">
                    {s.field === "faq" ? "Start each topic with a '## Heading' line. " : ""}Saved with the other settings (Save settings, top right).
                  </span>
                  <div className="spacer" />
                  <Btn small onClick={() => set(s.field!, CONTEXT_DEFAULTS[s.field!])}>Reset to default</Btn>
                </div>
              </div>
            )}
          </Fragment>
        ))}
        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn link" onClick={() => setShowGuardrails((v) => !v)}>
            {showGuardrails ? "Hide built-in guardrails" : "Show built-in guardrails (always applied, not editable)"}
          </button>
          {showGuardrails && <div className="codebox mono" style={{ marginTop: 8 }}>{GUARDRAILS}</div>}
        </div>
      </Card>

      <Card title="Data exports" sub="CSV or JSON.">
        <div className="srcrow first">
          <div className="grow"><b>Conversations</b><div className="meta">Full transcripts with per-message metadata: tools called, flags</div></div>
          <Btn small loading={busy === "conv-csv"} onClick={() => run("conv-csv", () => exportConversations("csv"))}>CSV</Btn>
          <Btn small loading={busy === "conv-json"} onClick={() => run("conv-json", () => exportConversations("json"))}>JSON</Btn>
        </div>
        <div className="srcrow">
          <div className="grow"><b>Freshdesk feedback</b><div className="meta">Draft vs sent diffs from the learning phase</div></div>
          <Btn small loading={busy === "fb-csv"} onClick={() => run("fb-csv", async () => downloadRows(`freshdesk-feedback-${stamp()}`, "csv", await feedbackRows()))}>CSV</Btn>
          <Btn small loading={busy === "fb-json"} onClick={() => run("fb-json", async () => downloadRows(`freshdesk-feedback-${stamp()}`, "json", await feedbackRows()))}>JSON</Btn>
        </div>
      </Card>
    </>
  );
};
