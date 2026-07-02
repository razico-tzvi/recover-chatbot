import type Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, StreamEvent } from "@recover/shared";
import { anthropic, MODEL } from "./client.js";
import { buildSystem } from "./systemPrompt.js";
import { toolDefinitions, runTool, toolStatusLabel, type ToolContext } from "./tools.js";

/** Hard cap on tool-use rounds to prevent runaway loops. */
const MAX_ITERATIONS = 6;
const MAX_TOKENS = 4096;

/**
 * Run one assistant turn against the Anthropic Messages API: stream Claude's
 * response to `emit`, executing tools as requested until the model finishes.
 */
export async function runAnthropicTurn(
  history: ChatMessage[],
  emit: (event: StreamEvent) => void,
): Promise<void> {
  const system = await buildSystem();
  const ctx: ToolContext = { transcript: history };

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: "adaptive" },
      system,
      tools: toolDefinitions,
      messages,
    });

    stream.on("text", (delta) => emit({ type: "text", delta }));
    stream.on("contentBlock", (block) => {
      if (block.type === "tool_use") {
        emit({ type: "tool_status", label: toolStatusLabel(block.name) });
      }
    });

    const response = await stream.finalMessage();

    if (response.stop_reason !== "tool_use") {
      emit({ type: "done" });
      return;
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (tu) => {
        const result = await runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, ctx);
        return { type: "tool_result" as const, tool_use_id: tu.id, content: result };
      }),
    );

    messages.push({ role: "user", content: toolResults });
  }

  emit({
    type: "text",
    delta: " I'm having trouble completing that — let me connect you with a human if you'd like.",
  });
  emit({ type: "done" });
}
