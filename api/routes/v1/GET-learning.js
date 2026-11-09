import { endpoint } from "../../lib/publicApi";
import { learningStatus } from "../../lib/learning";

/** GET /v1/learning — learning-loop settings, progress and every playbook version with its conversion stats. */
export default endpoint("learning", async ({ api, store }) => learningStatus(api, store));
