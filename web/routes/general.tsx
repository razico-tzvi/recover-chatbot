import { Box, Button, Checkbox, Flex, FormGroup, Input, Panel, Select, Text, Textarea } from "@bigcommerce/big-design";
import { ORDER_FIELDS } from "../../api/lib/defaults";
import { freshdeskConnected } from "../../api/lib/integrations";
import { useSettings, type Draft } from "../lib/settings";

export const GeneralPage = () => {
  const { draft, loading } = useSettings();
  if (loading || !draft) return <Panel><Text color="secondary60">Loading…</Text></Panel>;
  return (
    <>
      <BrandingPanel />
      <HandoffPanel />
      <SafeguardsPanel />
    </>
  );
};

function BrandingPanel() {
  const { draft, set } = useSettings();
  const d = draft as Draft;
  const questions = d.suggestedQuestions;
  const setQuestion = (i: number, v: string) => set("suggestedQuestions", questions.map((q, j) => (j === i ? v : q)));

  return (
    <Panel header="Branding" description="How the chat widget looks and introduces itself on your storefront.">
      <FormGroup>
        <Input label="Bot display name" value={d.botName} onChange={(e) => set("botName", e.target.value)} />
      </FormGroup>
      <FormGroup>
        <Flex flexGap="12px" alignItems="flex-end">
          <Input
            label="Widget color"
            description="Hex color, e.g. #ef6526"
            value={d.widgetColor}
            onChange={(e) => set("widgetColor", e.target.value)}
          />
          <input
            type="color"
            aria-label="Pick widget color"
            value={/^#[0-9a-fA-F]{6}$/.test(d.widgetColor) ? d.widgetColor : "#ef6526"}
            onChange={(e) => set("widgetColor", e.target.value)}
            style={{ width: 44, height: 36, border: "none", background: "none", cursor: "pointer" }}
          />
        </Flex>
      </FormGroup>
      <FormGroup>
        <Input label="Greeting" value={d.greeting} onChange={(e) => set("greeting", e.target.value)} />
      </FormGroup>
      <Text bold marginBottom="xxSmall">Suggested questions</Text>
      <Text color="secondary60">Shown as tappable chips under the greeting (up to 5).</Text>
      {questions.map((q, i) => (
        <Flex key={i} flexGap="8px" alignItems="center" marginBottom="xSmall">
          <Box style={{ flex: 1 }}>
            <Input aria-label={`Suggested question ${i + 1}`} value={q} onChange={(e) => setQuestion(i, e.target.value)} />
          </Box>
          <Button variant="subtle" type="button" onClick={() => set("suggestedQuestions", questions.filter((_, j) => j !== i))}>
            Remove
          </Button>
        </Flex>
      ))}
      {questions.length < 5 && (
        <Box marginBottom="medium">
          <Button variant="secondary" type="button" onClick={() => set("suggestedQuestions", [...questions, ""])}>Add question</Button>
        </Box>
      )}
      <div className="wide-field">
        <FormGroup>
          <Textarea label="Disclaimer" rows={3} value={d.disclaimer} onChange={(e) => set("disclaimer", e.target.value)} />
        </FormGroup>
      </div>
    </Panel>
  );
}

function HandoffPanel() {
  const { draft, set, store } = useSettings();
  const d = draft as Draft;
  const crmReady = freshdeskConnected(store);
  const options = [
    { value: "email", content: "Support email" },
    { value: "crm", content: crmReady ? "CRM ticket (Freshdesk)" : "CRM ticket — connect Freshdesk in Integrations first", disabled: !crmReady },
  ];
  return (
    <Panel header="Human handoff" description="Where a conversation goes when the shopper asks for a person or the bot can't help.">
      <FormGroup>
        <Select
          label="Destination"
          options={options}
          value={d.handoffDestination === "crm" && crmReady ? "crm" : "email"}
          onOptionChange={(v) => set("handoffDestination", v as string)}
        />
      </FormGroup>
      <FormGroup>
        <Input
          label="Support email"
          type="email"
          description={d.handoffDestination === "crm" ? "Used if the CRM ticket can't be created." : "Leave blank to use the store's admin email."}
          value={d.handoffEmail}
          placeholder="support@yourstore.com"
          onChange={(e) => set("handoffEmail", e.target.value)}
        />
      </FormGroup>
      <FormGroup>
        <Input
          label="Handoff webhook URL"
          description="Also posts each handoff as JSON to this https URL, e.g. a Slack incoming webhook."
          value={d.handoffWebhookUrl}
          placeholder="https://hooks.slack.com/services/..."
          onChange={(e) => set("handoffWebhookUrl", e.target.value)}
        />
      </FormGroup>
    </Panel>
  );
}

function SafeguardsPanel() {
  const { draft, set } = useSettings();
  const d = draft as Draft;
  const g = d.safeguards;
  const setG = (patch: Partial<typeof g>) => set("safeguards", { ...g, ...patch });
  const num = (key: keyof typeof g, label: string, description?: string) => (
    <FormGroup>
      <Input
        label={label}
        description={description}
        type="number"
        min={1}
        value={String(g[key] ?? "")}
        onChange={(e) => setG({ [key]: e.target.value === "" ? "" : Number(e.target.value) } as any)}
      />
    </FormGroup>
  );

  return (
    <Panel header="Safeguards" description="Enforced in code — no prompt or context edit can turn these off. The Safeguards instructions block on the Context tab only sets how refusals are worded.">
      <Text bold>Rate limits</Text>
      {num("messagesPerMinute", "Messages per minute, per visitor")}
      {num("messagesPerDay", "Messages per day, per visitor")}
      {num("ipMessagesPerDay", "Messages per day, per IP address", "Catches scripted abuse across many chats.")}

      <Text bold>Order lookup</Text>
      {num("lockoutAttempts", "Failed verifications before lockout", "Wrong order number + email combinations in one chat.")}
      {num("lockoutHours", "Lockout duration (hours)", "Locks order lookup for that visitor and IP, flags the chat, and points the shopper to a support ticket.")}
      <Text marginBottom="xSmall">Fields the bot may return after verification:</Text>
      {ORDER_FIELDS.map((f) => (
        <Checkbox
          key={f.key}
          label={f.label}
          checked={!!g.orderFields[f.key as keyof typeof g.orderFields]}
          onChange={() => setG({ orderFields: { ...g.orderFields, [f.key]: !g.orderFields[f.key as keyof typeof g.orderFields] } })}
        />
      ))}
      <Text color="secondary60" marginTop="xSmall">
        Addresses, payment details, amounts, items and phone numbers are stripped on the server and never reach the model.
      </Text>

      <Text bold marginTop="medium">Alerts</Text>
      <FormGroup>
        <Input
          label="Abuse alert email"
          type="email"
          value={g.alertEmail}
          placeholder="security@yourstore.com"
          onChange={(e) => setG({ alertEmail: e.target.value })}
        />
      </FormGroup>
      {num("flagSpikeThreshold", "Alert when flagged conversations in 24 hours exceed")}
    </Panel>
  );
}
