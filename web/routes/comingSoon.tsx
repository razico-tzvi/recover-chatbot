import { Card, Tag } from "../components/ui";

// Tabs whose features ship in later phases of the Admin v2 build.
const COPY: Record<string, { header: string; body: string }> = {
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
