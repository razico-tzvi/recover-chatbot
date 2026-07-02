import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "chatCart" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "7zAjlwPNxIMC",
  fields: {
    cartId: { type: "string", storageKey: "WYFUgoFv_AAw" },
    sessionId: { type: "string", storageKey: "70_3bskCr4Ua" },
    storeHash: { type: "string", storageKey: "8A3XdRiHYWzG" },
  },
};
