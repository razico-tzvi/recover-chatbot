import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.js";
import { getSettings, saveSettings } from "../db/settings.js";
import { SESSION_COOKIE } from "./appAuth.js";

const settingsSchema = z
  .object({
    greeting: z.string().max(200).optional(),
    title: z.string().max(60).optional(),
    color: z.string().max(20).optional(),
    systemExtra: z.string().max(2000).optional(),
    escalationEmail: z.string().max(200).optional(),
    slackWebhook: z.string().max(300).optional(),
  })
  .strict();

/** Resolve + verify the store from the signed session cookie, or null. */
function sessionStore(request: FastifyRequest): string | null {
  const raw = request.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Save merchant settings. Auth = signed session cookie set at /auth or /load.
  // CSRF guard: the admin page is served from APP_URL, so a cross-origin write
  // (which SameSite=None would otherwise allow) is rejected by Origin check.
  app.post("/api/settings", async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== config.APP_URL) {
      return reply.code(403).send({ error: "Cross-origin write rejected." });
    }
    const storeHash = sessionStore(request);
    if (!storeHash) return reply.code(401).send({ error: "Not authenticated." });

    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid settings." });

    const saved = saveSettings(storeHash, parsed.data);
    return { ok: true, settings: saved };
  });

  // Public per-store theming for the injected widget (no secrets).
  app.get("/api/widget-config", async (request, reply) => {
    const { store } = request.query as Record<string, string | undefined>;
    if (!store) return reply.code(400).send({ error: "Missing store." });
    const s = getSettings(store);
    return { greeting: s.greeting, title: s.title, color: s.color };
  });
}
