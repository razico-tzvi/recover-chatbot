# BigCommerce AI Customer Chatbot

An AI shopping assistant that chats with customers on behalf of a BigCommerce
storefront. It can discover products, check order status & tracking, answer
store-policy/FAQ questions, and hand off to a human — all powered by Claude,
with every secret kept server-side.

It ships as a single `<script>` snippet you paste into BigCommerce **Script
Manager**, backed by a small Node API.

---

## How it works

```
Shopper's browser (any store page)
  │  loads widget.js via Script Manager
  ▼
Chat widget  (vanilla TS, Shadow DOM, ~8 KB, zero runtime deps)
  │  POST /api/chat  (streamed NDJSON response)
  ▼
Backend API  (Node + TypeScript + Fastify)
  ├─ Claude tool-use loop (streaming)
  │     search_products · get_product_details · lookup_order
  │     search_faq · escalate_to_human
  ├─ BigCommerce client (catalog + orders, server-side token)
  ├─ Knowledge base (knowledge/policies.md, prompt-cached)
  └─ Escalation (email and/or Slack)
```

Monorepo (npm workspaces):

| Package | What it is |
|---|---|
| `packages/widget` | Embeddable front-end → builds to one self-contained `dist/widget.js`. |
| `packages/server` | Backend API (Fastify) running the Claude tool-use loop. |
| `packages/shared` | Types shared by both (message/event shapes, limits). |

---

## Prerequisites

- **Node.js ≥ 20** (developed/tested on Node 24).
- An **Anthropic API key** — https://console.anthropic.com
- A **BigCommerce store-level API account** (Store Settings → API → Store-level
  API accounts) with **read-only** scopes for **Products** and **Orders**. You
  get a **store hash** and **access token**.

---

## Setup

```bash
npm install
cp .env.example .env     # then fill in the values
```

Edit `.env`:

| Var | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | Anthropic key. |
| `ANTHROPIC_MODEL` | — | Default `claude-sonnet-4-6`. Use `claude-opus-4-8` for harder reasoning or `claude-haiku-4-5` for the cheapest option. |
| `BC_STORE_HASH` | ✅ | From the BigCommerce API account. |
| `BC_ACCESS_TOKEN` | ✅ | From the BigCommerce API account. |
| `ALLOWED_ORIGINS` | ✅ (prod) | Comma-separated storefront origins allowed to call the API (CORS). |
| `PORT` | — | Default `3000`. |
| `ESCALATION_EMAIL` + `SMTP_*` | one channel | Email handoff target + SMTP creds. |
| `SLACK_WEBHOOK_URL` | one channel | Slack incoming-webhook for handoff. |

Configure **at least one** escalation channel (email or Slack) so
`escalate_to_human` can actually reach a person.

Replace **`packages/server/knowledge/policies.md`** with your store's real
shipping/returns/sizing/policy text. The whole file is loaded into the
assistant's (prompt-cached) context.

---

## Run locally

Two terminals:

```bash
# 1) backend (watch mode, reads ../../.env)
npm run dev:server

# 2) widget (esbuild watch + dev server on :8080 serving demo.html)
npm run dev:widget
```

Open **http://localhost:8080/demo.html**. The demo page loads the widget
exactly as a storefront would. Make sure `ALLOWED_ORIGINS` includes
`http://localhost:8080`.

---

## Build for production

```bash
npm run build          # builds shared, server (→ dist), and widget (→ dist/widget.js)
npm run -w @recover/server start   # runs the compiled server
```

Deploy the **server** to any Node host (Render / Fly / Railway / your cloud).
Host **`packages/widget/dist/widget.js`** on the server or a CDN.

---

## Install on the storefront (Script Manager)

BigCommerce admin → **Storefront → Script Manager → Create a Script**:

- **Location:** Footer · **Pages:** All pages · **Type:** Script

```html
<script
  src="https://YOUR-HOST/widget.js"
  data-api="https://YOUR-API-HOST"
  data-color="#2d6cdf"
  data-title="Chat with us"
  data-greeting="Hi! 👋 Ask me about products, your order, or our policies."
  defer
></script>
```

| Attribute | Purpose |
|---|---|
| `data-api` | **Required.** Base URL of the backend. |
| `data-color` | Accent color. |
| `data-title` | Header title. |
| `data-greeting` | First message shown when the panel opens. |

Set the backend's `ALLOWED_ORIGINS` to your storefront domain(s).

---

## Security model

- API keys and the BigCommerce token live **only** on the server; the widget
  never sees them.
- **Order lookups are identity-gated**: `lookup_order` returns an order only
  when the supplied email matches the order's billing email. A mismatch is
  reported identically to "not found" so the bot can't confirm an order exists
  for someone else's email. (`emailsMatch` in
  `packages/server/src/bigcommerce/verify.ts`, unit-tested.)
- CORS is locked to `ALLOWED_ORIGINS`; per-IP rate limiting protects model
  spend; request bodies are size-capped.
- System-prompt guardrails forbid inventing product/price/stock/policy data and
  treat tool/message content as data, not instructions (prompt-injection
  resistance).
- The widget escapes all assistant text before rendering (no raw HTML), and
  only linkifies URLs.

---

## Tests & checks

```bash
npm run typecheck      # all packages
npm test               # server unit tests (FAQ retrieval + order email gate)
```

Manual end-to-end: run server + widget, then in the chat try —
1. "find me a blue t-shirt under $30" (product discovery),
2. "where's my order?" → it asks for order # + email; verify a mismatch is
   refused and a correct pair returns status,
3. "what's your return policy?" (FAQ),
4. "I want to talk to a person" (handoff → email/Slack arrives).

---

## Customizing

- **Persona / rules:** `packages/server/src/ai/systemPrompt.ts`
- **Tools:** add/edit in `packages/server/src/ai/tools.ts` (+ a handler).
- **Catalog/order shapes:** `packages/server/src/bigcommerce/`
- **Large FAQ:** swap `search_faq` (in `src/knowledge/faq.ts`) for an
  embeddings + vector lookup when the KB outgrows the context window.
- **Widget look:** `packages/widget/src/ui.ts` (styles are inlined).
