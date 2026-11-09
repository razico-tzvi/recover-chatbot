import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "crmTicket" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "crmTicket-model",
  fields: {
    action: { type: "string", storageKey: "crmTicket-action" },
    blockedTopic: {
      type: "string",
      storageKey: "crmTicket-blockedTopic",
    },
    confident: { type: "boolean", storageKey: "crmTicket-confident" },
    draft: { type: "string", storageKey: "crmTicket-draft" },
    feedbackAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "crmTicket-feedbackAt",
    },
    finalReply: {
      type: "string",
      storageKey: "crmTicket-finalReply",
    },
    model: { type: "string", storageKey: "crmTicket-model-name" },
    nextCheckAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "crmTicket-nextCheckAt",
    },
    question: { type: "string", storageKey: "crmTicket-question" },
    reason: { type: "string", storageKey: "crmTicket-reason" },
    similarity: {
      type: "number",
      storageKey: "crmTicket-similarity",
    },
    storeId: { type: "string", storageKey: "crmTicket-storeId" },
    subject: { type: "string", storageKey: "crmTicket-subject" },
    ticketId: { type: "number", storageKey: "crmTicket-ticketId" },
  },
};
