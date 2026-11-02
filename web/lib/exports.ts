import { api } from "../api";
import { downloadRows, fetchAll, stamp } from "./download";

// Full transcripts with message metadata, one row per message.
export async function conversationRows(filter?: Record<string, unknown>) {
  const sessions = await fetchAll(api.chatSession, { sort: { createdAt: "Descending" }, ...(filter ? { filter } : {}) });
  const byId = new Map(sessions.map((s: any) => [s.sessionId, s]));
  const ids = [...byId.keys()];
  const messages: any[] = [];
  // Message filters take bounded "in" lists, so fetch per batch of sessions.
  for (let i = 0; i < ids.length; i += 100) {
    messages.push(...(await fetchAll(api.chatMessage, {
      filter: { sessionId: { in: ids.slice(i, i + 100) } },
      sort: { createdAt: "Ascending" },
    }, 50000)));
  }
  return messages.map((m: any) => {
    const s: any = byId.get(m.sessionId) || {};
    return {
      sessionId: m.sessionId,
      sessionStarted: s.createdAt,
      needsHuman: !!s.needsHuman,
      flagged: !!s.flagged,
      flagReason: s.flagReason || "",
      model: s.model || "",
      time: m.createdAt,
      role: m.role,
      content: m.content || "",
      toolsCalled: Array.isArray(m.tools) ? m.tools.join("|") : "",
      imageCount: Array.isArray(m.images) ? m.images.length : 0,
    };
  });
}

export async function exportConversations(format: "csv" | "json", filter?: Record<string, unknown>) {
  downloadRows(`conversations-${stamp()}`, format, await conversationRows(filter));
}
