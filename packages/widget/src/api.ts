import type { ChatMessage, StreamEvent } from "@recover/shared";

/**
 * POST the conversation and stream newline-delimited JSON events back,
 * invoking `onEvent` for each. Resolves when the stream ends. Errors are
 * surfaced as an `error` StreamEvent rather than thrown, so callers have one
 * code path.
 */
export async function streamChat(
  apiBase: string,
  sessionId: string,
  messages: ChatMessage[],
  onEvent: (event: StreamEvent) => void,
  store?: string,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, messages, store: store || undefined }),
      signal,
    });
  } catch {
    onEvent({ type: "error", message: "Couldn't reach the server. Please try again." });
    return;
  }

  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: "Sorry, something went wrong. Please try again." });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const dispatch = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onEvent(JSON.parse(trimmed) as StreamEvent);
    } catch {
      /* ignore malformed line */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      dispatch(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  }
  dispatch(buf);
}
