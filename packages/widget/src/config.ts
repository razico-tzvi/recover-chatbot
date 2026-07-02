/**
 * Reads configuration from the <script> tag's data-* attributes. Captured at
 * module load while the bundle's IIFE is executing synchronously, so
 * document.currentScript points at our own tag.
 */
const script = document.currentScript as HTMLScriptElement | null;

function attr(name: string, fallback: string): string {
  return script?.getAttribute(name)?.trim() || fallback;
}

/**
 * Store hash. From `data-store` if present, else the `?store=` query param on
 * the script `src` (how the BigCommerce app injects it). Empty in manual mode.
 */
function readStore(): string {
  const ds = script?.getAttribute("data-store")?.trim();
  if (ds) return ds;
  try {
    return new URL(script?.src ?? "", location.href).searchParams.get("store") ?? "";
  } catch {
    return "";
  }
}

/**
 * Backend base URL. From `data-api` if present, else derived from the script's
 * own origin (the app serves widget.js from APP_URL, so that origin is the API).
 */
function readApiBase(): string {
  const da = attr("data-api", "");
  if (da) return da.replace(/\/+$/, "");
  try {
    return new URL(script?.src ?? "", location.href).origin;
  } catch {
    return "";
  }
}

export const widgetConfig = {
  apiBase: readApiBase(),
  store: readStore(),
  /** Theme accent color (may be overridden per-store at runtime). */
  color: attr("data-color", "#2d6cdf"),
  /** Header title. */
  title: attr("data-title", "Chat with us"),
  /** First assistant greeting shown when the panel opens. */
  greeting: attr("data-greeting", "Hi! 👋 How can I help you today?"),
};
