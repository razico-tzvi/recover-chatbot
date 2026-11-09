import { ActionOptions } from "gadget-server";
import { storesFor, pollStore, collectFeedback } from "../lib/crm";

// Every 5 minutes: answer/draft new Freshdesk tickets for every store with CRM
// ticket answering on, then capture agent edits of earlier drafts. `storeId`
// limits the run to one store (the admin's "Check now").
export const run: ActionRun = async ({ params, api, logger }) => {
  const ctx = { api, logger };
  const results: Record<string, unknown> = {};
  for (const store of await storesFor(api, params.storeId)) {
    try {
      const poll = await pollStore(ctx, store);
      const feedback = await collectFeedback(ctx, store);
      results[store.id] = { poll, feedback };
    } catch (err) {
      logger.error({ err, storeId: store.id }, "crmPoll failed for store");
    }
  }
  return results;
};

export const params = {
  storeId: { type: "string" },
};

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "*/5 * * * *" }] },
  timeoutMS: 900000,
};
