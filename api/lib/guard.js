// Time limits and retries for background jobs (crmSyncHistory, crmSyncRecent,
// crmPoll, syncOrders). Server-only.
//
// Calls to the app's own Gadget API sometimes hang until undici's 5-minute
// headers timeout ("[Network] fetch failed", UND_ERR_HEADERS_TIMEOUT), which used
// to fail a whole job run. guardApi() wraps `api` so every `api.internal.*` call
// gets a time limit, and reads / idempotent writes are retried. A request that
// timed out is not aborted (the client gives no handle on it) — it just stops
// blocking the job.

export const CALL_TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 3_000];

export class StepTimeoutError extends Error {
  constructor(label, ms) {
    super(`${label} timed out after ${Math.round(ms / 1000)}s`);
    this.name = "StepTimeoutError";
    this.label = label;
  }
}

export function withTimeout(work, label, ms = CALL_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeoutError(label, ms)), ms);
  });
  const run = Promise.resolve().then(() => (typeof work === "function" ? work() : work));
  return Promise.race([run, timeout]).finally(() => clearTimeout(timer));
}

// Network-level failures worth another try: our own time limit, undici timeouts,
// dropped connections, and Gadget/BigCommerce 5xx gateway errors.
export function isTransient(err) {
  if (!err) return false;
  if (err instanceof StepTimeoutError || err.name === "TimeoutError" || err.name === "AbortError") return true;
  const codes = [err.code, err.cause?.code, err.cause?.cause?.code].filter(Boolean).map(String);
  if (codes.some((c) => /^(UND_ERR_|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|GGT_NETWORK)/.test(c))) return true;
  const status = Number(err.status || err.statusCode || err.response?.status);
  if ([502, 503, 504].includes(status)) return true;
  return /fetch failed|socket hang up|network|timed? ?out|headers timeout|\b50[234]\b/i.test(String(err.message || ""));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs `work` with a time limit; transient failures are retried (attempts in total).
/** @param {() => any} work @param {{ label?: string, ms?: number, attempts?: number, logger?: any }} [opts] */
export async function retrying(work, { label = "call", ms = CALL_TIMEOUT_MS, attempts = ATTEMPTS, logger } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTimeout(work, label, ms);
    } catch (err) {
      if (attempt >= attempts || !isTransient(err)) throw err;
      logger?.warn({ err, label, attempt }, "transient failure; retrying");
      await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
    }
  }
}

// Methods safe to send twice. create is not: a timed-out create may still land,
// so it gets a time limit but no retry (callers re-check before creating).
const RETRYABLE = /^(find|maybeFind|findMany|findFirst|findOne|findBy|maybeFindBy|update|upsert|delete|deleteMany|bulkUpdate|bulkDelete)/;

// A record list's nextPage() also talks to the API: guard it, and the pages it returns.
// Gadget record lists are frozen, so the list can't be patched: it is wrapped in a
// Proxy that swaps nextPage (a prototype method, so the Proxy invariants allow it)
// and leaves everything else — indexes, length, iteration, hasNextPage — as is.
const guardedLists = new WeakSet();
function guardResult(result, label, logger, ms) {
  if (!result || typeof result !== "object" || typeof result.nextPage !== "function" || guardedLists.has(result)) return result;
  const next = result.nextPage.bind(result);
  const nextPage = () => retrying(next, { label: `${label}.nextPage`, logger, ms }).then((p) => guardResult(p, label, logger, ms));
  const proxy = new Proxy(result, {
    get(obj, prop) {
      if (prop === "nextPage") return nextPage;
      const value = Reflect.get(obj, prop, obj);
      // Methods run against the real list (it may use private state).
      return typeof value === "function" && !Object.getOwnPropertyDescriptor(obj, prop) ? value.bind(obj) : value;
    },
  });
  guardedLists.add(proxy);
  return proxy;
}

function guardNamespace(target, path, logger, ms) {
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj);
      if (typeof prop === "symbol") return value;
      // Proxy invariant: a frozen property must come back as-is.
      const desc = Object.getOwnPropertyDescriptor(obj, prop);
      if (desc && !desc.configurable && !desc.writable) return value;
      const label = `${path}.${prop}`;
      if (typeof value === "function") {
        return (...args) => {
          const call = () => value.apply(obj, args);
          const opts = { label, logger, ms, attempts: RETRYABLE.test(prop) ? ATTEMPTS : 1 };
          return retrying(call, opts).then((r) => guardResult(r, label, logger, ms));
        };
      }
      if (value && typeof value === "object") return guardNamespace(value, label, logger, ms);
      return value;
    },
  });
}

// `api` for a background job: api.internal.* (and enqueue) get time limits and
// retries; everything else (e.g. api.crmSyncHistory passed to enqueue) is untouched.
export function guardApi(api, logger, ms = CALL_TIMEOUT_MS) {
  if (!api || api.__guarded) return api;
  const internal = guardNamespace(api.internal, "api.internal", logger, ms);
  return new Proxy(api, {
    get(obj, prop) {
      if (prop === "__guarded") return true;
      if (prop === "internal") return internal;
      // Not retried: a timed-out enqueue may still have scheduled the job.
      if (prop === "enqueue") return (...args) => withTimeout(() => obj.enqueue(...args), "api.enqueue", ms);
      return Reflect.get(obj, prop, obj);
    },
  });
}

export const errorText = (err) => String(err?.message || err || "Unknown error").slice(0, 500);
