import type { StoreSettings } from "../db/settings.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The embedded admin settings page, rendered inside the BigCommerce control
 * panel iframe on /load (and after install on /auth). Saves via fetch to
 * /api/settings, authenticated by the signed session cookie.
 */
export function renderAdminPage(
  storeHash: string,
  s: StoreSettings,
  widgetInstalled: boolean,
): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Chatbot settings</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0; background: #f6f7fb; color: #1a1a1a; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 32px 20px 64px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #6b7280; font-size: 13px; margin: 0 0 24px; }
  .badge { display: inline-block; font-size: 12px; padding: 3px 9px; border-radius: 999px;
    background: ${widgetInstalled ? "#e7f6ec" : "#fdeaea"}; color: ${widgetInstalled ? "#1a7f37" : "#b42318"}; }
  .card { background: #fff; border: 1px solid #e6e8eb; border-radius: 12px; padding: 20px; margin-top: 16px; }
  label { display: block; font-weight: 600; font-size: 13px; margin: 14px 0 5px; }
  input, textarea { width: 100%; border: 1px solid #d8dbe0; border-radius: 8px; padding: 9px 11px;
    font-size: 14px; font-family: inherit; }
  textarea { min-height: 80px; resize: vertical; }
  .row { display: flex; gap: 14px; }
  .row > div { flex: 1; }
  .color { display: flex; align-items: center; gap: 10px; }
  .color input[type=color] { width: 44px; height: 38px; padding: 2px; }
  button { margin-top: 20px; background: #2d6cdf; color: #fff; border: none; border-radius: 8px;
    padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  .toast { margin-top: 12px; font-size: 13px; color: #1a7f37; display: none; }
  .hint { color: #6b7280; font-size: 12px; margin-top: 4px; }
</style></head>
<body><div class="wrap">
  <h1>AI Chatbot</h1>
  <p class="sub">Store <code>${esc(storeHash)}</code> · Storefront widget:
    <span class="badge">${widgetInstalled ? "installed ✓" : "not detected"}</span></p>

  <form id="f" class="card">
    <div class="row">
      <div><label>Header title</label><input name="title" value="${esc(s.title)}" maxlength="60" /></div>
      <div><label>Accent color</label><div class="color">
        <input type="color" name="color" value="${esc(s.color)}" />
      </div></div>
    </div>
    <label>Greeting message</label>
    <input name="greeting" value="${esc(s.greeting)}" maxlength="200" />

    <label>Extra assistant instructions (optional)</label>
    <textarea name="systemExtra" maxlength="2000" placeholder="e.g. Our brand voice is friendly and concise. Mention free returns when relevant.">${esc(s.systemExtra)}</textarea>
    <p class="hint">Appended to the assistant's system prompt for this store.</p>

    <div class="row">
      <div><label>Handoff email</label><input name="escalationEmail" type="email" value="${esc(s.escalationEmail)}" placeholder="support@yourstore.com" /></div>
      <div><label>Slack webhook (optional)</label><input name="slackWebhook" value="${esc(s.slackWebhook)}" placeholder="https://hooks.slack.com/..." /></div>
    </div>
    <p class="hint">Where "talk to a human" escalations are delivered.</p>

    <button type="submit" id="save">Save settings</button>
    <span class="toast" id="toast">Saved ✓</span>
  </form>
</div>
<script>
  const f = document.getElementById('f');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('save'); const toast = document.getElementById('toast');
    btn.disabled = true;
    const body = Object.fromEntries(new FormData(f).entries());
    try {
      const r = await fetch('/api/settings', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      toast.textContent = 'Saved ✓'; toast.style.color = '#1a7f37';
    } catch (err) {
      toast.textContent = 'Save failed — please retry.'; toast.style.color = '#b42318';
    }
    toast.style.display = 'inline'; btn.disabled = false;
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
  });
</script>
</body></html>`;
}
