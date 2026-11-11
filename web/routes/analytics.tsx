import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { downloadRows } from "../lib/download";
import { Alert, Btn, Card, Loading, Seg, Switch, Tag } from "../components/ui";

type Money = Record<string, number>;
type Daily = { day: string; conversations: number; handoffs: number; conversions: number };
type ModelRow = { model: string; conversations: number; inputTokens: number; outputTokens: number; costUsd: number | null; costPerConversation: number | null };
type Overview = {
  conversations: number; messages: number; handoffs: number; containment: number | null;
  ratingUp: number; ratingDown: number; satisfaction: number | null;
  inputTokens: number; outputTokens: number; costUsd: number | null; costPerConversation: number | null;
  usageTracked: number; usageUntracked: number; byModel: ModelRow[]; unpricedModels: string[]; conversion: number | null;
};
type Funnel = {
  conversations: number; productsShown: number; addedToCart: number; checkoutClicked: number; ordered: number;
  direct: number; assisted: number; directRevenue: Money; assistedRevenue: Money;
};
type Sales = {
  orders: number; revenue: Money; ordersByCurrency: Money; aov: Money; currency: string | null;
  site: null | { orders: number; ordersByCurrency: Money; revenue: Money; currency: string | null; aov: Money; daysCovered: number; daysInRange: number; coveredFrom: string };
  revenueShare: number | null; orderShare: number | null;
  coupons: { conversations: number; conversationsApplied: number; applied: number; rejected: number; discount: Money; codes?: { code: string; applied: number; rejected: number }[] };
  shipping: { conversations: number; estimates: number };
  topProducts?: { id: number; name: string | null; conversations: number; orders: number }[];
  faqGaps?: { question: string; count: number; lastAskedAt: string }[];
};
type Support = {
  handoffs: number; openHandoffs: number; flagged: number; conversations: number;
  topics: { key: string; label: string; conversations: number }[];
  safety: Record<string, number>; tickets: Record<string, number>;
  ticketEditRate: number | null; ticketFeedback: number;
};
type Period = { overview: Overview; funnel: Funnel; sales: Sales; support: Support };
type Data = Period & {
  days: number; from: string; to: string;
  truncated: boolean;
  ordersSyncedAt: string | null;
  syncError: string | null;
  daily: Daily[];
  compare: (Period & { from: string; to: string; truncated: boolean }) | null;
};

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "custom", label: "Custom" },
];

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num = (v: number) => v.toLocaleString();
const compact = (v: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
const usd = (v: number | null) =>
  v == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 3 : 2 }).format(v);
function cash(v: number | null | undefined, cur: string | null, digits = 0) {
  if (v == null) return "—";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD", maximumFractionDigits: digits }).format(v); }
  catch { return `${v.toLocaleString(undefined, { maximumFractionDigits: digits })} ${cur || ""}`.trim(); }
}
export function money(byCurrency: Money) {
  const parts = Object.entries(byCurrency || {}).filter(([, v]) => v > 0);
  if (!parts.length) return "—";
  return parts.map(([cur, v]) => cash(v, cur)).join(" + ");
}
const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });
const fmtRange = (from: string, to: string) => (from === to ? fmtDay(from, { month: "short", day: "numeric", year: "numeric" }) : `${fmtDay(from)} – ${fmtDay(to, { month: "short", day: "numeric", year: "numeric" })}`);
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

// Change vs. the comparison period. `higherIsBetter` colors it; null = neutral.
type Cmp = { prev: number | null | undefined; higherIsBetter?: boolean | null; points?: boolean };
function Delta({ cur, cmp }: { cur: number | null | undefined; cmp?: Cmp }) {
  if (!cmp) return null;
  const { prev, higherIsBetter = true, points } = cmp;
  if (cur == null || prev == null) return <div className="delta flat">— vs previous</div>;
  let text: string;
  let diff: number;
  if (points) {
    diff = (cur - prev) * 100;
    text = `${diff > 0 ? "+" : ""}${Math.round(diff)} pts`;
  } else if (prev === 0) {
    diff = cur;
    text = cur === 0 ? "no change" : "new";
  } else {
    diff = (cur - prev) / prev;
    text = `${diff > 0 ? "+" : ""}${Math.round(diff * 100)}%`;
  }
  const flat = Math.abs(diff) < 1e-9 || higherIsBetter == null;
  const tone = flat ? "flat" : (diff > 0) === higherIsBetter ? "good" : "bad";
  return <div className={`delta ${tone}`}>{`${diff > 0 ? "▲" : diff < 0 ? "▼" : "•"} ${text} vs previous`}</div>;
}

const SAFETY_LABELS: Record<string, string> = {
  rate_limit: "Rate-limit hits",
  verify_fail: "Failed order verifications",
  lockout: "Order-lookup lockouts",
  flag: "Flagged conversations",
  blocked_topic: "Blocked-topic chat messages",
};
const TICKET_LABELS: Record<string, string> = {
  drafted: "Drafted (private note)",
  replied: "Answered (public reply)",
  blocked: "Blocked topic",
  human: "Asked for a person",
  skipped: "Skipped",
  error: "Errors",
};

export const AnalyticsPage = () => {
  const today = isoDay(Date.now());
  const [preset, setPreset] = useState("30");
  const [from, setFrom] = useState(isoDay(Date.now() - 29 * 864e5));
  const [to, setTo] = useState(today);
  const [compare, setCompare] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customOk = preset !== "custom" || (!!from && !!to && from <= to);
  const load = useCallback(async (syncOrders = false) => {
    if (!customOk) return;
    setError(null);
    if (syncOrders) setSyncing(true); else setLoading(true);
    try {
      const range = preset === "custom" ? { from, to } : { days: Number(preset) };
      // @ts-ignore — global action
      setData(await api.getAnalytics({ ...range, compare, syncOrders }));
    } catch (e: any) {
      setError(e?.message || "Couldn't load analytics.");
    }
    setLoading(false); setSyncing(false);
  }, [preset, from, to, compare, customOk]);

  useEffect(() => { load(); }, [load]);

  const c = data?.compare || null;
  return (
    <>
      <div className="pills">
        <div className="range">
          <Seg name="range" label="Date range" value={preset} options={RANGES} onChange={setPreset} />
          {preset === "custom" && (
            <>
              <input type="date" aria-label="From" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
              <span className="desc">to</span>
              <input type="date" aria-label="To" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
            </>
          )}
          <label className="switchlabel">
            <Switch checked={compare} onChange={() => setCompare(!compare)} label="Compare to previous period" />
            Compare to previous period
          </label>
        </div>
        <div className="spacer" />
        {data && (
          <span className="hint" style={{ marginTop: 0 }}>
            {data.ordersSyncedAt ? `Orders checked ${new Date(data.ordersSyncedAt).toLocaleString()}` : "Orders not checked yet"}
          </span>
        )}
        <Btn small loading={syncing} disabled={loading} onClick={() => load(true)}>Check orders now</Btn>
        <Btn small disabled={!data} onClick={() => data && downloadRows(`analytics-daily-${data.from}-to-${data.to}`, "csv", data.daily, ["day", "conversations", "handoffs", "conversions"])}>
          Export CSV
        </Btn>
      </div>

      {!customOk && <Alert tone="warn">Pick a start date on or before the end date.</Alert>}
      {error && <Alert tone="crit">{error}</Alert>}
      {data?.syncError && <Alert tone="warn">{`Couldn't read orders from BigCommerce: ${data.syncError}`}</Alert>}
      {data?.truncated && <Alert tone="info">Showing the most recent 20,000 conversations in this range.</Alert>}
      {loading && !data && <Loading />}
      {data && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <Overview d={data} c={c} />
          <DailyChart daily={data.daily} />
          <FunnelCard f={data.funnel} c={c?.funnel} />
          <SalesCard s={data.sales} c={c?.sales} />
          <div className="grid2">
            <TopProducts rows={data.sales.topProducts || []} />
            <CouponsShipping s={data.sales} c={c?.sales} />
          </div>
          <FaqGaps rows={data.sales.faqGaps || []} />
          <Card title={<span className="row">Incentive A/B results <Tag tone="info">Coming soon</Tag></span>}>
            <p className="hint" style={{ marginTop: 6 }}>
              Conversion with vs. without the closing incentive appears here once the incentive ships (Features → Closing incentive).
            </p>
          </Card>
          <SupportTopics s={data.support} c={c?.support} />
          <Support s={data.support} />
        </div>
      )}
    </>
  );
};

function Stat({ label, value, sub, cur, cmp }: { label: string; value: string; sub?: string; cur?: number | null; cmp?: Cmp }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {cmp && <Delta cur={cur} cmp={cmp} />}
      {sub && <div className="hint">{sub}</div>}
    </div>
  );
}

function rangeSub(d: Data) {
  const base = `${fmtRange(d.from, d.to)} (UTC).`;
  return d.compare ? `${base} Compared with ${fmtRange(d.compare.from, d.compare.to)}.` : base;
}

function costSub(o: Overview) {
  if (!o.usageTracked && o.usageUntracked) {
    return `No token usage recorded for ${num(o.usageUntracked)} chat${o.usageUntracked === 1 ? "" : "s"} — they predate cost tracking.`;
  }
  const per = o.costPerConversation != null ? `${usd(o.costPerConversation)} / chat · ` : "";
  const untracked = o.usageUntracked ? ` · ${num(o.usageUntracked)} older chats untracked` : "";
  return `${per}${compact(o.inputTokens)} in · ${compact(o.outputTokens)} out tokens${untracked}`;
}

function Overview({ d, c }: { d: Data; c: Data["compare"] }) {
  const o = d.overview;
  const f = d.funnel;
  const p = c?.overview;
  const on = !!c;
  return (
    <Card title="Overview" sub={`${rangeSub(d)} A conversation counts once the shopper sends a message.`}>
      <div className="stats">
        <Stat label="Conversations" value={num(o.conversations)} sub={`${num(o.messages)} messages`} cur={o.conversations} cmp={on ? { prev: p?.conversations } : undefined} />
        <Stat label="Containment" value={pct(o.containment)} sub={`${num(o.handoffs)} handed to a human`} cur={o.containment} cmp={on ? { prev: p?.containment, points: true } : undefined} />
        <Stat
          label="Satisfaction"
          value={pct(o.satisfaction)}
          sub={o.ratingUp + o.ratingDown ? `👍 ${num(o.ratingUp)} · 👎 ${num(o.ratingDown)}` : "No ratings yet"}
          cur={o.satisfaction}
          cmp={on ? { prev: p?.satisfaction, points: true } : undefined}
        />
        <Stat label="AI cost" value={usd(o.costUsd)} sub={costSub(o)} cur={o.costPerConversation} cmp={on ? { prev: p?.costPerConversation, higherIsBetter: false } : undefined} />
        <Stat
          label="Conversion"
          value={pct(o.conversion)}
          sub={`${num(f.direct)} direct · ${num(f.assisted)} assisted`}
          cur={o.conversion}
          cmp={on ? { prev: p?.conversion, points: true } : undefined}
        />
      </div>
      {on && <p className="hint" style={{ marginTop: 8 }}>The AI cost change compares cost per conversation.</p>}
      <CostByModel rows={o.byModel} />
      {o.unpricedModels.length > 0 && (
        <p className="hint" style={{ marginTop: 10 }}>{`No list price for ${o.unpricedModels.join(", ")}, so those chats show tokens only.`}</p>
      )}
    </Card>
  );
}

function CostByModel({ rows }: { rows: ModelRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="tablewrap" style={{ marginTop: 14 }}>
      <table>
        <thead>
          <tr>
            <th>Model</th><th className="num">Chats</th><th className="num">Tokens in</th><th className="num">Tokens out</th>
            <th className="num">Tokens / chat</th><th className="num">Cost</th><th className="num">Cost / chat</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.model}>
              <td className="mono">{m.model}</td>
              <td className="num">{num(m.conversations)}</td>
              <td className="num">{compact(m.inputTokens)}</td>
              <td className="num">{compact(m.outputTokens)}</td>
              <td className="num">{m.conversations ? compact((m.inputTokens + m.outputTokens) / m.conversations) : "—"}</td>
              <td className="num">{usd(m.costUsd)}</td>
              <td className="num">{usd(m.costPerConversation)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Single-series column chart: one column per day, hover/focus for the day's numbers.
function DailyChart({ daily }: { daily: Daily[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...daily.map((r) => r.conversations));
  const h = hover != null ? daily[hover] : null;
  const tickEvery = daily.length > 31 ? 14 : daily.length > 7 ? 7 : 1;
  return (
    <Card
      title="Conversations per day"
      sub={h ? `${fmtDay(h.day, { weekday: "short", month: "short", day: "numeric" })}: ${num(h.conversations)} conversations · ${num(h.handoffs)} handoffs · ${num(h.conversions)} orders` : "Hover a day for its numbers. Days are UTC."}
      action={<Btn small onClick={() => setTable(!table)}>{table ? "Show chart" : "Show table"}</Btn>}
    >
      {table ? (
        <div className="tablewrap" style={{ maxHeight: 320, overflowY: "auto" }}>
          <table>
            <thead><tr><th>Day</th><th className="num">Conversations</th><th className="num">Handoffs</th><th className="num">Orders</th></tr></thead>
            <tbody>
              {[...daily].reverse().map((r) => (
                <tr key={r.day}><td>{fmtDay(r.day)}</td><td className="num">{r.conversations}</td><td className="num">{r.handoffs}</td><td className="num">{r.conversions}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="colchart">
          <div className="ymax">{num(max)}</div>
          <div className="cols" role="img" aria-label={`Conversations per day, peak ${max}`} onMouseLeave={() => setHover(null)}>
            {daily.map((r, i) => (
              <div
                key={r.day}
                className={hover === i ? "col on" : "col"}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${fmtDay(r.day)}: ${r.conversations} conversations`}
              >
                <i style={{ height: `${(r.conversations / max) * 100}%` }} />
              </div>
            ))}
          </div>
          <div className="xaxis">
            {daily.map((r, i) => (
              <span key={r.day}>{(daily.length - 1 - i) % tickEvery === 0 ? fmtDay(r.day) : ""}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function FunnelCard({ f, c }: { f: Funnel; c?: Funnel }) {
  const base = f.conversations;
  const steps = [
    { label: "Conversations", value: f.conversations, prev: c?.conversations },
    { label: "Saw products", value: f.productsShown, prev: c?.productsShown, note: "the bot searched, showed or compared products" },
    { label: "Added to cart in chat", value: f.addedToCart, prev: c?.addedToCart },
    { label: "Checkout link clicked", value: f.checkoutClicked, prev: c?.checkoutClicked, note: "clicked a cart or checkout link in a bot reply" },
    { label: "Ordered", value: f.ordered, prev: c?.ordered, note: "direct + assisted" },
  ];
  return (
    <Card
      title="Sales funnel"
      sub="Orders are matched to chats by cart: direct when the shopper checks out the cart the bot built, assisted when they order from their own cart within 7 days of chatting (so an order needn't follow a link click)."
    >
      {steps.map((s) => (
        <div className="fstep" key={s.label}>
          <div className="fname">
            {s.label}
            {s.note && <span className="desc">{` · ${s.note}`}</span>}
          </div>
          <div className="fbar"><i style={{ width: `${base ? Math.min(100, (s.value / base) * 100) : 0}%` }} /></div>
          <div className="fval">
            <b>{num(s.value)}</b> <span className="desc">{base ? pct(s.value / base) : "—"}</span>
            {c && <span className="desc">{` · prev ${num(s.prev || 0)}`}</span>}
          </div>
        </div>
      ))}
      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="kv"><span className="desc">Direct orders</span><b>{`${num(f.direct)} · ${money(f.directRevenue)}`}</b></div>
        <div className="kv"><span className="desc">Assisted orders</span><b>{`${num(f.assisted)} · ${money(f.assistedRevenue)}`}</b></div>
      </div>
    </Card>
  );
}

function SalesCard({ s, c }: { s: Sales; c?: Sales }) {
  const cur = s.currency;
  const site = s.site;
  const chatAov = cur != null ? s.aov[cur] ?? null : null;
  const siteAov = cur != null && site ? site.aov[cur] ?? null : null;
  const lift = chatAov != null && siteAov ? chatAov / siteAov - 1 : null;
  const on = !!c;
  const pcur = c?.currency ?? cur;
  let coverage: string | null = null;
  if (!site) coverage = "The site baseline starts with the next order check (hourly, or Check orders now).";
  else if (site.daysCovered < site.daysInRange) coverage = `Site orders are only recorded from ${fmtDay(site.coveredFrom, { month: "short", day: "numeric", year: "numeric" })}, so the baseline covers ${site.daysCovered} of ${site.daysInRange} days.`;
  return (
    <Card
      title="Chat-assisted revenue"
      sub="Revenue and average order value of orders credited to chats (direct + assisted, by conversation start date) against every order on the store in the same days."
    >
      <div className="stats">
        <Stat
          label="Chat revenue"
          value={money(s.revenue)}
          sub={s.revenueShare != null ? `${pct(s.revenueShare)} of site revenue (${money(site?.revenue || {})})` : "Site revenue not available yet"}
          cur={cur != null ? s.revenue[cur] || 0 : null}
          cmp={on ? { prev: pcur != null ? c?.revenue[pcur] || 0 : null } : undefined}
        />
        <Stat
          label="Chat orders"
          value={num(s.orders)}
          sub={s.orderShare != null ? `${pct(s.orderShare)} of ${num(site?.orders || 0)} site orders` : "Site orders not available yet"}
          cur={s.orders}
          cmp={on ? { prev: c?.orders } : undefined}
        />
        <Stat
          label="Chat AOV"
          value={cash(chatAov, cur, 2)}
          sub={lift != null ? `${lift >= 0 ? "+" : ""}${Math.round(lift * 100)}% vs site` : "No chat orders yet"}
          cur={chatAov}
          cmp={on ? { prev: pcur != null ? c?.aov[pcur] ?? null : null } : undefined}
        />
        <Stat
          label="Site AOV"
          value={cash(siteAov, cur, 2)}
          sub="All store orders (baseline)"
          cur={siteAov}
          cmp={on ? { prev: pcur != null ? c?.site?.aov[pcur] ?? null : null, higherIsBetter: null } : undefined}
        />
      </div>
      {coverage && <p className="hint" style={{ marginTop: 10 }}>{coverage}</p>}
    </Card>
  );
}

function TopProducts({ rows }: { rows: NonNullable<Sales["topProducts"]> }) {
  return (
    <Card title="Top products asked about" sub="Products the bot looked up (details, reviews, related, compare) or added to a cart, by number of chats.">
      {rows.length === 0 ? (
        <p className="hint">No product questions in this range.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Product</th><th className="num">Chats</th><th className="num">Ordered</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="wrap">{p.name || `Product #${p.id}`}</td>
                  <td className="num">{num(p.conversations)}</td>
                  <td className="num">{`${num(p.orders)} · ${pct(p.conversations ? p.orders / p.conversations : null)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CouponsShipping({ s, c }: { s: Sales; c?: Sales }) {
  const k = s.coupons;
  const codes = k.codes || [];
  const on = !!c;
  return (
    <Card title="Coupons & shipping estimates">
      <div className="stats">
        <Stat
          label="Coupons applied"
          value={num(k.applied)}
          sub={`${num(k.conversationsApplied)} chats · ${num(k.rejected)} rejected · ${money(k.discount)} off`}
          cur={k.applied}
          cmp={on ? { prev: c?.coupons.applied } : undefined}
        />
        <Stat
          label="Shipping estimates"
          value={num(s.shipping.estimates)}
          sub={`given in ${num(s.shipping.conversations)} chats`}
          cur={s.shipping.estimates}
          cmp={on ? { prev: c?.shipping.estimates } : undefined}
        />
      </div>
      {codes.length > 0 && (
        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Code</th><th className="num">Applied</th><th className="num">Rejected</th></tr></thead>
            <tbody>
              {codes.map((r) => (
                <tr key={r.code}><td className="mono">{r.code}</td><td className="num">{num(r.applied)}</td><td className="num">{num(r.rejected)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function FaqGaps({ rows }: { rows: NonNullable<Sales["faqGaps"]> }) {
  return (
    <Card
      title="Asked but unanswered"
      sub="FAQ gap list: questions the FAQ had no section for, or that the bot said it couldn't answer. Add the answers in Context › FAQ."
      action={rows.length ? <Btn small onClick={() => downloadRows("faq-gaps", "csv", rows, ["question", "count", "lastAskedAt"])}>Export CSV</Btn> : undefined}
    >
      {rows.length === 0 ? (
        <p className="hint">No unanswered questions in this range.</p>
      ) : (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Question</th><th className="num">Times</th><th className="num">Last asked</th></tr></thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.question + g.lastAskedAt}>
                  <td className="wrap">{g.question}</td>
                  <td className="num">{num(g.count)}</td>
                  <td className="num">{new Date(g.lastAskedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function SupportTopics({ s, c }: { s: Support; c?: Support }) {
  const max = Math.max(1, ...s.topics.map((t) => t.conversations));
  const prev = new Map((c?.topics || []).map((t) => [t.key, t.conversations]));
  return (
    <Card
      title="Support topics"
      sub={`${num(s.conversations)} support conversations${c ? ` (previous: ${num(c.conversations)})` : ""}. Topics come from the shopper's words and the tools the bot used; a chat can count under more than one.`}
    >
      {s.topics.length === 0 ? (
        <p className="hint">No support conversations in this range.</p>
      ) : (
        s.topics.map((t) => (
          <div className="fstep" key={t.key}>
            <div className="fname">{t.label}</div>
            <div className="fbar"><i style={{ width: `${(t.conversations / max) * 100}%` }} /></div>
            <div className="fval">
              <b>{num(t.conversations)}</b> <span className="desc">{pct(s.conversations ? t.conversations / s.conversations : null)}</span>
              {c && <span className="desc">{` · prev ${num(prev.get(t.key) || 0)}`}</span>}
            </div>
          </div>
        ))
      )}
    </Card>
  );
}

function Support({ s }: { s: Support }) {
  const safety = Object.entries(SAFETY_LABELS).map(([k, label]) => [label, s.safety[k] || 0] as const);
  const otherSafety = Object.entries(s.safety).filter(([k]) => !SAFETY_LABELS[k]).reduce((t, [, v]) => t + v, 0);
  const tickets = Object.entries(s.tickets);
  return (
    <div className="grid2">
      <Card title="Support">
        <Row label="Handoffs to a human" value={s.handoffs} />
        <Row label="Handoffs still open" value={s.openHandoffs} tone={s.openHandoffs ? "warn" : undefined} />
        {tickets.length === 0 ? (
          <p className="hint" style={{ paddingTop: 10 }}>No CRM tickets handled in this range.</p>
        ) : (
          <>
            {tickets.map(([k, v]) => <Row key={k} label={`CRM tickets · ${TICKET_LABELS[k] || k}`} value={v} />)}
            <Row
              label="Drafts the agent edited"
              text={s.ticketFeedback ? `${pct(s.ticketEditRate)} of ${num(s.ticketFeedback)}` : "—"}
            />
          </>
        )}
      </Card>
      <Card title="Safety">
        <Row label="Flagged conversations" value={s.flagged} tone={s.flagged ? "crit" : undefined} />
        {safety.filter(([label]) => label !== SAFETY_LABELS.flag).map(([label, v]) => <Row key={label} label={label} value={v} />)}
        {otherSafety > 0 && <Row label="Other events" value={otherSafety} />}
      </Card>
    </div>
  );
}

function Row({ label, value, text, tone }: { label: string; value?: number; text?: string; tone?: "warn" | "crit" }) {
  const shown = text ?? num(value || 0);
  return (
    <div className="kvrow">
      <span>{label}</span>
      {tone ? <Tag tone={tone}>{shown}</Tag> : <b>{shown}</b>}
    </div>
  );
}
