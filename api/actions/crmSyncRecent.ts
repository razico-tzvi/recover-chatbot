import { ActionOptions } from "gadget-server";
import { storesFor, syncRecent } from "../lib/crm";
import { errorText, guardApi } from "../lib/guard";

// Every 5 minutes: re-sync Freshdesk tickets updated in the last 30 minutes into
// crmHistory. Every Gadget API call has a 30 s limit and transient failures are
// retried (guard.js); Freshdesk calls have their own 15 s limit. syncRecent stops
// after 90 s and skips a ticket that fails; whatever is left is picked up on the
// next tick (the 30-minute window overlaps).
// (The earlier wrapper raced the whole store sync against 30 s and retried while
// the first attempt was still running, so two syncs could write the same tickets.)
export const run: ActionRun = async ({ api: rawApi, logger }) => {
  const api = guardApi(rawApi, logger);
  const results: Record<string, unknown> = {};
  for (const store of await storesFor(api)) {
    try {
      results[store.id] = await syncRecent({ api, logger }, store, 30, 90_000);
    } catch (err: any) {
      logger.error({ err, storeId: store.id }, "[crmSyncRecent] failed for store; the next tick retries");
      results[store.id] = { error: errorText(err) };
    }
  }
  return results;
};

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "*/5 * * * *" }] },
  timeoutMS: 240000,
};
