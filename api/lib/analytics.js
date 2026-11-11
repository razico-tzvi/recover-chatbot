import { ASSISTED_WINDOW_DAYS, ANALYTICS_MAX_DAYS, SUPPORT_TOPIC_LABELS, modelPrice, questionKey } from "./defaults";

const DAY = 24 * 60 * 60 * 1000;
const PAGE = 250;
const FIRST_SYNC_DAYS = 30;
// First run of the site baseline (all store orders per day) goes back far enough
// for a 90-day range compared with the 90 days before it.
const SITE_BACKFILL_DAYS = 180;
const SITE_KEEP_DAYS = 400;
const MAX_ORDER_PAGES = 40;

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const startOfDay = (t) => Date.parse(dayKey(t) + "T00:00:00.000Z");

// ─────────────────────────── order attribution ───────────────────────────

// Match new BigCommerce orders to chat sessions by cart id and record the
// conversion on the session:
//  - direct:   the order's cart is the one the chat built (chatCart, add_to_cart)
//  - assisted: the order's cart is the shopper's own storefront cart seen during
//              the chat, ordered within ASSISTED_WINDOW_DAYS of the chat
// Idempotent: a session keeps its first conversion; re-reading orders is harmless.
//
// The same read keeps the site baseline: placed orders and revenue per UTC day for
// the whole store (`analyticsState.siteDaily`), for chat AOV vs. site AOV. Reads start
// at midnight so every day read is complete and its totals are simply overwritten.
export async function syncStoreOrders({ api, connections, logger }, store) {
  const state = store.analyticsState || {};
  const firstSite = !state.siteFrom;
  let since = state.ordersCursor ? Date.parse(state.ordersCursor) : Date.now() - FIRST_SYNC_DAYS * DAY;
  if (firstSite) since = Math.min(since, Date.now() - SITE_BACKFILL_DAYS * DAY);
  // A day of overlap catches orders that were still Incomplete on the previous run.
  const readFrom = startOfDay(since - DAY);
  const bc = await connections.bigcommerce.forStoreHash(store.storeHash);

  const orders = [];
  let truncated = true;
  for (let page = 1; page <= MAX_ORDER_PAGES; page++) {
    const rows = await bc.v2.get("/orders", {
      query: { min_date_created: new Date(readFrom).toISOString(), sort: "date_created:asc", limit: PAGE, page },
    });
    const list = Array.isArray(rows) ? rows : [];
    orders.push(...list);
    if (list.length < PAGE) { truncated = false; break; }
  }

  // Incomplete (status 0) orders never finished checkout.
  const placed = orders.filter((o) => o && Number(o.status_id) !== 0);
  const siteDaily = siteTotals(state.siteDaily, placed, readFrom, truncated);
  const chatCandidates = placed.filter((o) => o.cart_id);
  let direct = 0, assisted = 0;
  for (let i = 0; i < chatCandidates.length; i += PAGE) {
    const batch = chatCandidates.slice(i, i + PAGE);
    const r = await attributeBatch(api, store, batch);
    direct += r.direct; assisted += r.assisted;
  }

  // Advance to the newest order seen; re-read orders are skipped as already attributed.
  const newest = orders.reduce((m, o) => Math.max(m, Date.parse(o?.date_created) || 0), since);
  const analyticsState = {
    ...state,
    ordersCursor: new Date(newest).toISOString(),
    ordersSyncedAt: new Date().toISOString(),
    siteDaily,
    siteFrom: firstSite ? dayKey(readFrom) : state.siteFrom,
  };
  await api.internal.bigcommerce.store.update(store.id, { analyticsState });
  store.analyticsState = analyticsState;

  logger?.info({ storeId: store.id, orders: orders.length, direct, assisted }, "order attribution synced");
  return { orders: orders.length, direct, assisted };
}

// Overwrite the per-day site totals for every complete day read: from `readFrom`
// to today, or (if the read was cut off at MAX_ORDER_PAGES) to the last order's day,
// which the next run re-reads in full.
// { "YYYY-MM-DD": { o: orders, c: { CUR: orders }, r: { CUR: revenue } } }
export function siteTotals(prev, placed, readFrom, truncated) {
  const out = { ...(prev && typeof prev === "object" ? prev : {}) };
  const last = truncated && placed.length ? Date.parse(placed[placed.length - 1].date_created) || Date.now() : Date.now();
  for (let t = readFrom; t <= last; t += DAY) out[dayKey(t)] = { o: 0, c: {}, r: {} };
  for (const o of placed) {
    const at = Date.parse(o.date_created);
    if (!at || at < readFrom) continue;
    const d = out[dayKey(at)];
    if (!d) continue;
    const cur = o.currency_code || o.default_currency_code || "";
    d.o++;
    d.c[cur] = (d.c[cur] || 0) + 1;
    d.r[cur] = (d.r[cur] || 0) + (Number(o.total_inc_tax) || 0);
  }
  const keepFrom = dayKey(Date.now() - SITE_KEEP_DAYS * DAY);
  for (const k of Object.keys(out)) if (k < keepFrom) delete out[k];
  return out;
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

// The period an Analytics request covers, in whole UTC days. Either `from`/`to`
// (YYYY-MM-DD, inclusive) or the last `days` days ending today; `compare` adds the
// period of the same length right before it. Shared by the tab and GET /v1/analytics.
export function resolveRange({ days, from, to, compare } = {}) {
  const today = startOfDay(Date.now());
  const parse = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || "")) ? Date.parse(`${d}T00:00:00.000Z`) : NaN);
  let start = parse(from);
  let end = parse(to);
  if (Number.isFinite(start) && Number.isFinite(end)) {
    end = Math.min(end, today);
    if (start > end) [start, end] = [end, start];
    start = Math.max(start, end - (ANALYTICS_MAX_DAYS - 1) * DAY);
  } else {
    const n = Math.min(ANALYTICS_MAX_DAYS, Math.max(1, Math.round(Number(days) || 30)));
    end = today;
    start = today - (n - 1) * DAY;
  }
  const on = compare === true || compare === "true" || compare === "1" || compare === 1;
  return { from: dayKey(start), to: dayKey(end), days: Math.round((end - start) / DAY) + 1, compare: on };
}

// Everything the Analytics tab shows for one store. `range` is resolveRange()'s
// output (a plain number of days is accepted too).
export async function storeAnalytics(api, store, range) {
  const r = typeof range === "object" && range ? range : resolveRange({ days: range });
  const start = Date.parse(`${r.from}T00:00:00.000Z`);
  const end = Date.parse(`${r.to}T00:00:00.000Z`) + DAY; // exclusive

  const cur = await periodStats(api, store, start, end, true);
  const prev = r.compare ? await periodStats(api, store, start - r.days * DAY, start, false) : null;

  // One bucket per day (UTC), oldest first.
  const daily = [];
  for (let t = start; t < end; t += DAY) daily.push({ day: dayKey(t), conversations: 0, handoffs: 0, conversions: 0 });
  const byDay = new Map(daily.map((x) => [x.day, x]));
  for (const s of cur.convos) {
    const row = byDay.get(dayKey(s.createdAt));
    if (!row) continue;
    row.conversations++;
    if (s.handoffAt) row.handoffs++;
    if (s.conversion) row.conversions++;
  }

  return {
    days: r.days,
    from: r.from,
    to: r.to,
    truncated: cur.truncated,
    ordersSyncedAt: store.analyticsState?.ordersSyncedAt || null,
    overview: cur.overview,
    funnel: cur.funnel,
    sales: cur.sales,
    support: cur.support,
    daily,
    compare: prev
      ? {
          from: dayKey(start - r.days * DAY),
          to: dayKey(start - DAY),
          truncated: prev.truncated,
          overview: prev.overview,
          funnel: prev.funnel,
          sales: prev.sales,
          support: prev.support,
        }
      : null,
  };
}

const SESSION_FIELDS = {
  id: true, createdAt: true, messageCount: true, needsHuman: true, handoffAt: true, flagged: true,
  rating: true, inputTokens: true, outputTokens: true, costUsd: true, model: true,
  productsShown: true, addedToCart: true, checkoutClickedAt: true, conversion: true, orderTotal: true, orderCurrency: true,
  productsAsked: true, couponsTried: true, shippingEstimates: true, unanswered: true, topics: true,
};

const addTo = (m, k, v) => { m[k] = (m[k] || 0) + v; return m; };
const ratio = (a, b) => (b ? a / b : null);

// The numbers for [start, end). `lists` adds the ranked lists (top products, FAQ
// gaps, coupon codes) — the comparison period only needs the totals.
async function periodStats(api, store, start, end, lists) {
  const inRange = {
    AND: [
      { storeId: { equals: store.id } },
      { createdAt: { greaterThanOrEqual: new Date(start).toISOString() } },
      { createdAt: { lessThan: new Date(end).toISOString() } },
    ],
  };
  const sessions = await findAll(api.internal.chatSession, inRange, SESSION_FIELDS);
  const safety = await findAll(api.internal.safetyEvent, inRange, { kind: true });
  const tickets = await findAll(api.internal.crmTicket, inRange, { action: true, similarity: true, feedbackAt: true });

  // Conversations that had at least one shopper message (flag-only rows have 0).
  const convos = sessions.filter((s) => (s.messageCount || 0) > 0);
  const n = convos.length;
  const handoffs = convos.filter((s) => s.handoffAt).length;
  const up = convos.filter((s) => s.rating === 1).length;
  const down = convos.filter((s) => s.rating === -1).length;

  // ── AI cost, overall and per model ──
  // Chats from before usage tracking (2026-11-09) have no token fields at all.
  const tracked = convos.filter((s) => s.inputTokens != null || s.outputTokens != null);
  const priced = convos.filter((s) => s.costUsd != null);
  const cost = priced.reduce((t, s) => t + (s.costUsd || 0), 0);
  const unpricedModels = [...new Set(tracked.filter((s) => (s.inputTokens || s.outputTokens) && !modelPrice(s.model)).map((s) => s.model || "unknown"))];
  const models = new Map();
  for (const s of tracked) {
    const key = s.model || "unknown";
    const m = models.get(key) || { model: key, conversations: 0, inputTokens: 0, outputTokens: 0, priced: 0, costUsd: 0 };
    m.conversations++;
    m.inputTokens += s.inputTokens || 0;
    m.outputTokens += s.outputTokens || 0;
    if (s.costUsd != null) { m.priced++; m.costUsd += s.costUsd; }
    models.set(key, m);
  }
  const byModel = [...models.values()]
    .map(({ priced: p, ...m }) => ({ ...m, costUsd: p ? m.costUsd : null, costPerConversation: p ? m.costUsd / p : null }))
    .sort((a, b) => b.conversations - a.conversations);

  // ── orders ──
  const direct = convos.filter((s) => s.conversion === "direct");
  const assisted = convos.filter((s) => s.conversion === "assisted");
  const ordered = [...direct, ...assisted];
  const revenue = (list) => list.reduce((m, s) => addTo(m, s.orderCurrency || "", s.orderTotal || 0), {});
  const orderCounts = (list) => list.reduce((m, s) => addTo(m, s.orderCurrency || "", 1), {});
  const aov = (rev, cnt) => Object.fromEntries(Object.keys(rev).filter((c) => cnt[c]).map((c) => [c, rev[c] / cnt[c]]));
  const chatRevenue = revenue(ordered);
  const chatOrders = orderCounts(ordered);

  // ── site baseline (every store order, from the hourly order sync) ──
  const st = store.analyticsState || {};
  let site = null;
  if (st.siteFrom && st.siteDaily) {
    let orders = 0, days = 0, total = 0;
    const rev = {}, cnt = {};
    for (let t = start; t < end; t += DAY) {
      total++;
      const d = st.siteDaily[dayKey(t)];
      if (!d) continue;
      days++;
      orders += d.o || 0;
      for (const [c, v] of Object.entries(d.r || {})) addTo(rev, c, v);
      for (const [c, v] of Object.entries(d.c || {})) addTo(cnt, c, v);
    }
    // The main currency is the one with the most revenue; AOVs are compared in it.
    const main = Object.entries(rev).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    site = {
      orders,
      ordersByCurrency: cnt,
      revenue: rev,
      currency: main,
      aov: aov(rev, cnt),
      daysCovered: days,
      daysInRange: total,
      coveredFrom: st.siteFrom,
    };
  }
  const mainCur = site?.currency ?? Object.entries(chatRevenue).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // ── coupons & shipping ──
  const couponChats = convos.filter((s) => Array.isArray(s.couponsTried) && s.couponsTried.length);
  const codes = new Map();
  const discount = {};
  let applied = 0, rejected = 0;
  for (const s of couponChats) {
    for (const c of s.couponsTried) {
      const code = String(c.code || "").toUpperCase() || "(blank)";
      const row = codes.get(code) || { code, applied: 0, rejected: 0 };
      if (c.applied) { row.applied++; applied++; addTo(discount, c.currency || "", Number(c.discount) || 0); }
      else { row.rejected++; rejected++; }
      codes.set(code, row);
    }
  }
  const shipChats = convos.filter((s) => (s.shippingEstimates || 0) > 0);

  const sales = {
    orders: ordered.length,
    revenue: chatRevenue,
    ordersByCurrency: chatOrders,
    aov: aov(chatRevenue, chatOrders),
    directRevenue: revenue(direct),
    assistedRevenue: revenue(assisted),
    currency: mainCur,
    site,
    revenueShare: site && mainCur != null && site.revenue[mainCur] ? (chatRevenue[mainCur] || 0) / site.revenue[mainCur] : null,
    orderShare: site && site.orders ? ordered.length / site.orders : null,
    coupons: {
      conversations: couponChats.length,
      conversationsApplied: couponChats.filter((s) => s.couponsTried.some((c) => c.applied)).length,
      applied,
      rejected,
      discount,
      ...(lists ? { codes: [...codes.values()].sort((a, b) => b.applied + b.rejected - (a.applied + a.rejected)).slice(0, 10) } : {}),
    },
    shipping: {
      conversations: shipChats.length,
      estimates: shipChats.reduce((t, s) => t + (s.shippingEstimates || 0), 0),
    },
  };

  if (lists) {
    // Top products asked about: chats that looked a product up (details, reviews,
    // related, compare) or added it to the cart, with how many of those chats ordered.
    const products = new Map();
    for (const s of convos) {
      for (const p of Array.isArray(s.productsAsked) ? s.productsAsked : []) {
        const row = products.get(p.id) || { id: p.id, name: null, conversations: 0, orders: 0 };
        if (!row.name && p.name) row.name = p.name;
        row.conversations++;
        if (s.conversion) row.orders++;
        products.set(p.id, row);
      }
    }
    sales.topProducts = [...products.values()].sort((a, b) => b.conversations - a.conversations || b.orders - a.orders).slice(0, 10);

    // Asked but unanswered (FAQ gap list): same question across chats, most asked first.
    const gaps = new Map();
    for (const s of convos) {
      for (const q of Array.isArray(s.unanswered) ? s.unanswered : []) {
        const k = questionKey(q);
        if (!k) continue;
        const row = gaps.get(k) || { question: q, count: 0, lastAskedAt: null };
        row.count++;
        if (!row.lastAskedAt || new Date(s.createdAt) > new Date(row.lastAskedAt)) { row.lastAskedAt = new Date(s.createdAt).toISOString(); row.question = q; }
        gaps.set(k, row);
      }
    }
    sales.faqGaps = [...gaps.values()].sort((a, b) => b.count - a.count || String(b.lastAskedAt).localeCompare(String(a.lastAskedAt))).slice(0, 25);
  }

  // ── support topics ──
  const supportChats = convos.filter((s) => Array.isArray(s.topics) && s.topics.length);
  const topicCounts = {};
  for (const s of supportChats) for (const k of s.topics) addTo(topicCounts, k, 1);
  const topics = Object.entries(topicCounts)
    .map(([key, conversations]) => ({ key, label: SUPPORT_TOPIC_LABELS[key] || key, conversations }))
    .sort((a, b) => b.conversations - a.conversations);

  const count = (list, key) => list.reduce((m, x) => addTo(m, x[key] || "other", 1), {});
  const sims = tickets.filter((t) => t.feedbackAt && t.similarity != null);

  return {
    convos,
    truncated: sessions.length >= MAX_SESSIONS,
    overview: {
      conversations: n,
      messages: convos.reduce((t, s) => t + (s.messageCount || 0), 0),
      handoffs,
      containment: n ? (n - handoffs) / n : null,
      ratingUp: up,
      ratingDown: down,
      satisfaction: up + down ? up / (up + down) : null,
      inputTokens: tracked.reduce((t, s) => t + (s.inputTokens || 0), 0),
      outputTokens: tracked.reduce((t, s) => t + (s.outputTokens || 0), 0),
      costUsd: priced.length ? cost : null,
      costPerConversation: priced.length ? cost / priced.length : null,
      usageTracked: tracked.length,
      usageUntracked: n - tracked.length,
      byModel,
      unpricedModels,
      conversion: ratio(ordered.length, n),
    },
    funnel: {
      conversations: n,
      productsShown: convos.filter((s) => s.productsShown).length,
      addedToCart: convos.filter((s) => s.addedToCart).length,
      checkoutClicked: convos.filter((s) => s.checkoutClickedAt).length,
      ordered: ordered.length,
      direct: direct.length,
      assisted: assisted.length,
      directRevenue: revenue(direct),
      assistedRevenue: revenue(assisted),
    },
    sales,
    support: {
      handoffs,
      openHandoffs: convos.filter((s) => s.needsHuman).length,
      flagged: sessions.filter((s) => s.flagged).length,
      conversations: supportChats.length,
      topics,
      safety: count(safety, "kind"),
      tickets: count(tickets, "action"),
      ticketEditRate: sims.length ? sims.filter((t) => t.similarity < 0.9).length / sims.length : null,
      ticketFeedback: sims.length,
    },
  };
}
