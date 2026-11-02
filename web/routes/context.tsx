import { Badge, Box, Button, Flex, FormGroup, Message, Panel, Table, Text, Textarea } from "@bigcommerce/big-design";
import { useEffect, useState } from "react";
import { api } from "../api";
import { GUARDRAILS } from "../../api/lib/defaults";
import { freshdeskConnected } from "../../api/lib/integrations";
import { CONTEXT_DEFAULTS, useSettings, type ContextKey } from "../lib/settings";
import { download, downloadRows, stamp, textBlockRows } from "../lib/download";
import { exportConversations } from "../lib/exports";

type Source = {
  n: number;
  id: string; // not "key": big-design Table spreads rows as props, and React strips "key"
  name: string;
  kind: string;
  updates: string;
  field?: ContextKey;
  note?: string;
};

const SOURCES: Source[] = [
  { n: 1, id: "guidelines", name: "General guidelines (system prompt)", kind: "Editable text", updates: "Immediate", field: "systemPrompt" },
  { n: 2, id: "faq", name: "Store FAQ & policies", kind: "Editable text, ## heading per topic", updates: "Immediate", field: "faq" },
  { n: 3, id: "catalog", name: "Product catalog", kind: "BigCommerce, read live by the bot's tools", updates: "Live" },
  { n: 4, id: "freshdesk", name: "Freshdesk ticket history", kind: "Sync, agent replies only", updates: "Nightly" },
  { n: 5, id: "playbook", name: "Sales playbook", kind: "Versioned, written by the learning loop", updates: "On approved version" },
  { n: 6, id: "incentive", name: "Incentive instructions", kind: "Editable text", updates: "Immediate", field: "incentiveInstructions", note: "Used once the closing incentive is turned on." },
  { n: 7, id: "safeguards", name: "Safeguards instructions", kind: "Editable text (wording of refusals only)", updates: "Immediate", field: "safeguardsInstructions" },
  { n: 8, id: "voice", name: "Voice & tone", kind: "Editable text", updates: "Immediate", field: "voiceTone" },
];

const savedBlock = (store: any, k: ContextKey) => (store?.[k]?.trim() ? store[k] : CONTEXT_DEFAULTS[k]);

export const ContextPage = () => {
  const { store, draft, set, loading } = useSettings();
  const [editing, setEditing] = useState<ContextKey | null>(null);
  const [catalog, setCatalog] = useState<{ count?: number; fetchedAt?: string; error?: string; loading?: boolean }>({ loading: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [showGuardrails, setShowGuardrails] = useState(false);

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

  if (loading || !draft) return <Panel><Text color="secondary60">Loading…</Text></Panel>;

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

  const exportSource = (s: Source, format: "csv" | "json") =>
    run(`${s.id}-${format}`, async () => {
      if (s.field) {
        const text = savedBlock(store, s.field);
        if (format === "json") download(`${s.id}-${stamp()}.json`, JSON.stringify({ source: s.name, content: text }, null, 2), "application/json");
        else downloadRows(`${s.id}-${stamp()}`, "csv", textBlockRows(text), ["topic", "content"]);
      } else if (s.id === "catalog") {
        downloadRows(`catalog-${stamp()}`, format, await catalogProducts());
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
          freshdeskTicketHistory: null, // arrives with the Freshdesk sync
          salesPlaybook: null, // arrives with the learning loop
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
      return <Badge variant={custom ? "success" : "secondary"} label={custom ? "Active · customized" : "Active · default"} />;
    }
    if (s.id === "catalog") return catalog.error ? <Badge variant="danger" label="Error" /> : <Badge variant="success" label="Active" />;
    if (s.id === "freshdesk") return <Badge variant="secondary" label={freshdeskConnected(store) ? "Sync not built yet" : "Not connected"} />;
    return <Badge variant="secondary" label="Not started" />;
  };

  const items = (s: Source) => {
    if (s.id === "faq") return `${draft.faq.split(/\n(?=## )/).filter((x) => x.trim()).length} topics`;
    if (s.field) return `${draft[s.field].length.toLocaleString()} chars`;
    if (s.id === "catalog") return catalog.loading ? "Counting…" : catalog.count != null ? `${catalog.count.toLocaleString()} products` : "—";
    return "—";
  };

  const updated = (s: Source) => {
    if (s.field) return store?.updatedAt ? new Date(store.updatedAt).toLocaleDateString() : "—";
    if (s.id === "catalog" && catalog.fetchedAt) return "Live · counted " + new Date(catalog.fetchedAt).toLocaleTimeString();
    return "—";
  };

  const actions = (s: Source) => {
    const exportBtns = (
      <>
        <Button variant="subtle" isLoading={busy === `${s.id}-csv`} onClick={() => exportSource(s, "csv")}>CSV</Button>
        <Button variant="subtle" isLoading={busy === `${s.id}-json`} onClick={() => exportSource(s, "json")}>JSON</Button>
      </>
    );
    if (s.field) {
      return (
        <Flex flexGap="4px" flexWrap="wrap">
          <Button variant="secondary" onClick={() => setEditing(editing === s.field ? null : s.field!)}>
            {editing === s.field ? "Close" : "Edit"}
          </Button>
          {exportBtns}
        </Flex>
      );
    }
    if (s.id === "catalog") {
      return (
        <Flex flexGap="4px" flexWrap="wrap">
          <Button variant="secondary" isLoading={catalog.loading} onClick={loadCatalogCount}>Refresh</Button>
          {exportBtns}
        </Flex>
      );
    }
    return <Text color="secondary60" marginBottom="none">{s.id === "freshdesk" ? "Coming with the Freshdesk integration" : "Coming with the learning loop"}</Text>;
  };

  const editingSource = SOURCES.find((s) => s.field === editing);

  return (
    <>
      <Panel
        header="Context sources"
        description="Everything the bot knows about your store. Edits take effect after you save."
        action={{ text: "Export all", variant: "secondary", isLoading: busy === "all", onClick: exportAll }}
      >
        {exportError && <Message type="error" messages={[{ text: exportError }]} marginBottom="small" />}
        {catalog.error && <Message type="warning" messages={[{ text: catalog.error }]} marginBottom="small" />}
        <Table
          columns={[
            { header: "#", hash: "n", render: (s: Source) => s.n },
            { header: "Source", hash: "name", render: (s: Source) => (
              <Box>
                <Text bold marginBottom="none">{s.name}</Text>
                <Text color="secondary60" marginBottom="none">{s.kind}{s.note ? ` · ${s.note}` : ""}</Text>
              </Box>
            ) },
            { header: "Status", hash: "status", render: status },
            { header: "Items", hash: "items", render: items },
            { header: "Updated", hash: "updated", render: updated },
            { header: "", hash: "actions", render: actions },
          ]}
          items={SOURCES}
          stickyHeader
        />
        {editingSource && editing && (
          <Box marginTop="medium" className="wide-field tall-field">
            <FormGroup>
              <Textarea
                label={editingSource.name}
                description={editing === "faq" ? "Start each topic with a '## Heading' line." : "Saved with the other settings (Save settings, top right)."}
                rows={7}
                value={draft[editing]}
                onChange={(e) => set(editing, e.target.value)}
              />
            </FormGroup>
            <Button variant="subtle" onClick={() => set(editing, CONTEXT_DEFAULTS[editing])}>Reset to default</Button>
          </Box>
        )}
        <Box marginTop="medium">
          <Button variant="subtle" onClick={() => setShowGuardrails((v) => !v)}>
            {showGuardrails ? "Hide built-in guardrails" : "Show built-in guardrails (always applied, not editable)"}
          </Button>
          {showGuardrails && (
            <Box padding="small" backgroundColor="secondary10" borderRadius="normal" marginTop="xSmall">
              <Text marginBottom="none" style={{ whiteSpace: "pre-wrap" }}>{GUARDRAILS}</Text>
            </Box>
          )}
        </Box>
      </Panel>

      <Panel header="Data exports" description="Full conversation transcripts with message metadata (tools called, flags).">
        <Flex flexGap="8px" flexWrap="wrap" alignItems="center">
          <Text marginBottom="none">Conversations</Text>
          <Button variant="secondary" isLoading={busy === "conv-csv"} onClick={() => run("conv-csv", () => exportConversations("csv"))}>CSV</Button>
          <Button variant="secondary" isLoading={busy === "conv-json"} onClick={() => run("conv-json", () => exportConversations("json"))}>JSON</Button>
        </Flex>
        <Text color="secondary60" marginTop="small">Freshdesk feedback exports arrive with the Freshdesk integration.</Text>
      </Panel>
    </>
  );
};
