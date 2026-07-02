import type { FastifyInstance, FastifyReply } from "fastify";
import { exchangeCode } from "../app/oauth.js";
import { verifySignedPayload } from "../app/jwt.js";
import { installWidgetScript } from "../app/scripts.js";
import { upsertStore, deleteStore, storeExists } from "../db/stores.js";
import { getSettings } from "../db/settings.js";
import { renderAdminPage } from "../admin/page.js";

export const SESSION_COOKIE = "bc_session";

/** Set the signed, iframe-safe session cookie identifying the store. */
function setSession(reply: FastifyReply, storeHash: string): void {
  reply.setCookie(SESSION_COOKIE, storeHash, {
    signed: true,
    httpOnly: true,
    secure: true,
    sameSite: "none", // app renders inside the BigCommerce control-panel iframe
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

function sendAdmin(reply: FastifyReply, storeHash: string): void {
  reply
    .type("text/html")
    .send(renderAdminPage(storeHash, getSettings(storeHash), storeExists(storeHash)));
}

export async function appAuthRoutes(app: FastifyInstance): Promise<void> {
  // OAuth Auth Callback — merchant clicks Install.
  app.get("/auth", async (request, reply) => {
    const { code, scope, context } = request.query as Record<string, string | undefined>;
    if (!code || !scope || !context) {
      return reply.code(400).send("Missing required OAuth parameters.");
    }
    try {
      const { accessToken, scope: grantedScope, storeHash } = await exchangeCode(code, scope, context);
      upsertStore(storeHash, accessToken, grantedScope);

      // Auto-inject the storefront widget (non-fatal if it fails).
      try {
        await installWidgetScript(storeHash, accessToken);
      } catch (err) {
        request.log.warn({ err }, "widget script injection failed");
      }

      setSession(reply, storeHash);
      return sendAdmin(reply, storeHash);
    } catch (err) {
      request.log.error({ err }, "OAuth install failed");
      return reply.code(500).send("Installation failed. Please try again.");
    }
  });

  // Load Callback — merchant opens the app in the control panel.
  app.get("/load", async (request, reply) => {
    const { signed_payload_jwt } = request.query as Record<string, string | undefined>;
    if (!signed_payload_jwt) return reply.code(400).send("Missing signed payload.");
    try {
      const { storeHash } = verifySignedPayload(signed_payload_jwt);
      if (!storeExists(storeHash)) {
        return reply.code(410).send("This store isn't installed. Please reinstall the app.");
      }
      setSession(reply, storeHash);
      return sendAdmin(reply, storeHash);
    } catch (err) {
      request.log.warn({ err }, "load payload verification failed");
      return reply.code(401).send("Invalid signed payload.");
    }
  });

  // Uninstall Callback — merchant removes the app.
  app.get("/uninstall", async (request, reply) => {
    const { signed_payload_jwt } = request.query as Record<string, string | undefined>;
    if (!signed_payload_jwt) return reply.code(400).send("Missing signed payload.");
    try {
      const { storeHash } = verifySignedPayload(signed_payload_jwt);
      deleteStore(storeHash); // storefront script auto-removes (auto_uninstall)
      return reply.code(200).send("Uninstalled.");
    } catch (err) {
      request.log.warn({ err }, "uninstall payload verification failed");
      return reply.code(401).send("Invalid signed payload.");
    }
  });

  // Remove-user Callback (multi-user apps) — nothing per-user to clean up yet.
  app.get("/remove-user", async () => ({ ok: true }));
}
