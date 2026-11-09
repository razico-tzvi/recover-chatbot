import { ApiError, endpoint, listParams, createdFilter, page } from "../../lib/publicApi";

const iso = (d) => (d ? new Date(d).toISOString() : null);

/**
 * GET /v1/feedback — newest first; limit, since, until, cursor as elsewhere.
 *   source=ratings (default): widget 👍/👎 per conversation (rating 1 / -1)
 *   source=crm: each Freshdesk AI draft next to what the agent sent
 *               (similarity 1 = sent unchanged)
 */
export default endpoint("feedback", async ({ request, api, store }) => {
  const q = request.query || {};
  const p = listParams(q);
  const filter = createdFilter(store.id, p);

  if (q.source === "crm") {
    const { data, nextCursor } = await page(api.internal.crmTicket, filter, p.limit);
    return {
      source: "crm",
      data: data.map((r) => ({
        ticketId: r.ticketId,
        createdAt: iso(r.createdAt),
        outcome: r.action,
        confident: r.confident ?? null,
        blockedTopic: r.blockedTopic || null,
        subject: r.subject || "",
        aiDraft: r.draft || "",
        agentReply: r.finalReply || null,
        similarity: typeof r.similarity === "number" ? r.similarity : null,
        feedbackAt: iso(r.feedbackAt),
        model: r.model || "",
      })),
      nextCursor,
    };
  }
  if (q.source && q.source !== "ratings") throw new ApiError(400, "source must be ratings or crm.");

  const { data, nextCursor } = await page(api.internal.chatSession, { ...filter, rating: { isSet: true } }, p.limit);
  return {
    source: "ratings",
    data: data.map((s) => ({ sessionId: s.sessionId, createdAt: iso(s.createdAt), rating: s.rating, ratingAt: iso(s.ratingAt), preview: s.preview || "" })),
    nextCursor,
  };
});
