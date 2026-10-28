import { ActionOptions } from "gadget-server";

// Emails shoppers who asked the chatbot (notify_back_in_stock) to be told when
// an out-of-stock product/variant is available again. Runs on a schedule; each
// alert is sent once and then stamped with notifiedAt.
export const run: ActionRun = async ({ api, connections, emails, logger }) => {
  const pending = await api.internal.stockAlert.findMany({
    filter: { notifiedAt: { isSet: false } },
    first: 250,
  });

  const byStore = new Map<string, any[]>();
  for (const a of pending) {
    if (!a.storeHash || !a.productId || !a.email) continue;
    byStore.set(a.storeHash, [...(byStore.get(a.storeHash) ?? []), a]);
  }

  let sent = 0;
  for (const [storeHash, alerts] of byStore) {
    try {
      const bc = await connections.bigcommerce.forStoreHash(storeHash);
      const ids = [...new Set(alerts.map((a) => a.productId))];
      const products: any[] =
        (await bc.v3.get("/catalog/products", {
          query: { "id:in": ids.join(","), include: "variants", limit: 250 },
        })) || [];
      const byId = new Map(products.map((p) => [p.id, p]));

      for (const a of alerts) {
        const p = byId.get(a.productId);
        if (!p || !available(p, a.variantId)) continue;
        const name = a.productName || p.name;
        await emails.sendMail({
          to: a.email,
          subject: `Back in stock: ${name}`,
          html:
            `<p>Good news — <b>${esc(name)}</b> is back in stock.</p>` +
            (a.productUrl ? `<p><a href="${esc(a.productUrl)}">Shop it now</a></p>` : "") +
            `<p style="color:#888;font-size:12px">You asked our store assistant to let you know. This is a one-time email.</p>`,
        });
        await api.internal.stockAlert.update(a.id, { notifiedAt: new Date() });
        sent++;
      }
    } catch (err) {
      logger.error({ err, storeHash }, "stock alert check failed");
    }
  }
  return { checked: pending.length, sent };
};

function available(p: any, variantId?: number | null) {
  if (p.availability && p.availability !== "available") return false;
  if (variantId) {
    const v = (p.variants ?? []).find((x: any) => x.id === variantId);
    if (!v || v.purchasing_disabled) return false;
    if (p.inventory_tracking === "variant") return (v.inventory_level ?? 0) > 0;
  }
  if (p.inventory_tracking === "product") return (p.inventory_level ?? 0) > 0;
  if (p.inventory_tracking === "variant" && !variantId) {
    return (p.variants ?? []).some((v: any) => !v.purchasing_disabled && (v.inventory_level ?? 0) > 0);
  }
  return true;
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const options: ActionOptions = {
  triggers: { api: true, scheduler: [{ cron: "*/30 * * * *" }] },
};
