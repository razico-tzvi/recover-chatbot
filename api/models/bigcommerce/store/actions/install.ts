import { applyParams, save, ActionOptions } from "gadget-server";
import { ensureWidgetScript } from "../../../../injectWidget";

export const run: ActionRun = async ({ params, record, logger, api, connections }) => {
  applyParams(params, record);
  await save(record);
};

export const onSuccess: ActionOnSuccess = async ({ record, logger, connections }) => {
  // Auto-inject the storefront chat widget on install.
  await ensureWidgetScript(connections, record.storeHash, logger);
};

export const options: ActionOptions = {
  actionType: "create",
};
