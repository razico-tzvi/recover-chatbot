import { test } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { verifyWithSecret } from "./jwtVerify.ts";

const SECRET = "test-client-secret";

test("verifyWithSecret accepts a correctly-signed payload and extracts the store hash", () => {
  const token = jwt.sign({ sub: "stores/abc123", user: { email: "m@x.com" } }, SECRET, {
    algorithm: "HS256",
  });
  const session = verifyWithSecret(token, SECRET);
  assert.equal(session.storeHash, "abc123");
  assert.equal(session.userEmail, "m@x.com");
});

test("verifyWithSecret rejects a payload signed with a different secret", () => {
  const token = jwt.sign({ sub: "stores/abc123" }, "wrong-secret", { algorithm: "HS256" });
  assert.throws(() => verifyWithSecret(token, SECRET));
});

test("verifyWithSecret rejects a tampered token", () => {
  const token = jwt.sign({ sub: "stores/abc123" }, SECRET, { algorithm: "HS256" });
  const tampered = token.slice(0, -4) + "AAAA";
  assert.throws(() => verifyWithSecret(tampered, SECRET));
});

test("verifyWithSecret rejects a payload with no store hash", () => {
  const token = jwt.sign({ user: { email: "m@x.com" } }, SECRET, { algorithm: "HS256" });
  assert.throws(() => verifyWithSecret(token, SECRET));
});
