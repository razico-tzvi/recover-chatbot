import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "crmHistory" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "crmHistory-model",
  fields: {
    answer: { type: "string", storageKey: "crmHistory-answer" },
    storeId: { type: "string", storageKey: "crmHistory-storeId" },
    subject: { type: "string", storageKey: "crmHistory-subject" },
    ticketId: { type: "number", storageKey: "crmHistory-ticketId" },
    ticketUpdatedAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "crmHistory-ticketUpdatedAt",
    },
  },
};
