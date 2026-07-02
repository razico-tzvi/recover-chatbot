import { applyParams, save, ActionOptions } from "gadget-server";

// Standard update action so the app's settings form can persist per-store
// chatbot configuration (LLM provider/base URL/model/key).
export const run: ActionRun = async ({ params, record }) => {
  applyParams(params, record);
  await save(record);
};

export const options: ActionOptions = {
  actionType: "update",
  // Invocable from the app frontend via api.bigcommerce.store.update(...)
  triggers: { api: true },
};
