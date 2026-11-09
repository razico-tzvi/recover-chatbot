import { ActionOptions } from "gadget-server";
import { resolveLearning } from "../lib/defaults";
import { llmConfig } from "../lib/llm";
import { activate, deactivate, learningStatus, markRunning, reject } from "../lib/learning";

// Learning tab operations. The store always comes from the session's
// BigCommerce context, never from params.
//   status     — progress, settings and every version with its conversion stats
//   run        — queue an analysis now (skips the thresholds, not the minimum data)
//   approve    — make a proposed version live (optionally with edited text)
//   reject     — discard a proposed version
//   activate   — re-activate an earlier version (rollback)
//   deactivate — run with no playbook
//   settings   — auto on/off and the two thresholds
export const run: ActionRun = async ({ params, api, connections }) => {
  const storeHash = connections.bigcommerce.currentStoreHash;
  if (!storeHash) throw new Error("No store in context.");
  const [store] = await api.internal.bigcommerce.store.findMany({ filter: { storeHash: { equals: storeHash } }, first: 1 });
  if (!store) throw new Error("Store not installed.");

  const version = async () => {
    const id = String(params.versionId || "");
    const [row] = id ? await api.internal.salesPlaybook.findMany({ filter: { id: { equals: id }, storeId: { equals: store.id } }, first: 1 }) : [];
    return row;
  };

  switch (params.op) {
    case "status":
      return { ok: true, ...(await learningStatus(api, store)) };

    case "run": {
      if (!llmConfig(store, "analysis").configured) return { ok: false, message: "Connect Anthropic (API key and model) on the Integrations tab first." };
      const [pending] = await api.internal.salesPlaybook.findMany({ filter: { storeId: { equals: store.id }, status: { equals: "proposed" } }, first: 1 });
      if (pending) return { ok: false, message: "A proposed version is waiting for review — approve or reject it first." };
      await markRunning(api, store);
      await api.enqueue(api.learningLoop, { storeId: store.id, force: true });
      return { ok: true, message: "Analysis started — it reads the recent chats and takes a minute or two." };
    }

    case "approve": {
      const row = await version();
      if (!row || row.status !== "proposed") return { ok: false, message: "Only a proposed version can be approved." };
      const v = await activate(api, store, row, params.content);
      return { ok: true, message: `Version ${v.version} is live. New chats use it from now on.` };
    }

    case "reject": {
      const row = await version();
      if (!row || row.status !== "proposed") return { ok: false, message: "Only a proposed version can be rejected." };
      await reject(api, row);
      return { ok: true, message: `Version ${row.version} rejected.` };
    }

    case "activate": {
      const row = await version();
      if (!row || row.status !== "retired") return { ok: false, message: "Only an earlier, approved version can be restored." };
      await activate(api, store, row);
      return { ok: true, message: `Rolled back to version ${row.version}. New chats use it from now on.` };
    }

    case "deactivate":
      await deactivate(api, store);
      return { ok: true, message: "Playbook turned off. New chats run without one." };

    case "settings": {
      const next: Record<string, unknown> = { ...resolveLearning(store) };
      if (typeof params.auto === "boolean") next.auto = params.auto;
      if (params.minSettled != null) next.minSettled = params.minSettled;
      if (params.minConversions != null) next.minConversions = params.minConversions;
      const learningSettings = resolveLearning({ learningSettings: next });
      await api.internal.bigcommerce.store.update(store.id, { learningSettings });
      return { ok: true, message: "Learning settings saved.", settings: learningSettings };
    }

    default:
      return { ok: false, message: "Unknown operation." };
  }
};

export const params = {
  op: { type: "string" },
  versionId: { type: "string" },
  content: { type: "string" },
  auto: { type: "boolean" },
  minSettled: { type: "number" },
  minConversions: { type: "number" },
};

export const options: ActionOptions = {
  triggers: { api: true },
  timeoutMS: 120000,
};
