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

// Freshdesk ticket history (agent public replies only), from the nightly sync.
export async function historyRows() {
  const rows = await fetchAll(api.crmHistory, { sort: { ticketUpdatedAt: "Descending" } }, 50000);
  return rows.map((r: any) => ({ ticketId: r.ticketId, subject: r.subject || "", agentReply: r.answer || "", ticketUpdatedAt: r.ticketUpdatedAt }));
}

// Learning-mode feedback: each AI draft next to what the agent actually sent.
export async function feedbackRows() {
  const rows = await fetchAll(api.crmTicket, { sort: { createdAt: "Descending" } }, 50000);
  return rows.map((r: any) => ({
    ticketId: r.ticketId,
    time: r.createdAt,
    outcome: r.action,
    confident: r.confident ?? "",
    blockedTopic: r.blockedTopic || "",
    subject: r.subject || "",
    aiDraft: r.draft || "",
    agentReply: r.finalReply || "",
    keptWording: typeof r.similarity === "number" ? r.similarity : "",
    model: r.model || "",
  }));
}
