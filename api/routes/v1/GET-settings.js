import { endpoint, settingsOut } from "../../lib/publicApi";

/** GET /v1/settings — resolved store settings. Never returns API keys, secrets or webhook URLs. */
export default endpoint("settings", async ({ store }) => settingsOut(store));
