import type { ProductSummary, ProductDetail, ProductSearchParams } from "./catalog.js";
import type { OrderStatus } from "./orders.js";

/**
 * Sample data for MOCK_BIGCOMMERCE=true, so the app runs end-to-end with no
 * real BigCommerce store (local testing / demos).
 */
const PRODUCTS: ProductDetail[] = [
  {
    id: 101,
    name: "Classic Cotton T-Shirt — Blue",
    price: 24.0,
    sku: "TSHIRT-BLU",
    url: "/classic-cotton-tshirt-blue/",
    inStock: true,
    imageUrl: null,
    description: "A soft 100% cotton crew-neck tee in blue. True to size.",
    inventoryLevel: 42,
    inventoryTracking: "product",
    categories: [1],
    variants: [
      { id: 1011, sku: "TSHIRT-BLU-S", price: null, inventoryLevel: 10, optionValues: [{ optionDisplayName: "Size", label: "S" }] },
      { id: 1012, sku: "TSHIRT-BLU-M", price: null, inventoryLevel: 20, optionValues: [{ optionDisplayName: "Size", label: "M" }] },
      { id: 1013, sku: "TSHIRT-BLU-L", price: null, inventoryLevel: 12, optionValues: [{ optionDisplayName: "Size", label: "L" }] },
    ],
  },
  {
    id: 102,
    name: "Classic Cotton T-Shirt — Charcoal",
    price: 24.0,
    sku: "TSHIRT-CHR",
    url: "/classic-cotton-tshirt-charcoal/",
    inStock: true,
    imageUrl: null,
    description: "The same soft cotton crew-neck tee in charcoal grey.",
    inventoryLevel: 8,
    inventoryTracking: "product",
    categories: [1],
    variants: [],
  },
  {
    id: 201,
    name: "Merino Wool Beanie",
    price: 32.5,
    sku: "BEANIE-MER",
    url: "/merino-wool-beanie/",
    inStock: true,
    imageUrl: null,
    description: "Warm, itch-free merino wool beanie. One size fits most.",
    inventoryLevel: 15,
    inventoryTracking: "product",
    categories: [2],
    variants: [],
  },
  {
    id: 202,
    name: "Waxed Canvas Weekender Bag",
    price: 129.0,
    sku: "BAG-WEEKEND",
    url: "/waxed-canvas-weekender/",
    inStock: false,
    imageUrl: null,
    description: "Durable waxed-canvas travel bag with leather trim. Currently out of stock.",
    inventoryLevel: 0,
    inventoryTracking: "product",
    categories: [3],
    variants: [],
  },
];

function toSummary(p: ProductDetail): ProductSummary {
  return {
    id: p.id,
    name: p.name,
    price: p.price,
    sku: p.sku,
    url: p.url,
    inStock: p.inStock,
    imageUrl: p.imageUrl,
  };
}

export function mockSearchProducts(params: ProductSearchParams): ProductSummary[] {
  const kw = params.keyword?.toLowerCase().split(/\s+/).filter(Boolean) ?? [];
  return PRODUCTS.filter((p) => {
    const hay = `${p.name} ${p.description}`.toLowerCase();
    if (kw.length && !kw.some((w) => hay.includes(w))) return false;
    if (params.minPrice !== undefined && p.price < params.minPrice) return false;
    if (params.maxPrice !== undefined && p.price > params.maxPrice) return false;
    return true;
  })
    .slice(0, Math.min(params.limit ?? 5, 10))
    .map(toSummary);
}

export function mockGetProductDetail(productId: number): ProductDetail | null {
  return PRODUCTS.find((p) => p.id === productId) ?? null;
}

/** One sample order. Billing email is jane@example.com (for the email gate). */
const ORDERS: Record<number, { email: string; order: OrderStatus }> = {
  1001: {
    email: "jane@example.com",
    order: {
      id: 1001,
      status: "Shipped",
      dateCreated: "Mon, 30 Jun 2026 14:02:00 +0000",
      total: "48.00",
      items: [{ name: "Classic Cotton T-Shirt — Blue", quantity: 2 }],
      shipments: [
        {
          trackingNumber: "1Z999AA10123456784",
          trackingCarrier: "ups",
          shippingMethod: "Standard Shipping",
          dateCreated: "Tue, 01 Jul 2026 09:15:00 +0000",
        },
      ],
    },
  },
};

export function mockLookupOrder(
  orderId: number,
  email: string,
): OrderStatus | "not_found" | "email_mismatch" {
  const entry = ORDERS[orderId];
  if (!entry) return "not_found";
  if (entry.email.toLowerCase() !== email.trim().toLowerCase()) return "email_mismatch";
  return entry.order;
}
