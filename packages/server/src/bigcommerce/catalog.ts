import { bcGet } from "./client.js";

/** Trimmed product shape we expose to the model and the shopper. */
export interface ProductSummary {
  id: number;
  name: string;
  price: number;
  sku: string;
  url: string;
  inStock: boolean;
  imageUrl: string | null;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  inventoryLevel: number;
  inventoryTracking: string;
  categories: number[];
  variants: Array<{
    id: number;
    sku: string;
    price: number | null;
    inventoryLevel: number;
    optionValues: Array<{ optionDisplayName: string; label: string }>;
  }>;
}

interface BcProduct {
  id: number;
  name: string;
  sku: string;
  price: number;
  description?: string;
  custom_url?: { url: string };
  inventory_level?: number;
  inventory_tracking?: string;
  availability?: string;
  categories?: number[];
  primary_image?: { url_standard?: string };
  variants?: Array<{
    id: number;
    sku: string;
    price: number | null;
    inventory_level: number;
    option_values?: Array<{ option_display_name: string; label: string }>;
  }>;
}

function isInStock(p: BcProduct): boolean {
  if (p.availability && p.availability !== "available") return false;
  if (p.inventory_tracking && p.inventory_tracking !== "none") {
    return (p.inventory_level ?? 0) > 0;
  }
  return true;
}

function toSummary(p: BcProduct): ProductSummary {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    sku: p.sku,
    url: p.custom_url?.url ?? "",
    inStock: isInStock(p),
    imageUrl: p.primary_image?.url_standard ?? null,
  };
}

export interface ProductSearchParams {
  keyword?: string;
  categoryId?: number;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
}

/** Keyword/category/price search over the catalog. */
export async function searchProducts(
  params: ProductSearchParams,
): Promise<ProductSummary[]> {
  const limit = Math.min(params.limit ?? 5, 10);
  const data = await bcGet<{ data: BcProduct[] }>("/v3/catalog/products", {
    query: {
      keyword: params.keyword,
      "categories:in": params.categoryId,
      "price:min": params.minPrice,
      "price:max": params.maxPrice,
      limit,
      include: "primary_image",
      is_visible: true,
    },
  });
  return data.data.map(toSummary);
}

/** Full detail for one product, including variants and availability. */
export async function getProductDetail(
  productId: number,
): Promise<ProductDetail | null> {
  try {
    const { data: p } = await bcGet<{ data: BcProduct }>(
      `/v3/catalog/products/${productId}`,
      { query: { include: "primary_image,variants" } },
    );
    return {
      ...toSummary(p),
      description: stripHtml(p.description ?? ""),
      inventoryLevel: p.inventory_level ?? 0,
      inventoryTracking: p.inventory_tracking ?? "none",
      categories: p.categories ?? [],
      variants: (p.variants ?? []).map((v) => ({
        id: v.id,
        sku: v.sku,
        price: v.price,
        inventoryLevel: v.inventory_level,
        optionValues: (v.option_values ?? []).map((o) => ({
          optionDisplayName: o.option_display_name,
          label: o.label,
        })),
      })),
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return null;
    throw err;
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}
