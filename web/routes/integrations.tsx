import { Badge, Box, Button, Flex, FormGroup, Input, Message, Modal, Panel, Select, Tabs, Text } from "@bigcommerce/big-design";
import { useState } from "react";
import { api } from "../api";
import { CLAUDE_MODELS, FEATURES } from "../../api/lib/defaults";
import { freshdeskHost } from "../../api/lib/integrations";
import { hasSecret, useSettings, type Draft } from "../lib/settings";

type Id = "anthropic" | "bigcommerce" | "freshdesk" | "shipstation";
type TestResult = { ok: boolean; message: string; missing?: string[] };

const IS_DEV = process.env.GADGET_PUBLIC_APP_ENV === "development";

const TILES: { id: Id; name: string; letter: string; color: string; powers: string }[] = [
  { id: "anthropic", name: "Anthropic", letter: "A", color: "#d97757", powers: "All AI responses" },
  { id: "bigcommerce", name: "BigCommerce", letter: "B", color: "#34313f", powers: "Catalog, order lookup, carts & checkout" },
  { id: "freshdesk", name: "Freshdesk", letter: "F", color: "#25c16f", powers: "Ticket history, ticket drafting, handoff tickets" },
  { id: "shipstation", name: "ShipStation", letter: "S", color: "#84c225", powers: "Carrier tracking and delivery estimates" },
];

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
  const { store, draft, loading } = useSettings();
  const [open, setOpen] = useState<Id | null>(null);
  const [group, setGroup] = useState("integrated");
  const [results, setResults] = useState<Partial<Record<Id, TestResult>>>({});

  if (loading || !draft) return <Panel><Text color="secondary60">Loading…</Text></Panel>;

  const connected: Record<Id, boolean> = {
    anthropic: draft.llmProvider === "anthropic" ? !!draft.llmModel && (hasSecret(store, "llmApiKey") || !!draft.llmApiKey) : !!draft.llmBaseUrl && !!draft.llmModel,
    bigcommerce: true,
    freshdesk: !!freshdeskHost(draft.freshdeskDomain) && (hasSecret(store, "freshdeskApiKey") || !!draft.freshdeskApiKey),
    shipstation: hasSecret(store, "shipstationApiKey") || !!draft.shipstationApiKey,
  };

  const badge = (id: Id) => {
    const r = results[id];
    if (id === "bigcommerce" && r?.missing?.length) return <Badge variant="warning" label={`${r.missing.length} permission${r.missing.length > 1 ? "s" : ""} missing`} />;
    if (r && !r.ok) return <Badge variant="danger" label="Test failed" />;
    if (connected[id]) return <Badge variant="success" label="Connected" />;
    return <Badge variant="secondary" label="Setup needed" />;
  };

  const shown = TILES.filter((t) => (group === "integrated") === connected[t.id]);

  return (
    <Panel header="Integrations" description="Click a tile to manage its credentials and test the connection. Credential changes are saved with Save settings.">
      <Tabs
        activeTab={group}
        items={[
          { id: "integrated", title: `Integrated (${TILES.filter((t) => connected[t.id]).length})` },
          { id: "not", title: `Not yet integrated (${TILES.filter((t) => !connected[t.id]).length})` },
        ]}
        onTabClick={setGroup}
      />
      <Flex flexWrap="wrap" flexGap="12px" marginTop="medium">
        {shown.length === 0 && <Text color="secondary60">Nothing here.</Text>}
        {shown.map((t) => (
          <Box
            key={t.id}
            border="box"
            borderRadius="normal"
            padding="medium"
            style={{ width: 240, cursor: "pointer" }}
            onClick={() => setOpen(t.id)}
          >
            <Flex alignItems="center" flexGap="10px" marginBottom="xSmall">
              <div style={{ width: 36, height: 36, borderRadius: 8, background: t.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                {t.letter}
              </div>
              <Text bold marginBottom="none">{t.name}</Text>
            </Flex>
            <Text color="secondary60" marginBottom="xSmall">{t.powers}</Text>
            {badge(t.id)}
          </Box>
        ))}
      </Flex>
      {open && (
        <IntegrationModal
          id={open}
          onClose={() => setOpen(null)}
          result={results[open]}
          onResult={(r) => setResults((x) => ({ ...x, [open]: r }))}
        />
      )}
    </Panel>
  );
};

function IntegrationModal({ id, onClose, result, onResult }: { id: Id; onClose: () => void; result?: TestResult; onResult: (r: TestResult) => void }) {
  const { store, draft, set } = useSettings();
  const d = draft as Draft;
  const [testing, setTesting] = useState(false);
  const tile = TILES.find((t) => t.id === id)!;

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

  const secretInput = (key: "llmApiKey" | "freshdeskApiKey" | "shipstationApiKey" | "shipstationApiSecret", label: string, description?: string) => (
    <FormGroup>
      <Input
        label={label}
        type="password"
        description={description}
        value={d[key]}
        placeholder={hasSecret(store, key) ? "•••••••• (leave blank to keep current)" : "Paste it here"}
        onChange={(e) => set(key, e.target.value)}
      />
    </FormGroup>
  );

  return (
    <Modal
      isOpen
      header={tile.name}
      onClose={onClose}
      closeOnClickOutside
      actions={[
        ...(id === "bigcommerce" ? [] : [{ text: "Test connection", variant: "secondary" as const, isLoading: testing, onClick: test }]),
        ...(id === "bigcommerce" ? [{ text: "Review permissions", variant: "secondary" as const, isLoading: testing, onClick: test }] : []),
        { text: "Done", onClick: onClose },
      ]}
    >
      {id === "anthropic" && (
        <>
          {IS_DEV && (
            <FormGroup>
              <Select
                label="Provider"
                description="Production always runs on Anthropic; the OpenAI-compatible option exists in development only."
                options={[
                  { value: "anthropic", content: "Anthropic (Claude)" },
                  { value: "openai", content: "OpenAI-compatible (dev only)" },
                ]}
                value={d.llmProvider}
                onOptionChange={(v) => set("llmProvider", v as string)}
              />
            </FormGroup>
          )}
          {d.llmProvider === "anthropic" ? (
            <>
              {secretInput("llmApiKey", "API key", "Create one at console.anthropic.com → Settings → API keys.")}
              <FormGroup>
                <Select
                  label="Chat model"
                  description="Answers shoppers in the storefront widget."
                  options={CLAUDE_MODELS}
                  value={CLAUDE_MODELS.some((m) => m.value === d.llmModel) ? d.llmModel : undefined}
                  placeholder="Choose a model"
                  onOptionChange={(v) => set("llmModel", v as string)}
                />
              </FormGroup>
              {(["crm", "analysis"] as const).map((role) => (
                <FormGroup key={role}>
                  <Select
                    label={role === "crm" ? "CRM model" : "Analysis model"}
                    description={role === "crm" ? "Drafts and answers Freshdesk tickets." : "Runs the learning loop's analysis."}
                    options={[{ value: "", content: "Same as chat model" }, ...CLAUDE_MODELS]}
                    value={d.anthropicModels[role]}
                    onOptionChange={(v) => set("anthropicModels", { ...d.anthropicModels, [role]: v as string })}
                  />
                </FormGroup>
              ))}
            </>
          ) : (
            <>
              <FormGroup>
                <Input label="API base URL" value={d.llmBaseUrl} placeholder="https://.../v1" onChange={(e) => set("llmBaseUrl", e.target.value)} />
              </FormGroup>
              <FormGroup>
                <Input label="Model" value={d.llmModel} onChange={(e) => set("llmModel", e.target.value)} />
              </FormGroup>
              {secretInput("llmApiKey", "API key", "Leave blank if the endpoint doesn't need one.")}
            </>
          )}
        </>
      )}

      {id === "bigcommerce" && (
        <>
          <Text>Connected through the app install (one-click OAuth). The bot needs these permissions:</Text>
          {BC_PERMISSIONS.map((p) => {
            const missing = result?.missing?.includes(p.name);
            return (
              <Flex key={p.name} justifyContent="space-between" marginBottom="xxSmall">
                <Text marginBottom="none">{p.name}</Text>
                {result && p.probed ? <Badge variant={missing ? "warning" : "success"} label={missing ? "Missing" : "Granted"} /> : null}
              </Flex>
            );
          })}
          <Text color="secondary60" marginTop="small">
            Features that need a missing permission ({FEATURES.filter((f) => f.needs).map((f) => f.label).join(", ")}) apologize and offer a handoff until it's added. After adding permissions to the app, re-authorize it from the store's Apps page.
          </Text>
        </>
      )}

      {id === "freshdesk" && (
        <>
          <FormGroup>
            <Input
              label="Freshdesk domain"
              description="e.g. yourcompany.freshdesk.com"
              value={d.freshdeskDomain}
              onChange={(e) => set("freshdeskDomain", e.target.value)}
            />
          </FormGroup>
          {secretInput("freshdeskApiKey", "API key", "In Freshdesk: your profile picture → Profile settings → View API key.")}
          <Text color="secondary60">Ticket history sync and ticket drafting arrive with the CRM tab. Today the connection powers handoff tickets.</Text>
        </>
      )}

      {id === "shipstation" && (
        <>
          {secretInput("shipstationApiKey", "API key", "In ShipStation: Settings → Account → API Settings.")}
          {secretInput("shipstationApiSecret", "API secret", "Only for V1 keys. Leave blank for a V2 API key.")}
          <Text color="secondary60">Tracking events in order lookup arrive in a later release; you can connect and test now.</Text>
        </>
      )}

      {result && <Message type={result.ok ? "success" : "error"} messages={[{ text: result.message }]} marginTop="medium" />}
    </Modal>
  );
}
