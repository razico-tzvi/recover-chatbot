import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { API_EXPIRY_DAYS, API_MAX_KEYS, API_SCOPES } from "../../api/lib/defaults";
import { Alert, Btn, Card, Field, Loading, Modal, Tag, type Tone } from "../components/ui";

type Key = {
  id: string; label: string; prefix: string; scopes: string[];
  createdAt: string; expiresAt: string | null; lastUsedAt: string | null; revokedAt: string | null;
  state: "active" | "expired" | "revoked";
};
type Result = { ok: boolean; message?: string };

// @ts-ignore — global action
const call = (op: string, args: Record<string, unknown> = {}) => api.apiAdmin({ op, ...args }) as Promise<any>;

const date = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const STATE: Record<Key["state"], { tone: Tone; label: string }> = {
  active: { tone: "good", label: "Active" },
  expired: { tone: "warn", label: "Expired" },
  revoked: { tone: "crit", label: "Revoked" },
};
const scopeLabel = (k: string) => API_SCOPES.find((s) => s.key === k)?.label || k;

export const ApiPage = () => {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Result | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [revoking, setRevoking] = useState<Key | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await call("list");
      setKeys(r.keys);
      setError(null);
    } catch (e: any) {
      setError(e?.message || "Couldn't load API keys.");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const op = async (name: string, args: Record<string, unknown>, id: string) => {
    setBusy(id);
    try {
      const r = await call(name, args);
      setNotice(r);
      await load();
      return r;
    } catch (e: any) {
      setNotice({ ok: false, message: e?.message || "Something went wrong." });
    } finally {
      setBusy(null);
    }
  };

  const base = typeof window !== "undefined" ? window.location.origin : "";
  const active = keys?.filter((k) => k.state === "active").length ?? 0;

  return (
    <>
      <Card
        title="API keys"
        sub={`Read-only REST access to this store's data. Each key is labeled, limited to the resources you pick and can expire. Up to ${API_MAX_KEYS} active keys.`}
        action={<Btn primary onClick={() => setCreating(true)} disabled={active >= API_MAX_KEYS}>New API key</Btn>}
      >
        {error && <Alert tone="crit">{error}</Alert>}
        {notice && <Alert tone={notice.ok ? "good" : "crit"}>{notice.message}</Alert>}
        {!keys && !error && <Loading />}
        {keys && keys.length === 0 && <p className="hint">No keys yet. Create one for each system that reads from the chatbot (BI dashboard, data warehouse, Zapier…), so you can revoke them one at a time.</p>}
        {keys && keys.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Label</th><th>Key</th><th>Scopes</th><th>Created</th><th>Expires</th><th>Last used</th><th>Status</th><th /></tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td><b>{k.label}</b></td>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{k.prefix}…</td>
                    <td>{k.scopes.map(scopeLabel).join(", ")}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{date(k.createdAt)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{k.expiresAt ? date(k.expiresAt) : "Never"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{k.lastUsedAt ? date(k.lastUsedAt) : "Never"}</td>
                    <td><Tag tone={STATE[k.state].tone}>{STATE[k.state].label}</Tag></td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {k.state === "active"
                        ? <Btn small danger onClick={() => setRevoking(k)}>Revoke</Btn>
                        : <Btn small loading={busy === k.id} onClick={() => op("delete", { keyId: k.id }, k.id)}>Remove</Btn>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Endpoints" sub="Every endpoint is GET, returns JSON and only ever returns this store's data. Shopper IPs, API keys and other secrets are never returned.">
        <p className="hint" style={{ marginTop: 0 }}>Send the key as a bearer token:</p>
        <pre className="codebox mono">{`curl ${base}/v1/conversations?limit=20 \\\n  -H "Authorization: Bearer rak_…"`}</pre>
        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Scope</th><th>Endpoint</th><th>Returns</th></tr></thead>
            <tbody>
              <tr><td>any key</td><td className="mono">GET /v1/me</td><td>The key's label, scopes, expiry and store</td></tr>
              {API_SCOPES.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td className="mono">{s.endpoints.map((e) => <div key={e}>{e}</div>)}</td>
                  <td>{s.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ghead" style={{ marginTop: 18 }}>Lists</div>
        <p className="hint" style={{ marginTop: 0 }}>
          Conversations, feedback and safety events are newest first. Query: <span className="mono">limit</span> (1–200, default 50),{" "}
          <span className="mono">since</span> / <span className="mono">until</span> (ISO dates), and <span className="mono">cursor</span> — pass the
          previous response's <span className="mono">nextCursor</span> to get the next page (<span className="mono">null</span> = last page).
          Conversations also take <span className="mono">needsHuman=true</span>, <span className="mono">flagged=true</span>, <span className="mono">converted=true</span>;
          feedback takes <span className="mono">source=ratings|crm</span>; safety events take <span className="mono">kind</span>; analytics takes{" "}
          <span className="mono">days</span> (1–90).
        </p>
        <div className="ghead">Errors</div>
        <p className="hint" style={{ marginTop: 0 }}>
          <span className="mono">401</span> missing, invalid, expired or revoked key · <span className="mono">403</span> the key lacks that scope ·{" "}
          <span className="mono">400</span> bad query · <span className="mono">404</span> unknown conversation. The body is <span className="mono">{`{"error": "…"}`}</span>.
        </p>
      </Card>

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreate={async (args) => {
            const r = await op("create", args, "create");
            if (r?.ok) {
              setCreating(false);
              setSecret({ label: String(args.label), value: r.key });
            }
          }}
          busy={busy === "create"}
          error={notice && !notice.ok ? notice.message : undefined}
        />
      )}

      {secret && <SecretModal {...secret} onClose={() => setSecret(null)} />}

      {revoking && (
        <Modal
          title="Revoke API key?"
          sub={`"${revoking.label}" (${revoking.prefix}…) stops working immediately. Anything using it gets 401 from then on. This can't be undone.`}
          onClose={() => setRevoking(null)}
          footer={<Btn danger loading={busy === revoking.id} onClick={async () => { await op("revoke", { keyId: revoking.id }, revoking.id); setRevoking(null); }}>Revoke key</Btn>}
        >
          {null}
        </Modal>
      )}
    </>
  );
};

function CreateModal({ onClose, onCreate, busy, error }: {
  onClose: () => void;
  onCreate: (args: { label: string; scopes: string[]; expiresInDays: number }) => void;
  busy: boolean;
  error?: string;
}) {
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const toggle = (k: string) => setScopes((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <Modal
      title="New API key"
      sub="Give each integration its own key with only the resources it needs."
      onClose={onClose}
      footer={<Btn primary loading={busy} disabled={!label.trim() || !scopes.length} onClick={() => onCreate({ label: label.trim(), scopes, expiresInDays: days })}>Create key</Btn>}
    >
      {error && <Alert tone="crit">{error}</Alert>}
      <Field label="Label" htmlFor="k-label" hint="Where the key is used, e.g. “Looker dashboard”.">
        <input type="text" id="k-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Expires" htmlFor="k-exp">
        <select id="k-exp" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {API_EXPIRY_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
          <option value={0}>Never</option>
        </select>
      </Field>
      <div className="ghead" style={{ marginTop: 14 }}>Can read</div>
      {API_SCOPES.map((s) => (
        <label key={s.key} className="frow" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={scopes.includes(s.key)} onChange={() => toggle(s.key)} />
          <span className="name">{s.label}<div className="desc">{s.hint}</div></span>
        </label>
      ))}
    </Modal>
  );
}

function SecretModal({ label, value: secret, onClose }: { label: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal
      title={`Key created: ${label}`}
      sub="Copy it now and store it somewhere safe — it is shown only once. If you lose it, revoke it and create a new one."
      onClose={onClose}
      footer={<Btn primary onClick={copy}>{copied ? "Copied" : "Copy key"}</Btn>}
    >
      <pre className="codebox mono" style={{ wordBreak: "break-all" }}>{secret}</pre>
    </Modal>
  );
}
