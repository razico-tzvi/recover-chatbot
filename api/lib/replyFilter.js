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

const ID = String.raw`(?:product\s+)?\bid\b\s*[:#]?\s*\d+(?![\/\w])|\bproduct\s*#?\s*\d+(?![\/\w])`;
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
  [new RegExp(String.raw`,?\s*(?:\bproduct\s+)?\bid\b\s*[:#]?\s*\d+(?![\/\w])`, "gi"), ""],
  [/\b(products?)\s+#?\d{2,}(?![\/\w]|\.\d)/gi, "$1"],
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
  return s.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").replace(/\(\s*\)/g, "");
}

// Index just past the last sentence end (". ", "!\n", "\n" …), or 0.
function lastBoundary(s) {
  const re = /[.!?:](?=\s)|\n/g;
  let k = 0, m;
  while ((m = re.exec(s))) k = m.index + 1;
  return k;
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
    const k = pending.length > MAX_PENDING ? pending.length : lastBoundary(pending);
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
