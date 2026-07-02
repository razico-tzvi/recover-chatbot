import { config } from "../config.js";
import { verifyWithSecret, type AppSession } from "./jwtVerify.js";

export type { AppSession };

/**
 * Verify the `signed_payload_jwt` BigCommerce sends to the Load and Uninstall
 * callbacks, using the app's client secret.
 */
export function verifySignedPayload(token: string): AppSession {
  return verifyWithSecret(token, config.BC_CLIENT_SECRET as string);
}
