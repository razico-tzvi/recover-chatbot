// Helpers shared by the integration test action and the chat route.

// Accepts "acme", "acme.freshdesk.com" or "https://acme.freshdesk.com/…".
export function freshdeskHost(domain) {
  let d = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d) return "";
  if (!d.includes(".")) d += ".freshdesk.com";
  return /^[a-z0-9.-]+$/.test(d) ? d : "";
}

export const freshdeskConnected = (store) => !!(freshdeskHost(store?.freshdeskDomain) && store?.freshdeskApiKey);

// Opens a Freshdesk ticket for a chat handoff. Returns the ticket id.
export async function createFreshdeskTicket(store, { email, subject, description }) {
  const host = freshdeskHost(store.freshdeskDomain);
  const res = await fetch(`https://${host}/api/v2/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${store.freshdeskApiKey}:X`).toString("base64"),
    },
    body: JSON.stringify({ email, subject, description, status: 2, priority: 2, source: 7, tags: ["ai-handoff"] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Freshdesk ${res.status}`);
  const t = await res.json();
  return t?.id;
}

// ─────────────────────────── Freshdesk API (CRM ticket answering) ───────────────────────────

export class FreshdeskRateLimit extends Error {
  constructor(retryAfter) {
    super(`Freshdesk rate limit (retry after ${retryAfter}s)`);
    this.retryAfter = retryAfter;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_RATE_WAIT_S = 5;

// Small authenticated Freshdesk v2 client. Plans have per-minute API limits
// (some as low as 50/min). A short Retry-After (≤ 5 s) is waited out once;
// anything longer throws FreshdeskRateLimit so the caller saves its progress
// and resumes later — long sleeps inside an action get it aborted.
export async function freshdesk(store, method, path, body) {
  const host = freshdeskHost(store.freshdeskDomain);
  if (!host || !store.freshdeskApiKey) throw new Error("Freshdesk isn't connected.");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${host}/api/v2${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(`${store.freshdeskApiKey}:X`).toString("base64"),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 429) {
      const after = Number(res.headers.get("retry-after")) || 30;
      if (attempt < 1 && after <= MAX_RATE_WAIT_S) {
        await wait(after * 1000 + 500);
        continue;
      }
      throw new FreshdeskRateLimit(after);
    }
    return handle(res, method, path);
  }
}

async function handle(res, method, path) {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Freshdesk ${method} ${path.split("?")[0]} → ${res.status} ${detail.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export const freshdeskTicketUrl = (store, id) => `https://${freshdeskHost(store?.freshdeskDomain)}/a/tickets/${id}`;
