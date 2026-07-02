import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { config } from "../config.js";

// Derive a 32-byte key from APP_ENCRYPTION_KEY for AES-256-GCM. In app mode
// APP_ENCRYPTION_KEY is required (validated in config); the fallback only
// applies to non-app dev runs where nothing sensitive is stored.
const key = scryptSync(config.APP_ENCRYPTION_KEY ?? "dev-insecure-key", "recover-chatbot", 32);

/** Encrypt a UTF-8 string → base64(iv | tag | ciphertext). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/** Decrypt a value produced by encrypt(). Throws on tampering. */
export function decrypt(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
