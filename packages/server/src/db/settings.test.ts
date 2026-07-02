import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Provide a minimal valid config (app mode off) and an isolated DB before the
// db module — which reads config at import — is loaded. Each test file runs in
// its own process, so these env writes don't leak.
process.env.LLM_PROVIDER = "openai";
process.env.OPENAI_BASE_URL = "http://localhost:1/v1";
process.env.OPENAI_MODEL = "x";
process.env.MOCK_BIGCOMMERCE = "true";
process.env.DATABASE_PATH = join(tmpdir(), `recover-settings-test-${process.pid}.db`);

const { getSettings, saveSettings, DEFAULT_SETTINGS } = await import("./settings.ts");

test("getSettings returns defaults for an unknown store", () => {
  const s = getSettings("never-seen");
  assert.equal(s.greeting, DEFAULT_SETTINGS.greeting);
  assert.equal(s.color, DEFAULT_SETTINGS.color);
});

test("saveSettings persists a partial patch and getSettings reads it back", () => {
  saveSettings("store1", { greeting: "Hello!", escalationEmail: "s@store1.com" });
  const s = getSettings("store1");
  assert.equal(s.greeting, "Hello!");
  assert.equal(s.escalationEmail, "s@store1.com");
  // Untouched fields keep their defaults.
  assert.equal(s.title, DEFAULT_SETTINGS.title);
});

test("saveSettings merges successive patches", () => {
  saveSettings("store2", { title: "Support" });
  saveSettings("store2", { color: "#ff0000" });
  const s = getSettings("store2");
  assert.equal(s.title, "Support");
  assert.equal(s.color, "#ff0000");
});
