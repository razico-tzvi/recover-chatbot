import { bcGet } from "./client.js";
import { emailsMatch } from "./verify.js";
import { config } from "../config.js";
import { mockLookupOrder } from "./mock.js";

export interface OrderStatus {
  id: number;
  status: string;
  dateCreated: string;
  total: string;
  items: Array<{ name: string; quantity: number }>;
  shipments: Array<{
    trackingNumber: string | null;
    trackingCarrier: string | null;
    shippingMethod: string | null;
    dateCreated: string;
  }>;
}

interface BcOrder {
  id: number;
  status: string;
  date_created: string;
  total_inc_tax: string;
  billing_address?: { email?: string };
  products?: { url: string; resource: string };
  shipments?: { url: string; resource: string };
}

interface BcOrderProduct {
  name: string;
  quantity: number;
}

interface BcShipment {
  tracking_number: string | null;
  tracking_carrier: string | null;
  shipping_method: string | null;
  date_created: string;
}

/**
 * Look up an order by ID, but ONLY return it if the supplied email matches the
 * order's billing email (case-insensitive). This is the identity gate that
 * prevents one shopper from reading another's order. Returns:
 *   - the order on a verified match
 *   - "not_found" if the order id doesn't exist
 *   - "email_mismatch" if it exists but the email doesn't match
 */
export async function lookupOrder(
  orderId: number,
  email: string,
  storeHash?: string,
): Promise<OrderStatus | "not_found" | "email_mismatch"> {
  if (config.MOCK_BIGCOMMERCE) return mockLookupOrder(orderId, email);

  let order: BcOrder;
  try {
    order = await bcGet<BcOrder>(storeHash, `/v2/orders/${orderId}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) return "not_found";
    throw err;
  }

  // v2 returns 200 with empty body for a non-existent order in some cases.
  if (!order || !order.id) return "not_found";

  if (!emailsMatch(order.billing_address?.email, email)) {
    return "email_mismatch";
  }

  const [products, shipments] = await Promise.all([
    bcGet<BcOrderProduct[]>(storeHash, `/v2/orders/${orderId}/products`).catch(() => []),
    bcGet<BcShipment[]>(storeHash, `/v2/orders/${orderId}/shipments`).catch(() => []),
  ]);

  return {
    id: order.id,
    status: order.status,
    dateCreated: order.date_created,
    total: order.total_inc_tax,
    items: products.map((p) => ({ name: p.name, quantity: p.quantity })),
    shipments: shipments.map((s) => ({
      trackingNumber: s.tracking_number,
      trackingCarrier: s.tracking_carrier,
      shippingMethod: s.shipping_method,
      dateCreated: s.date_created,
    })),
  };
}
