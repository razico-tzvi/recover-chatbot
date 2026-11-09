import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "chatSession" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "0ZfmLTW_J4KS",
  fields: {
    addedToCart: {
      type: "boolean",
      default: false,
      storageKey: "sess-addedToCart",
    },
    conversion: { type: "string", storageKey: "sess-conversion" },
    convertedAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "sess-convertedAt",
    },
    costUsd: { type: "number", storageKey: "sess-costUsd" },
    flagReason: { type: "string", storageKey: "sess-flagReason" },
    flagged: {
      type: "boolean",
      default: false,
      storageKey: "sess-flagged",
    },
    flaggedAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "sess-flaggedAt",
    },
    handoffAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "sess-handoffAt",
    },
    handoffEmail: { type: "string", storageKey: "sess-handoffEmail" },
    handoffSummary: {
      type: "string",
      storageKey: "sess-handoffSummary",
    },
    inputTokens: { type: "number", storageKey: "sess-inputTokens" },
    messageCount: { type: "number", storageKey: "c7KWOjGrn3Ir" },
    model: { type: "string", storageKey: "sess-model" },
    needsHuman: {
      type: "boolean",
      default: false,
      storageKey: "sess-needsHuman",
    },
    orderCurrency: {
      type: "string",
      storageKey: "sess-orderCurrency",
    },
    orderId: { type: "number", storageKey: "sess-orderId" },
    orderTotal: { type: "number", storageKey: "sess-orderTotal" },
    outputTokens: { type: "number", storageKey: "sess-outputTokens" },
    preview: { type: "string", storageKey: "za5uSb27e-4z" },
    productsShown: {
      type: "boolean",
      default: false,
      storageKey: "sess-productsShown",
    },
    provider: { type: "string", storageKey: "sess-provider" },
    rating: { type: "number", storageKey: "sess-rating" },
    ratingAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "sess-ratingAt",
    },
    sessionId: { type: "string", storageKey: "HiIwekOgnTI8" },
    storeId: { type: "string", storageKey: "Og-8g_uZZONF" },
    storefrontCartId: {
      type: "string",
      storageKey: "sess-storefrontCartId",
    },
  },
};
