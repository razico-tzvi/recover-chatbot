import { ActionOptions } from "gadget-server";

// Context tab: product catalog source. Returns the store's product count, and
// with `full: true` the products themselves for the CSV/JSON export. The catalog
// is read live from BigCommerce by the chat tools, so there's nothing to re-sync.
export const run: ActionRun = async ({ params, connections }) => {
  const storeHash = connections.bigcommerce.currentStoreHash;
  if (!storeHash) throw new Error("No store in context.");
  const bc = await connections.bigcommerce.forStoreHash(storeHash);

  const fields = params.full
    ? "id,name,sku,price,sale_price,inventory_level,inventory_tracking,availability,is_visible,categories,brand_id,custom_url"
    : "id";
  const products: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows: any[] =
      (await bc.v3.get("/catalog/products", { query: { limit: PAGE_SIZE, page, include_fields: fields } })) || [];
    products.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  return {
    count: products.length,
    truncated: products.length >= PAGE_SIZE * MAX_PAGES,
    fetchedAt: new Date().toISOString(),
    products: params.full
      ? products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          salePrice: p.sale_price || null,
          inventoryLevel: p.inventory_tracking === "none" ? null : p.inventory_level,
          availability: p.availability,
          visible: p.is_visible,
          categories: (p.categories || []).join("|"),
          brandId: p.brand_id || null,
          url: p.custom_url?.url || "",
        }))
      : undefined,
  };
};

const PAGE_SIZE = 250;
const MAX_PAGES = 40;

export const params = {
  full: { type: "boolean" },
};

export const options: ActionOptions = {
  triggers: { api: true },
};
