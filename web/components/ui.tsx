import { useEffect, type ReactNode } from "react";

// Small building blocks for the admin's look (classes live in web/app.css).

export function Card({ title, sub, action, children }: { title?: ReactNode; sub?: ReactNode; action?: ReactNode; children?: ReactNode }) {
  const head = title && (
    <>
      <h2>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
    </>
  );
  return (
    <div className="card">
      {action ? (
        <div className="row between" style={{ alignItems: "flex-start", marginBottom: sub ? 0 : 12 }}>
          <div>{head}</div>
          {action}
        </div>
      ) : head}
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, hint, full, children }: { label?: ReactNode; htmlFor?: string; hint?: ReactNode; full?: boolean; children: ReactNode }) {
  return (
    <div className={full ? "field full" : "field"}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

export function Btn({ primary, small, danger, loading, children, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; small?: boolean; danger?: boolean; loading?: boolean }) {
  const cls = ["btn", primary && "primary", small && "small", danger && "danger", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest} disabled={rest.disabled || loading}>
      {loading ? "Working…" : children}
    </button>
  );
}

export type Tone = "good" | "warn" | "crit" | "info" | "muted";
export const Tag = ({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) => <span className={`tag ${tone}`}>{children}</span>;

export const Alert = ({ tone, children }: { tone: Exclude<Tone, "muted">; children: ReactNode }) => <div className={`alert ${tone}`}>{children}</div>;

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: () => void; disabled?: boolean; label?: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={onChange} />
      <i />
    </span>
  );
}

export function Seg<T extends string>({ name, value, options, onChange, label }: {
  name: string;
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function Modal({ title, badge, sub, onClose, children, footer }: { title: string; badge?: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <div className="row between"><h2>{title}</h2>{badge}</div>
        {sub && <p className="hint" style={{ margin: "2px 0 14px" }}>{sub}</p>}
        {children}
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
          {footer}
          <Btn onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

export const Loading = () => <div className="loading">Loading…</div>;
