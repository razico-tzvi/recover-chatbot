import { config } from "../config.js";

const BASE = `https://api.bigcommerce.com/stores/${config.BC_STORE_HASH}`;

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

function buildUrl(path: string, query?: RequestOpts["query"]): string {
  const url = new URL(BASE + path);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Authenticated GET against the BigCommerce Management API with rate-limit
 * backoff. BigCommerce returns 429 with an `X-Rate-Limit-Time-Reset-Ms`
 * header indicating how long to wait before retrying.
 */
export async function bcGet<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const url = buildUrl(path, opts.query);

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: {
        "X-Auth-Token": config.BC_ACCESS_TOKEN,
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
