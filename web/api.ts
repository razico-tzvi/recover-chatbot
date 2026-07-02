// Sets up the API client for interacting with your backend.
// For your API reference, visit: https://docs.gadget.dev/api/recover-ai-chat
import { Client } from "@gadget-client/recover-ai-chat";

export const api = new Client({ environment: window.gadgetConfig.environment });