import { ActionOptions } from "gadget-server";
import { ensureWidgetScript } from "../injectWidget";

// Manually (re)inject the storefront widget for a store. Useful for stores that
// were installed before widget injection existed; install/reinstall do this
// automatically going forward.
export const run: ActionRun = async ({ params, logger, connections }) => {
  const storeHash = params.storeHash;
  if (!storeHash) throw new Error("storeHash is required");
  await ensureWidgetScript(connections, storeHash, logger);
  return { ok: true, storeHash };
};

export const params = {
  storeHash: { type: "string" },
};

export const options: ActionOptions = {
  triggers: { api: true },
};
