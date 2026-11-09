import { Card, Tag } from "../components/ui";

// Tabs whose features ship in later phases of the Admin v2 build.
const COPY: Record<string, { header: string; body: string }> = {
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
