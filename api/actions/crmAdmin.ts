import { ActionOptions } from "gadget-server";
import { resolveCrm } from "../lib/defaults";
import { freshdesk, freshdeskConnected } from "../lib/integrations";
import { llmConfig } from "../lib/llm";
import { draftReply, processTicket, withSignature } from "../lib/crm";

// CRM tab operations. The store always comes from the session's BigCommerce
// context, never from params.
//   checkNow  — queue a poll for this store
//   syncNow   — queue a ticket-history sync for this store
//   preview   — draft a reply to pasted text; nothing is posted to Freshdesk
//   retry     — re-run a ticket that ended in "error"
export const run: ActionRun = async ({ params, api, connections, logger }) => {
  const storeHash = connections.bigcommerce.currentStoreHash;
  if (!storeHash) throw new Error("No store in context.");
  const [store] = await api.internal.bigcommerce.store.findMany({ filter: { storeHash: { equals: storeHash } }, first: 1 });
  if (!store) throw new Error("Store not installed.");
  const ctx = { api, logger };

  switch (params.op) {
    case "checkNow":
      if (!freshdeskConnected(store)) return { ok: false, message: "Connect Freshdesk on the Integrations tab first." };
      await api.enqueue(api.crmPoll, { storeId: store.id });
      return { ok: true, message: "Checking for new tickets — results appear below in a minute." };

    case "syncNow":
      if (!freshdeskConnected(store)) return { ok: false, message: "Connect Freshdesk on the Integrations tab first." };
      // A rate-limited sync has already scheduled its own continuation.
      const paused = (store.crmState as any)?.syncPausedUntil;
      if (paused && new Date(paused).getTime() > Date.now() - 30_000) {
        return { ok: true, message: "A history sync is already running — it continues automatically after Freshdesk's rate-limit window." };
      }
      await api.enqueue(api.crmSyncHistory, { storeId: store.id });
      return { ok: true, message: "History sync started — it runs in the background." };

    case "preview": {
      const cfg = llmConfig(store, "crm");
      if (!cfg.configured) return { ok: false, message: "Connect Anthropic (API key and model) on the Integrations tab first." };
      const question = String(params.text || "").trim().slice(0, 4000);
      if (!question) return { ok: false, message: "Paste a customer message to preview." };
      const d = await draftReply(ctx, store, cfg, { subject: String(params.subject || "").slice(0, 300), question, name: "" });
      return { ok: true, confident: d.confident, reason: d.reason, reply: withSignature(d.reply, resolveCrm(store).signature), model: cfg.model };
    }

    case "retry": {
      const id = Number(params.ticketId);
      const [row] = await api.internal.crmTicket.findMany({ filter: { storeId: { equals: store.id }, ticketId: { equals: id } }, first: 1 });
      if (!row || row.action !== "error") return { ok: false, message: "Only tickets that failed can be retried." };
      const crm = resolveCrm(store);
      if (crm.mode === "off") return { ok: false, message: "Turn on Learning or Live mode first." };
      const cfg = llmConfig(store, "crm");
      if (!cfg.configured) return { ok: false, message: "Connect Anthropic (API key and model) on the Integrations tab first." };
      const t = await freshdesk(store, "GET", `/tickets/${id}?include=requester`);
      await api.internal.crmTicket.delete(row.id);
      const out: any = await processTicket(ctx, store, crm, cfg, t);
      return { ok: out?.action !== "error", message: out?.action === "error" ? `Failed again: ${out.reason}` : `Done: ${out?.action}.` };
    }

    default:
      return { ok: false, message: "Unknown operation." };
  }
};

export const params = {
  op: { type: "string" },
  text: { type: "string" },
  subject: { type: "string" },
  ticketId: { type: "number" },
};

export const options: ActionOptions = {
  triggers: { api: true },
  timeoutMS: 120000,
};
