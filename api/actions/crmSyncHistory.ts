import { ActionOptions } from "gadget-server";
import { storesFor, syncArchived, syncHistory } from "../lib/crm";
import { seedVoiceTone, VOICE_SEED_REPLIES } from "../lib/voice";

// Nightly: pull resolved/closed Freshdesk tickets (agent public replies only)
// into crmHistory for every connected store. Incremental via crmState.historyCursor;
// the first run looks back 12 months. When a run stops at Freshdesk's rate limit
// (or the per-run cap) it schedules its own continuation for that store, up to
// MAX_CONTINUATIONS times, instead of sleeping inside the action.
// Once a store's sync chain finishes (or it has VOICE_SEED_REPLIES tickets stored),
// its Voice & tone is seeded once from the stored agent replies — only while the
// block is still the built-in default.
// Then (once the list is caught up) it backfills archived tickets by id — Freshdesk
// drops them from the list — which can take hours on a 40/min plan, so archive
// runs may chain up to MAX_ARCHIVE_CONTINUATIONS.
const MAX_CONTINUATIONS = 20;
const MAX_ARCHIVE_CONTINUATIONS = 1500;

export const run: ActionRun = async ({ params, api, logger }) => {
  const ctx = { api, logger };
  const continuation = Number(params.continuation) || 0;
  const results: Record<string, unknown> = {};
  for (const store of await storesFor(api, params.storeId)) {
    try {
      // A chain for this store is already waiting out the rate limit: don't start a second one.
      const paused = (store.crmState as any)?.syncPausedUntil;
      if (!continuation && paused && new Date(paused).getTime() > Date.now() - 30_000) {
        results[store.id] = { skipped: "chain running" };
        continue;
      }
      let r: any = await syncHistory(ctx, store);
      if (!r.skipped && !r.error && !r.retryAfter && !r.more && !(store.crmState as any)?.archive?.done) {
        r = { ...(await syncArchived(ctx, store)), live: r };
      }
      results[store.id] = r;
      if ((r.retryAfter || r.more) && continuation < (r.archive ? MAX_ARCHIVE_CONTINUATIONS : MAX_CONTINUATIONS)) {
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
    }
  }
  return results;
};

export const params = {
  storeId: { type: "string" },
  continuation: { type: "number" },
};

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "0 7 * * *" }] },
  timeoutMS: 900000,
};
