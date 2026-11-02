import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "chatMessage" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "iT9JWV-ODLSj",
  fields: {
    content: { type: "string", storageKey: "jSbC_DzWUpoX" },
    images: { type: "json", storageKey: "msg-images" },
    role: { type: "string", storageKey: "gzUhLQExcMX-" },
    sessionId: { type: "string", storageKey: "NtdmBcP_xIhg" },
    storeId: { type: "string", storageKey: "fDRCtfX5asU3" },
  },
};
