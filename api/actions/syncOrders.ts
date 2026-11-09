import { ActionOptions } from "gadget-server";
import { syncStoreOrders } from "../lib/analytics";

// Hourly: credit new BigCommerce orders to the chats that led to them (direct /
// assisted conversion) for every installed store. `storeId` limits the run to one store.
export const run: ActionRun = async ({ params, api, connections, logger }) => {
  const filter = params.storeId ? { id: { equals: String(params.storeId) } } : undefined;
  const stores = await api.internal.bigcommerce.store.findMany({ filter, first: 250 });
  const results: Record<string, unknown> = {};
  for (const store of stores) {
    try {
      results[store.id] = await syncStoreOrders({ api, connections, logger }, store);
    } catch (err) {
      logger.error({ err, storeId: store.id }, "syncOrders failed for store");
    }
  }
  return results;
};

export const params = {
  storeId: { type: "string" },
};

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "17 * * * *" }] },
  timeoutMS: 900000,
};
