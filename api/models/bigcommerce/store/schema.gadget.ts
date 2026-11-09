import type { GadgetModel } from "gadget-server";

// This file describes the schema for the "bigcommerce/store" model, go to https://recover-ai-chat.gadget.app/edit to view/edit your model in Gadget
// For more information on how to update this file http://docs.gadget.dev

export const schema: GadgetModel = {
  type: "gadget/model-schema/v2",
  storageKey: "DataModel-BigCommerce-Store",
  fields: {
    anthropicModels: {
      type: "json",
      storageKey: "store-anthropicModels",
    },
    botName: { type: "string", storageKey: "store-botName" },
    crmSettings: { type: "json", storageKey: "store-crmSettings" },
    crmState: { type: "json", storageKey: "store-crmState" },
    disclaimer: { type: "string", storageKey: "store-disclaimer" },
    faq: { type: "string", storageKey: "store-faq" },
    features: { type: "json", storageKey: "store-features" },
    freshdeskApiKey: {
      type: "encryptedString",
      storageKey: "store-freshdeskApiKey",
    },
    freshdeskDomain: {
      type: "string",
      storageKey: "store-freshdeskDomain",
    },
    greeting: { type: "string", storageKey: "store-greeting" },
    handoffDestination: {
      type: "string",
      storageKey: "store-handoffDestination",
    },
    handoffEmail: {
      type: "string",
      storageKey: "store-handoffEmail",
    },
    handoffWebhookUrl: {
      type: "string",
      storageKey: "store-handoffWebhookUrl",
    },
    incentiveInstructions: {
      type: "string",
      storageKey: "store-incentiveInstructions",
    },
    lastFlagAlertAt: {
      type: "dateTime",
      includeTime: true,
      storageKey: "store-lastFlagAlertAt",
    },
    llmApiKey: { type: "string", storageKey: "store-llmApiKey" },
    llmBaseUrl: { type: "string", storageKey: "store-llmBaseUrl" },
    llmModel: { type: "string", storageKey: "store-llmModel" },
    llmProvider: { type: "string", storageKey: "store-llmProvider" },
    safeguards: { type: "json", storageKey: "store-safeguards" },
    safeguardsInstructions: {
      type: "string",
      storageKey: "store-safeguardsInstructions",
    },
    shipstationApiKey: {
      type: "encryptedString",
      storageKey: "store-shipstationApiKey",
    },
    shipstationApiSecret: {
      type: "encryptedString",
      storageKey: "store-shipstationApiSecret",
    },
    suggestedQuestions: {
      type: "json",
      storageKey: "store-suggestedQuestions",
    },
    systemPrompt: {
      type: "string",
      storageKey: "store-systemPrompt",
    },
    visionEnabled: {
      type: "boolean",
      storageKey: "store-visionEnabled",
    },
    voiceTone: { type: "string", storageKey: "store-voiceTone" },
    widgetColor: { type: "string", storageKey: "store-widgetColor" },
  },
};
