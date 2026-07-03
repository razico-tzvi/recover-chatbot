/**
 * Inject (once) the storefront chat widget via the BigCommerce Scripts API.
 * `auto_uninstall: true` lets BigCommerce remove it when the app is uninstalled.
 * Requires the Content (Scripts, modify) OAuth scope on the store token.
 */
export async function ensureWidgetScript(connections, storeHash, logger) {
  const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
  if (!appUrl) {
    logger?.warn("APP_URL not set — skipping widget injection");
    return;
  }
  const bc = await connections.bigcommerce.forStoreHash(storeHash);
  const NAME = "Recover Chatbot Widget";
  const desiredSrc = appUrl + "/widget?store=" + storeHash;

  // Reconcile: keep one script pointing at the CURRENT app URL and remove any
  // stale ones (e.g. a dev-pointing script left over after going live).
  const existing = (await bc.v3.get("/content/scripts", { query: { limit: 250 } }).catch(() => [])) || [];
  let hasCorrect = false;
  for (const s of existing.filter((x) => x.name === NAME)) {
    if (s.src === desiredSrc) {
      hasCorrect = true;
    } else {
      await bc.v3.delete(`/content/scripts/${s.uuid}`).catch(() => {});
      logger?.info("removed stale widget script: " + s.src);
    }
  }
  if (hasCorrect) {
    logger?.info("widget script already correct");
    return;
  }

  await bc.v3.post("/content/scripts", {
    body: {
      name: NAME,
      description: "AI customer support chat widget",
      auto_uninstall: true,
      load_method: "default",
      location: "footer",
      visibility: "all_pages",
      kind: "src",
      src: desiredSrc,
      consent_category: "functional",
    },
  });
  logger?.info("injected widget script -> " + desiredSrc);
}
