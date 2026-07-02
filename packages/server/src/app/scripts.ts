import { config } from "../config.js";

/**
 * Inject the chat widget onto the merchant's storefront via the BigCommerce
 * Scripts API, so no manual Script Manager step is needed. `auto_uninstall`
 * makes BigCommerce remove it automatically when the app is uninstalled.
 * Requires the Content (Scripts, modify) OAuth scope.
 */
export async function installWidgetScript(storeHash: string, token: string): Promise<void> {
  const res = await fetch(
    `https://api.bigcommerce.com/stores/${storeHash}/v3/content/scripts`,
    {
      method: "POST",
      headers: {
        "X-Auth-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        name: "Recover Chatbot Widget",
        description: "AI customer support chat widget",
        auto_uninstall: true,
        load_method: "default",
        location: "footer",
        visibility: "all_pages",
        kind: "src",
        src: `${config.APP_URL}/widget.js?store=${storeHash}`,
        consent_category: "functional",
      }),
    },
  );

  if (!res.ok) {
    // Non-fatal: install still succeeds; the merchant can retry from the app UI.
    const body = await res.text().catch(() => "");
    throw new Error(`Scripts API install failed: ${res.status} ${body.slice(0, 300)}`);
  }
}
