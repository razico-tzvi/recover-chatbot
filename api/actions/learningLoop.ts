import { ActionOptions } from "gadget-server";
import { checkStore } from "../lib/learning";

// Daily: for every store with the learning loop on auto, propose a new sales
// playbook version once enough settled conversations have built up (see
// api/lib/learning.js). `storeId` + `force` is the Learning tab's "Run analysis
// now", which skips the thresholds (but not the minimum data check).
export const run: ActionRun = async ({ params, api, logger }) => {
  const filter = params.storeId ? { id: { equals: String(params.storeId) } } : undefined;
  const stores = await api.internal.bigcommerce.store.findMany({ filter, first: 250 });
  const results: Record<string, unknown> = {};
  for (const store of stores) {
    try {
      results[store.id] = await checkStore({ api, logger }, store, { force: !!params.force && !!params.storeId });
    } catch (err: any) {
      logger.warn({ err, storeId: store.id }, "learningLoop failed for store");
      results[store.id] = { error: String(err?.message || err) };
    }
  }
  return results;
};

export const params = {
  storeId: { type: "string" },
  force: { type: "boolean" },
};

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "41 6 * * *" }] },
  timeoutMS: 900000,
};
