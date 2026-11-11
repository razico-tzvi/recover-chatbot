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
limiting. **Phase 2** = CRM ticket answering (Freshdesk), below. **Phase 3a** =
Analytics tab, below. **Learning** = the sales learning loop, below. **API** =
API keys + read-only REST endpoints, below. The closing incentive shows as
"coming soon".

## API tab (REST API)

Code: `api/lib/publicApi.js` (keys, auth, pagination, serializers),
`api/routes/v1/*` (endpoints), `api/actions/apiAdmin.ts` (tab operations,
current store only), model `apiKey`, `web/routes/api.tsx`. Scope list
`API_SCOPES` (+ `API_EXPIRY_DAYS`, `API_MAX_KEYS`) in `defaults.js`.

| What | How |
|---|---|
| Keys | `rak_` + 32 random bytes (base64url). Only the SHA-256 (`keyHash`) and a display `prefix` are stored; the secret is shown once at creation. Each key has a **label**, **scopes** (resources), optional **expiry** (30/90/180/365 days or never). Max 20 active per store. **Revoke** is immediate; revoked/expired keys can then be removed. `lastUsedAt` is updated at most once a minute. |
| Auth | `Authorization: Bearer rak_…` (or `X-Api-Key`). 401 missing/invalid/expired/revoked, 403 missing scope, 400 bad query, 404 unknown conversation; body `{"error": "…"}`. The store is always the key's store. |
| Endpoints (all GET) | `/v1/me` (any key) · `/v1/conversations`, `/v1/conversations/{sessionId}` (conversations) · `/v1/analytics?days=` (analytics, same numbers as the tab) · `/v1/context` (context) · `/v1/feedback?source=ratings\|crm` (feedback) · `/v1/learning` (learning) · `/v1/settings` (settings) · `/v1/safety-events?kind=` (safety) |
| Lists | Newest first; `limit` (1–200, default 50), `since` / `until` (ISO, on createdAt), `cursor` = previous page's `nextCursor` (createdAt of its last row; `null` on the last page). Conversations also filter on `needsHuman`, `flagged`, `converted` (`=true`). |
| Never returned | Shopper IPs, LLM/Freshdesk/ShipStation keys, the handoff webhook URL (only `webhookConfigured`), key hashes. |

Everything is read-only for now; write endpoints (e.g. updating context or
settings) are not built.

## Analytics (phase 3a)

Code: `api/lib/analytics.js` (order attribution + dashboard numbers),
`api/actions/getAnalytics.ts` (tab data, current store only),
`api/actions/syncOrders.ts` (cron `17 * * * *`), `api/routes/POST-feedback.js`
(widget rating), `web/routes/analytics.tsx`.

| What | How it's recorded |
|---|---|
| Conversations, messages | `chatSession` rows with `messageCount > 0` (flag-only rows are excluded) |
| Containment | share of conversations without `handoffAt` |
| Satisfaction | widget "Was this helpful? 👍 👎" under the latest reply → `POST /feedback` → `chatSession.rating` (1 / -1, last one wins, one per session in the widget) |
| AI cost | `POST /chat` sums streamed usage per turn (Anthropic `message_start` / `message_delta`; OpenAI-compatible `stream_options.include_usage`) into `inputTokens` / `outputTokens`, and `costUsd` priced at the turn's model from `MODEL_PRICES` in `api/lib/defaults.js` (list prices, 2026-10). Unknown models (dev endpoint) show tokens only. CRM drafting cost is not counted yet. |
| Funnel | `productsShown` (any of `PRODUCT_TOOLS` used), `addedToCart` (`add_to_cart` used), then orders |
| Direct conversion | order whose `cart_id` is the cart the bot built (`chatCart`) |
| Assisted conversion | order whose `cart_id` is the shopper's own storefront cart (widget reads `/api/storefront/carts` and sends `cartId` with each message → `chatSession.storefrontCartId`), placed within `ASSISTED_WINDOW_DAYS` (7) of the chat |
| Support & safety | handoffs (open ones = `needsHuman`), flagged sessions, `safetyEvent` counts by kind, `crmTicket` counts by action and the share of drafts the agent edited (similarity < 0.9) |

Order attribution reads `GET /v2/orders?min_date_created=` from a per-store
cursor (`store.analyticsState.ordersCursor`; first run goes back 30 days, each
run re-reads a 1-day overlap for orders that were still Incomplete). A session
keeps its first conversion (`conversion`, `orderId`, `orderTotal`,
`orderCurrency`, `convertedAt`). The tab's **Check orders now** runs the same
sync for the current store. Ranges: 7 / 30 / 90 days, daily buckets in UTC,
CSV export of the daily rows, table view of the chart. Incentive A/B results
are a placeholder until the closing incentive ships.

## Sales learning loop (Learning tab)

Code: `api/lib/learning.js`, `api/actions/learningLoop.ts` (cron `41 6 * * *`,
daily), `api/actions/learningAdmin.ts` (tab operations, current store only),
`web/routes/learning.tsx`. Settings resolver `resolveLearning` + `DEFAULT_LEARNING`
in `defaults.js`.

| What | How |
|---|---|
| Settled conversation | `messageCount > 0` and its outcome is final: it converted (direct/assisted, from `syncOrders`) **or** its last activity is older than `ASSISTED_WINDOW_DAYS` (7) with no order |
| Window | conversations created since the last proposal (`learningState.cursor`, set when a proposal is written); the first window starts at the first chat |
| Trigger | daily check, when **auto** is on, no proposal is pending, and the window has ≥ `minSettled` (default 250) settled conversations with ≥ `minConversions` (default 25) conversions. Both thresholds and auto are editable on the tab (clamped 20+/5+) |
| Run analysis now | queues `learningLoop` with `force` for this store; skips the thresholds but still needs ≥ 10 settled / 2 converted (`MANUAL_MIN`) |
| Analysis | the store's **analysis** model (`anthropicModels.analysis`, else the chat model). Reads the newest 30 converted and 30 non-converted settled chats (non-converted ones that showed products first), transcripts clipped, plus the live playbook. Returns `{playbook, rationale, changes}`; the prompt allows only sales *behaviour* (no product facts, prices, codes, promises, personal data, nothing against the guardrails), max `PLAYBOOK_MAX_CHARS` (6000) |
| Versions | `salesPlaybook` rows: `proposed` → `active` → `retired`, or `rejected`. Nothing goes live without **Approve** (the text can be edited first, `edited: true`). **Restore** re-activates a retired version (rollback); **Turn off** runs with none |
| Live text | the active version's text is copied to `store.salesPlaybook`; `buildSystem` appends it as `--- SALES PLAYBOOK … ---` after the FAQ |
| Per-version conversion | each `chatSession` is stamped with `playbookVersion` (the live version when it started; 0/unset = no playbook, the baseline). The tab shows chats, settled, orders, conversion rate (conversions ÷ settled) and revenue per version, exportable as CSV/JSON |

The Context tab's **Sales playbook** source shows the live version, exports it
(CSV/JSON, and in Export all) and links to the Learning tab.

## CRM ticket answering (Freshdesk, phase 2)

Code: `api/lib/crm.js` (engine), `api/lib/llm.js` (non-streaming LLM call),
`api/lib/integrations.js` (`freshdesk()` client), actions `crmPoll`,
`crmSyncHistory`, `crmAdmin`; admin `web/routes/crm.tsx`. Settings are the
store's `crmSettings` JSON (`resolveCrm` / `DEFAULT_CRM` in `defaults.js`);
run state (cursors, last run, errors, history count) is `crmState`.

| Piece | How it works |
|---|---|
| Modes | **Off** · **Learning** — every new ticket gets an AI draft as a *private note* tagged `ai-draft`; nothing reaches the customer · **Live** — confident answers go out as a public reply tagged `ai-answered`; low-confidence ones still become private drafts. |
| Which tickets | `crmPoll` (cron `*/5 * * * *`) lists tickets updated since a cursor (`GET /api/v2/tickets?updated_since=…&order_by=updated_at`). A ticket is handled once (dedupe on `crmTicket`) if it is **open**, was **created after `enabledAt`** (stamped by the admin when the mode leaves Off — the backlog is never touched), has none of the *skip* tags (default `ai-handoff`, i.e. chat handoffs) or the bot's own tags, carries one of the *only* tags if any are set, and has no agent public reply yet. Max 10 tickets per store per run. |
| Drafting | `draftReply`: `CRM_GUARDRAILS` (code, not editable) + voice & tone + refusal wording + FAQ + up to 3 similar synced past tickets (keyword overlap) + up to 3 recent agent corrections. The model returns JSON `{confident, reason, reply}`; the store's **signature** is appended in code. Model: Integrations › CRM model, else the chat model. |
| Topic blocklist | `matchBlocklist` (whole words/phrases in subject + body). Matching tickets never get an AI-written answer: the **set response** is used instead (sent in Live, private note in Learning), or with no set response the ticket is only tagged `ai-blocked`. **Defaults** (`DEFAULT_BLOCKLIST`, used until the store saves its own list — `crmSettings.blocklistSeeded`): chargebacks & payment disputes, dealer/wholesale inquiries, warranty claims needing an RMA decision (all *leave for CS*), and legal questions (set response `LEGAL_SET_RESPONSE`: "My settings restrict me from providing any type of legal advice. Please consult with a lawyer familiar with the laws in your state."). **Site chat uses the same list** on the shopper's latest message (`POST-chat.js`, independent of the CRM mode): a set response is streamed word for word with no LLM call; a leave-for-CS topic runs the LLM with an instruction not to answer and to offer a handoff. Each hit logs a `blocked_topic` `safetyEvent`. |
| Feedback | Each draft gets `nextCheckAt`; `collectFeedback` (same cron) looks for the first agent public reply after the draft, stores it as `finalReply` with a word-level `similarity` (1 = sent unchanged). Rechecked hourly for 14 days. Drafts kept < 90% feed the "agents edited these" prompt section. |
| History sync | `crmSyncHistory` (cron `0 7 * * *`, plus **Sync now**): resolved/closed tickets → `crmHistory` with subject + **agent public replies only** (no customer text, no private notes, no `ai-answered` tickets). First run looks back 12 months; ≤150 tickets per run, incremental cursor. |
| Voice & tone seeding | `api/lib/voice.js`. When a store's sync chain finishes (no more pages, no rate-limit pause) — or as soon as ≥ 200 tickets are synced, since a rate-limited backfill can take days — `seedVoiceTone` runs **once**: if `voiceTone` is still empty (built-in default) and ≥ 20 agent replies from the last 12 months are stored, the analysis model (Integrations › Analysis model, else the chat model) writes a 6–12 bullet style guide from ≤ 80 replies sampled evenly over the year (quoted thread stripped; style only — no facts, names or signatures) and it is saved to `voiceTone`; `crmState.voiceSeed` records when, how many replies and the model, and stops any re-seed. An edited block is never overwritten. Context tab › Voice & tone › **Generate from tickets** (`crmAdmin` op `voiceTone`) re-runs the analysis on demand and fills the editor; nothing is saved until Save settings. |
| Rate limits | Freshdesk plans allow as little as ~50 calls/min. A 429 with Retry-After ≤ 5 s is retried once; otherwise the run saves its cursor and stops — the poll resumes on the next tick; the history sync **schedules its own continuation** after Retry-After (≤ 20 per chain; the CRM tab shows "pausing… resumes around"). Long sleeps inside an action got it aborted in dev (`AbortError`), so the code never waits long. |
| Errors | A failed ticket is recorded as `error`; **Retry** on the CRM tab reprocesses it. Tagging is best effort (stores with required custom fields may reject `PUT /tickets`). |

Freshdesk calls: `GET /tickets`, `GET /tickets/{id}`, `GET /tickets/{id}/conversations`,
`POST /tickets/{id}/notes` (private), `POST /tickets/{id}/reply` (Live only),
`PUT /tickets/{id}` (tags). The API key's agent is the author of notes/replies.

**CRM tab**: mode, last check / history sync status with **Check now** and
**Sync now**, tag rules, signature, blocklist editor (saved with Save
settings), recent-ticket log (outcome, kept-wording %, draft vs. agent reply,
Retry), and **Try it** — drafts a reply to pasted text without posting.
Context tab: Freshdesk history status/count + CSV/JSON export; Data exports:
Freshdesk feedback (draft vs. sent).

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
`safetyEvent` model (`kind`: `rate_limit`, `verify_fail`, `lockout`, `flag`, `blocked_topic`).

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
FAQ (`faq`) + the approved sales playbook (`salesPlaybook`, Learning tab) +
page context. An empty field ⇒ its built-in default; the admin
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
- **CRM** (`web/routes/crm.tsx`): ticket answering, see above. Titled
  "Freshdesk" once connected; a settings tab (shared Save).
- **Analytics** (`web/routes/analytics.tsx`): see Analytics above.
- **Learning** (`web/routes/learning.tsx`): see Sales learning loop above.
- **API**: "coming soon" panel (`web/routes/comingSoon.tsx`).
- **Conversations** (`web/routes/conversations.tsx`): All / Needs human /
  Flagged filters, CSV/JSON export of the filtered set (one row per message,
  incl. tools called), flagged banner and tools-per-reply in the transcript,
  **Mark resolved** for handoffs.

## Schema & permissions

| Model | Change |
|---|---|
| `bigcommerce/store` | + `faq`, `handoffEmail`, `handoffWebhookUrl`; v2: `botName`, `widgetColor`, `greeting`, `suggestedQuestions` (json), `disclaimer`, `handoffDestination`, `features` (json), `safeguards` (json), `voiceTone`, `safeguardsInstructions`, `incentiveInstructions`, `anthropicModels` (json), `freshdeskDomain`, `freshdeskApiKey`, `shipstationApiKey`, `shipstationApiSecret` (encrypted), `lastFlagAlertAt`; phase 2: `crmSettings`, `crmState` (json); phase 3a: `analyticsState` (json: `ordersCursor`, `ordersSyncedAt`); learning: `learningSettings` (json: `auto`, `minSettled`, `minConversions`), `learningState` (json: `cursor`, `activeVersion`, `lastCheckAt`, `lastRunAt`, `lastRunError`, `running`), `salesPlaybook` (live text) |
| `chatSession` | + `needsHuman` (default false), `handoffEmail`, `handoffSummary`, `handoffAt`; v2: `flagged`, `flagReason`, `flaggedAt`; phase 3a: `inputTokens`, `outputTokens`, `costUsd`, `productsShown`, `addedToCart`, `storefrontCartId`, `rating`, `ratingAt`, `conversion` (direct/assisted), `orderId`, `orderTotal`, `orderCurrency`, `convertedAt`; learning: `playbookVersion` |
| `chatMessage` | v2: + `ip` (user messages), `tools` (json, tools called for that reply) |
| `stockAlert` | kept (feature removed for now) |
| `safetyEvent` | new: `storeId`, `sessionId`, `ip`, `kind`, `detail`, `expiresAt` |
| `crmTicket` | phase 2: `storeId`, `ticketId`, `subject`, `question`, `action` (drafted/replied/blocked/skipped/error), `reason`, `confident`, `draft`, `blockedTopic`, `model`, `finalReply`, `similarity`, `feedbackAt`, `nextCheckAt` |
| `salesPlaybook` | learning: `storeId`, `version`, `status` (proposed/active/retired/rejected), `content`, `rationale`, `changeSummary` (json; not `changes`, which `GadgetRecord#changes()` shadows), `basedOn` (json: window, counts, sample sizes), `model`, `trigger` (auto/manual), `edited`, `decidedAt`, `activatedAt`, `retiredAt` |
| `crmHistory` | phase 2: `storeId`, `ticketId`, `subject`, `answer` (agent public replies), `ticketUpdatedAt` |

`accessControl/permissions.gadget.ts`: `bigcommerce-app-users` may **update**
its own `chatSession` (Mark resolved) and run the `getCatalog` and
`testIntegration` global actions (both resolve the store from
`connections.bigcommerce.currentStoreHash`, never from params). Phase 2: **read**
own `crmTicket` / `crmHistory` rows (`accessControl/filters/crm*.gelly`, scoped
by `storeId == $session.bigcommerceStoreId`) and run `crmAdmin` (same store
resolution). The admin doesn't read `safetyEvent`, so that role grant was
dropped (the filter file is kept). Phase 3a: run `getAnalytics` (same store
resolution; it reads `safetyEvent` / `crmTicket` server-side). Learning: run
`learningAdmin` (same store resolution; `salesPlaybook` rows are only read
server-side, so there is no role grant on that model).

## Verification — phase 2 CRM (2026-11-09)

| Check | Result |
|---|---|
| `ggt dev` sync, `ggt problems` | ✅ none; `crmTicket` / `crmHistory` queryable in dev |
| Mocked Freshdesk + LLM + DB run of `syncHistory` → `pollStore` → `collectFeedback` → Live poll | ✅ backlog and `ai-handoff` tickets ignored; draft posted as private note only; blocklisted ticket tagged, no AI text; cursor advances, second poll handles nothing; agent edit captured (similarity < 0.9); Live posts `/reply`; history keeps agent public replies only |
| Unit checks: `resolveCrm`, `matchBlocklist` (punctuation, case), `parseDraft`, `similarity`, `toHtml` | ✅ |
| `vite build`, TS (no new errors) | ✅ |
| Staging control panel (Apps → AI Support, dev app 66240): CRM tab renders, titled "Freshdesk" | ✅ |
| **Sync now** against `recoverinnovations.freshdesk.com` | ✅ after fixes — 165+ resolved tickets synced via self-scheduled continuations; status/notice refresh live |
| **Try it** (preview, nothing posted) | ✅ grounded in the FAQ (30-day returns, 5–7 day refunds), marked confident |
| Save signature + blocklist topic → `crmSettings` round-trip (keywords normalized, mode Off keeps `enabledAt` empty); reverted afterwards | ✅ |
| Context tab: Freshdesk history "Synced", count, CSV/JSON | ✅ (rendered; downloads not clicked) |
| **Learning mode on the real helpdesk** (2026-11-09, temporary config: only `ai-handoff`, skip list empty, blocklist "Chargebacks"; 3 test handoffs from the dev chat with `@example.com` emails → #122542–#122544) | ✅ #122543 ("…file a chargeback…") → blocked, tagged, no AI text; #122544 → clean private-note draft grounded in the FAQ, flagged "needs agent"; log + detail view in the CRM tab. Settings restored to Off/defaults afterwards |
| Live mode, feedback capture on a real agent reply | not run — Live would email a customer, and no agent login was available to reply; both covered by the mocked run |

Fixed during staging verification: (1) the first sync hit Freshdesk's rate
limit after ~29 tickets; in-action waits then got the job aborted → replaced
with saved cursor + scheduled continuation; (2) the CRM status block showed
stale counts/errors after a background run → it now reads `crmState` on its
own and refreshes every 5 s for 2 min after Check/Sync; (3) **Sync now**
while a continuation is pending no longer starts a parallel chain.

Fixed during the live Learning-mode test: (4) the history backfill used the
whole per-minute API budget, so the ticket poll got rate-limited — backfill now
stops below 40% of `X-Ratelimit-Remaining`, and a rate-limited poll shows a
notice; (5) the dev model's JSON reply was **cut off at the token limit** and the
raw JSON was posted as the note on #122542 — `complete()` now reports
truncation, drafting retries once with a larger budget, the parser salvages the
`reply` field from malformed JSON, and anything still unusable is recorded as an
`error` (Retry) with **nothing posted**; (6) a failed tag update after a posted
note no longer causes a second note on the next tick; (7) greetings no longer
use the email handle Freshdesk assigns as a name ("Hi Ai-test-sizing"); (8) the
ticket log refreshes every 15 s.

Test leftovers: Freshdesk tickets #122542–#122544 (subjects start "Chat
handoff", bodies "[TEST - please ignore]") are still open and need closing by
an agent; #122542 carries the malformed raw-JSON note from before fix (5).
Dev DB: chat sessions `crm-test-*` and their `crmTicket` rows.

## Verification — Learning tab (2026-11-09, dev env, staging store `a7gc2spzm0`)

Synced with `ggt push` (`ggt problems`: none); admin checked in the staging
control panel (dev app 66240). Test data: 13 real chats via dev `POST /chat`
(sessions `learn-test-*`), 8 marked converted with fake order ids 990001–990008
via `ggt eval -w` (stand-in for `syncOrders`). All test rows, both playbook
versions and the store's learning fields were deleted afterwards.

| Check | Result |
|---|---|
| Mocked-DB unit run of `api/lib/learning.js` | ✅ thresholds skip, forced run (analysis model, both transcript sides), pending/min-data blocks, approve with edits, rollback, turn off, reject, per-version stats |
| Tab renders with live data; Run disabled below `MANUAL_MIN` with hint | ✅ |
| New chats stamped `playbookVersion: 0` with no playbook live | ✅ |
| **Run analysis now** → queued `learningLoop` → "running" banner → auto-refresh → proposed v1 (dev model `pcsoftai`; 8 converted / 2 not) | ✅ behaviour-only playbook, rationale, 6 changes; window counters reset |
| Edit proposal → **Approve with edits** → `store.salesPlaybook` = edited text, v1 live, marked edited | ✅ |
| Chat after approval: session stamped `playbookVersion: 1`; reply follows the playbook (grouped options, fit-based pick, closes with a cart offer) | ✅ |
| Turn off (confirm modal) → v1 retired, baseline live; Restore → v1 live again | ✅ |
| Threshold settings save (20 / 5), meters follow | ✅ |
| `learningLoop` cron path (no force) → `below thresholds`, `lastCheckAt` shown | ✅ |
| Proposal card: changes list, Compare with live version; Reject (confirm modal) → v2 rejected, "never live" | ✅ |
| Context tab: Sales playbook row "Active · v1", Manage → Learning tab | ✅ |
| CSV/JSON export buttons | not clicked |
| Analysis with the Anthropic analysis model; an automatic proposal from real thresholds | not run — dev uses the OpenAI-compatible model and has no real conversions |

Fixed during verification: the version field `changes` read as `undefined`
through the internal API — `GadgetRecord#changes()` shadows it — renamed to
`changeSummary` (same storage key); Reject confirm text clarified.

## Verification — phase 3a Analytics (2026-11-09, dev env, staging store `a7gc2spzm0`)

| Check | Result |
|---|---|
| Mocked DB + orders run of `syncStoreOrders` → `storeAnalytics` | ✅ chat-cart order → direct, own-cart order → assisted, own-cart order outside 7 days and Incomplete order ignored; second run attributes nothing; overview/funnel/support/daily numbers match the fixtures; unpriced model reported |
| Live `POST /chat` on dev (OpenAI-compatible dev model) | ✅ session got `inputTokens` 10,017 / `outputTokens` 286, `productsShown`, `storefrontCartId`; `costUsd` null (no list price for the dev model) |
| `POST /feedback` | ✅ rating saved; unknown session → 404; rating 5 → 400 |
| Analytics tab in the staging control panel | ✅ tiles, daily chart, funnel, placeholder, support/safety render with dev data; **Check orders now** read staging orders and set the cursor (no chat carts among them, so 0 conversions) |
| Anthropic streaming usage capture | not run live — dev uses the OpenAI-compatible endpoint; code path follows the documented `message_start` / `message_delta` usage fields |
| Widget rating UI / storefront cart read on a real storefront | not run — needs the widget served from an env with this code on the storefront |

## Required BigCommerce OAuth scopes

Set on the BigCommerce connection in the Gadget editor; stores must re-authorize
after a change.

| Scope | Needed for | Status on staging (2026-10-28) |
|---|---|---|
| Products (read) | catalog, categories, brands, reviews | ✅ |
| Carts (modify) | cart tools, shipping-quote temp cart | ✅ |
| Orders (read) | `lookup_order`, Analytics order attribution | ✅ (`syncOrders` read staging orders 2026-11-09) |
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
