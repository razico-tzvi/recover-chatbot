// Cleans the bot's reply before it reaches the shopper. A prompt rule alone
// doesn't stop the model from leaking internal details now and then, so this
// runs in code on every streamed reply:
//  - text written in a tool round ("Found it - product 150. Let me check its
//    configurator.") is held back and dropped when the round ends in a tool call;
//  - internal product ids ("(id 163, $14.95)", "product 150") are removed;
//  - mentions of the store's internal sources ("per the override rule") are removed;
//  - working-note sentences ("Let me confirm …", "Found it.") are removed.
// No store-specific wording: it only matches generic patterns.

// A tool round's text is held until the round ends. Past this many characters it
// is treated as a real answer and streams (still cleaned sentence by sentence).
export const HOLD_CHARS = 300;
// Sentence buffer: flush even without a sentence end past this length.
const MAX_PENDING = 600;

const ID = String.raw`(?:product\s+)?\bid\b\s*[:#=]?\s*\d+(?![\/\w])|\bproduct\s*#?\s*\d+(?![\/\w])`;
const SOURCE = String.raw`(?:override\s+(?:rules?|notes?|instructions?)|store\s+guidelines|(?:general\s+)?guidelines\s+(?:i(?:'ve| have)\s+been\s+given)|system\s+prompt|internal\s+(?:rules?|notes?))`;

// Marks where a sentence lead-in was cut, for re-capitalizing.
const CUT = "\u0000";

const RULES = [
  // "(id 163)", "(product id 163)", "(ID: 163)", "(product 163)"
  [new RegExp(String.raw`\s*\(\s*(?:${ID})\s*\)`, "gi"), ""],
  // "(id 163, $14.95, in stock)" → "($14.95, in stock)"
  [new RegExp(String.raw`\(\s*(?:${ID})\s*[,;]\s*`, "gi"), "("],
  // "($14.95, id 163)" → "($14.95)"
  [new RegExp(String.raw`\s*[,;]\s*(?:${ID})(?=\s*\))`, "gi"), ""],
  // "(product id 163, titled …)" leftovers and bare "product id 163" / "id 163" / "product 150"
  [new RegExp(String.raw`,?\s*(?:\bproduct\s+)?\bid\b\s*[:#=]?\s*\d+(?![\/\w])`, "gi"), ""],
  [/\b(products?)\s+#?\d{2,}(?![\/\w]|\.\d)/gi, "$1"],
  // A lone id label whose number is gone: "(id works with …)" → "(works with …)".
  // Lower-case only, so "(ID required)" / "photo ID" stay.
  [/\(\s*(?:product\s+)?id\b\s*[:#=]?\s*(?=[^\d\s])/g, "("],
  [/([,;]\s*)(?:product\s+)?id\b\s*[:#=]?\s*(?=\))/g, ""],
  // "Per the override rule for this store, that's …" / "(per our override note)"
  [new RegExp(String.raw`\s*\(\s*(?:as\s+|according\s+to\s+|per\s+)(?:the|our|my|this\s+store'?s)\s+${SOURCE}[^)]*\)`, "gi"), ""],
  [new RegExp(String.raw`\b(?:as\s+|according\s+to\s+|per\s+|based\s+on\s+)(?:the|our|my|this\s+store'?s)\s+${SOURCE}(?:\s+for\s+this\s+store)?\s*[,:—–-]?\s*`, "gi"), CUT],
];

// Whole sentences that are the bot's own working notes, not an answer.
const NOTE_RE = /(?<=^\s*|[.!?:]\s+|\n\s*)(?:found it\s*[-–—:,]?\s*(?:the\s+)?(?:products?)?\s*(?=[.!]|$)|(?:let me|i'll|i will|now i'll|now let me)\s+(?:check|confirm|look|search|pull|find|verify|see|get|grab|double-check|take a look|fetch|review)\b)[^.!?\n]*(?:[.!?…]+|:(?=\s|$)|$)[ \t]*/gi;

/** Clean one complete piece of reply text (whole sentences). */
export function cleanReply(text) {
  let s = String(text || "");
  for (const [re, to] of RULES) s = s.replace(re, to);
  s = s.replace(NOTE_RE, "");
  // Capitalize a sentence start left lower-case by a removed lead-in
  // ("Per the override rule, that's …" → "That's …"). Only where text was cut,
  // so bare links at a line start ("https://…") are left alone.
  s = s.replace(new RegExp(String.raw`(^|[.!?]\s+|\n[ \t]*)${CUT}([a-z])`, "g"), (m, lead, c) => lead + c.toUpperCase());
  s = s.split(CUT).join("");
  return s
    .replace(/\(\s*[—–\-,;:]+\s*/g, "(") // "( — works …)" left by a removed id
    .replace(/\(\s+/g, "(")
    .replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").replace(/\s*\(\s*\)/g, "");
}

// Text that may be the start of an id still being streamed ("(id", "product id:",
// "(id 16"): never cut a chunk right after it, or the number arrives in the next
// chunk and the label is left behind.
const ID_TAIL = /(?:\(\s*)?(?:\bproduct\s*(?:\bid\b)?|\bid\b|#)\s*[:#=]?\s*\d*\s*$/i;

// Index just past the last sentence end (". ", "!\n", "\n" …) that is safe to
// cut at, or 0. Safe = outside any open "( … )" (so "(id: 163, $14.95)" is
// cleaned in one piece) and not right after an id label ("Product id: 163").
// A blank line closes any parenthesis left open.
export function lastBoundary(s) {
  let k = 0, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === "\n" && s[i + 1] === "\n") depth = 0;
    const end = c === "\n" || (/[.!?:]/.test(c) && /\s/.test(s[i + 1] || ""));
    if (end && depth === 0 && !ID_TAIL.test(s.slice(Math.max(0, i - 40), i + 1))) k = i + 1;
  }
  return k;
}

// Forced cut for an over-long buffer: the last space that doesn't split an id.
function forcedCut(s) {
  let k = s.length;
  for (;;) {
    const m = ID_TAIL.exec(s.slice(Math.max(0, k - 40), k));
    if (!m || !m[0].trim()) break;
    k = Math.max(0, k - 40) + m.index;
  }
  const sp = s.lastIndexOf(" ", k);
  return sp > 0 ? sp + 1 : k;
}

/**
 * Wraps the stream writer. `send(text)` receives only cleaned text.
 *   delta(t)    — model text for the current round
 *   toolRound() — the current round ended in a tool call
 *   finish()    — the reply is over; flush everything
 */
export function replyFilter(send, logger) {
  let held = "";        // this round's text, not yet released
  let streaming = false; // this round passed HOLD_CHARS and streams
  let pending = "";     // released text waiting for a sentence end
  let sent = false;     // anything sent yet (to trim leading blank lines)

  const out = (t) => {
    if (!t) return;
    if (!sent) { t = t.replace(/^\s+/, ""); if (!t) return; sent = true; }
    send(t);
  };
  const release = (t) => {
    pending += t;
    let k = lastBoundary(pending);
    if (!k && pending.length > MAX_PENDING) k = forcedCut(pending);
    if (k > 0) { out(cleanReply(pending.slice(0, k))); pending = pending.slice(k); }
  };

  return {
    delta(t) {
      if (!t) return;
      if (streaming) return release(t);
      held += t;
      if (held.length >= HOLD_CHARS) { streaming = true; release(held); held = ""; }
    },
    toolRound() {
      if (held.trim()) logger?.info({ dropped: held.slice(0, 300) }, "chat: dropped text written before a tool call");
      held = "";
      if (streaming) release("\n\n");
      streaming = false;
    },
    finish() {
      if (held) release(held);
      held = "";
      streaming = false;
      if (pending) { out(cleanReply(pending)); pending = ""; }
    },
  };
}
