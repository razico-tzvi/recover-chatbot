import type { ChatMessage, StreamEvent } from "@recover/shared";
import { config } from "../config.js";
import { buildSystemText } from "./systemPrompt.js";
import { toolDefinitions, runTool, toolStatusLabel, type ToolContext } from "./tools.js";

const MAX_ITERATIONS = 6;
const MAX_TOKENS = 2048;

interface OpenAIToolCall {
  id: string;
  name: string;
  arguments: string; // accumulated JSON string
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/** Translate our Anthropic-style tool defs into OpenAI function tools. */
const openaiTools = toolDefinitions.map((t) => ({
  type: "function" as const,
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

/**
 * Run one assistant turn against any OpenAI-compatible /v1/chat/completions
 * endpoint (Ollama, LM Studio, llama.cpp, vLLM, …) with streaming and
 * tool-calling. Emits the same StreamEvents as the Anthropic path.
 */
export async function runOpenAITurn(
  history: ChatMessage[],
  emit: (event: StreamEvent) => void,
): Promise<void> {
  const ctx: ToolContext = { transcript: history };
  const messages: OpenAIMessage[] = [
    { role: "system", content: await buildSystemText() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const res = await fetch(`${config.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.OPENAI_MODEL,
        messages,
        tools: openaiTools,
        tool_choice: "auto",
        stream: true,
        max_tokens: MAX_TOKENS,
      }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI-compatible endpoint ${res.status}: ${body.slice(0, 300)}`);
    }

    const { text, toolCalls } = await consumeStream(res.body, emit);

    if (toolCalls.length === 0) {
      emit({ type: "done" });
      return;
    }

    // Record the assistant's tool-call turn, then execute and feed results back.
    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: c.arguments || "{}" },
      })),
    });

    for (const call of toolCalls) {
      emit({ type: "tool_status", label: toolStatusLabel(call.name) });
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      } catch {
        /* leave empty on malformed args */
      }
      const result = await runTool(call.name, input, ctx);
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  emit({
    type: "text",
    delta: " I'm having trouble completing that — let me connect you with a human if you'd like.",
  });
  emit({ type: "done" });
}

/** Parse the SSE stream, emit text deltas, and accumulate any tool calls. */
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  emit: (event: StreamEvent) => void,
): Promise<{ text: string; toolCalls: OpenAIToolCall[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  const toolCalls: OpenAIToolCall[] = [];

  const handleData = (data: string) => {
    if (data === "[DONE]") return;
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta;
    if (!delta) return;

    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      emit({ type: "text", delta: delta.content });
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx: number = tc.index ?? 0;
        const existing = (toolCalls[idx] ??= { id: "", name: "", arguments: "" });
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("data:")) handleData(line.slice(5).trim());
    }
  }

  // Some tool-calls may have empty ids (Ollama); synthesize stable ones.
  toolCalls.forEach((c, i) => {
    if (!c.id) c.id = `call_${i}`;
  });

  return { text, toolCalls: toolCalls.filter((c) => c.name) };
}
