import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { downloadRows } from "../lib/download";
import { Alert, Btn, Card, Loading, Seg, Tag } from "../components/ui";

type Daily = { day: string; conversations: number; handoffs: number; conversions: number };
type Data = {
  days: number;
  truncated: boolean;
  ordersSyncedAt: string | null;
  syncError: string | null;
  overview: {
    conversations: number; messages: number; handoffs: number; containment: number | null;
    ratingUp: number; ratingDown: number; satisfaction: number | null;
    inputTokens: number; outputTokens: number; costUsd: number | null; costPerConversation: number | null;
    unpricedModels: string[];
  };
  funnel: {
    conversations: number; productsShown: number; addedToCart: number; direct: number; assisted: number;
    directRevenue: Record<string, number>; assistedRevenue: Record<string, number>;
  };
  support: {
    handoffs: number; openHandoffs: number; flagged: number;
    safety: Record<string, number>; tickets: Record<string, number>;
    ticketEditRate: number | null; ticketFeedback: number;
  };
  daily: Daily[];
};

const RANGES = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const num = (v: number) => v.toLocaleString();
const compact = (v: number) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v);
const usd = (v: number | null) =>
  v == null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: v < 1 ? 3 : 2 }).format(v);
export function money(byCurrency: Record<string, number>) {
  const parts = Object.entries(byCurrency).filter(([, v]) => v > 0);
  if (!parts.length) return "—";
  return parts
    .map(([cur, v]) => {
      try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || "USD", maximumFractionDigits: 0 }).format(v); }
      catch { return `${Math.round(v).toLocaleString()} ${cur}`; }
    })
    .join(" + ");
}
const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { ...opts, timeZone: "UTC" });

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
  skipped: "Skipped",
  error: "Errors",
};

export const AnalyticsPage = () => {
  const [days, setDays] = useState("30");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (syncOrders = false) => {
    setError(null);
    if (syncOrders) setSyncing(true); else setLoading(true);
    try {
      // @ts-ignore — global action
      setData(await api.getAnalytics({ days: Number(days), syncOrders }));
    } catch (e: any) {
      setError(e?.message || "Couldn't load analytics.");
    }
    setLoading(false); setSyncing(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="pills">
        <Seg name="range" label="Date range" value={days} options={RANGES} onChange={setDays} />
        <div className="spacer" />
        {data && (
          <span className="hint" style={{ marginTop: 0 }}>
            {data.ordersSyncedAt ? `Orders checked ${new Date(data.ordersSyncedAt).toLocaleString()}` : "Orders not checked yet"}
          </span>
        )}
        <Btn small loading={syncing} disabled={loading} onClick={() => load(true)}>Check orders now</Btn>
        <Btn small disabled={!data} onClick={() => data && downloadRows(`analytics-daily-${data.days}d`, "csv", data.daily, ["day", "conversations", "handoffs", "conversions"])}>
          Export CSV
        </Btn>
      </div>

      {error && <Alert tone="crit">{error}</Alert>}
      {data?.syncError && <Alert tone="warn">{`Couldn't read orders from BigCommerce: ${data.syncError}`}</Alert>}
      {data?.truncated && <Alert tone="info">Showing the most recent 20,000 conversations in this range.</Alert>}
      {loading && !data && <Loading />}
      {data && (
        <div style={{ opacity: loading ? 0.6 : 1, transition: "opacity .15s" }}>
          <Overview d={data} />
          <DailyChart daily={data.daily} />
          <Funnel f={data.funnel} />
          <Card title={<span className="row">Incentive A/B results <Tag tone="info">Coming soon</Tag></span>}>
            <p className="hint" style={{ marginTop: 6 }}>
              Conversion with vs. without the closing incentive appears here once the incentive ships (Features → Closing incentive).
            </p>
          </Card>
          <Support s={data.support} />
        </div>
      )}
    </>
  );
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="hint">{sub}</div>}
    </div>
  );
}

function Overview({ d }: { d: Data }) {
  const o = d.overview;
  const f = d.funnel;
  const conversions = f.direct + f.assisted;
  return (
    <Card title="Overview" sub={`Last ${d.days} days. A conversation counts once the shopper sends a message.`}>
      <div className="stats">
        <Stat label="Conversations" value={num(o.conversations)} sub={`${num(o.messages)} messages`} />
        <Stat label="Containment" value={pct(o.containment)} sub={`${num(o.handoffs)} handed to a human`} />
        <Stat
          label="Satisfaction"
          value={pct(o.satisfaction)}
          sub={o.ratingUp + o.ratingDown ? `👍 ${num(o.ratingUp)} · 👎 ${num(o.ratingDown)}` : "No ratings yet"}
        />
        <Stat
          label="AI cost"
          value={usd(o.costUsd)}
          sub={`${o.costPerConversation != null ? `${usd(o.costPerConversation)} / chat · ` : ""}${compact(o.inputTokens)} in · ${compact(o.outputTokens)} out tokens`}
        />
        <Stat
          label="Conversion"
          value={pct(f.conversations ? conversions / f.conversations : null)}
          sub={`${num(f.direct)} direct · ${num(f.assisted)} assisted`}
        />
      </div>
      {o.unpricedModels.length > 0 && (
        <p className="hint" style={{ marginTop: 10 }}>{`No list price for ${o.unpricedModels.join(", ")}, so those chats show tokens only.`}</p>
      )}
    </Card>
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

function Funnel({ f }: { f: Data["funnel"] }) {
  const base = f.conversations;
  const steps = [
    { label: "Conversations", value: f.conversations },
    { label: "Saw products", value: f.productsShown, note: "the bot searched, showed or compared products" },
    { label: "Added to cart in chat", value: f.addedToCart },
    { label: "Ordered", value: f.direct + f.assisted, note: "direct + assisted" },
  ];
  return (
    <Card
      title="Sales funnel"
      sub="Orders are matched to chats by cart: direct when the shopper checks out the cart the bot built, assisted when they order from their own cart within 7 days of chatting."
    >
      {steps.map((s) => (
        <div className="fstep" key={s.label}>
          <div className="fname">
            {s.label}
            {s.note && <span className="desc">{` · ${s.note}`}</span>}
          </div>
          <div className="fbar"><i style={{ width: `${base ? (s.value / base) * 100 : 0}%` }} /></div>
          <div className="fval">
            <b>{num(s.value)}</b> <span className="desc">{base ? pct(s.value / base) : "—"}</span>
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

function Support({ s }: { s: Data["support"] }) {
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
