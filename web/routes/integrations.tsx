import { useState } from "react";
import { api } from "../api";
import { CLAUDE_MODELS, FEATURES, resolveCrm } from "../../api/lib/defaults";
import { freshdeskHost } from "../../api/lib/integrations";
import { hasSecret, useSettings, type Draft } from "../lib/settings";
import { Alert, Btn, Field, Loading, Modal, Tag } from "../components/ui";
import anthropicLogo from "../assets/integrations/anthropic.svg";
import bigcommerceLogo from "../assets/integrations/bigcommerce.svg";
import freshdeskLogo from "../assets/integrations/freshdesk.svg";
import shipstationLogo from "../assets/integrations/shipstation.png";

type Id = "anthropic" | "bigcommerce" | "freshdesk" | "shipstation";
type TestResult = { ok: boolean; message: string; missing?: string[] };

const IS_DEV = process.env.GADGET_PUBLIC_APP_ENV === "development";

// Official vendor marks (web/assets/integrations); `bg` is the tile behind the mark.
const TILES: { id: Id; name: string; logo: string; bg: string; powers: string }[] = [
  { id: "anthropic", name: "Anthropic", logo: anthropicLogo, bg: "#F0EEE6", powers: "Powers every AI response. One key, a model per role." },
  { id: "bigcommerce", name: "BigCommerce", logo: bigcommerceLogo, bg: "#FFFFFF", powers: "Installed app · catalog, order lookup, carts & checkout." },
  { id: "freshdesk", name: "Freshdesk", logo: freshdeskLogo, bg: "#FFFFFF", powers: "The connected CRM: ticket history, ticket drafting, handoff tickets." },
  { id: "shipstation", name: "ShipStation", logo: shipstationLogo, bg: "#FFFFFF", powers: "Carrier-level tracking events and delivery estimates for order lookups." },
];

// "5 min ago" style; the exact time goes in a tooltip.
function ago(iso?: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

type SyncRow = { label: string; at?: string | null; error?: string; never: string };

// Integrations that pull data on a schedule; the others are queried live.
function syncRows(id: Id, store: any): SyncRow[] {
  if (id === "bigcommerce") {
    return [{ label: "Orders (hourly)", at: store?.analyticsState?.ordersSyncedAt, never: "Waiting for the first hourly order sync" }];
  }
  if (id === "freshdesk") {
    const c = store?.crmState || {};
    const rows: SyncRow[] = [{ label: "Ticket history (nightly)", at: c.lastSyncAt, error: c.lastSyncError || undefined, never: "Waiting for the first history sync" }];
    if (resolveCrm(store).mode !== "off") rows.push({ label: "New tickets (every 5 min)", at: c.lastPollAt, error: c.lastPollError || undefined, never: "Not checked yet" });
    return rows;
  }
  return [];
}

// Permissions the bot's tools need on the app's OAuth token. `probed` ones are
// checked by Review permissions (testIntegration); the rest are core install scopes.
const BC_PERMISSIONS = [
  { name: "Products (read-only)" },
  { name: "Orders (read-only)" },
  { name: "Carts (modify)" },
  { name: "Checkouts (modify)", probed: true },
  { name: "Information & Settings (read)", probed: true },
  { name: "Marketing (read-only)" },
  { name: "Content (modify)" },
];

export const IntegrationsPage = () => {
  const { store, draft, loading, save, saving } = useSettings();
  const [open, setOpen] = useState<Id | null>(null);
  const [group, setGroup] = useState<"in" | "out">("in");
  const [results, setResults] = useState<Partial<Record<Id, TestResult>>>({});

  if (loading || !draft) return <Loading />;

  // Saved = what the bot actually uses; the draft may hold typed, unsaved credentials.
  const savedProvider = store?.llmProvider || "anthropic";
  const saved: Record<Id, boolean> = {
    anthropic: savedProvider === "anthropic" ? !!store?.llmModel && hasSecret(store, "llmApiKey") : !!store?.llmBaseUrl && !!store?.llmModel,
    bigcommerce: true,
    freshdesk: !!freshdeskHost(store?.freshdeskDomain) && hasSecret(store, "freshdeskApiKey"),
    shipstation: hasSecret(store, "shipstationApiKey"),
  };
  const connected: Record<Id, boolean> = {
    anthropic: draft.llmProvider === "anthropic" ? !!draft.llmModel && (hasSecret(store, "llmApiKey") || !!draft.llmApiKey) : !!draft.llmBaseUrl && !!draft.llmModel,
    bigcommerce: true,
    freshdesk: !!freshdeskHost(draft.freshdeskDomain) && (hasSecret(store, "freshdeskApiKey") || !!draft.freshdeskApiKey),
    shipstation: hasSecret(store, "shipstationApiKey") || !!draft.shipstationApiKey,
  };
  const unsaved: Record<Id, boolean> = {
    anthropic: !!draft.llmApiKey.trim() || draft.llmProvider !== savedProvider || draft.llmModel.trim() !== (store?.llmModel ?? "")
      || draft.llmBaseUrl.trim() !== (store?.llmBaseUrl ?? "")
      || draft.anthropicModels.crm !== (store?.anthropicModels?.crm ?? "") || draft.anthropicModels.analysis !== (store?.anthropicModels?.analysis ?? ""),
    bigcommerce: false,
    freshdesk: !!draft.freshdeskApiKey.trim() || draft.freshdeskDomain.trim() !== (store?.freshdeskDomain ?? ""),
    shipstation: !!draft.shipstationApiKey.trim() || !!draft.shipstationApiSecret.trim(),
  };

  const status = (id: Id): { text: string; tone: "good" | "warn" | "crit" } => {
    const r = results[id];
    if (id === "bigcommerce" && r?.missing?.length) return { text: `Connected · ${r.missing.length} permission${r.missing.length > 1 ? "s" : ""} missing`, tone: "warn" };
    if (r && !r.ok) return { text: "Test failed", tone: "crit" };
    if (unsaved[id]) return { text: connected[id] ? "Connected · unsaved" : "Unsaved changes", tone: "warn" };
    if (saved[id]) return { text: "Connected", tone: "good" };
    return { text: "Setup needed", tone: "warn" };
  };

  // Tile line: status, plus the latest sync for synced integrations.
  const tileStat = (id: Id) => {
    const st = status(id).text;
    if (st !== "Connected") return st;
    const last = syncRows(id, store).map((r) => r.at).filter(Boolean).sort().pop();
    return last ? `${st} · synced ${ago(last)}` : st;
  };

  const inCount = TILES.filter((t) => saved[t.id]).length;
  const shown = TILES.filter((t) => (group === "in") === saved[t.id]);
  const current = open && TILES.find((t) => t.id === open);
  const pending = TILES.filter((t) => unsaved[t.id]);

  return (
    <>
      <div className="note">
        BigCommerce connects with one click as an installed app. ShipStation and Freshdesk authenticate with API keys, so each panel
        tells you exactly where the key lives, then tests the connection. Credential changes are saved with Save settings.
      </div>
      {pending.length > 0 && !current && (
        <div className="alert warn row between">
          <span>Not saved yet: {pending.map((t) => t.name).join(", ")}. The bot keeps using the old settings until you save.</span>
          <Btn small primary loading={saving} onClick={save}>Save settings</Btn>
        </div>
      )}
      <div className="pills">
        <button type="button" className={group === "in" ? "pill on" : "pill"} onClick={() => setGroup("in")}>Integrated · {inCount}</button>
        <button type="button" className={group === "out" ? "pill on" : "pill"} onClick={() => setGroup("out")}>Not yet integrated · {TILES.length - inCount}</button>
      </div>
      <div className="tiles">
        {shown.length === 0 && <span className="hint">Nothing here.</span>}
        {shown.map((t) => (
          <button type="button" key={t.id} className="tile" onClick={() => setOpen(t.id)}>
            <span className="mark" style={{ background: t.bg }}><img src={t.logo} alt="" /></span>
            <span><b>{t.name}</b><span className="tstat">{saved[t.id] || unsaved[t.id] || results[t.id] ? tileStat(t.id) : "Not yet integrated"}</span></span>
          </button>
        ))}
      </div>
      <p className="hint" style={{ margin: "-4px 0 16px" }}>Click a tile to open its settings.</p>
      {current && (
        <IntegrationModal
          tile={current}
          badge={<Tag tone={status(current.id).tone}>{status(current.id).text}</Tag>}
          unsaved={unsaved[current.id]}
          onClose={() => setOpen(null)}
          result={results[current.id]}
          onResult={(r) => setResults((x) => ({ ...x, [current.id]: r }))}
        />
      )}
    </>
  );
};

function IntegrationModal({ tile, badge, unsaved, onClose, result, onResult }: {
  tile: (typeof TILES)[number];
  badge: React.ReactNode;
  unsaved: boolean;
  onClose: () => void;
  result?: TestResult;
  onResult: (r: TestResult) => void;
}) {
  const { store, draft, set, save, saving, saveError } = useSettings();
  const d = draft as Draft;
  const [testing, setTesting] = useState(false);
  const saveAndClose = async () => { if (await save()) onClose(); };
  const id = tile.id;

  const test = async () => {
    setTesting(true);
    try {
      const args: Record<string, string> = { integration: id };
      if (id === "anthropic") Object.assign(args, { provider: d.llmProvider, apiKey: d.llmApiKey, baseUrl: d.llmBaseUrl });
      if (id === "freshdesk") Object.assign(args, { domain: d.freshdeskDomain, apiKey: d.freshdeskApiKey });
      if (id === "shipstation") Object.assign(args, { apiKey: d.shipstationApiKey, apiSecret: d.shipstationApiSecret });
      // @ts-ignore — global action
      onResult(await api.testIntegration(args));
    } catch (e: any) {
      onResult({ ok: false, message: e?.message || "Test failed." });
    }
    setTesting(false);
  };

  const secretInput = (key: "llmApiKey" | "freshdeskApiKey" | "shipstationApiKey" | "shipstationApiSecret", label: string, hint?: string) => (
    <Field label={label} htmlFor={`i-${key}`} hint={hint}>
      <input
        type="password"
        id={`i-${key}`}
        autoComplete="off"
        value={d[key]}
        placeholder={hasSecret(store, key) ? "•••••••• (leave blank to keep current)" : "Paste it here"}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );

  const modelSelect = (label: string, hint: string, value: string, onChange: (v: string) => void, sameAsChat?: boolean) => (
    <Field label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {sameAsChat ? <option value="">Same as chat model</option> : !CLAUDE_MODELS.some((m) => m.value === value) && <option value="">Choose a model</option>}
        {CLAUDE_MODELS.map((m) => <option key={m.value} value={m.value}>{m.content}</option>)}
      </select>
    </Field>
  );

  return (
    <Modal
      title={tile.name}
      badge={badge}
      sub={tile.powers}
      onClose={onClose}
      footer={
        <>
          <Btn loading={testing} onClick={test}>{id === "bigcommerce" ? "Review permissions" : "Test connection"}</Btn>
          {id !== "bigcommerce" && <Btn primary loading={saving} disabled={!unsaved} onClick={saveAndClose}>Save</Btn>}
        </>
      }
    >
      {id === "anthropic" && (
        <div className="grid2">
          {IS_DEV && (
            <Field label="Provider" full hint="Production always runs on Anthropic; the OpenAI-compatible option exists in development only.">
              <select value={d.llmProvider} onChange={(e) => set("llmProvider", e.target.value)}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI-compatible (dev only)</option>
              </select>
            </Field>
          )}
          {d.llmProvider === "anthropic" ? (
            <>
              {secretInput("llmApiKey", "API key", "console.anthropic.com › Settings › API keys.")}
              {modelSelect("Chat model", "Answers shoppers in the storefront widget.", d.llmModel, (v) => set("llmModel", v))}
              {modelSelect("CRM model", "Drafts and answers Freshdesk tickets.", d.anthropicModels.crm, (v) => set("anthropicModels", { ...d.anthropicModels, crm: v }), true)}
              {modelSelect("Analysis model (learning runs)", "Runs the learning loop's analysis.", d.anthropicModels.analysis, (v) => set("anthropicModels", { ...d.anthropicModels, analysis: v }), true)}
            </>
          ) : (
            <>
              <Field label="API base URL" htmlFor="i-base">
                <input type="text" id="i-base" value={d.llmBaseUrl} placeholder="https://.../v1" onChange={(e) => set("llmBaseUrl", e.target.value)} />
              </Field>
              <Field label="Model" htmlFor="i-model">
                <input type="text" id="i-model" value={d.llmModel} onChange={(e) => set("llmModel", e.target.value)} />
              </Field>
              {secretInput("llmApiKey", "API key", "Leave blank if the endpoint doesn't need one.")}
            </>
          )}
        </div>
      )}

      {id === "bigcommerce" && (
        <>
          <div className="chips">
            {BC_PERMISSIONS.map((p) => {
              const missing = result?.missing?.includes(p.name);
              return <span key={p.name} className={`tag ${result && p.probed ? (missing ? "warn" : "good") : ""}`}>{p.name}</span>;
            })}
          </div>
          {!!result?.missing?.length && (
            <Alert tone="warn">
              {result.missing.length} permission{result.missing.length > 1 ? "s" : ""} missing: {result.missing.join(", ")}.
            </Alert>
          )}
          <p className="hint">
            Connected through the app install (one-click OAuth). Features that need a missing permission
            ({FEATURES.filter((f) => f.needs).map((f) => f.label).join(", ")}) apologize and offer a handoff until it's added.
            After adding permissions to the app, re-authorize it from the store's Apps page.
          </p>
        </>
      )}

      {id === "freshdesk" && (
        <>
          <div className="grid2">
            <Field label="Domain" htmlFor="i-fdd" hint="e.g. yourcompany.freshdesk.com">
              <input type="text" id="i-fdd" value={d.freshdeskDomain} onChange={(e) => set("freshdeskDomain", e.target.value)} />
            </Field>
            {secretInput("freshdeskApiKey", "API key")}
          </div>
          <p className="hint">The key lives in Freshdesk under Profile settings › View API key. Once connected it powers handoff tickets, the nightly ticket-history sync and ticket drafting/answering on the CRM tab.</p>
        </>
      )}

      {id === "shipstation" && (
        <>
          <div className="grid2">
            {secretInput("shipstationApiKey", "API key")}
            {secretInput("shipstationApiSecret", "API secret", "Only for V1 keys. Leave blank for a V2 key.")}
          </div>
          <p className="hint">Get the key in ShipStation under Settings › Account › API Settings, paste it once, then test. Tracking events in order lookup arrive in a later release.</p>
        </>
      )}

      {syncRows(id, store).length > 0 && (
        <div className="kv sync">
          <b className="label">Last sync</b>
          {syncRows(id, store).map((r) => (
            <div className="kvrow" key={r.label}>
              <span>{r.label}</span>
              {r.at ? (
                <span title={new Date(r.at).toLocaleString()}>
                  {r.error ? <Tag tone="crit">Error</Tag> : null} {new Date(r.at).toLocaleString()} <span className="hint">· {ago(r.at)}</span>
                </span>
              ) : <span className="hint">{r.never}</span>}
            </div>
          ))}
          {syncRows(id, store).filter((r) => r.error).map((r) => <Alert key={r.label} tone="crit">{r.label}: {r.error}</Alert>)}
        </div>
      )}

      {result && <Alert tone={result.ok ? "good" : "crit"}>{result.message}</Alert>}
      {unsaved && (
        <Alert tone="warn">
          Not saved yet{result?.ok ? " — the test passed, but" : ":"} these credentials only take effect after you click Save.
        </Alert>
      )}
      {saveError && <Alert tone="crit">{saveError}</Alert>}
    </Modal>
  );
}
