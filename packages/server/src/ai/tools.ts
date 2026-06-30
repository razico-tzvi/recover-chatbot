import type Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage } from "@recover/shared";
import { searchProducts, getProductDetail } from "../bigcommerce/catalog.js";
import { lookupOrder } from "../bigcommerce/orders.js";
import { searchFaq } from "../knowledge/faq.js";
import { escalate } from "../escalation.js";

/** Context handed to every tool handler for the current turn. */
export interface ToolContext {
  /** Full conversation so far (used by escalate_to_human). */
  transcript: ChatMessage[];
}

/** Anthropic tool definitions advertised to the model. */
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "search_products",
    description:
      "Search the store catalog for products. Use for any product discovery or recommendation request. Returns up to 10 matching products with name, price, stock status, and a link.",
    input_schema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "Free-text search terms, e.g. 'blue cotton t-shirt'." },
        min_price: { type: "number", description: "Minimum price filter." },
        max_price: { type: "number", description: "Maximum price filter." },
        category_id: { type: "number", description: "BigCommerce category id, if known." },
        limit: { type: "number", description: "Max results (1-10, default 5)." },
      },
      required: [],
    },
  },
  {
    name: "get_product_details",
    description:
      "Get full details for a single product by its id (obtained from search_products): description, variants/options, and live availability. Use when the shopper asks about a specific product.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "number", description: "BigCommerce product id." },
      },
      required: ["product_id"],
    },
  },
  {
    name: "lookup_order",
    description:
      "Look up the status and tracking of a customer's order. REQUIRES both the order number and the email used on the order — never call this without both. Only returns the order if the email matches the order's billing email.",
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "number", description: "The order number." },
        email: { type: "string", description: "Email address used to place the order." },
      },
      required: ["order_id", "email"],
    },
  },
  {
    name: "search_faq",
    description:
      "Search store policies and FAQs (shipping, returns, sizing, payments, etc.). Use for any policy or how-does-this-work question. Returns the most relevant policy sections.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What the shopper is asking about." },
      },
      required: ["query"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Hand off to a human support agent. Use when you cannot resolve the request, the shopper asks for a person, or the task needs account/order changes you can't make. Collect the shopper's email (and name if offered) first.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Concise summary of what the shopper needs." },
        contact_email: { type: "string", description: "Shopper's email for follow-up." },
        contact_name: { type: "string", description: "Shopper's name, if provided." },
      },
      required: ["summary", "contact_email"],
    },
  },
];

/** A short human-readable status shown in the widget while a tool runs. */
export function toolStatusLabel(name: string): string {
  switch (name) {
    case "search_products":
      return "Searching products…";
    case "get_product_details":
      return "Looking up product details…";
    case "lookup_order":
      return "Checking your order…";
    case "search_faq":
      return "Checking store policies…";
    case "escalate_to_human":
      return "Connecting you to a human…";
    default:
      return "Working…";
  }
}

/**
 * Execute a tool by name. Always resolves to a string (never throws) so the
 * agentic loop can feed a tool_result back to the model even on failure.
 */
export async function runTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  try {
    switch (name) {
      case "search_products": {
        const results = await searchProducts({
          keyword: asString(input.keyword),
          minPrice: asNumber(input.min_price),
          maxPrice: asNumber(input.max_price),
          categoryId: asNumber(input.category_id),
          limit: asNumber(input.limit),
        });
        if (results.length === 0) return JSON.stringify({ results: [], note: "No matching products." });
        return JSON.stringify({ results });
      }

      case "get_product_details": {
        const id = asNumber(input.product_id);
        if (id === undefined) return errMsg("product_id is required.");
        const detail = await getProductDetail(id);
        if (!detail) return errMsg("No product found with that id.");
        return JSON.stringify(detail);
      }

      case "lookup_order": {
        const id = asNumber(input.order_id);
        const email = asString(input.email);
        if (id === undefined || !email) {
          return errMsg("Both order_id and email are required to look up an order.");
        }
        const result = await lookupOrder(id, email);
        if (result === "not_found") {
          return JSON.stringify({ found: false, reason: "No order with that number exists." });
        }
        if (result === "email_mismatch") {
          // Deliberately identical to not_found from the model's view, so it
          // can't confirm an order exists for a non-matching email.
          return JSON.stringify({
            found: false,
            reason: "We couldn't find an order matching that order number and email. Ask the shopper to double-check both.",
          });
        }
        return JSON.stringify({ found: true, order: result });
      }

      case "search_faq": {
        const query = asString(input.query) ?? "";
        return await searchFaq(query);
      }

      case "escalate_to_human": {
        const summary = asString(input.summary) ?? "(no summary)";
        const contactEmail = asString(input.contact_email);
        if (!contactEmail) return errMsg("A contact email is required to escalate.");
        const result = await escalate({
          summary,
          contactEmail,
          contactName: asString(input.contact_name),
          transcript: ctx.transcript,
        });
        if (!result.delivered) {
          return JSON.stringify({
            delivered: false,
            note: "Escalation channel is not configured or failed. Apologize and provide the store's support email if available.",
          });
        }
        return JSON.stringify({ delivered: true, channels: result.channels });
      }

      default:
        return errMsg(`Unknown tool: ${name}`);
    }
  } catch (err) {
    console.error(`Tool ${name} failed:`, err);
    return errMsg("That request failed due to a temporary issue. Apologize and suggest trying again or escalating to a human.");
  }
}

function errMsg(message: string): string {
  return JSON.stringify({ error: message });
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}
