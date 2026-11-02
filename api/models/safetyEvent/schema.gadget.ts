import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "safetyEvent" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "safetyEvent-model",
  fields: {
    detail: { type: "string", storageKey: "safetyEvent-detail" },
    expiresAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "safetyEvent-expiresAt",
    },
    ip: { type: "string", storageKey: "safetyEvent-ip" },
    kind: { type: "string", storageKey: "safetyEvent-kind" },
    sessionId: {
      type: "string",
      storageKey: "safetyEvent-sessionId",
    },
    storeId: { type: "string", storageKey: "safetyEvent-storeId" },
  },
};
