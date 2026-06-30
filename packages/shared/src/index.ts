/**
 * Types shared between the server and the embeddable widget.
 * Kept dependency-free so both a Node build and a browser build can import it.
 */

/** A single chat turn as exchanged between widget and server. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Request body for POST /api/chat. */
export interface ChatRequest {
  sessionId: string;
  messages: ChatMessage[];
}

/**
 * Server → widget stream events, sent as newline-delimited JSON (NDJSON).
 * Each line is one JSON-encoded StreamEvent.
 */
export type StreamEvent =
  /** Incremental assistant text. */
  | { type: "text"; delta: string }
  /** Human-readable status while a tool runs, e.g. "Searching products…". */
  | { type: "tool_status"; label: string }
  /** Terminal success event; the turn is complete. */
  | { type: "done" }
  /** Terminal error event; `message` is safe to show the user. */
  | { type: "error"; message: string };

/** Limits enforced on both ends. */
export const LIMITS = {
  /** Max characters in a single user message. */
  maxUserMessageChars: 4000,
  /** Max prior turns the widget sends with each request. */
  maxHistoryMessages: 40,
  /** Max characters for a sessionId. */
  maxSessionIdChars: 100,
} as const;
