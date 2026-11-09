import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "salesPlaybook" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

// One version of a store's sales playbook, written by the learning loop
// (api/lib/learning.js). status: proposed → active → retired, or rejected.
export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "salesPlaybook-model",
  fields: {
    activatedAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "salesPlaybook-activatedAt",
    },
    basedOn: { type: "json", storageKey: "salesPlaybook-basedOn" },
    // Not "changes": that name is shadowed by GadgetRecord#changes().
    changeSummary: {
      type: "json",
      storageKey: "salesPlaybook-changes",
    },
    content: { type: "string", storageKey: "salesPlaybook-content" },
    decidedAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "salesPlaybook-decidedAt",
    },
    edited: { type: "boolean", storageKey: "salesPlaybook-edited" },
    model: { type: "string", storageKey: "salesPlaybook-model-name" },
    rationale: {
      type: "string",
      storageKey: "salesPlaybook-rationale",
    },
    retiredAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "salesPlaybook-retiredAt",
    },
    status: { type: "string", storageKey: "salesPlaybook-status" },
    storeId: { type: "string", storageKey: "salesPlaybook-storeId" },
    trigger: { type: "string", storageKey: "salesPlaybook-trigger" },
    version: { type: "number", storageKey: "salesPlaybook-version" },
  },
};
