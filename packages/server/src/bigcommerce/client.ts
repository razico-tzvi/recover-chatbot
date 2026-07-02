import { config } from "../config.js";
import { getStoreToken } from "../db/stores.js";

export class BigCommerceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BigCommerceError";
  }
}

interface RequestOpts {
  /** Query parameters appended to the path. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Max retries on HTTP 429 (rate limit). */
  maxRetries?: number;
}

/**
 * Resolve the store hash + token for a request. In app mode the token comes
 * from the per-store record; in single-store/dev mode it falls back to the
 * BC_STORE_HASH / BC_ACCESS_TOKEN env vars.
 */
function resolveStore(storeHash?: string): { hash: string; token: string } {
  const hash = storeHash ?? config.BC_STORE_HASH;
  const token = (storeHash ? getStoreToken(storeHash) : null) ?? config.BC_ACCESS_TOKEN;
  if (!hash || !token) {
    throw new BigCommerceError("No BigCommerce credentials available for this store.", 401);
  }
  return { hash, token };
}

function buildUrl(hash: string, path: string, query?: RequestOpts["query"]): string {
  const url = new URL(`https://api.bigcommerce.com/stores/${hash}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Authenticated GET against the BigCommerce Management API for a given store,
 * with rate-limit backoff. BigCommerce returns 429 with an
 * `X-Rate-Limit-Time-Reset-Ms` header indicating how long to wait.
 */
export async function bcGet<T>(
  storeHash: string | undefined,
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const { hash, token } = resolveStore(storeHash);
  const url = buildUrl(hash, path, opts.query);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        "X-Auth-Token": token,
        Accept: "application/json",
      },
    });

    if (res.status === 429 && attempt < maxRetries) {
      const resetMs = Number(res.headers.get("X-Rate-Limit-Time-Reset-Ms")) || 1000;
      await new Promise((r) => setTimeout(r, Math.min(resetMs, 10_000)));
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BigCommerceError(
        `BigCommerce ${res.status} on ${path}: ${body.slice(0, 300)}`,
        res.status,
      );
    }

    return (await res.json()) as T;
  }
}
