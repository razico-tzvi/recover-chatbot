import { ActionOptions } from "gadget-server";
import { storesFor, syncHistory } from "../lib/crm";

// Nightly: pull resolved/closed Freshdesk tickets (agent public replies only)
// into crmHistory for every connected store. Incremental via crmState.historyCursor;
// the first run looks back 90 days. When a run stops at Freshdesk's rate limit
// (or the per-run cap) it schedules its own continuation for that store, up to
// MAX_CONTINUATIONS times, instead of sleeping inside the action.
const MAX_CONTINUATIONS = 20;

export const run: ActionRun = async ({ params, api, logger }) => {
  const ctx = { api, logger };
  const continuation = Number(params.continuation) || 0;
  const results: Record<string, unknown> = {};
  for (const store of await storesFor(api, params.storeId)) {
    try {
      const r = await syncHistory(ctx, store);
      results[store.id] = r;
      if ((r.retryAfter || r.more) && continuation < MAX_CONTINUATIONS) {
        const delayS = r.retryAfter ? r.retryAfter + 5 : 5;
        await api.enqueue(
          api.crmSyncHistory,
          { storeId: store.id, continuation: continuation + 1 },
          { startAt: new Date(Date.now() + delayS * 1000).toISOString() }
        );
        logger.info({ storeId: store.id, delayS, continuation: continuation + 1, saved: r.saved }, "crm history sync continues later");
      }
    } catch (err) {
      logger.error({ err, storeId: store.id }, "crmSyncHistory failed for store");
    }
  }
  return results;
};

export const params = {
  storeId: { type: "string" },
  continuation: { type: "number" },
};

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "0 7 * * *" }] },
  timeoutMS: 900000,
};
