import { endpoint } from "../../lib/publicApi";
import { storeAnalytics } from "../../lib/analytics";

/** GET /v1/analytics?days=30 — the Analytics tab's numbers for the last 1–90 days (daily rows in UTC). */
export default endpoint("analytics", async ({ request, api, store }) => {
  const days = Math.min(90, Math.max(1, Math.round(Number(request.query?.days) || 30)));
  return storeAnalytics(api, store, days);
});
