import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LIMITS, type StreamEvent } from "@recover/shared";
import { runChatTurn } from "../ai/chat.js";

const bodySchema = z.object({
  sessionId: z.string().min(1).max(LIMITS.maxSessionIdChars),
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

    const { messages } = parsed.data;
    if (messages[messages.length - 1]?.role !== "user") {
      return reply.code(400).send({ error: "The last message must be from the user." });
    }

    // Take over the socket and stream newline-delimited JSON events.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    const write = (event: StreamEvent) => {
      if (!res.writableEnded) res.write(JSON.stringify(event) + "\n");
    };

    let clientGone = false;
    request.raw.on("close", () => {
      clientGone = true;
    });

    try {
      await runChatTurn(messages, (event) => {
        if (!clientGone) write(event);
      });
    } catch (err) {
      request.log.error({ err }, "chat turn failed");
      write({ type: "error", message: "Sorry, something went wrong. Please try again." });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
}
