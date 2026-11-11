import { endpoint, cleanScopes, keyAccess } from "../../lib/publicApi";

/** GET /v1/me — the calling key's store, label, access, scopes and expiry. Any valid key. */
export default endpoint(null, async ({ store, key }) => ({
  storeHash: store.storeHash,
  key: {
    label: key.label,
    prefix: key.prefix,
    access: keyAccess(key),
    scopes: cleanScopes(key.scopes),
    expiresAt: key.expiresAt ? new Date(key.expiresAt).toISOString() : null,
  },
}));
