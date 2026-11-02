import { ORDER_FIELDS } from "../../api/lib/defaults";
import { freshdeskConnected } from "../../api/lib/integrations";
import { useSettings, type Draft } from "../lib/settings";
import { Btn, Card, Field, Loading, Seg } from "../components/ui";

export const GeneralPage = () => {
  const { draft, loading } = useSettings();
  if (loading || !draft) return <Loading />;
  return (
    <>
      <BrandingCard />
      <HandoffCard />
      <SafeguardsCard />
    </>
  );
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function BrandingCard() {
  const { draft, set } = useSettings();
  const d = draft as Draft;
  const questions = d.suggestedQuestions;
  const setQuestion = (i: number, v: string) => set("suggestedQuestions", questions.map((q, j) => (j === i ? v : q)));

  return (
    <Card title="Branding" sub="Per-store identity: how the chat widget looks and introduces itself on your storefront.">
      <div className="grid2">
        <Field label="Bot display name" htmlFor="g-name">
          <input type="text" id="g-name" value={d.botName} onChange={(e) => set("botName", e.target.value)} />
        </Field>
        <Field label="Widget color" htmlFor="g-color" hint="Hex color, e.g. #E8591A">
          <div className="row">
            <input
              type="color"
              className="swatch"
              aria-label="Pick widget color"
              value={HEX.test(d.widgetColor) ? d.widgetColor : "#e8591a"}
              onChange={(e) => set("widgetColor", e.target.value)}
            />
            <input type="text" id="g-color" value={d.widgetColor} style={{ maxWidth: 120 }} onChange={(e) => set("widgetColor", e.target.value)} />
          </div>
        </Field>
        <Field label="Greeting" htmlFor="g-greet" full>
          <textarea id="g-greet" rows={2} value={d.greeting} onChange={(e) => set("greeting", e.target.value)} />
        </Field>
        <Field label="Suggested questions" hint="Shown as tappable chips under the greeting (up to 5)." full>
          <div className="chips">
            {questions.map((q, i) => (
              <span key={i} className="chip row" style={{ gap: 4, padding: "2px 4px 2px 10px" }}>
                <input
                  type="text"
                  aria-label={`Suggested question ${i + 1}`}
                  value={q}
                  size={Math.max(12, q.length)}
                  onChange={(e) => setQuestion(i, e.target.value)}
                  style={{ border: 0, background: "transparent", padding: "2px 0", width: "auto", fontWeight: 600, fontSize: 12.5 }}
                />
                <button
                  type="button"
                  aria-label={`Remove suggested question ${i + 1}`}
                  onClick={() => set("suggestedQuestions", questions.filter((_, j) => j !== i))}
                  style={{ border: 0, background: "none", color: "var(--muted)", padding: "0 6px" }}
                >×</button>
              </span>
            ))}
            {questions.length < 5 && <Btn small onClick={() => set("suggestedQuestions", [...questions, ""])}>+ Add</Btn>}
          </div>
        </Field>
        <Field label="Disclaimer" htmlFor="g-disc" full>
          <textarea id="g-disc" rows={2} value={d.disclaimer} onChange={(e) => set("disclaimer", e.target.value)} />
        </Field>
      </div>
    </Card>
  );
}

function HandoffCard() {
  const { draft, set, store } = useSettings();
  const d = draft as Draft;
  const crmReady = freshdeskConnected(store);
  const dest = d.handoffDestination === "crm" && crmReady ? "crm" : "email";
  return (
    <Card title="Human handoff" sub="Where a conversation goes when the shopper asks for a person or the bot can't help.">
      <div className="field" style={{ marginBottom: 14 }}>
        <label>Destination</label>
        <Seg
          name="hdest"
          label="Handoff destination"
          value={dest}
          onChange={(v) => set("handoffDestination", v)}
          options={[
            { value: "email", label: "Support email" },
            { value: "crm", label: crmReady ? "CRM ticket · Freshdesk" : "CRM ticket", disabled: !crmReady },
          ]}
        />
        <p className="hint">
          {crmReady
            ? "Freshdesk is connected, so handoffs can open a ticket there."
            : "CRM ticket becomes available once a CRM is connected under Integrations."}
        </p>
      </div>
      <div className="grid2">
        <Field
          label="Support email"
          htmlFor="g-mail"
          hint={dest === "crm" ? "Used if the CRM ticket can't be created." : "Leave blank to use the store's admin email."}
        >
          <input type="email" id="g-mail" value={d.handoffEmail} placeholder="support@yourstore.com" onChange={(e) => set("handoffEmail", e.target.value)} />
        </Field>
        <Field label="Handoff webhook URL" htmlFor="g-hook" hint="Optional. Posts each handoff as JSON to this https URL, e.g. a Slack webhook.">
          <input type="text" id="g-hook" value={d.handoffWebhookUrl} placeholder="https://hooks.slack.com/services/..." onChange={(e) => set("handoffWebhookUrl", e.target.value)} />
        </Field>
      </div>
    </Card>
  );
}

function SafeguardsCard() {
  const { draft, set } = useSettings();
  const d = draft as Draft;
  const g = d.safeguards;
  const setG = (patch: Partial<typeof g>) => set("safeguards", { ...g, ...patch });
  const numInput = (key: keyof typeof g, id: string, width = 110) => (
    <input
      type="number"
      id={id}
      min={1}
      style={{ maxWidth: width }}
      value={String(g[key] ?? "")}
      onChange={(e) => setG({ [key]: e.target.value === "" ? "" : Number(e.target.value) } as any)}
    />
  );

  return (
    <Card
      title="Safeguards"
      sub="Thresholds are editable here. Enforcement runs server side; no prompt or context edit can turn these off. The Safeguards instructions block on the Context tab only sets how refusals are worded."
    >
      <div className="grid2">
        <Field label="Messages per minute, per visitor" htmlFor="s-min">{numInput("messagesPerMinute", "s-min")}</Field>
        <Field label="Messages per day, per visitor" htmlFor="s-day">{numInput("messagesPerDay", "s-day")}</Field>
        <Field label="Messages per day, per IP" htmlFor="s-ip" hint="Catches scripted abuse across many chats.">{numInput("ipMessagesPerDay", "s-ip")}</Field>
        <Field
          label="Verification lockout"
          htmlFor="s-att"
          hint="Locks order lookup for that visitor and IP, flags the chat, and points the shopper to a support ticket."
        >
          <div className="row">
            {numInput("lockoutAttempts", "s-att", 80)}
            <span className="hint">failed attempts →</span>
            {numInput("lockoutHours", "s-hrs", 80)}
            <span className="hint">hour lock</span>
          </div>
        </Field>
        <Field
          label="Order lookup returns"
          full
          hint="The model receives these fields only. Addresses, payment details, amounts, items and phone numbers are stripped server side."
        >
          <div className="chips">
            {ORDER_FIELDS.map((f) => {
              const k = f.key as keyof typeof g.orderFields;
              return (
                <label key={f.key} className="chip row" style={{ gap: 6, margin: 0, cursor: "pointer" }}>
                  <input type="checkbox" checked={!!g.orderFields[k]} onChange={() => setG({ orderFields: { ...g.orderFields, [k]: !g.orderFields[k] } })} />
                  {f.label}
                </label>
              );
            })}
          </div>
        </Field>
        <Field label="Abuse alert email" htmlFor="s-alert">
          <input type="email" id="s-alert" value={g.alertEmail} placeholder="security@yourstore.com" onChange={(e) => setG({ alertEmail: e.target.value })} />
        </Field>
        <Field label="Alert on flag spikes" htmlFor="s-spike">
          <div className="row">
            <span className="hint">Email when flags exceed</span>
            {numInput("flagSpikeThreshold", "s-spike", 80)}
            <span className="hint">in 24 h</span>
          </div>
        </Field>
      </div>
    </Card>
  );
}
