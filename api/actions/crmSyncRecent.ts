import { ActionOptions, ActionRun } from "gadget-server";
import { storesFor, syncRecent } from "../lib/crm";

/**
 * Wraps a promise execution with a hard timeout limit.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Executes syncRecent with retry logic and per-attempt timeout.
 */
async function syncStoreRecentWithRetry(
  context: { api: any; logger: any },
  store: any,
  minutes: number = 30,
  maxRetries: number = 2,
  timeoutMs: number = 30000
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(
        syncRecent(context, store, minutes),
        timeoutMs,
        `crmSyncRecent attempt ${attempt} timed out after ${timeoutMs}ms for store ${store.id}`
      );
    } catch (err: any) {
      lastError = err;
      context.logger.warn(
        { err, storeId: store.id, attempt },
        `[crmSyncRecent] Attempt ${attempt} failed for store ${store.id}: ${err.message || err}`
      );

      if (attempt < maxRetries) {
        // Wait 1 second before retrying
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw lastError;
}

export const run: ActionRun = async ({ api, logger }) => {
  const results: Record<string, unknown> = {};
  
  try {
    const stores = await storesFor(api);

    for (const store of stores) {
      try {
        // 30-second timeout per store call, up to 2 retries
        results[store.id] = await syncStoreRecentWithRetry({ api, logger }, store, 30, 2, 30000);
      } catch (err: any) {
        logger.error(
          { err, storeId: store.id },
          `[crmSyncRecent] Execution failed for store ${store.id} after retries`
        );
        results[store.id] = { error: err?.message || String(err) };
      }
    }
  } catch (err) {
    logger.error({ err }, "[crmSyncRecent] Failed to fetch stores");
  }

  return results;
};

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "*/5 * * * *" }] },
  timeoutMS: 120000, // Reduced job limit to 2 minutes (prevents 5-minute hanging)
};