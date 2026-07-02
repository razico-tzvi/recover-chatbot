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

  // Avoid duplicates across installs/reinstalls.
  const existing = (await bc.v3.get("/content/scripts", { query: { limit: 250 } }).catch(() => [])) || [];
  if (existing.some((s) => s.name === NAME)) {
    logger?.info("widget script already present");
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
      src: appUrl + "/widget?store=" + storeHash,
      consent_category: "functional",
    },
  });
  logger?.info("injected widget script for store " + storeHash);
}
