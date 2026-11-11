import { ActionOptions } from "gadget-server";
import { API_EXPIRY_DAYS, API_MAX_KEYS } from "../lib/defaults";
import { cleanAccess, cleanScopes, keyAccess, keyState, newKey } from "../lib/publicApi";

const DAY = 24 * 60 * 60 * 1000;

// API tab operations. The store always comes from the session's BigCommerce
// context, never from params.
//   list   — every key of this store (never the secret or its hash)
//   create — label + access (read | readwrite) + scopes + expiresInDays (0 = never);
//            returns the secret ONCE
//   revoke — stop a key working immediately (kept in the list for the record)
//   delete — remove a revoked or expired key from the list
export const run: ActionRun = async ({ params, api, connections }) => {
  const storeHash = connections.bigcommerce.currentStoreHash;
  if (!storeHash) throw new Error("No store in context.");
  const store = await api.internal.bigcommerce.store.findFirst({ filter: { storeHash: { equals: storeHash } } });

  const keys = async () => [...(await api.internal.apiKey.findMany({ filter: { storeId: { equals: store.id } }, sort: { createdAt: "Descending" }, first: 250 }))];
  const own = async () => {
    const id = String(params.keyId || "");
    return id ? api.internal.apiKey.findFirst({ filter: { id: { equals: id }, storeId: { equals: store.id } } }).catch(() => null) : null;
  };
  const out = (k: any) => ({
    id: k.id,
    label: k.label || "",
    prefix: k.prefix,
    access: keyAccess(k),
    scopes: cleanScopes(k.scopes),
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    revokedAt: k.revokedAt,
    state: keyState(k),
  });

  switch (params.op) {
    case "list":
      return { ok: true, storeHash, keys: (await keys()).map(out) };

    case "create": {
      const label = String(params.label || "").trim().slice(0, 80);
      const scopes = cleanScopes(params.scopes);
      const days = Math.round(Number(params.expiresInDays) || 0);
      const access = params.access ? cleanAccess(params.access) : "read";
      if (!label) return { ok: false, message: "Give the key a label so you know where it's used." };
      if (!scopes.length) return { ok: false, message: "Pick at least one resource the key can reach." };
      if (!access) return { ok: false, message: "Pick read or read & write access." };
      if (days !== 0 && !API_EXPIRY_DAYS.includes(days)) return { ok: false, message: "Pick an expiry from the list." };
      if ((await keys()).filter((k) => keyState(k) === "active").length >= API_MAX_KEYS) {
        return { ok: false, message: `A store can have at most ${API_MAX_KEYS} active keys — revoke one first.` };
      }
      const { key, keyHash, prefix } = newKey();
      const row = await api.internal.apiKey.create({
        storeId: store.id, label, access, scopes, keyHash, prefix,
        expiresAt: days ? new Date(Date.now() + days * DAY) : null,
      });
      return { ok: true, message: `Key "${label}" created. Copy it now — it won't be shown again.`, key, created: out(row) };
    }

    case "revoke": {
      const row = await own();
      if (!row) return { ok: false, message: "Key not found." };
      if (row.revokedAt) return { ok: true, message: "Already revoked." };
      await api.internal.apiKey.update(row.id, { revokedAt: new Date() });
      return { ok: true, message: `Key "${row.label}" revoked. Requests with it now get 401.` };
    }

    case "delete": {
      const row = await own();
      if (!row) return { ok: false, message: "Key not found." };
      if (keyState(row) === "active") return { ok: false, message: "Revoke the key before removing it." };
      await api.internal.apiKey.delete(row.id);
      return { ok: true, message: `Key "${row.label}" removed.` };
    }

    default:
      return { ok: false, message: "Unknown operation." };
  }
};

export const params = {
  op: { type: "string" },
  keyId: { type: "string" },
  label: { type: "string" },
  access: { type: "string" },
  scopes: { type: "array", items: { type: "string" } },
  expiresInDays: { type: "number" },
};

export const options: ActionOptions = {
  triggers: { api: true },
};
