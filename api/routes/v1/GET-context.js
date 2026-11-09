import { endpoint, contextOut } from "../../lib/publicApi";

/** GET /v1/context — the context blocks the bot runs with (defaults filled in) and the live sales playbook. */
export default endpoint("context", async ({ store }) => contextOut(store));
