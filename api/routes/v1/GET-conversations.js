import { endpoint, listParams, createdFilter, page, sessionOut } from "../../lib/publicApi";

/**
 * GET /v1/conversations — chat sessions, newest first.
 * Query: limit (1–200, default 50), since / until (ISO dates, on createdAt),
 * cursor (from the previous page's nextCursor), needsHuman=true, flagged=true,
 * converted=true. Sessions with no shopper message are left out.
 */
export default endpoint("conversations", async ({ request, api, store }) => {
  const q = request.query || {};
  const p = listParams(q);
  
  // Ensure store.id is string matched and filtered by active updatedAt timestamp
  const filter = { 
    storeId: { equals: String(store.id) },
    messageCount: { greaterThan: 0 } 
  };
  
  if (p.since) filter.updatedAt = { gte: p.since };
  if (p.until) filter.updatedAt = { lte: p.until };
  if (q.needsHuman === "true") filter.needsHuman = { equals: true };
  if (q.flagged === "true") filter.flagged = { equals: true };
  if (q.converted === "true") filter.conversion = { isSet: true };
  
  const { data, nextCursor } = await page(api.internal.chatSession, filter, p.limit);
  return { data: data.map(sessionOut), nextCursor };
});