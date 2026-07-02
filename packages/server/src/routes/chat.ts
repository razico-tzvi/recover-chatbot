import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LIMITS, type StreamEvent } from "@recover/shared";
import { runChatTurn } from "../ai/chat.js";
import { config, appModeEnabled } from "../config.js";
import type { TurnContext } from "../ai/tools.js";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(LIMITS.maxSessionIdChars),
  /** Store hash (app mode). Injected by the widget from its script tag. */
  store: z.string().max(50).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(LIMITS.maxUserMessageChars),
      }),
    )
    .min(1)
    .max(LIMITS.maxHistoryMessages),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/chat", async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request body." });
    }

    const { messages, store } = parsed.data;
    if (messages[messages.length - 1]?.role !== "user") {
      return reply.code(400).send({ error: "The last message must be from the user." });
    }

    // Resolve per-store context in app mode (skipped when MOCK_BIGCOMMERCE).
    let turn: TurnContext = {};
    if (appModeEnabled && !config.MOCK_BIGCOMMERCE) {
      if (!store) {
        return reply.code(400).send({ error: "Missing store." });
      }
      const { storeExists } = await import("../db/stores.js");
      const { getSettings } = await import("../db/settings.js");
      if (!storeExists(store)) {
        return reply.code(403).send({ error: "This store isn't installed." });
      }
      turn = { storeHash: store, settings: getSettings(store) };
    } else if (appModeEnabled && store) {
      // Mock mode but still surface per-store settings if present.
      const { getSettings } = await import("../db/settings.js");
      turn = { storeHash: store, settings: getSettings(store) };
    }

    // Take over the socket and stream newline-delimited JSON events.
    // NOTE: hijacking bypasses Fastify's onSend hooks — including @fastify/cors
    // — so we must set the CORS header on the streamed response ourselves, or
    // the browser blocks the response body from JS even though it arrives.
    reply.hijack();
    const res = reply.raw;
    const headers: Record<string, string> = {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    };
    // Public storefront widget endpoint: reflect the requesting origin (no
    // credentials are used, so this is safe). Mirrors the global CORS policy,
    // which the hijacked response bypasses.
    const origin = request.headers.origin;
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
    res.writeHead(200, headers);

    // The client is gone only when the RESPONSE socket closes before we've
    // finished. (Do NOT key off request.raw "close" — that fires as soon as
    // the request body is read, long before the client disconnects.)
    let clientGone = false;
    res.on("close", () => {
      if (!res.writableEnded) clientGone = true;
    });

    const write = (event: StreamEvent) => {
      if (!clientGone && !res.writableEnded && !res.destroyed) {
        res.write(JSON.stringify(event) + "\n");
      }
    };

    try {
      await runChatTurn(messages, write, turn);
    } catch (err) {
      request.log.error({ err }, "chat turn failed");
      write({ type: "error", message: "Sorry, something went wrong. Please try again." });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
}
