import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { chatRoutes } from "./routes/chat.js";

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 256 * 1024, // 256 KB — chat payloads are small
  });

  // Lock CORS to the configured storefront origins. If none are configured,
  // allow same-origin only (no cross-origin browser calls).
  await app.register(cors, {
    origin: config.ALLOWED_ORIGINS.length > 0 ? config.ALLOWED_ORIGINS : false,
    methods: ["POST", "GET", "OPTIONS"],
  });

  // Per-IP rate limiting to protect the upstream model spend.
  await app.register(rateLimit, {
    max: 30,
    timeWindow: "1 minute",
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  await app.register(chatRoutes);

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Chatbot server listening on :${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
