import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "stockAlert" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "stockAlert-model",
  fields: {
    email: { type: "string", storageKey: "stockAlert-email" },
    notifiedAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "stockAlert-notifiedAt",
    },
    productId: { type: "number", storageKey: "stockAlert-productId" },
    productName: {
      type: "string",
      storageKey: "stockAlert-productName",
    },
    productUrl: {
      type: "string",
      storageKey: "stockAlert-productUrl",
    },
    sessionId: { type: "string", storageKey: "stockAlert-sessionId" },
    storeHash: { type: "string", storageKey: "stockAlert-storeHash" },
    storeId: { type: "string", storageKey: "stockAlert-storeId" },
    variantId: { type: "number", storageKey: "stockAlert-variantId" },
  },
};
