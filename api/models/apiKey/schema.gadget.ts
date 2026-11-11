import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "apiKey" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

// A store's REST API key (API tab, api/lib/publicApi.js). Only the SHA-256
// hash of the secret is stored; `prefix` is the first characters, for display.
// `scopes` is a list of resource names from API_SCOPES. `access` is "read" or
// "readwrite" (API_ACCESS); empty = read (keys made before access existed).
export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "apiKey-model",
  fields: {
    access: { type: "string", storageKey: "apiKey-access" },
    expiresAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "apiKey-expiresAt",
    },
    keyHash: { type: "string", storageKey: "apiKey-keyHash" },
    label: { type: "string", storageKey: "apiKey-label" },
    lastUsedAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "apiKey-lastUsedAt",
    },
    prefix: { type: "string", storageKey: "apiKey-prefix" },
    revokedAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "apiKey-revokedAt",
    },
    scopes: { type: "json", storageKey: "apiKey-scopes" },
    storeId: { type: "string", storageKey: "apiKey-storeId" },
  },
};
