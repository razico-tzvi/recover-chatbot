import { test } from "node:test";
import assert from "node:assert/strict";
import { emailsMatch } from "./verify.ts";

test("emailsMatch is case- and whitespace-insensitive on a match", () => {
  assert.equal(emailsMatch("Jane@Example.com", "  jane@example.com "), true);
});

test("emailsMatch rejects a different email", () => {
  assert.equal(emailsMatch("jane@example.com", "john@example.com"), false);
});

test("emailsMatch never matches when the order has no billing email", () => {
  assert.equal(emailsMatch(undefined, ""), false);
  assert.equal(emailsMatch("", "anything@example.com"), false);
});
