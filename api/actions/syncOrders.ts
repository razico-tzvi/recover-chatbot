import { ActionOptions } from "gadget-server";
import { syncStoreOrders } from "../lib/analytics";
import { errorText, guardApi } from "../lib/guard";

// Hourly: credit new BigCommerce orders to the chats that led to them (direct /
// assisted conversion) for every installed store. `storeId` limits the run to one store.
// Gadget API calls and BigCommerce order pages have time limits and are retried on
// network hangs (guard.js); a store that still fails is retried next hour from its
// saved cursor, without holding up the other stores.
export const run: ActionRun = async ({ params, api: rawApi, connections, logger }) => {
  const api = guardApi(rawApi, logger);
  const filter = params.storeId ? { id: { equals: String(params.storeId) } } : undefined;
  const stores = await api.internal.bigcommerce.store.findMany({ filter, first: 250 });
  const results: Record<string, unknown> = {};
  for (const store of stores) {
    try {
      results[store.id] = await syncStoreOrders({ api, connections, logger }, store);
    } catch (err) {
      logger.error({ err, storeId: store.id }, "syncOrders failed for store; retried next hour");
      results[store.id] = { error: errorText(err) };
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
