import { Card, Tag } from "../components/ui";

// Tabs whose features ship in later phases of the Admin v2 build.
const COPY: Record<string, { header: string; body: string }> = {
  crm: {
    header: "CRM ticket answering",
    body: "Coming next: nightly ticket-history sync, Learning mode (drafts as private notes tagged ai-draft, with edits captured as feedback), tags, a topic blocklist with set responses, and the bot signature. Connect Freshdesk on the Integrations tab now — handoff tickets already use it.",
  },
  analytics: {
    header: "Analytics",
    body: "Coming soon: overview (conversations, containment, ratings, AI cost), the sales funnel with direct vs. assisted conversion, incentive A/B results, support and safety numbers. Rate-limit hits, lockouts and flags are already being recorded.",
  },
  learning: {
    header: "Learning",
    body: "Coming soon: the sales learning loop. After 250 settled conversations with 25+ conversions, it compares converted and non-converted chats and proposes a new sales playbook version for approval, with rollback.",
  },
  api: {
    header: "API",
    body: "Coming soon: labeled, expiring, resource-scoped API keys and REST endpoints for conversations, analytics, context, feedback, learning, settings and safety events. Until then, use the exports on the Context and Conversations tabs.",
  },
};

export const ComingSoonPage = ({ tab }: { tab: string }) => {
  const c = COPY[tab];
  return (
    <Card title={<span className="row">{c.header} <Tag tone="info">Coming soon</Tag></span>}>
      <p className="hint" style={{ marginTop: 6 }}>{c.body}</p>
    </Card>
  );
};
