// api/lib/productContent.js
/**
 * Fetches product tab content from the store's configured external API.
 * Modular: each store configures its own endpoint and key in the admin.
 * No hardcoded URLs or store-specific logic.
 */

const requestCache = new WeakMap();

const STOP = new Set([
  "the", "and", "for", "with", "this", "that", "does", "work", "works", "fit", "fits",
  "kit", "pro", "compatible", "compatibility", "can", "use", "any", "will", "have",
  "you", "are", "what", "about", "into", "your", "from", "how", "much",
]);

// Normalizes text for matching
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\bglock\s+(\d{2}\w?)\b/g, "glock g$1")
    .replace(/\bgen\s*(\d)/g, "gen$1")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function terms(query) {
  const base = [...new Set(norm(query).split(" ").filter((t) => t.length >= 2 && !STOP.has(t)))];
  const expanded = new Set(base);
  for (const t of base) {
    if (t === "weigh" || t === "weighs" || t === "weight" || t === "heavy") {
      expanded.add("weight"); expanded.add("grams"); expanded.add("oz"); expanded.add("specs");
    }
    if (t === "material" || t === "materials" || t === "made") {
      expanded.add("polymer"); expanded.add("metal"); expanded.add("specs");
    }
    if (t === "spec" || t === "specs" || t === "specification" || t === "specifications" || t === "dimension" || t === "dimensions") {
      expanded.add("specs");
    }
  }
  return [...expanded];
}

// Converts raw HTML into clean readable text while keeping table cells together on single lines
function htmlToText(html) {
  return String(html || "")
    .replace(/<\/t[dh]\s*>\s*<t[dh][^>]*>/gi, " | ")
    .replace(/<\/t[dh]\s*>/gi, " | ")
    .replace(/<\/(tr|p|li|h[1-6]|div|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&times;/g, "x")
    .replace(/&#8249;|&#8250;/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\|\s*\n\s*/g, " | ")
    .replace(/\n\s*\|\s*/g, "\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

// Filter out empty placeholder tabs like "Qa" or "Reviews"
function cleanTabs(tabs) {
  return (tabs || []).filter((t) => {
    const name = String(t.name || "").toLowerCase();
    if (name === "qa" || name === "reviews") return false;
    const txt = htmlToText(t.content);
    return txt.length > 20 && !txt.startsWith("Loading");
  });
}

/**
 * Returns ALL tabs (fit chart, specs, features) as structured readable text.
 * No character limit.
 */
export async function fetchProductContent(store, productId, logger) {
  const data = await fetchFromSource(store, productId, logger);
  if (!data) return "";

  const tabs = cleanTabs(data.tabs);
  return tabs
    .map((tab) => `## ${tab.name}\n${htmlToText(tab.content)}`)
    .join("\n\n")
    .trim();
}

/**
 * Keyword search over the product's answered Q&A.
 * Returns all matching results if no limit is provided.
 */
export async function searchProductQA(store, productId, query, limit, logger) {
  const data = await fetchFromSource(store, productId, logger);
  if (!data) return { results: [], note: "Q&A source unavailable for this store/product." };

  const qa = Array.isArray(data.qa) ? data.qa : [];
  if (!qa.length) return { results: [], note: "No Q&A available for this product." };

  const t = terms(query);
  if (!t.length) return { results: limit ? qa.slice(0, limit) : qa };

  const scored = qa
    .map((item, idx) => {
      const q = new Set(norm(item.question).split(" "));
      const a = new Set(norm((item.answers || []).join(" ")).split(" "));
      const score = t.reduce((n, w) => n + (q.has(w) ? 2 : 0) + (a.has(w) ? 1 : 0), 0);
      return { item, idx, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || x.idx - y.idx);

  const out = scored.map((x) => x.item);
  const results = limit ? out.slice(0, limit) : out;

  return results.length
    ? { results }
    : { results: [], note: "No Q&A matched that query for this product." };
}

/**
 * Search the Product Tabs content (fit chart, specs, installation, features).
 * Returns all matching lines without truncation.
 */
export async function searchProductTabs(store, productId, query, logger) {
  const data = await fetchFromSource(store, productId, logger);
  const t = terms(query);
  if (!data || !t.length) return [];

  const tabs = cleanTabs(data.tabs);
  const hits = [];

  for (const tab of tabs) {
    const raw = htmlToText(tab.content);
    const tabName = String(tab.name || "").toLowerCase();

    // If query is looking for specs/weights and this is the Specs tab, return ALL lines
    if (tabName.includes("spec") && t.some((w) => ["weight", "grams", "oz", "polymer", "specs", "material"].includes(w))) {
      hits.push({
        tab: tab.name,
        header: `Official ${tab.name}`,
        lines: raw.split("\n").filter((l) => l.trim().length > 0),
        bestMatchTerms: 99,
        queryTerms: t.length,
      });
      continue;
    }

    const lines = raw.split("\n").filter(Boolean);
    const scored = lines
      .map((l) => {
        const n = new Set(norm(l).split(" "));
        return { l, score: t.reduce((c, w) => c + (n.has(w) ? 1 : 0), 0) };
      })
      .filter((x) => x.score > 0);

    if (!scored.length) continue;

    const best = Math.max(...scored.map((x) => x.score));
    const top = scored.filter((x) => x.score === best).map((x) => x.l);
    hits.push({ tab: tab.name, header: lines[0] || "", lines: top, bestMatchTerms: best, queryTerms: t.length });
  }

  return hits.sort((a, b) => b.bestMatchTerms - a.bestMatchTerms);
}

// Shared fetch
async function fetchFromSource(store, productId, logger) {
  let config = store?.productContentSource;
  if (typeof config === "string") {
    try { config = JSON.parse(config); } catch { config = null; }
  }
  if (!config || !config.enabled || !config.endpointUrl || !config.apiKey) {
    logger?.warn({ productId }, "product content source not configured/enabled");
    return null;
  }

  let byId = requestCache.get(store);
  if (!byId) requestCache.set(store, (byId = new Map()));

  if (!byId.has(productId)) {
    byId.set(
      productId,
      (async () => {
        try {
          const url = `${config.endpointUrl}?productId=${productId}`;
          const res = await fetch(url, {
            headers: { "X-API-Key": config.apiKey, Accept: "application/json" },
          });
          if (!res.ok) {
            logger?.error({ productId, status: res.status }, "product content fetch failed");
            return null;
          }
          const data = await res.json();
          logger?.info({ productId, tabs: data?.tabs?.length || 0, qa: data?.qa?.length || 0 }, "product content fetched");
          return data;
        } catch (err) {
          logger?.error({ err, productId }, "product content fetch threw");
          return null;
        }
      })()
    );
  }
  return byId.get(productId);
}