const STOP = new Set([
  "the","a","an","is","are","was","were","be","been","have","has","had",
  "do","does","did","will","would","should","can","could","of","in","to",
  "for","with","on","at","by","from","it","its","this","that","and","or",
  "but","not","no","so","if","my","your","i","you","he","she","we","they",
  "what","which","who","how","all","any","some","more","most","only","own",
  "same","than","too","very","just","about","also","into","over","after",
  "before","between","out","up","down","off","then","once","here","there",
  "when","where","why","while","during","through","now","again","am","as",
  "because","until","against","me","him","her","us","them",
]);

function filenameFrom(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop())
      .replace(/\.\w+$/, "")
      .replace(/[-_]/g, " ")
      .replace(/\d{4}x\d{3,4}/g, "")
      .replace(/\s+/g, " ")
      .trim();
  } catch { return ""; }
}

export async function searchUgcMedia(store, productId, query, logger) {
  const raw = store.ugcSource;
  if (!raw) return { results: [], note: "UGC source not configured" };

  const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!cfg?.enabled || !cfg?.endpointUrl || !cfg?.apiKey) {
    return { results: [], note: "UGC source not enabled or incomplete" };
  }

  const url = new URL(cfg.endpointUrl);
  url.searchParams.set("storeHash", cfg.storeHash || store.storeHash);
  url.searchParams.set("embedKey", cfg.apiKey);
  url.searchParams.set("productId", String(productId));
  url.searchParams.set("limit", "24");

  logger?.info?.("ugc_fetch", { url: url.toString().replace(cfg.apiKey, "***") });

  const res = await fetch(url.toString());
  if (!res.ok) {
    logger?.error?.("ugc_fetch_failed", { status: res.status });
    return { results: [], error: `UGC API returned ${res.status}` };
  }

  const data = await res.json();
  const items = data?.media || [];

  const flat = items.map(m => {
    const asset = m.assets?.edges?.[0]?.node;
    const titles = (m.productTags?.edges || [])
      .map(e => e.node?.productTitle).filter(Boolean);
    const imgUrl = asset?.file?.url || "";
    return {
      type: asset?.type || "photo",
      url: imgUrl,
      caption: m.caption || filenameFrom(imgUrl),
      views: m.viewsCount || 0,
      likes: m.likesCount || 0,
      products: titles,
    };
  }).filter(m => m.url);

  if (query) {
    const terms = query.toLowerCase().split(/\W+/)
      .filter(t => t.length > 2 && !STOP.has(t));
    if (terms.length) {
      const scored = flat.map(m => {
        const text = `${m.caption} ${m.products.join(" ")}`.toLowerCase();
        const score = terms.reduce((s, t) => s + (text.includes(t) ? 1 : 0), 0);
        return { ...m, score };
      });
      scored.sort((a, b) => b.score - a.score || b.views - a.views);
      const hits = scored.filter(m => m.score > 0);
      return { results: (hits.length ? hits : scored).slice(0, 8) };
    }
  }

  flat.sort((a, b) => (b.likes + b.views) - (a.likes + a.views));
  return { results: flat.slice(0, 8) };
}