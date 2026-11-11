import { ActionOptions } from "gadget-server";
import { resolveRange, storeAnalytics, syncStoreOrders } from "../lib/analytics";

// Analytics tab: the current store's numbers for the last `days` days, or a custom
// `from`/`to` (YYYY-MM-DD, UTC, inclusive); `compare` adds the period before it.
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

  const range = resolveRange({ days: params.days, from: params.from, to: params.to, compare: params.compare });
  return { ...(await storeAnalytics(api, store, range)), syncError };
};

export const params = {
  days: { type: "number" },
  from: { type: "string" },
  to: { type: "string" },
  compare: { type: "boolean" },
  syncOrders: { type: "boolean" },
};

export const options: ActionOptions = {
  triggers: { api: true },
  timeoutMS: 120000,
};
