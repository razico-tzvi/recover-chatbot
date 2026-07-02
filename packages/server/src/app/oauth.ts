import { config } from "../config.js";

const TOKEN_URL = "https://login.bigcommerce.com/oauth2/token";

export interface TokenResult {
  accessToken: string;
  scope: string;
  storeHash: string;
}

interface TokenResponse {
  access_token: string;
  scope: string;
  context: string; // "stores/{hash}"
}

/**
 * Exchange the `code` from the Auth Callback for a permanent store access
 * token. `redirect_uri` must exactly match the app's registered Auth Callback
 * URL (`<APP_URL>/auth`).
 */
export async function exchangeCode(
  code: string,
  scope: string,
  context: string,
): Promise<TokenResult> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: config.BC_CLIENT_ID,
      client_secret: config.BC_CLIENT_SECRET,
      code,
      scope,
      grant_type: "authorization_code",
      redirect_uri: `${config.APP_URL}/auth`,
      context,
    }),
  });

  if (!res.ok) {
    throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as TokenResponse;
  const storeHash = (data.context || context).replace(/^stores\//, "");
  return { accessToken: data.access_token, scope: data.scope, storeHash };
}
