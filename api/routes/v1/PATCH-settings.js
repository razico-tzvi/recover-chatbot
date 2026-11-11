import { endpoint, jsonBody, writeSettings } from "../../lib/publicApi";

/**
 * PATCH /v1/settings — change branding, features, safeguards, handoff and learning
 * settings (partial, same shape as GET /v1/settings). Read-write keys with the
 * "settings" scope only. LLM, CRM and secrets can't be changed here.
 */
export default endpoint("settings", async ({ request, api, store }) => writeSettings(api, store, jsonBody(request)), { write: true });
