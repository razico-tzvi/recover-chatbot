# AGENTS.md — recover-chatbot (Gadget BigCommerce app)

## Local development

### Run the app locally (Gadget dev mode)

The Gadget CLI is the npm package **`ggt`** (not `gadget`):

```bash
npm install -g ggt        # one-time
ggt dev                   # sync local files to the Gadget development env + stream logs
```

- **App UI (admin, 9 tabs: General, Context, Integrations, Features, CRM,
  Analytics, Conversations, Learning, API)** does NOT stand alone —
  `https://recover-ai-chat--development.gadget.app` (root) only shows the
  "App must be viewed in the BigCommerce control panel" placeholder. The real
  admin only renders when embedded in an **installed store's BigCommerce
  control panel** (Apps → Recover AI Chatbot).
- **Developer editor:** `https://recover-ai-chat.gadget.app/edit/development`
  — Gadget editor with Files / Logs / Preview / API / Queues / Installs /
  Ops / Settings / Docs tabs; its Preview tab shows the app UI unauthenticated.
- Widget: `https://recover-ai-chat--development.gadget.app/widget?store=<HASH>`
- The dev environment has its **own database** — a store row must exist there
  (`bigcommerce/store`) or `POST /chat` returns `404 Store not installed.`
- `ggt` writes its session to `~/.config/ggt/session.txt`; if it fails with
  EPERM, run it outside a file sandbox.
- `ggt eval` runs against the dev env with a **read-only** session (reads OK,
  writes rejected with GGT_PERMISSION_DENIED).

### Test the widget on a local Stencil theme

The widget script tag is designed for local testing: `GET-widget.js` derives
its API base from its own URL, so `?api=` on the script src overrides the
backend (default: production `https://recover-ai-chat.gadget.app`):

```html
<script
  src="https://recover-ai-chat--development.gadget.app/widget?store=<STORE_HASH>&api=https://recover-ai-chat--development.gadget.app"
  data-title="Recover AI"
  defer
></script>
```

- `store=` is required — the widget exits immediately without it.
- Branding (bot name, color, greeting, suggestions, disclaimer) comes from the
  store's General tab; `data-*` attributes only apply when the store row
  doesn't exist in that env.
- CORS is fine for local origins: `POST-chat.js` echoes the request's
  `Origin` into `Access-Control-Allow-Origin`.

The sibling repo `../recover-bigcommerce` is the Stencil theme. Full
setup (ggt dev + `stencil start` + the script tag in
`theme/templates/layout/base.html` + verification steps) is documented in
`../recover-bigcommerce/docs/setup/LOCAL-DEV-WITH-CHATBOT.md` — follow it.

### Staging store (preferred test target)

- **Staging storefront:** `https://recover-stage.mybigcommerce.com/` — preview
  code `4e89f7e1fq` (enter it on the store's password/preview gate).
- The widget is injected there via the BigCommerce Scripts API
  (`api/injectWidget.js`), so testing on staging exercises the production
  injection path — no manual script tag needed.
- **The staging store has its own hash: `a7gc2spzm0`** (NOT the main store's
  `us8jq79lnj`) — the injected script is
  `https://recover-ai-chat.gadget.app/widget?store=a7gc2spzm0`. It is a
  separate `bigcommerce/store` row in the Gadget DB, so it needs its own
  LLM provider/model/API key configured in the Gadget admin settings, or
  `POST /chat` returns "The assistant isn't configured yet — please set the
  LLM provider, model and API key in the app settings."
  **Status (2026-10-28):** the staging row is now configured — it carries the
  same settings as the main store row (`anthropic` / `claude-sonnet-5` /
  `https://ai.pcsoftnepal.com/v1` / shared API key, `visionEnabled: true`),
  copied via `ggt eval -e production -w 'api.bigcommerce.store.update("2", {...})'`.

## Conventions

- Admin v2 spec ("Recover AI Chatbot - Admin v2 Requirements", ClickUp task
  86eybafcf) is built in 5 phases; phase 1 is done. Every setting is per store
  (multi-tenant) and editable in the admin — nothing Recover-specific in code.
- `api/lib/defaults.js` — the single source for context-block defaults
  (`DEFAULT_GUIDELINES`, `DEFAULT_FAQ`, voice & tone, …), the non-editable
  `GUARDRAILS`, branding, `FEATURES` (feature → tools) and `DEFAULT_SAFEGUARDS`,
  plus `resolve*` helpers. Imported by both the backend and the admin (`web/`),
  so keep it free of server-only imports.
- `api/routes/POST-chat.js` — chat endpoint: rate limits, feature-gated tool
  list, verify-only order lookup + lockouts, `buildSystem` (guardrails + store
  context blocks).
- Tools, safeguards, handoff, admin tabs, required OAuth scopes and test status
  are documented in `docs/CHATBOT-TOOLS.md` — keep it updated when tools change.
- `api/lib/crm.js` — CRM ticket answering (Freshdesk, phase 2): `crmPoll`
  cron (5 min) drafts/answers new tickets, `crmSyncHistory` cron (nightly)
  syncs agent replies. Only tickets created after the mode left Off are
  touched. Don't run Check now / Live mode against a real helpdesk without
  the store owner's OK — it posts notes/replies on customer tickets.
- `api/lib/analytics.js` — Analytics tab (phase 3a): `getAnalytics` aggregates
  per store; `syncOrders` cron (hourly) credits BigCommerce orders to chats by
  cart id (direct = bot-built cart, assisted = shopper's own cart within 7 days).
  Token cost uses `MODEL_PRICES` in `defaults.js` — add new models there.
- Back-in-stock is removed for now (tool, cron, admin list); the `stockAlert`
  model is kept.
- `api/routes/GET-widget.js` — serves the widget; `?api=` and `?store=` query
  params control backend + store; branding and feature flags (vision) come
  from the `bigcommerce/store` row.
- `api/injectWidget.js` — Scripts-API injection used on app install
  (production path; local testing uses the manual script tag above).
- Product URLs from BigCommerce are storefront-relative; `POST-chat.js`
  absolutizes them against the store's canonical URL (cached in
  `storeUrlCache`).
