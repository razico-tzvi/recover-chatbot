import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { config, appModeEnabled } from "./config.js";
import { chatRoutes } from "./routes/chat.js";

const here = dirname(fileURLToPath(import.meta.url));
const widgetJsPath = join(here, "..", "..", "widget", "dist", "widget.js");

async function main(): Promise<void> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 256 * 1024,
  });

  // The chat + widget endpoints are a public storefront surface, so reflect any
  // origin — but disallow credentials cross-origin. Admin writes are protected
  // separately by an Origin check + signed session cookie (see routes/admin).
  await app.register(cors, { origin: true, credentials: false });

  await app.register(cookie, { secret: config.SESSION_SECRET ?? "dev-insecure-session-secret" });

  await app.register(rateLimit, { max: 30, timeWindow: "1 minute" });

  app.get("/api/health", async () => ({ status: "ok", appMode: appModeEnabled }));

  // Serve the widget bundle so <APP_URL>/widget.js works.
  app.get("/widget.js", async (_request, reply) => {
    try {
      const js = await readFile(widgetJsPath, "utf8");
      return reply
        .type("application/javascript; charset=utf-8")
        .header("Cache-Control", "public, max-age=300")
        .send(js);
    } catch {
      return reply.code(404).send("// widget bundle not built");
    }
  });

  await app.register(chatRoutes);

  // App-mode routes (OAuth install, admin UI, settings) only when configured.
  if (appModeEnabled) {
    const { appAuthRoutes } = await import("./routes/appAuth.js");
    const { adminRoutes } = await import("./routes/admin.js");
    await app.register(appAuthRoutes);
    await app.register(adminRoutes);
    app.log.info("BigCommerce app mode enabled");
  }

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
    app.log.info(`Chatbot server listening on :${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
