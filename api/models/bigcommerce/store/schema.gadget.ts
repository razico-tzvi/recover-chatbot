import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "bigcommerce/store" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "DataModel-BigCommerce-Store",
  fields: {
    llmApiKey: { type: "string", storageKey: "store-llmApiKey" },
    llmBaseUrl: { type: "string", storageKey: "store-llmBaseUrl" },
    llmModel: { type: "string", storageKey: "store-llmModel" },
    llmProvider: { type: "string", storageKey: "store-llmProvider" },
  },
};
