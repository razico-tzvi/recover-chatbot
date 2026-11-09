import { ActionOptions } from "gadget-server";
import { storeAnalytics, syncStoreOrders } from "../lib/analytics";

// Analytics tab: the current store's numbers for the last `days` days (7–90).
// `syncOrders: true` first pulls new orders for conversion attribution
// (otherwise the hourly syncOrders job keeps them current).
export const run: ActionRun = async ({ params, api, connections, logger }) => {
  const storeHash = connections.bigcommerce.currentStoreHash;
  if (!storeHash) throw new Error("No store in context.");
  const store = await api.internal.bigcommerce.store.findFirst({ filter: { storeHash: { equals: storeHash } } });

  let syncError: string | null = null;
  if (params.syncOrders) {
    try {
      await syncStoreOrders({ api, connections, logger }, store);
    } catch (err: any) {
      logger.error({ err }, "order sync from Analytics tab failed");
      syncError = String(err?.message || err).slice(0, 300);
    }
  }

  const days = Math.min(90, Math.max(1, Math.round(Number(params.days) || 30)));
  return { ...(await storeAnalytics(api, store, days)), syncError };
};

export const params = {
  days: { type: "number" },
  syncOrders: { type: "boolean" },
};

export const options: ActionOptions = {
  triggers: { api: true },
  timeoutMS: 120000,
};
