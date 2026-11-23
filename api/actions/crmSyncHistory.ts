import { ActionOptions } from "gadget-server";
import { backfillQuestions, saveState, storesFor, syncArchived, syncHistory } from "../lib/crm";
import { errorText, guardApi, isTransient } from "../lib/guard";
import { seedVoiceTone, VOICE_SEED_REPLIES } from "../lib/voice";

// Nightly: pull resolved/closed Freshdesk tickets (agent public replies only)
// into crmHistory for every connected store. Incremental via crmState.historyCursor;
// the first run looks back HISTORY_MONTHS (defaults.js, 6). When a run stops at Freshdesk's rate limit
// (or the per-run cap) it schedules its own continuation for that store, up to
// MAX_CONTINUATIONS times, instead of sleeping inside the action.
// Once a store's sync chain finishes (or it has VOICE_SEED_REPLIES tickets stored),
// its Voice & tone is seeded once from the stored agent replies — only while the
// block is still the built-in default.
// Then (once the list is caught up) it backfills archived tickets by id — Freshdesk
// drops them from the list. A full-window backfill on a 40/min plan pauses for the
// rate limit hundreds of times, so a chain may continue up to MAX_CONTINUATIONS;
// it ends on its own as soon as a run is caught up.
const MAX_CONTINUATIONS = 1500;
// A run that fails on a network hang / timeout (e.g. a Gadget API call that never
// answers — every API call has a 30 s limit and is retried, see guard.js) is
// retried as a batch from the saved cursor, RETRY_DELAY_S later, up to MAX_RETRIES
// times in a row; only then does the Context tab show "Sync error".
const MAX_RETRIES = 5;
const RETRY_DELAY_S = 120;

export const run: ActionRun = async ({ params, api: rawApi, logger }) => {
  const api = guardApi(rawApi, logger);
  const ctx = { api, logger };
  const continuation = Number(params.continuation) || 0;
  const retry = Number(params.retry) || 0;
  const results: Record<string, unknown> = {};
  for (const store of await storesFor(api, params.storeId)) {
    try {
      // A chain for this store is already waiting out the rate limit (or a retry): don't start a second one.
      const st = (store.crmState as any) || {};
      const paused = [st.syncPausedUntil, st.syncRetryAt].filter(Boolean).map((x: string) => new Date(x).getTime());
      if (!continuation && paused.some((t: number) => t > Date.now() - 30_000)) {
        results[store.id] = { skipped: "chain running" };
        continue;
      }
      let r: any;
      try {
        r = await syncHistory(ctx, store);
        const caught = (x: any) => !x.skipped && !x.error && !x.retryAfter && !x.more;
        if (caught(r) && !(store.crmState as any)?.archive?.done) {
          r = { ...(await syncArchived(ctx, store)), live: r };
          // Archive finished in this run: go straight on to the question backfill.
          if (caught(r) && (store.crmState as any)?.archive?.done && !(store.crmState as any)?.questionBackfill?.done) r.more = true;
        } else if (caught(r) && !(store.crmState as any)?.questionBackfill?.done) {
          r = { ...(await backfillQuestions(ctx, store)), live: r };
        }
      } catch (err: any) {
        // Thrown outside the batch loop (e.g. saving progress hung): same retry path.
        r = { error: `Sync failed: ${errorText(err)}`, transient: isTransient(err) };
        logger.warn({ err, storeId: store.id, transient: r.transient }, "crm history sync failed");
        await saveState(api, store, { lastSyncAt: new Date().toISOString(), lastSyncError: r.error, lastSyncErrorAt: new Date().toISOString() }).catch(() => {});
      }
      results[store.id] = r;
      if (r.error && r.transient && retry < MAX_RETRIES) {
        const at = new Date(Date.now() + RETRY_DELAY_S * 1000).toISOString();
        await api.enqueue(api.crmSyncHistory, { storeId: store.id, continuation: continuation + 1, retry: retry + 1 }, { startAt: at });
        await saveState(api, store, { syncRetryAt: at, syncRetries: retry + 1 }).catch(() => {});
        logger.info({ storeId: store.id, retry: retry + 1, at, error: r.error }, "crm history sync retries the batch later");
        continue;
      }
      if ((r.retryAfter || r.more) && continuation < MAX_CONTINUATIONS) {
        const delayS = r.retryAfter ? r.retryAfter + 5 : 5;
        await api.enqueue(
          api.crmSyncHistory,
          { storeId: store.id, continuation: continuation + 1 },
          { startAt: new Date(Date.now() + delayS * 1000).toISOString() }
        );
        logger.info({ storeId: store.id, delayS, continuation: continuation + 1, saved: r.saved }, "crm history sync continues later");
      }
      // A rate-limited backfill can take days to catch up, so a store that
      // already has plenty of replies is seeded without waiting for it.
      const caughtUp = !r.retryAfter && !r.more;
      if (!r.skipped && !r.error && (caughtUp || (store.crmState?.historyCount || 0) >= VOICE_SEED_REPLIES) && !store.crmState?.voiceSeed && !String(store.voiceTone || "").trim()) {
        try {
          results[`${store.id}:voice`] = await seedVoiceTone(ctx, store);
        } catch (err: any) {
          logger.info({ storeId: store.id, reason: err?.message }, "voice & tone not seeded");
        }
      }
    } catch (err) {
      logger.error({ err, storeId: store.id }, "crmSyncHistory failed for store");
      results[store.id] = { error: errorText(err) };
    }
  }
  return results;
};

export const params = {
  storeId: { type: "string" },
  continuation: { type: "number" },
  retry: { type: "number" },
};

export const options: ActionOptions = {
  triggers: {
    api: true,
    scheduler: [{ cron: "0 7 * * *" }],
  },
  timeoutMS: 900000,
};
