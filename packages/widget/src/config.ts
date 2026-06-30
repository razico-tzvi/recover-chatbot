/**
 * Reads configuration from the <script> tag's data-* attributes. Captured at
 * module load while the bundle's IIFE is executing synchronously, so
 * document.currentScript points at our own tag.
 */
const script = document.currentScript as HTMLScriptElement | null;

function attr(name: string, fallback: string): string {
  return script?.getAttribute(name)?.trim() || fallback;
}

export const widgetConfig = {
  /** Backend base URL, e.g. https://chatbot.example.com (no trailing slash). */
  apiBase: attr("data-api", "").replace(/\/+$/, ""),
  /** Theme accent color. */
  color: attr("data-color", "#2d6cdf"),
  /** Header title. */
  title: attr("data-title", "Chat with us"),
  /** First assistant greeting shown when the panel opens. */
  greeting: attr("data-greeting", "Hi! 👋 How can I help you today?"),
};
