import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "chatSession" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "0ZfmLTW_J4KS",
  fields: {
    messageCount: { type: "number", storageKey: "c7KWOjGrn3Ir" },
    model: { type: "string", storageKey: "sess-model" },
    preview: { type: "string", storageKey: "za5uSb27e-4z" },
    provider: { type: "string", storageKey: "sess-provider" },
    sessionId: { type: "string", storageKey: "HiIwekOgnTI8" },
    storeId: { type: "string", storageKey: "Og-8g_uZZONF" },
  },
};
