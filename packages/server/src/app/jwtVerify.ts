import jwt from "jsonwebtoken";

/** Identity extracted from a verified BigCommerce load/uninstall payload. */
export interface AppSession {
  storeHash: string;
  userEmail?: string;
}

interface BcSignedPayload {
  sub?: string; // "stores/{hash}"
  user?: { email?: string };
}

/**
 * Verify a BigCommerce `signed_payload_jwt` (HS256) against a given secret and
 * extract the store hash. Pure (no config import) so it's unit-testable.
 * Throws if the signature is invalid or the store hash is missing.
 */
export function verifyWithSecret(token: string, secret: string): AppSession {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as BcSignedPayload;
  const sub = payload.sub ?? "";
  const storeHash = sub.startsWith("stores/") ? sub.slice("stores/".length) : "";
  if (!storeHash) throw new Error("signed payload missing store hash");
  return { storeHash, userEmail: payload.user?.email };
}
