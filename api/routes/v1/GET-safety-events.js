import { endpoint, listParams, createdFilter, page, safetyOut } from "../../lib/publicApi";

/**
 * GET /v1/safety-events — rate limits, failed order verifications, lockouts
 * and flags, newest first. Query: limit, since, until, cursor, kind
 * (rate_limit | verify_fail | lockout | flag). Shopper IPs are not returned.
 */
export default endpoint("safety", async ({ request, api, store }) => {
  const q = request.query || {};
  const p = listParams(q);
  const filter = createdFilter(store.id, p);
  if (q.kind) filter.kind = { equals: String(q.kind) };
  const { data, nextCursor } = await page(api.internal.safetyEvent, filter, p.limit);
  return { data: data.map(safetyOut), nextCursor };
});
