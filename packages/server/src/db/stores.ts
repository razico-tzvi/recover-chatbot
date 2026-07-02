import { db } from "./index.js";
import { encrypt, decrypt } from "./crypto.js";

interface StoreRow {
  access_token: string;
}

/** Insert or update a store's OAuth access token (encrypted at rest). */
export function upsertStore(storeHash: string, accessToken: string, scope: string): void {
  db.prepare(
    `INSERT INTO stores (store_hash, access_token, scope, installed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(store_hash) DO UPDATE SET
       access_token = excluded.access_token,
       scope        = excluded.scope`,
  ).run(storeHash, encrypt(accessToken), scope, new Date().toISOString());
}

/** Decrypted access token for a store, or null if not installed. */
export function getStoreToken(storeHash: string): string | null {
  const row = db.prepare("SELECT access_token FROM stores WHERE store_hash = ?").get(storeHash) as
    | StoreRow
    | undefined;
  return row ? decrypt(row.access_token) : null;
}

/** Whether a store is currently installed. */
export function storeExists(storeHash: string): boolean {
  return db.prepare("SELECT 1 FROM stores WHERE store_hash = ?").get(storeHash) !== undefined;
}

/** Remove a store and its settings (on uninstall). */
export function deleteStore(storeHash: string): void {
  db.prepare("DELETE FROM stores WHERE store_hash = ?").run(storeHash);
  db.prepare("DELETE FROM store_settings WHERE store_hash = ?").run(storeHash);
}
