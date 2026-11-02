// Helpers shared by the integration test action and the chat route.

// Accepts "acme", "acme.freshdesk.com" or "https://acme.freshdesk.com/…".
export function freshdeskHost(domain) {
  let d = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!d) return "";
  if (!d.includes(".")) d += ".freshdesk.com";
  return /^[a-z0-9.-]+$/.test(d) ? d : "";
}

export const freshdeskConnected = (store) => !!(freshdeskHost(store?.freshdeskDomain) && store?.freshdeskApiKey);

// Opens a Freshdesk ticket for a chat handoff. Returns the ticket id.
export async function createFreshdeskTicket(store, { email, subject, description }) {
  const host = freshdeskHost(store.freshdeskDomain);
  const res = await fetch(`https://${host}/api/v2/tickets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${store.freshdeskApiKey}:X`).toString("base64"),
    },
    body: JSON.stringify({ email, subject, description, status: 2, priority: 2, source: 7, tags: ["ai-handoff"] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Freshdesk ${res.status}`);
  const t = await res.json();
  return t?.id;
}
