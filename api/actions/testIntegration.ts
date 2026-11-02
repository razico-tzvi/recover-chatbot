import { ActionOptions } from "gadget-server";
import { freshdeskHost } from "../lib/integrations";

// Integrations tab "Test connection". Credentials typed into the panel (not yet
// saved) are tested as-is; blank ones fall back to what the store has saved.
// Never returns the credentials themselves.
export const run: ActionRun = async ({ params, api, connections, logger }) => {
  const storeHash = connections.bigcommerce.currentStoreHash;
  if (!storeHash) throw new Error("No store in context.");
  const [store] = await api.internal.bigcommerce.store.findMany({ filter: { storeHash: { equals: storeHash } }, first: 1 });
  if (!store) throw new Error("Store not installed.");

  const p = params as Record<string, string | undefined>;
  const pick = (typed: string | undefined, saved: unknown) => (typed || "").trim() || String(saved || "").trim();

  try {
    switch (p.integration) {
      case "anthropic":
        return await testLlm(p.provider || store.llmProvider || "anthropic", pick(p.apiKey, store.llmApiKey), pick(p.baseUrl, store.llmBaseUrl));
      case "bigcommerce":
        return await testBigCommerce(await connections.bigcommerce.forStoreHash(storeHash));
      case "freshdesk":
        return await testFreshdesk(pick(p.domain, store.freshdeskDomain), pick(p.apiKey, store.freshdeskApiKey));
      case "shipstation":
        return await testShipStation(pick(p.apiKey, store.shipstationApiKey), pick(p.apiSecret, store.shipstationApiSecret));
      default:
        return { ok: false, message: "Unknown integration." };
    }
  } catch (err: any) {
    logger.warn({ err, integration: p.integration }, "integration test failed");
    return { ok: false, message: err?.name === "TimeoutError" ? "The service didn't respond in time." : "Couldn't reach the service." };
  }
};

const TIMEOUT_MS = 10_000;

async function get(url: string, headers: Record<string, string>) {
  return fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function authMessage(status: number, service: string) {
  if (status === 401 || status === 403) return `${service} rejected the credentials (${status}).`;
  return `${service} returned an unexpected response (${status}).`;
}

async function testLlm(provider: string, apiKey: string, baseUrl: string) {
  if (provider === "anthropic") {
    if (!apiKey) return { ok: false, message: "Enter an Anthropic API key." };
    const res = await get("https://api.anthropic.com/v1/models", { "x-api-key": apiKey, "anthropic-version": "2023-06-01" });
    return res.ok ? { ok: true, message: "Connected to Anthropic." } : { ok: false, message: authMessage(res.status, "Anthropic") };
  }
  if (!baseUrl) return { ok: false, message: "Enter the API base URL." };
  const res = await get(`${baseUrl.replace(/\/+$/, "")}/models`, apiKey ? { Authorization: `Bearer ${apiKey}` } : {});
  return res.ok ? { ok: true, message: "Connected to the OpenAI-compatible endpoint." } : { ok: false, message: authMessage(res.status, "The endpoint") };
}

// BigCommerce gives no scope list for this install, so each permission the bot
// needs is probed with a harmless call: 403 means the scope is missing.
async function testBigCommerce(bc: any) {
  const missing: string[] = [];
  const status = (err: any) => {
    const s = err?.status ?? err?.response?.status;
    if (s) return Number(s);
    const m = /:\s(\d{3})\s-/.exec(String(err?.message || ""));
    return m ? Number(m[1]) : 0;
  };

  await bc.v3.get("/catalog/products", { query: { limit: 1, include_fields: "id" } });
  try {
    await bc.v2.get("/store");
  } catch (err) {
    if (status(err) === 403) missing.push("Information & Settings (read)");
    else throw err;
  }
  try {
    // A checkout that can't exist: 404 means the call was authorized.
    await bc.v3.post("/checkouts/00000000-0000-0000-0000-000000000000/coupons", { body: { coupon_code: "PERMISSION-CHECK" } });
  } catch (err) {
    if (status(err) === 403) missing.push("Checkouts (modify)");
  }
  return missing.length
    ? { ok: false, missing, message: `Connected, but missing permissions: ${missing.join(", ")}. Add them to the app and re-authorize it.` }
    : { ok: true, missing, message: "Connected with all required permissions." };
}

async function testFreshdesk(domain: string, apiKey: string) {
  const host = freshdeskHost(domain);
  if (!host || !apiKey) return { ok: false, message: "Enter your Freshdesk domain and API key." };
  const res = await get(`https://${host}/api/v2/agents/me`, { Authorization: "Basic " + Buffer.from(`${apiKey}:X`).toString("base64") });
  if (!res.ok) return { ok: false, message: authMessage(res.status, "Freshdesk") };
  const me = await res.json().catch(() => ({}));
  return { ok: true, message: `Connected to ${host}${me?.contact?.name ? ` as ${me.contact.name}` : ""}.` };
}

// ShipStation V1 uses key + secret (Basic auth); V2 uses a single API-Key header.
async function testShipStation(apiKey: string, apiSecret: string) {
  if (!apiKey) return { ok: false, message: "Enter your ShipStation API key." };
  const res = apiSecret
    ? await get("https://ssapi.shipstation.com/carriers", { Authorization: "Basic " + Buffer.from(`${apiKey}:${apiSecret}`).toString("base64") })
    : await get("https://api.shipstation.com/v2/carriers", { "API-Key": apiKey });
  return res.ok ? { ok: true, message: "Connected to ShipStation." } : { ok: false, message: authMessage(res.status, "ShipStation") };
}

export const params = {
  integration: { type: "string" },
  provider: { type: "string" },
  apiKey: { type: "string" },
  apiSecret: { type: "string" },
  baseUrl: { type: "string" },
  domain: { type: "string" },
};

export const options: ActionOptions = {
  triggers: { api: true },
};
