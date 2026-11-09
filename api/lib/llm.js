// Non-streaming, tool-less LLM call for background jobs (CRM ticket drafting,
// the sales learning loop).
// Uses the store's Integrations settings: Anthropic in production; the
// OpenAI-compatible endpoint only outside production (same rule as POST /chat).

export function llmConfig(store, role) {
  const provider = (store.llmProvider || process.env.LLM_PROVIDER || "anthropic").toLowerCase();
  const roleModel = provider === "anthropic" ? store.anthropicModels?.[role] : "";
  const model = roleModel || store.llmModel || (provider === "anthropic" ? "" : process.env.OPENAI_MODEL);
  const baseUrl = store.llmBaseUrl || process.env.OPENAI_BASE_URL;
  const apiKey = store.llmApiKey || (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY) || "";
  const devOnlyBlocked = provider !== "anthropic" && process.env.GADGET_ENV === "production";
  const configured = provider === "anthropic" ? !!(model && apiKey) : !!(baseUrl && model) && !devOnlyBlocked;
  return { provider, model, baseUrl, apiKey, configured };
}

// Returns { text, truncated } — truncated when the output hit maxTokens.
export async function complete(cfg, { system, user, maxTokens = 2000, timeoutMs = 90_000 }) {
  if (cfg.provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    return { text, truncated: data.stop_reason === "max_tokens" };
  }
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
    body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const data = await res.json();
  const choice = data.choices?.[0] || {};
  return { text: choice.message?.content || "", truncated: choice.finish_reason === "length" };
}
