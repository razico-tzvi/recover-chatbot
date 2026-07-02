import type { ChatMessage, StreamEvent } from "@recover/shared";
import { config } from "../config.js";
import { runAnthropicTurn } from "./anthropic.js";
import { runOpenAITurn } from "./openai.js";
import type { TurnContext } from "./tools.js";

/**
 * Run one assistant turn using the configured LLM provider. Both providers
 * stream the same StreamEvents to `emit`, so callers are provider-agnostic.
 */
export function runChatTurn(
  history: ChatMessage[],
  emit: (event: StreamEvent) => void,
  turn: TurnContext = {},
): Promise<void> {
  return config.LLM_PROVIDER === "openai"
    ? runOpenAITurn(history, emit, turn)
    : runAnthropicTurn(history, emit, turn);
}
