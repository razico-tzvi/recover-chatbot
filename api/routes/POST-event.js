import { RouteHandler } from "gadget-server";

/**
 * POST /event — widget signals for the Analytics funnel. Body:
 * { storeHash, sessionId, event: "checkout_click" }. A click on a cart/checkout
 * link in a bot reply stamps `chatSession.checkoutClickedAt` (first click wins).
 * Only sessions that already exist (the shopper has chatted) are updated.
 *
 * @type { RouteHandler }
 */
const EVENTS = new Set(["checkout_click"]);

const route = async ({ request, reply, api }) => {
  const body = request.body || {};
  const storeHash = String(body.storeHash || "");
  const sessionId = String(body.sessionId || "").slice(0, 100);
  const event = String(body.event || "");
  if (!storeHash || !sessionId || !EVENTS.has(event)) {
    return reply.code(400).send({ error: "storeHash, sessionId and a known event are required." });
  }

  const stores = await api.internal.bigcommerce.store.findMany({ filter: { storeHash: { equals: storeHash } }, first: 1 });
  const store = stores[0];
  if (!store) return reply.code(404).send({ error: "Store not installed." });

  const rows = await api.internal.chatSession.findMany({
    filter: { sessionId: { equals: sessionId }, storeId: { equals: store.id } },
    first: 1,
  });
  if (!rows[0]) return reply.code(404).send({ error: "Conversation not found." });

  if (!rows[0].checkoutClickedAt) await api.internal.chatSession.update(rows[0].id, { checkoutClickedAt: new Date() });
  return reply.send({ ok: true });
};

// Cross-origin: called from the storefront, like POST /chat.
route.options = {
  cors: { origin: true, methods: ["POST", "OPTIONS"], allowedHeaders: ["Content-Type"] },
};

export default route;
