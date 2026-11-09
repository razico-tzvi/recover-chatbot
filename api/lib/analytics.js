import { ASSISTED_WINDOW_DAYS, modelPrice } from "./defaults";

const DAY = 24 * 60 * 60 * 1000;
const PAGE = 250;
const FIRST_SYNC_DAYS = 30;
const MAX_ORDER_PAGES = 40;

// ─────────────────────────── order attribution ───────────────────────────

// Match new BigCommerce orders to chat sessions by cart id and record the
// conversion on the session:
//  - direct:   the order's cart is the one the chat built (chatCart, add_to_cart)
//  - assisted: the order's cart is the shopper's own storefront cart seen during
//              the chat, ordered within ASSISTED_WINDOW_DAYS of the chat
// Idempotent: a session keeps its first conversion; re-reading orders is harmless.
export async function syncStoreOrders({ api, connections, logger }, store) {
  const state = store.analyticsState || {};
  const since = new Date(state.ordersCursor || Date.now() - FIRST_SYNC_DAYS * DAY);
  const bc = await connections.bigcommerce.forStoreHash(store.storeHash);

  const orders = [];
  for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
    const rows = await bc.v2.get("/orders", {
      // A day of overlap catches orders that were still Incomplete on the previous run.
      query: { min_date_created: new Date(since.getTime() - DAY).toISOString(), sort: "date_created:asc", limit: PAGE, page },
    });
    const list = Array.isArray(rows) ? rows : [];
    orders.push(...list);
    if (list.length < PAGE) break;
  }

  // Incomplete (status 0) orders never finished checkout.
  const placed = orders.filter((o) => o && o.cart_id && Number(o.status_id) !== 0);
  let direct = 0, assisted = 0;
  for (let i = 0; i < placed.length; i += PAGE) {
    const batch = placed.slice(i, i + PAGE);
    const r = await attributeBatch(api, store, batch);
    direct += r.direct; assisted += r.assisted;
  }

  // Advance to the newest order seen; re-read orders are skipped as already attributed.
  const newest = orders.reduce((m, o) => Math.max(m, Date.parse(o?.date_created) || 0), since.getTime());
  const analyticsState = { ...state, ordersCursor: new Date(newest).toISOString(), ordersSyncedAt: new Date().toISOString() };
  await api.internal.bigcommerce.store.update(store.id, { analyticsState });
  store.analyticsState = analyticsState;

  logger?.info({ storeId: store.id, orders: orders.length, direct, assisted }, "order attribution synced");
  return { orders: orders.length, direct, assisted };
}

async function attributeBatch(api, store, orders) {
  const cartIds = [...new Set(orders.map((o) => String(o.cart_id)))];

  const chatCarts = await api.internal.chatCart.findMany({
    filter: { storeHash: { equals: store.storeHash }, cartId: { in: cartIds } },
    first: PAGE,
  });
  const chatSessionIds = [...new Set(chatCarts.map((c) => c.sessionId).filter(Boolean))];
  const directSessions = chatSessionIds.length
    ? await api.internal.chatSession.findMany({
        filter: { storeId: { equals: store.id }, sessionId: { in: chatSessionIds } },
        first: PAGE,
      })
    : [];
  const assistedSessions = await api.internal.chatSession.findMany({
    filter: { storeId: { equals: store.id }, storefrontCartId: { in: cartIds } },
    first: PAGE,
  });

  const bySessionId = new Map(directSessions.map((s) => [s.sessionId, s]));
  const directByCart = new Map(chatCarts.map((c) => [c.cartId, bySessionId.get(c.sessionId)]).filter(([, s]) => s));
  const assistedByCart = new Map();
  for (const s of assistedSessions) {
    const prev = assistedByCart.get(s.storefrontCartId);
    if (!prev || new Date(s.updatedAt) > new Date(prev.updatedAt)) assistedByCart.set(s.storefrontCartId, s);
  }

  let direct = 0, assisted = 0;
  const touched = new Set();
  for (const o of orders) {
    const cartId = String(o.cart_id);
    const placedAt = new Date(Date.parse(o.date_created) || Date.now());
    let session = directByCart.get(cartId);
    let kind = "direct";
    if (!session) {
      session = assistedByCart.get(cartId);
      kind = "assisted";
      if (session) {
        const start = new Date(session.createdAt).getTime();
        const last = new Date(session.updatedAt).getTime();
        if (placedAt.getTime() < start || placedAt.getTime() - last > ASSISTED_WINDOW_DAYS * DAY) session = null;
      }
    }
    if (!session || session.orderId || touched.has(session.id)) continue;
    touched.add(session.id);
    await api.internal.chatSession.update(session.id, {
      conversion: kind,
      orderId: Number(o.id),
      orderTotal: Number(o.total_inc_tax) || 0,
      orderCurrency: o.currency_code || o.default_currency_code || "",
      convertedAt: placedAt,
    });
    if (kind === "direct") direct++; else assisted++;
  }
  return { direct, assisted };
}

// ─────────────────────────── dashboard numbers ───────────────────────────

const MAX_SESSIONS = 20000;

export async function findAll(model, filter, select) {
  const rows = [];
  let page = await model.findMany({ filter, select, first: PAGE });
  for (;;) {
    rows.push(...page);
    if (!page.hasNextPage || rows.length >= MAX_SESSIONS) break;
    page = await page.nextPage();
  }
  return rows;
}

// Everything the Analytics tab shows for one store over the last `days` days.
export async function storeAnalytics(api, store, days) {
  const now = Date.now();
  const from = new Date(now - days * DAY);
  const inRange = { storeId: { equals: store.id }, createdAt: { greaterThanOrEqual: from.toISOString() } };

  const sessions = await findAll(api.internal.chatSession, inRange, {
    id: true, createdAt: true, messageCount: true, needsHuman: true, handoffAt: true, flagged: true,
    rating: true, inputTokens: true, outputTokens: true, costUsd: true, model: true,
    productsShown: true, addedToCart: true, conversion: true, orderTotal: true, orderCurrency: true,
  });
  const safety = await findAll(api.internal.safetyEvent, inRange, { kind: true });
  const tickets = await findAll(api.internal.crmTicket, inRange, { action: true, similarity: true, feedbackAt: true });

  // Conversations that had at least one shopper message (flag-only rows have 0).
  const convos = sessions.filter((s) => (s.messageCount || 0) > 0);
  const n = convos.length;
  const handoffs = convos.filter((s) => s.handoffAt).length;
  const up = convos.filter((s) => s.rating === 1).length;
  const down = convos.filter((s) => s.rating === -1).length;
  const priced = convos.filter((s) => s.costUsd != null);
  const cost = priced.reduce((t, s) => t + (s.costUsd || 0), 0);
  const unpricedModels = [...new Set(convos.filter((s) => (s.inputTokens || s.outputTokens) && !modelPrice(s.model)).map((s) => s.model || "unknown"))];

  const direct = convos.filter((s) => s.conversion === "direct");
  const assisted = convos.filter((s) => s.conversion === "assisted");
  const revenue = (list) => {
    const byCur = {};
    for (const s of list) byCur[s.orderCurrency || ""] = (byCur[s.orderCurrency || ""] || 0) + (s.orderTotal || 0);
    return byCur;
  };

  // One bucket per day (UTC), oldest first.
  const daily = [];
  for (let d = days - 1; d >= 0; d--) {
    const day = new Date(now - d * DAY).toISOString().slice(0, 10);
    daily.push({ day, conversations: 0, handoffs: 0, conversions: 0 });
  }
  const byDay = new Map(daily.map((r) => [r.day, r]));
  for (const s of convos) {
    const r = byDay.get(new Date(s.createdAt).toISOString().slice(0, 10));
    if (!r) continue;
    r.conversations++;
    if (s.handoffAt) r.handoffs++;
    if (s.conversion) r.conversions++;
  }

  const count = (list, key) => list.reduce((m, x) => ({ ...m, [x[key] || "other"]: (m[x[key] || "other"] || 0) + 1 }), {});
  const sims = tickets.filter((t) => t.feedbackAt && t.similarity != null);

  return {
    days,
    from: from.toISOString(),
    truncated: sessions.length >= MAX_SESSIONS,
    ordersSyncedAt: store.analyticsState?.ordersSyncedAt || null,
    overview: {
      conversations: n,
      messages: convos.reduce((t, s) => t + (s.messageCount || 0), 0),
      handoffs,
      containment: n ? (n - handoffs) / n : null,
      ratingUp: up,
      ratingDown: down,
      satisfaction: up + down ? up / (up + down) : null,
      inputTokens: convos.reduce((t, s) => t + (s.inputTokens || 0), 0),
      outputTokens: convos.reduce((t, s) => t + (s.outputTokens || 0), 0),
      costUsd: priced.length ? cost : null,
      costPerConversation: priced.length ? cost / priced.length : null,
      unpricedModels,
    },
    funnel: {
      conversations: n,
      productsShown: convos.filter((s) => s.productsShown).length,
      addedToCart: convos.filter((s) => s.addedToCart).length,
      direct: direct.length,
      assisted: assisted.length,
      directRevenue: revenue(direct),
      assistedRevenue: revenue(assisted),
    },
    support: {
      handoffs,
      openHandoffs: convos.filter((s) => s.needsHuman).length,
      flagged: sessions.filter((s) => s.flagged).length,
      safety: count(safety, "kind"),
      tickets: count(tickets, "action"),
      ticketEditRate: sims.length ? sims.filter((t) => t.similarity < 0.9).length / sims.length : null,
      ticketFeedback: sims.length,
    },
    daily,
  };
}
