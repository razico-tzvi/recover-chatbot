import { createHash, randomBytes } from "crypto";
import {
  API_SCOPES, API_ACCESS, API_CONTEXT_SOURCES, API_WRITABLE_SETTINGS, API_CONTEXT_MAX_CHARS, PLAYBOOK_MAX_CHARS, FEATURES, ORDER_FIELDS,
  DEFAULT_GUIDELINES, DEFAULT_FAQ, DEFAULT_VOICE_TONE, DEFAULT_SAFEGUARDS_INSTRUCTIONS, DEFAULT_INCENTIVE_INSTRUCTIONS,
  resolveBranding, resolveFeatures, resolveSafeguards, resolveCrm, resolveLearning,
} from "./defaults";
import { publishPlaybook, deactivate } from "./learning";

// Public REST API (API tab). Keys look like `rak_<43 chars>`; only their
// SHA-256 is stored, so a lost key can't be shown again — make a new one.
// Every endpoint is scoped to one resource and to the key's store. GETs work
// with any key that has the scope; writes (PUT /v1/context/{source},
// PATCH /v1/settings) also need a read-write key.

export const KEY_PREFIX = "rak_";
const LAST_USED_EVERY_MS = 60 * 1000;

export const hashKey = (key) => createHash("sha256").update(String(key)).digest("hex");

export function newKey() {
  const key = KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, keyHash: hashKey(key), prefix: key.slice(0, KEY_PREFIX.length + 6) };
}

export const SCOPE_KEYS = API_SCOPES.map((s) => s.key);
export const cleanScopes = (list) => [...new Set((Array.isArray(list) ? list : []).filter((s) => SCOPE_KEYS.includes(s)))];
// Anything but an explicit "readwrite" is read-only.
export const keyAccess = (k) => (k?.access === "readwrite" ? "readwrite" : "read");
export const cleanAccess = (v) => (API_ACCESS.some((a) => a.key === v) ? v : null);

export const keyState = (k, now = Date.now()) =>
  k.revokedAt ? "revoked" : k.expiresAt && new Date(k.expiresAt).getTime() <= now ? "expired" : "active";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Bearer key (or X-Api-Key) → { key, store }, or throws ApiError(401/403).
// `scope` null = any valid key (GET /v1/me). `write` = also needs a read-write key.
export async function authenticate(api, request, scope, { write = false } = {}) {
  const header = String(request.headers.authorization || "");
  const raw = (header.match(/^Bearer\s+(\S+)$/i)?.[1] || String(request.headers["x-api-key"] || "")).trim();
  if (!raw.startsWith(KEY_PREFIX)) throw new ApiError(401, "Missing API key. Send it as `Authorization: Bearer rak_…`.");

  const key = await api.internal.apiKey.findFirst({ filter: { keyHash: { equals: hashKey(raw) } } }).catch(() => null);
  if (!key) throw new ApiError(401, "Invalid API key.");
  const state = keyState(key);
  if (state !== "active") throw new ApiError(401, `This API key is ${state}.`);
  if (scope && !cleanScopes(key.scopes).includes(scope)) throw new ApiError(403, `This API key doesn't have the "${scope}" scope.`);
  if (write && keyAccess(key) !== "readwrite") throw new ApiError(403, "This API key is read-only. Create a read-write key to make changes.");

  const store = await api.internal.bigcommerce.store.findFirst({ filter: { id: { equals: key.storeId } } }).catch(() => null);
  if (!store) throw new ApiError(401, "The store for this API key is no longer installed.");

  if (!key.lastUsedAt || Date.now() - new Date(key.lastUsedAt).getTime() > LAST_USED_EVERY_MS) {
    await api.internal.apiKey.update(key.id, { lastUsedAt: new Date() }).catch(() => {});
  }
  return { key, store };
}

// Wraps a handler with auth, JSON errors and no-store caching.
// `write: true` marks a write endpoint (read-write keys only).
export function endpoint(scope, handler, { write = false } = {}) {
  const route = async ({ request, reply, api, logger, connections }) => {
    reply.header("Cache-Control", "no-store");
    try {
      const { key, store } = await authenticate(api, request, scope, { write });
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
  route.options = {
    cors: { origin: true, methods: ["GET", "PUT", "PATCH", "OPTIONS"], allowedHeaders: ["Authorization", "X-Api-Key", "Content-Type"] },
  };
  return route;
}

// JSON object body of a write request, or 400.
export function jsonBody(request) {
  let b = request.body;
  if (typeof b === "string") {
    try {
      b = JSON.parse(b);
    } catch {
      throw new ApiError(400, "The body must be JSON.");
    }
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new ApiError(400, "The body must be a JSON object.");
  return b;
}

const reload = (api, store) => api.internal.bigcommerce.store.findFirst({ filter: { id: { equals: store.id } } });

// ─────────────────────────── writes ───────────────────────────

// PUT /v1/context/{source} { content }. The five text blocks save like the
// admin's Save settings (text equal to the default is stored as "", empty =
// back to the default). The sales playbook becomes a new live version (empty =
// turn the playbook off), as in the Learning tab.
export async function writeContext(api, store, source, body, key) {
  const src = API_CONTEXT_SOURCES[source];
  if (!src) throw new ApiError(404, `Unknown context source "${source}". Use one of: ${Object.keys(API_CONTEXT_SOURCES).join(", ")}.`);
  const { content } = body;
  if (typeof content !== "string") throw new ApiError(400, 'Send the new text as {"content": "…"}.');
  const text = content.trim();

  if (source === "salesPlaybook") {
    if (text.length > PLAYBOOK_MAX_CHARS) throw new ApiError(400, `The sales playbook can be at most ${PLAYBOOK_MAX_CHARS} characters.`);
    if (!text) {
      if (String(store.salesPlaybook || "").trim()) await deactivate(api, store);
    } else if (text !== String(store.salesPlaybook || "").trim()) {
      await publishPlaybook(api, store, text, { trigger: "api", rationale: `Written through the API (key "${key.label}").` });
    }
  } else {
    if (text.length > API_CONTEXT_MAX_CHARS) throw new ApiError(400, `${src.label} can be at most ${API_CONTEXT_MAX_CHARS} characters.`);
    await api.internal.bigcommerce.store.update(store.id, { [src.field]: text === src.fallback.trim() ? "" : text });
  }

  const out = contextOut(await reload(api, store));
  return { source, ...(out[source] || { content: "", version: null }), updatedAt: out.updatedAt };
}

// PATCH /v1/settings — partial, same shape as GET /v1/settings, only the
// API_WRITABLE_SETTINGS sections. Values are checked, then normalized by the
// same resolve* helpers the admin save uses.
const WRITABLE_SETTINGS = API_WRITABLE_SETTINGS;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const bad = (msg) => new ApiError(400, msg);

function fields(name, obj, allowed) {
  if (!isObj(obj)) throw bad(`"${name}" must be an object.`);
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length) throw bad(`Unknown ${name} field(s): ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`);
  return obj;
}
function text(path, v, max) {
  if (typeof v !== "string") throw bad(`${path} must be a string.`);
  if (v.length > max) throw bad(`${path} can be at most ${max} characters.`);
  return v.trim();
}
function flag(path, v) {
  if (typeof v !== "boolean") throw bad(`${path} must be true or false.`);
  return v;
}
function count(path, v) {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw bad(`${path} must be a whole number of at least 1.`);
  return v;
}

export async function writeSettings(api, store, body) {
  const keys = Object.keys(body);
  if (!keys.length) throw bad(`Nothing to change. Send any of: ${WRITABLE_SETTINGS.join(", ")}.`);
  const readOnly = keys.filter((k) => !WRITABLE_SETTINGS.includes(k));
  if (readOnly.length) throw bad(`Can't change ${readOnly.join(", ")} through the API. Writable: ${WRITABLE_SETTINGS.join(", ")}.`);

  const patch = {};

  if (body.branding !== undefined) {
    const b = fields("branding", body.branding, ["botName", "widgetColor", "greeting", "suggestedQuestions", "disclaimer"]);
    if (b.botName !== undefined) patch.botName = text("branding.botName", b.botName, 80);
    if (b.greeting !== undefined) patch.greeting = text("branding.greeting", b.greeting, 300);
    if (b.disclaimer !== undefined) patch.disclaimer = text("branding.disclaimer", b.disclaimer, 1000);
    if (b.widgetColor !== undefined) {
      const c = text("branding.widgetColor", b.widgetColor, 7);
      if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw bad('branding.widgetColor must be a hex color like "#ef6526".');
      patch.widgetColor = c;
    }
    if (b.suggestedQuestions !== undefined) {
      const q = b.suggestedQuestions;
      if (!Array.isArray(q) || q.length > 5) throw bad("branding.suggestedQuestions must be a list of at most 5 questions.");
      patch.suggestedQuestions = q.map((s, i) => text(`branding.suggestedQuestions[${i}]`, s, 200)).filter(Boolean);
    }
  }

  if (body.features !== undefined) {
    const writable = FEATURES.filter((f) => !f.comingSoon).map((f) => f.key);
    const f = fields("features", body.features, writable);
    const features = { ...resolveFeatures(store) };
    for (const [k, v] of Object.entries(f)) features[k] = flag(`features.${k}`, v);
    patch.features = features;
    patch.visionEnabled = !!features.vision; // kept for older code paths, like the admin
  }

  if (body.safeguards !== undefined) {
    const cur = resolveSafeguards(store);
    const numeric = Object.keys(cur).filter((k) => typeof cur[k] === "number");
    const s = fields("safeguards", body.safeguards, [...numeric, "orderFields", "alertEmail"]);
    const next = { ...cur, orderFields: { ...cur.orderFields } };
    for (const k of numeric) if (s[k] !== undefined) next[k] = count(`safeguards.${k}`, s[k]);
    if (s.orderFields !== undefined) {
      const o = fields("safeguards.orderFields", s.orderFields, ORDER_FIELDS.map((f) => f.key));
      for (const [k, v] of Object.entries(o)) next.orderFields[k] = flag(`safeguards.orderFields.${k}`, v);
    }
    if (s.alertEmail !== undefined) {
      const e = text("safeguards.alertEmail", s.alertEmail, 200);
      if (e && !EMAIL_RE.test(e)) throw bad("safeguards.alertEmail must be an email address (or empty).");
      next.alertEmail = e;
    }
    patch.safeguards = resolveSafeguards({ safeguards: next }); // clamps the limits
  }

  if (body.handoff !== undefined) {
    const h = fields("handoff", body.handoff, ["destination", "email"]);
    if (h.destination !== undefined) {
      if (!["email", "crm"].includes(h.destination)) throw bad('handoff.destination must be "email" or "crm".');
      patch.handoffDestination = h.destination;
    }
    if (h.email !== undefined) {
      const e = text("handoff.email", h.email, 200);
      if (e && !EMAIL_RE.test(e)) throw bad("handoff.email must be an email address (or empty).");
      patch.handoffEmail = e;
    }
  }

  if (body.learning !== undefined) {
    const l = fields("learning", body.learning, ["auto", "minSettled", "minConversions"]);
    const next = { ...resolveLearning(store) };
    if (l.auto !== undefined) next.auto = flag("learning.auto", l.auto);
    if (l.minSettled !== undefined) next.minSettled = count("learning.minSettled", l.minSettled);
    if (l.minConversions !== undefined) next.minConversions = count("learning.minConversions", l.minConversions);
    patch.learningSettings = resolveLearning({ learningSettings: next }); // clamps the thresholds
  }

  if (Object.keys(patch).length) await api.internal.bigcommerce.store.update(store.id, patch);
  return settingsOut(await reload(api, store));
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
