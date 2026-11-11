import { endpoint, jsonBody, writeContext } from "../../../lib/publicApi";

/**
 * PUT /v1/context/{source} — replace one context source's text. Body: {"content": "…"}.
 * Sources: guidelines, faq, voiceTone, safeguardsInstructions, incentiveInstructions, salesPlaybook.
 * Read-write keys with the "context" scope only.
 */
export default endpoint(
  "context",
  async ({ request, api, store, key }) => writeContext(api, store, String(request.params.source || ""), jsonBody(request), key),
  { write: true }
);
