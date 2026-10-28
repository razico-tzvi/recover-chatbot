# Chatbot tools & handoff (Gadget app)

What the storefront assistant can do, how each capability is wired, what it
needs from BigCommerce, and how it was verified. Added in commit `bb20857`
on `fix/widget-env-and-tools` (2026-10-28).

Code lives in `api/routes/POST-chat.js` (tool definitions in `TOOLS`, dispatch
in `runTool`, implementations below it) unless noted otherwise.

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
| `lookup_order` | Order status/tracking; requires order id **and** matching billing email. | `GET /v2/orders/...` |
| `search_faq` | Searches the store's FAQ (per-store, see below). | — |
| `notify_back_in_stock` | Saves a one-time restock email request (`stockAlert` model). Refuses if the item is in stock, dedupes, max 5 pending per chat. | `GET /v3/catalog/products/{id}?include=variants` |
| `escalate_to_human` | Flags the chat for staff and notifies the store (see Handoff). 10-minute cooldown per chat. | `GET /v2/store` (admin email fallback) |

## Human handoff

`escalate_to_human` (requires shopper email + summary):

1. Sets on the `chatSession`: `needsHuman`, `handoffEmail`, `handoffSummary`, `handoffAt`.
2. Emails the store via Gadget's mailer (`emails.sendMail`), `replyTo` = shopper.
   Recipient: the store's **Human handoff email** setting, else the store's
   `admin_email` from `GET /v2/store`.
3. Optionally POSTs `{ "text": ... }` to the **Handoff webhook URL** setting
   (https only; works with Slack incoming webhooks).

If neither notification can be sent, the request is still saved and visible in
the admin Conversations tab.

## Back-in-stock alerts

- Model `stockAlert`: `storeId`, `storeHash`, `sessionId`, `email`, `productId`,
  `variantId`, `productName`, `productUrl`, `notifiedAt`.
- `api/actions/sendStockAlerts.ts` runs every 30 minutes (cron
  `*/30 * * * *`, also callable via API): checks pending alerts per store,
  emails each one whose product/variant is available again, then sets
  `notifiedAt`. Handles 250 pending alerts per run.

## Page context

The widget (`api/routes/GET-widget.js`, `pageContext()`) sends
`page: { url, title, productId }` with every message. `productId` is read from
the Stencil add-to-cart form (`[data-cart-item-add] input[name="product_id"]`).
`buildSystem` appends it to the system prompt (sanitized, framed as data) so
"does this come in black?" resolves to the product on screen.

## Per-store FAQ & system prompt

- New store field `faq`. Empty ⇒ built-in `DEFAULT_FAQ`.
- `buildSystem(store, page)` = store `systemPrompt` (or `DEFAULT_SYSTEM`) +
  `--- STORE POLICIES & FAQ ---` + FAQ + page context.
- Custom prompts saved before this change contained an inline FAQ copy; anything
  from the `--- STORE POLICIES & FAQ ---` marker onward is stripped so it isn't
  duplicated.
- `DEFAULT_SYSTEM` / `DEFAULT_FAQ` in `POST-chat.js` must stay in sync with
  `DEFAULT_SYSTEM_PROMPT` / `DEFAULT_FAQ` in `web/routes/index.tsx`.

## Admin UI

- **Settings** (`web/routes/index.tsx`): "Store policies & FAQ" textarea (with
  reset), "Human handoff email", "Handoff webhook URL", and a
  "Back-in-stock requests" panel (product, email, Waiting / Emailed date).
- **Conversations** (`web/routes/conversations.tsx`): "Needs human (N)" filter,
  "Needs human" badge on sessions, handoff box in the transcript (time,
  reply-to mailto link, summary) with **Mark resolved** (sets `needsHuman: false`).

## Schema & permissions

| Model | Change |
|---|---|
| `bigcommerce/store` | + `faq`, `handoffEmail`, `handoffWebhookUrl` |
| `chatSession` | + `needsHuman` (default false), `handoffEmail`, `handoffSummary`, `handoffAt` |
| `stockAlert` | new (create/update/delete actions) |

`accessControl/permissions.gadget.ts`: `bigcommerce-app-users` may **update**
its own `chatSession` (Mark resolved) and **read/delete** its own `stockAlert`
rows (`accessControl/filters/stockAlert.gelly`, scoped by
`storeId == $session.bigcommerceStoreId`).

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
