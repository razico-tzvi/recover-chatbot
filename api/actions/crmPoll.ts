import { ActionOptions } from "gadget-server";
import { storesFor, pollStore, collectFeedback, saveState } from "../lib/crm";
import { errorText, guardApi } from "../lib/guard";

// Every 5 minutes: answer/draft new Freshdesk tickets for every store with CRM
// ticket answering on, then capture agent edits of earlier drafts. `storeId`
// limits the run to one store (the admin's "Check now").
// Every Gadget API call has a 30 s limit and transient failures are retried
// (guard.js), so a hung call no longer stalls the run for 5 minutes. Poll and
// feedback fail independently; whatever is left is retried on the next tick
// (tickets already handled are recorded in crmTicket and skipped).
export const run: ActionRun = async ({ params, api: rawApi, logger }) => {
  const api = guardApi(rawApi, logger);
  const ctx = { api, logger };
  const results: Record<string, unknown> = {};
  for (const store of await storesFor(api, params.storeId)) {
    let poll: unknown;
    let feedback: unknown;
    try {
      poll = await pollStore(ctx, store);
    } catch (err) {
      logger.error({ err, storeId: store.id }, "crmPoll failed for store; the next tick retries");
      poll = { error: errorText(err) };
      await saveState(api, store, { lastPollAt: new Date().toISOString(), lastPollError: `Polling failed: ${errorText(err)}` }).catch(() => {});
    }
    try {
      feedback = await collectFeedback(ctx, store);
    } catch (err) {
      logger.error({ err, storeId: store.id }, "crm feedback check failed for store; the next tick retries");
      feedback = { error: errorText(err) };
    }
    results[store.id] = { poll, feedback };
  }
  return results;
};

export const params = {
  storeId: { type: "string" },
};

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "*/5 * * * *" }] },
  timeoutMS: 240000, // under the 5-minute schedule so runs don't pile up
};
