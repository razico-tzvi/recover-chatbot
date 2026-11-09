import { RouteHandler } from "gadget-server";

/**
 * POST /feedback — the widget's "Was this helpful?" thumbs. Body:
 * { storeHash, sessionId, rating: 1 | -1 }. Stores the shopper's latest rating
 * on their chat session for the Analytics tab. Only sessions that already exist
 * (the shopper has chatted) can be rated.
 *
 * @type { RouteHandler }
 */
const route = async ({ request, reply, api }) => {
  const body = request.body || {};
  const storeHash = String(body.storeHash || "");
  const sessionId = String(body.sessionId || "").slice(0, 100);
  const rating = Number(body.rating);
  if (!storeHash || !sessionId || (rating !== 1 && rating !== -1)) {
    return reply.code(400).send({ error: "storeHash, sessionId and rating (1 or -1) are required." });
  }

  const stores = await api.internal.bigcommerce.store.findMany({ filter: { storeHash: { equals: storeHash } }, first: 1 });
  const store = stores[0];
  if (!store) return reply.code(404).send({ error: "Store not installed." });

  const rows = await api.internal.chatSession.findMany({
    filter: { sessionId: { equals: sessionId }, storeId: { equals: store.id } },
    first: 1,
  });
  if (!rows[0]) return reply.code(404).send({ error: "Conversation not found." });

  await api.internal.chatSession.update(rows[0].id, { rating, ratingAt: new Date() });
  return reply.send({ ok: true });
};

// Cross-origin: called from the storefront, like POST /chat.
route.options = {
  cors: { origin: true, methods: ["POST", "OPTIONS"], allowedHeaders: ["Content-Type"] },
};

export default route;
