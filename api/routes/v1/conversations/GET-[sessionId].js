import { endpoint, sessionOut, messageOut } from "../../../lib/publicApi";
import { findAll } from "../../../lib/analytics";

/** GET /v1/conversations/{sessionId} — one session with its full transcript (oldest message first). */
export default endpoint("conversations", async ({ request, api, store }) => {
  const sessionId = String(request.params.sessionId || "").slice(0, 100);
  const session = await api.internal.chatSession.findFirst({
    filter: { storeId: { equals: store.id }, sessionId: { equals: sessionId } },
  }).catch(() => null);
  if (!session) return null;
  const messages = await findAll(api.internal.chatMessage, { storeId: { equals: store.id }, sessionId: { equals: sessionId } });
  messages.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return { ...sessionOut(session), messages: messages.map(messageOut) };
});
