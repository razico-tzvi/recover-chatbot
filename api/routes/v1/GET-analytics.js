import { endpoint } from "../../lib/publicApi";
import { resolveRange, storeAnalytics } from "../../lib/analytics";

/**
 * GET /v1/analytics — the Analytics tab's numbers (daily rows in UTC).
 * ?days=30 (1–366, ending today) or ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive);
 * &compare=true adds `compare` with the same numbers for the period right before.
 */
export default endpoint("analytics", async ({ request, api, store }) => {
  const q = request.query || {};
  return storeAnalytics(api, store, resolveRange({ days: q.days, from: q.from, to: q.to, compare: q.compare }));
});
