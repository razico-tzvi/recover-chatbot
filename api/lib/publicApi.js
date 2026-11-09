import { createHash, randomBytes } from "crypto";
import {
  API_SCOPES, DEFAULT_GUIDELINES, DEFAULT_FAQ, DEFAULT_VOICE_TONE, DEFAULT_SAFEGUARDS_INSTRUCTIONS, DEFAULT_INCENTIVE_INSTRUCTIONS,
  resolveBranding, resolveFeatures, resolveSafeguards, resolveCrm, resolveLearning,
} from "./defaults";

// Public REST API (API tab). Keys look like `rak_<43 chars>`; only their
// SHA-256 is stored, so a lost key can't be shown again — make a new one.
// Every endpoint is GET, scoped to one resource and to the key's store.

export const KEY_PREFIX = "rak_";
const LAST_USED_EVERY_MS = 60 * 1000;

export const hashKey = (key) => createHash("sha256").update(String(key)).digest("hex");

export function newKey() {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, keyHash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

export const SCOPE_KEYS = API_SCOPES.map((s) => s.key);
export const cleanScopes = (list) => [...new Set((Array.isArray(list) ? list : []).filter((s) => SCOPE_KEYS.includes(s)))];

export const keyState = (k, now = Date.now()) =>
  k.revokedAt ? "revoked" : k.expiresAt && new Date(k.expiresAt).getTime() <= now ? "expired" : "active";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Bearer key (or X-Api-Key) → { key, store }, or throws ApiError(401/403).
// `scope` null = any valid key (GET /v1/me).
export async function authenticate(api, request, scope) {
  const header = String(request.headers.authorization || "");
  const raw = (header.match(/^Bearer\s+(\S+)$/i)?.[1] || String(request.headers["x-api-key"] || "")).trim();
  if (!raw.startsWith(KEY_PREFIX)) throw new ApiError(401, "Missing API key. Send it as `Authorization: Bearer rak_…`.");

  const key = await api.internal.apiKey.findFirst({ filter: { keyHash: { equals: hashKey(raw) } } }).catch(() => null);
  if (!key) throw new ApiError(401, "Invalid API key.");
  const state = keyState(key);
  if (state !== "active") throw new ApiError(401, `This API key is ${state}.`);
  if (scope && !cleanScopes(key.scopes).includes(scope)) throw new ApiError(403, `This API key doesn't have the "${scope}" scope.`);

  const store = await api.internal.bigcommerce.store.findFirst({ filter: { id: { equals: key.storeId } } }).catch(() => null);
  if (!store) throw new ApiError(401, "The store for this API key is no longer installed.");

  if (!key.lastUsedAt || Date.now() - new Date(key.lastUsedAt).getTime() > LAST_USED_EVERY_MS) {
    await api.internal.apiKey.update(key.id, { lastUsedAt: new Date() }).catch(() => {});
  }
  return { key, store };
}

// Wraps a handler with auth, JSON errors and no-store caching.
export function endpoint(scope, handler) {
  const route = async ({ request, reply, api, logger, connections }) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { key, store } = await authenticate(api, request, scope);
      const body = await handler({ request, api, logger, connections, store, key });
      if (body == null) return reply.code(404).send({ error: "Not found." });
      return reply.send(body);
    } catch (err) {
      if (err instanceof ApiError) return reply.code(err.status).send({ error: err.message });
      logger.error({ err }, `public API ${scope} failed`);
      return reply.code(500).send({ error: "Internal error." });
    }
  };
  // Server-to-server use; CORS allowed so dashboards can call it too.
  route.options = { cors: { origin: true, methods: ["GET", "OPTIONS"], allowedHeaders: ["Authorization", "X-Api-Key"] } };
  return route;
}

// ─────────────────────────── list helpers ───────────────────────────

export function listParams(query, max = 200) {
  const limit = Math.min(max, Math.max(1, Math.floor(Number(query.limit)) || 50));
  const date = (v) => {
    if (!v) return null;
    const d = new Date(String(v));
    if (Number.isNaN(d.getTime())) throw new ApiError(400, `Invalid date: ${v}`);
    return d.toISOString();
  };
  // `cursor` is the createdAt of the last row of the previous page (newest first).
  return { limit, since: date(query.since), until: date(query.until), cursor: date(query.cursor) };
}

export function createdFilter(storeId, { since, until, cursor }) {
  const createdAt = {};
  if (since) createdAt.greaterThanOrEqual = since;
  if (until) createdAt.lessThan = until;
  if (cursor && (!until || cursor < until)) createdAt.lessThan = cursor;
  return { storeId: { equals: storeId }, ...(Object.keys(createdAt).length ? { createdAt } : {}) };
}

// Newest first; reads one extra row to know whether another page exists.
export async function page(model, filter, limit, select) {
  const rows = [...(await model.findMany({ filter, sort: { createdAt: "Descending" }, first: limit + 1, ...(select ? { select } : {}) }))];
  const more = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data[data.length - 1];
  return { data, nextCursor: more && last ? new Date(last.createdAt).toISOString() : null };
}

const iso = (d) => (d ? new Date(d).toISOString() : null);

// ─────────────────────────── serializers ───────────────────────────

export const sessionOut = (s) => ({
  sessionId: s.sessionId,
  createdAt: iso(s.createdAt),
  updatedAt: iso(s.updatedAt),
  messageCount: s.messageCount || 0,
  preview: s.preview || "",
  model: s.model || "",
  provider: s.provider || "",
  needsHuman: !!s.needsHuman,
  handoffAt: iso(s.handoffAt),
  handoffSummary: s.handoffSummary || "",
  flagged: !!s.flagged,
  flagReason: s.flagReason || "",
  rating: s.rating ?? null,
  productsShown: !!s.productsShown,
  addedToCart: !!s.addedToCart,
  conversion: s.conversion || null,
  orderId: s.orderId ?? null,
  orderTotal: s.orderTotal ?? null,
  orderCurrency: s.orderCurrency || null,
  convertedAt: iso(s.convertedAt),
  playbookVersion: s.playbookVersion ?? null,
  inputTokens: s.inputTokens || 0,
  outputTokens: s.outputTokens || 0,
  costUsd: s.costUsd ?? null,
});

// IPs are never returned.
export const messageOut = (m) => ({
  createdAt: iso(m.createdAt),
  role: m.role,
  content: m.content || "",
  tools: Array.isArray(m.tools) ? m.tools : [],
  imageCount: Array.isArray(m.images) ? m.images.length : 0,
});

export const safetyOut = (e) => ({
  id: e.id,
  createdAt: iso(e.createdAt),
  kind: e.kind,
  detail: e.detail || "",
  sessionId: e.sessionId || null,
  expiresAt: iso(e.expiresAt),
});

const block = (value, fallback) => (value && String(value).trim()) || fallback;

export const contextOut = (store) => ({
  guidelines: { content: block(store.systemPrompt, DEFAULT_GUIDELINES), isDefault: !String(store.systemPrompt || "").trim() },
  faq: { content: block(store.faq, DEFAULT_FAQ), isDefault: !String(store.faq || "").trim() },
  voiceTone: { content: block(store.voiceTone, DEFAULT_VOICE_TONE), isDefault: !String(store.voiceTone || "").trim() },
  safeguardsInstructions: { content: block(store.safeguardsInstructions, DEFAULT_SAFEGUARDS_INSTRUCTIONS), isDefault: !String(store.safeguardsInstructions || "").trim() },
  incentiveInstructions: { content: block(store.incentiveInstructions, DEFAULT_INCENTIVE_INSTRUCTIONS), isDefault: !String(store.incentiveInstructions || "").trim() },
  salesPlaybook: store.salesPlaybook?.trim() ? { version: store.learningState?.activeVersion ?? null, content: store.salesPlaybook } : null,
  updatedAt: iso(store.updatedAt),
});

// No API keys, secrets or webhook URLs (they can carry tokens).
export const settingsOut = (store) => {
  const { enabledAt, ...crm } = resolveCrm(store);
  return {
    storeHash: store.storeHash,
    branding: resolveBranding(store),
    features: resolveFeatures(store),
    safeguards: resolveSafeguards(store),
    handoff: {
      destination: store.handoffDestination || null,
      email: store.handoffEmail || null,
      webhookConfigured: !!store.handoffWebhookUrl,
    },
    llm: {
      provider: store.llmProvider || null,
      model: store.llmModel || null,
      models: store.anthropicModels || null,
      configured: !!store.llmApiKey,
      visionEnabled: !!store.visionEnabled,
    },
    crm: { ...crm, enabledAt: enabledAt || null, freshdeskDomain: store.freshdeskDomain || null, connected: !!(store.freshdeskDomain && store.freshdeskApiKey) },
    learning: resolveLearning(store),
    updatedAt: iso(store.updatedAt),
  };
};
