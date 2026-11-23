// api/lib/productConfigurator.js
// Modular connector for the Product Configurator Gadget app.
// Reads a configured product's steps, choices, fitment, and price deltas.
//
// The configurator host is set per store in the Integrations admin page
// (store.configuratorHost). If blank, the connector is a no-op.

const fetch = globalThis.fetch;

// [CHANGED] The Integrations hint says a blank host uses this default, but
// resolveConfig used to return null. Delete this constant and the fallback in
// resolveConfig if you want a blank host to stay a no-op instead.
const DEFAULT_HOST = "product-configurator.gadget.app";

function resolveConfig(store) {
  // [CHANGED] Falls back to the default host so the UI hint is true.
  const host = store?.configuratorHost?.trim() || DEFAULT_HOST;
  if (!host) return null;
  return {
    host,
    baseUrl: `https://${host}`,
  };
}

// ── Per-request cache (keyed on store object identity) ──────────────
const _cache = new WeakMap();
function cacheFor(store) {
  if (!_cache.has(store)) _cache.set(store, new Map());
  return _cache.get(store);
}

// [NEW] Returned by fetchRaw for a 404 when the caller asks for it (see opts.notFoundValue).
// Lets a caller tell "the configurator app says there is none" (a real answer) from
// "the request failed" (timeout / 5xx / network: null, which is not an answer).
const NOT_FOUND = Symbol("not found");

// ── Helpers ─────────────────────────────────────────────────────────
async function fetchRaw(baseUrl, endpoint, params, logger, opts = {}) {
  const url = new URL(endpoint, baseUrl);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const href = url.toString();
  try {
    const res = await fetch(href, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // [NEW] A 404 from the status endpoint only means "this product has no published
      // configurator". That's expected, not a failure, so it is no longer logged as a
      // warning (it was 18 warnings a day for products 143 and 188).
      if (res.status === 404 && opts.notFoundValue !== undefined) {
        logger?.debug(
          { href, productId: params.product, storeHash: params.store },
          "no published configurator"
        );
        return opts.notFoundValue;
      }
      // [CHANGED] Gadget's logger is pino: the object goes FIRST, the message second.
      // Before, the object was dropped, so the log had no status or product id.
      // Also logs the href and a snippet of the response body so you can see why.
      logger?.warn(
        {
          status: res.status,
          href,
          productId: params.product,
          storeHash: params.store,
          body: await res.text().then((t) => t.slice(0, 300)).catch(() => ""),
        },
        "configurator fetch failed"
      );
      return null;
    }
    return await res.json();
  } catch (err) {
    // [CHANGED] Same argument-order fix.
    logger?.warn(
      { err: err.message, href, productId: params.product, storeHash: params.store },
      "configurator fetch error"
    );
    return null;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Check whether a product has a configurator.
 * Returns true or false when the configurator app gave a real answer
 * (false also when no configurator host is configured for the store), or
 * null when the check itself failed (timeout, 5xx, network): "don't know".
 * [CHANGED] null is new. Callers that cache the result should not cache null.
 */
export async function productHasConfigurator(store, productId, logger) {
  if (!productId) return false;
  const config = resolveConfig(store);
  if (!config) return false;

  const cache = cacheFor(store);
  const key = `status:${productId}`;
  if (cache.has(key)) return cache.get(key);

  const data = await fetchRaw(
    config.baseUrl,
    "/configurator-status",
    { store: store.storeHash, product: productId },
    logger,
    { notFoundValue: NOT_FOUND }
  );

  // [NEW] The request failed: unknown. Not cached, so the next call asks again.
  if (data === null) return null;

  const has = data !== NOT_FOUND && !!(data?.exists || data?.enabled || data?.active);
  cache.set(key, has);
  return has;
}

/**
 * Fetch and summarize the full configurator payload for a product.
 * Returns a structured summary OBJECT or null (also null if no host is configured).
 * Use formatFullSummary(summary) to turn it into text for the model.
 */
export async function summarizeConfigurator(store, productId, logger) {
  if (!productId) return null;
  const config = resolveConfig(store);
  if (!config) return null;

  const cache = cacheFor(store);
  const key = `summary:${productId}`;
  if (cache.has(key)) return cache.get(key);

  const data = await fetchRaw(
    config.baseUrl,
    "/configurator",
    { store: store.storeHash, product: productId },
    logger
  );
  if (!data) {
    cache.set(key, null);
    return null;
  }

  const summary = buildSummary(data);
  cache.set(key, summary);
  return summary;
}

/**
 * Search a product's configurator for a specific query
 * (e.g. "Glock 21 adapter", "cheek rest price").
 * Returns a focused text snippet or null.
 */
export async function searchProductConfigurator(store, productId, query, logger) {
  const summary = await summarizeConfigurator(store, productId, logger);
  if (!summary) return null;

  const q = (query || "").toLowerCase();
  if (!q) return formatFullSummary(summary);

  const hits = [];

  // Search choices
  for (const step of summary.steps) {
    for (const choice of step.choices) {
      const haystack = [
        choice.name,
        choice.description,
        choice.fitment,
        choice.group,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (haystack.includes(q)) {
        hits.push({
          step: step.name,
          choice: choice.name,
          price: choice.priceDelta,
          fitment: choice.fitment,
          description: choice.description,
        });
      }
    }
  }

  if (hits.length === 0) return null;

  const lines = hits.map((h) => {
    let line = `• **${h.choice}** (Step: ${h.step})`;
    if (h.price) line += ` — ${h.price}`;
    if (h.fitment) line += ` — Fits: ${h.fitment}`;
    if (h.description) line += `\n  ${h.description}`;
    return line;
  });

  return `Configurator matches for "${query}":\n${lines.join("\n")}`;
}

// ── Internal ────────────────────────────────────────────────────────

function buildSummary(data) {
  const layers = data.layers || [];
  const content = data.content || [];
  const settings = data.settings || {};
  const productInfo = data.product_info || {};

  // Map layerId → layer name
  const layerMap = new Map();
  for (const l of layers) {
    layerMap.set(String(l._id), l.name || `Step ${l.order}`);
  }

  // Build steps with choices
  const steps = [];
  for (const layer of layers.sort((a, b) => (a.order || 0) - (b.order || 0))) {
    // [CHANGED] Skip MASTER / logic-only layers that shoppers never see.
    if (layer.hide_in_configurator) continue;
    const layerId = String(layer._id);
    const entries = content.filter((c) => String(c.layerId) === layerId);
    const choices = [];

    for (const entry of entries) {
      for (const c of entry.choices || []) {
        if (c.is_group) continue; // skip group headers
        if (c.available === "" || c.available === "0") continue; // skip unavailable

        const priceDelta = formatPriceDelta(c, productInfo.currency);
        const fitment = extractFitment(c);

        choices.push({
          id: c._id,
          name: c.name || "Unnamed",
          description: c.description || c.advanced_description || null,
          priceDelta,
          fitment,
          group: c.parent
            ? entries
                .flatMap((e) => e.choices || [])
                .find((p) => p._id === c.parent && p.is_group)?.name || null
            : null,
          // [CHANGED] Keep the raw pricing fields so real prices can be worked out later.
          linkedProductId: c.linked_product_id > 0 ? c.linked_product_id : null,
          overrideLinkedPrice: !!c.override_linked_price,
          overrideMode: c.override_linked_price_mode || null,
        });
      }
    }

    if (choices.length > 0) {
      steps.push({
        // [CHANGED] admin_label says which gun/color a repeated layer belongs to.
        name: layer.admin_label ? `${layer.name} [${layer.admin_label}]` : layer.name || `Step ${layer.order}`,
        order: layer.order,
        choices,
      });
    }
  }

  return {
    basePrice: settings.base_price || null,
    currency: productInfo.currency || "USD",
    cartProductId: settings.cart_product_id || null,
    steps,
  };
}

function formatPriceDelta(choice, currency) {
  const extra = parseFloat(choice.extra_price);
  const symbol = currency === "USD" ? "$" : currency || "";
  // [CHANGED] 0.9 + multiply is a multiplier on the linked product's price, not +$0.90.
  if (choice.override_linked_price && choice.override_linked_price_mode === "multiply" && extra > 0 && extra < 1) {
    return `${Math.round((1 - extra) * 100)}% off the linked product's store price`;
  }
  if (!extra || isNaN(extra)) {
    // [CHANGED] No configurator price: if linked, the price is the store product's price.
    return choice.linked_product_id > 0 ? "priced at its linked store product" : null;
  }
  if ((choice.extra_price_type || "amount") === "percent") return `+${extra}%`;
  return `+${symbol}${extra.toFixed(2)}`;
}

function extractFitment(choice) {
  // Fitment info is often in the description or name
  const text = [choice.name, choice.description, choice.advanced_description]
    .filter(Boolean)
    .join(" ");
  // Look for common firearm patterns
  const match = text.match(
    /\b(Glock|Sig|Sauer|Smith|Wesson|HK|Heckler|CZ|Canik|FN|Beretta|Walther|Springfield|Ruger|Kimber|Staccato|2011|1911|P320|P365|M&P|XD|XDM|VP9|SFP9)\s*\d*\w*\b/gi
  );
  return match ? [...new Set(match)].join(", ") : null;
}

// [CHANGED] Exported so getProductDetails in POST-chat.js can turn the summary
// object into text. Before, it called .slice() on the object and crashed.
export function formatFullSummary(summary) {
  const lines = [];
  if (summary.basePrice) {
    lines.push(`Base price: ${summary.currency === "USD" ? "$" : ""}${summary.basePrice}`);
  }
  for (const step of summary.steps) {
    lines.push(`\n**${step.name}:**`);
    for (const c of step.choices) {
      let line = `  • ${c.name}`;
      if (c.priceDelta) line += ` (${c.priceDelta})`;
      if (c.fitment) line += ` — Fits: ${c.fitment}`;
      lines.push(line);
    }
  }
  return lines.join("\n");
}