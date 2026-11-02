# Chatbot tools & handoff (Gadget app)

What the storefront assistant can do, how each capability is wired, what it
needs from BigCommerce, and how it was verified. Added in commit `bb20857`
on `fix/widget-env-and-tools` (2026-10-28).

Code lives in `api/routes/POST-chat.js` (tool definitions in `TOOLS`, dispatch
in `runTool`, implementations below it) unless noted otherwise. Defaults and
per-store settings resolvers shared by the backend and the admin live in
`api/lib/defaults.js`.

Admin v2 (spec: "Recover AI Chatbot - Admin v2 Requirements", ClickUp
86eybafcf) is being built in phases. **Phase 1** (this doc) = 9-tab admin,
context sources + exports, Integrations tab, feature toggles, safeguards + rate
limiting. Phases 2–5 (Freshdesk ticket automation, Analytics + API, closing
incentive, learning loop) show as "coming soon" tabs.

## Feature toggles

Each tool belongs to a feature in `FEATURES` (`api/lib/defaults.js`); the store's
`features` JSON switches them. `enabledTools(store)` builds the allowed set:
disabled tools are **removed from the tool list sent to the model**, and
`runTool` refuses them if called anyway. `search_faq` is always on. "Image
uploads (vision)" also hides the widget's attach button and strips images
server-side. Stores without a saved `features` keep `visionEnabled` for vision.

## Tools

| Tool | What it does | BigCommerce API |
|---|---|---|
| `search_products` | Keyword / category / price search; falls back to category-name match. New: optional `category_id`. | `GET /v3/catalog/products`, `/catalog/categories` |
| `get_product_details` | Full product incl. variants (needed for `variant_id`). | `GET /v3/catalog/products/{id}` |
| `get_related_products` | The store's related products; if set to automatic (`[-1]`) or empty, other products from the same category. | `GET /v3/catalog/products` |
| `compare_products` | 2–4 products side by side: price, sale price, stock, brand, rating, weight, custom fields (specs), short description. | `GET /v3/catalog/products?id:in=`, `/catalog/brands` |
| `browse_categories` | Visible categories (id, name, parent, link); `parent_id` narrows to subcategories. | `GET /v3/catalog/categories` |
| `get_product_reviews` | Average rating, count, 5 most recent **approved** reviews. | `GET /v3/catalog/products/{id}/reviews` |
| `add_to_cart` | Adds to the chat session's cart (one cart per session, stored in `chatCart`). | `POST /v3/carts[/{id}/items]` |
| `view_cart` | Items (now incl. `item_id`), quantities, total, cart/checkout links. | `GET /v3/carts/{id}` |
| `update_cart_item` | Change quantity by `item_id`; quantity 0 removes. 422 (e.g. not enough stock) → friendly message. | `PUT /v3/carts/{id}/items/{itemId}` |
| `remove_from_cart` | Remove by `item_id` (removing the last item deletes the cart). | `DELETE /v3/carts/{id}/items/{itemId}` |
| `apply_coupon` | Applies a code to the session cart; returns discount + grand total. Rejected codes (400/404/422) → "applied: false" with a reason. | `POST /v3/checkouts/{cartId}/coupons` |
| `get_shipping_estimate` | Shipping options/costs for the cart, or for one product (`product_id`). Needs `country_code` + `postal_code` (state recommended). Uses a **throwaway cart** with a placeholder address, deleted afterwards, so the shopper's real checkout is never touched. | `POST /v3/carts`, `POST /v3/checkouts/{id}/consignments?include=consignments.available_shipping_options`, `DELETE /v3/carts/{id}` |
| `get_promotions` | Active promotions + coupon codes. | `GET /v3/promotions` |
| `lookup_order` | **Verify-only** (see Safeguards): order id + matching billing email → verified or not; returns only allowlisted fields (status, ship date, carrier, tracking number/link). | `GET /v2/orders/{id}`, `/orders/{id}/shipments` |
| `search_faq` | Searches the store's FAQ (per-store, see below). | — |
| `escalate_to_human` | Flags the chat for staff and notifies the store (see Handoff). 10-minute cooldown per chat. | `GET /v2/store` (admin email fallback) |

## Human handoff

`escalate_to_human` (requires shopper email + summary):

1. Sets on the `chatSession`: `needsHuman`, `handoffEmail`, `handoffSummary`, `handoffAt`.
2. **Destination** (General tab): *Support email* or *CRM ticket*. CRM ticket
   opens a Freshdesk ticket (`POST /api/v2/tickets`, tag `ai-handoff`, ticket #
   appended to the summary) when Freshdesk is connected; if that fails it falls
   back to email.
3. Email goes via Gadget's mailer (`emails.sendMail`), `replyTo` = shopper.
   Recipient: the store's **Support email** setting, else the store's
   `admin_email` from `GET /v2/store`.
4. Optionally POSTs JSON `{ text, event: "handoff", shopperEmail, summary, sessionId, store }`
   to the **Handoff webhook URL** (https only; Slack reads `text`).

If neither notification can be sent, the request is still saved and visible in
the admin Conversations tab.

## Back-in-stock alerts — removed for now

Per the Admin v2 spec the tool, the scheduled `sendStockAlerts` action and the
admin list are removed. The `stockAlert` model and its rows are kept so the
feature can come back without a migration.

## Safeguards (enforced in code)

All thresholds live in the store's `safeguards` JSON (General tab), clamped by
`resolveSafeguards`; defaults in `DEFAULT_SAFEGUARDS`. Events are written to the
`safetyEvent` model (`kind`: `rate_limit`, `verify_fail`, `lockout`, `flag`).

| Safeguard | Default | Where |
|---|---|---|
| Messages per minute / per day, per visitor (widget `sessionId`) | 10 / 60 | `checkRateLimits` (counts the visitor's user `chatMessage` rows) |
| Messages per day, per IP (`x-forwarded-for`, stored on `chatMessage.ip`) | 200 | `checkRateLimits` |
| Failed order verifications before lockout / lockout length | 3 / 24 h | `lookupOrder` → `lockout` event with `expiresAt`; locks that visitor **and** IP, flags the chat, tells the shopper to open a ticket |
| Order-lookup field allowlist | status, ship date, carrier, tracking link | `lookupOrder`; address, payment, amounts, items, phone never reach the model |
| Flag-spike alert | > 5 flags in 24 h → email the alert address, max once a day | `flagSession` |

A failed lookup reads the same whether or not the order exists. Rate-limit and
lockout replies are sent as NDJSON, like normal replies.

**Guardrails** (`GUARDRAILS`) are always prepended to the system prompt and are
not editable; store context blocks follow, framed as unable to override them.

## Page context

The widget (`api/routes/GET-widget.js`, `pageContext()`) sends
`page: { url, title, productId }` with every message. `productId` is read from
the Stencil add-to-cart form (`[data-cart-item-add] input[name="product_id"]`).
`buildSystem` appends it to the system prompt (sanitized, framed as data) so
"does this come in black?" resolves to the product on screen.

## System prompt & context blocks

`buildSystem(store, page)` = bot name + `GUARDRAILS` + general guidelines
(`systemPrompt`, default `DEFAULT_GUIDELINES`) + voice & tone (`voiceTone`) +
refusal wording (`safeguardsInstructions`) + `--- STORE POLICIES & FAQ ---` +
FAQ (`faq`) + page context. An empty field ⇒ its built-in default; the admin
saves "" when a block equals the default. `incentiveInstructions` is stored now
and used once the closing incentive ships. Prompts saved before the FAQ became
its own field have the inline FAQ stripped at the marker.

The defaults live once in `api/lib/defaults.js` and are imported by the admin
(`web/lib/settings.tsx`), so there is nothing to keep in sync by hand.

## Admin UI (9 tabs, `web/components/App.tsx`)

Settings tabs share one draft (`web/lib/settings.tsx`) with **Discard** /
**Save settings** in the header.

- **General** (`web/routes/general.tsx`): branding (bot name, widget color,
  greeting, suggested questions, disclaimer — served to the widget by
  `GET /widget`), human handoff (destination, support email, webhook),
  safeguards (all thresholds above, order-field allowlist, alert email).
- **Context** (`web/routes/context.tsx`): the 8 sources with status, item count,
  updated date, Edit (text blocks) and CSV/JSON export; product catalog count and
  export via the `getCatalog` global action; Export all (one JSON bundle);
  conversation exports; read-only view of the built-in guardrails. Freshdesk
  history and the sales playbook show as not started.
- **Integrations** (`web/routes/integrations.tsx`): tiles (Integrated / Not yet
  integrated) opening a panel. Anthropic: API key + model per role (chat, CRM,
  analysis; `anthropicModels`); the OpenAI-compatible provider is offered only in
  the development env and refused by `POST /chat` when `GADGET_ENV=production`.
  BigCommerce: **Review permissions** probes Checkouts (modify) and Information &
  Settings (read). Freshdesk: domain + API key. ShipStation: API key (+ secret
  for V1 keys). **Test connection** = `testIntegration` global action. New keys
  are `encryptedString` fields and write-only in the UI.
- **Features** (`web/routes/features.tsx`): a switch per feature; Closing
  incentive is shown but disabled until phase 4.
- **CRM / Analytics / Learning / API**: "coming soon" panels
  (`web/routes/comingSoon.tsx`). The CRM tab is titled "Freshdesk" once connected.
- **Conversations** (`web/routes/conversations.tsx`): All / Needs human /
  Flagged filters, CSV/JSON export of the filtered set (one row per message,
  incl. tools called), flagged banner and tools-per-reply in the transcript,
  **Mark resolved** for handoffs.

## Schema & permissions

| Model | Change |
|---|---|
| `bigcommerce/store` | + `faq`, `handoffEmail`, `handoffWebhookUrl`; v2: `botName`, `widgetColor`, `greeting`, `suggestedQuestions` (json), `disclaimer`, `handoffDestination`, `features` (json), `safeguards` (json), `voiceTone`, `safeguardsInstructions`, `incentiveInstructions`, `anthropicModels` (json), `freshdeskDomain`, `freshdeskApiKey`, `shipstationApiKey`, `shipstationApiSecret` (encrypted), `lastFlagAlertAt` |
| `chatSession` | + `needsHuman` (default false), `handoffEmail`, `handoffSummary`, `handoffAt`; v2: `flagged`, `flagReason`, `flaggedAt` |
| `chatMessage` | v2: + `ip` (user messages), `tools` (json, tools called for that reply) |
| `stockAlert` | kept (feature removed for now) |
| `safetyEvent` | new: `storeId`, `sessionId`, `ip`, `kind`, `detail`, `expiresAt` |

`accessControl/permissions.gadget.ts`: `bigcommerce-app-users` may **update**
its own `chatSession` (Mark resolved), **read** its own `safetyEvent` rows
(`accessControl/filters/safetyEvent.gelly`, scoped by
`storeId == $session.bigcommerceStoreId`), and run the `getCatalog` and
`testIntegration` global actions (both resolve the store from
`connections.bigcommerce.currentStoreHash`, never from params).

## Required BigCommerce OAuth scopes

Set on the BigCommerce connection in the Gadget editor; stores must re-authorize
after a change.

| Scope | Needed for | Status on staging (2026-10-28) |
|---|---|---|
| Products (read) | catalog, categories, brands, reviews | ✅ |
| Carts (modify) | cart tools, shipping-quote temp cart | ✅ |
| Orders (read) | `lookup_order` | ✅ (not re-tested) |
| Marketing (read) | `get_promotions` | ✅ (not re-tested) |
| **Checkouts (modify)** | `apply_coupon`, `get_shipping_estimate` | ❌ **missing → 403** |
| **Information & Settings (read)** | `GET /v2/store`: absolute product links, handoff admin-email fallback | ❌ **missing → 403** |

Tool failures with 401/403 tell the model not to retry; it apologizes and
offers a handoff.

## Verification — Admin v2 phase 1 (2026-11-02, dev env, staging store `a7gc2spzm0`)

Synced with `ggt dev` (`ggt problems`: none); admin checked inside the staging
control panel (Apps → AI Support, dev app 66240), widget on recover-stage.

| Check | Result |
|---|---|
| 9 tabs render; General / Context / Integrations / Features / Conversations / CRM placeholder | ✅ |
| Save → `bigcommerce/store` → `GET /widget` config (bot name, vision toggle) | ✅ |
| Context: catalog count via `getCatalog` (237 products), FAQ topic count, editor | ✅ |
| Integrations: Review permissions flags Checkouts (modify) + Information & Settings (read) as missing; LLM Test connection | ✅ |
| Widget: wrong order # + email ×3 → non-revealing reply, then lockout; `safetyEvent` verify_fail ×3 → lockout (24 h) → flag; session flagged | ✅ |
| Conversations: Flagged filter, flag banner, "tools: lookup_order" per reply | ✅ |
| Export buttons (CSV/JSON downloads) | not clicked |
| Freshdesk / ShipStation connect, CRM handoff ticket, rate-limit reply in the live widget | not tested (no credentials; rate limits covered by mocked tests) |

Fixed during verification: Context rows keyed by `key` (React strips it when
big-design's Table spreads rows as props); transcript query used `first: 500`
(Gadget max is 250 — pre-existing, broke every transcript); `<Button>` without
`variant` renders unstyled grey because React 19 ignores big-design's
`defaultProps` — always pass `variant`.

## Verification (2026-10-28, dev env, staging store `a7gc2spzm0`)

Synced with `ggt dev` (`ggt problems`: none). Tested on
`https://recover-stage.mybigcommerce.com/` by replacing the injected production
widget with the dev widget
(`/widget?store=a7gc2spzm0&api=https://recover-ai-chat--development.gadget.app`);
the staging row in the dev DB uses provider `openai` / model `pcsoftai`.

| Capability | Result |
|---|---|
| browse_categories (typed in the widget UI) | ✅ real category tree |
| search → related products, reviews | ✅ |
| compare_products (20/20N vs 20/20X) | ✅ |
| add_to_cart → view_cart with item ids | ✅ |
| update_cart_item (qty 2, total $79.90) | ✅ |
| remove_from_cart | ✅ cart empty |
| Page context ("this one" on S-PRO page) | ✅ resolved to product 143 |
| notify_back_in_stock | ✅ `stockAlert` row created |
| escalate_to_human | ✅ session flagged; no email sent (no handoff email set, `/v2/store` 403) |
| apply_coupon, get_shipping_estimate | ❌ 403 missing Checkouts scope; graceful fallback |

All tools were also exercised against a mocked BigCommerce client/DB before syncing.

Not yet verified: the admin UI changes (control panel not reachable from the
test browser), the scheduled stock-alert email, and a real handoff email.
`pcsoftai` sometimes exhausts the 6 tool iterations (`MAX_ITERATIONS`) on
repeated searches; stronger models are unlikely to hit this.

Test data left in the dev DB: session `claude-test-1793173402203`
(needsHuman) and a stock alert for `test-alert@example.com`.

## Follow-ups

1. Add **Checkouts (modify)** and **Information & Settings (read)** scopes; re-authorize stores.
2. Set a **Human handoff email** for each store in Settings.
3. Verify the admin UI and the stock-alert email in the control panel; then deploy to production.
