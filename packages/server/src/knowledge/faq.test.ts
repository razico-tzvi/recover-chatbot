import { test } from "node:test";
import assert from "node:assert/strict";
import { searchFaq, loadPolicies } from "./faq.ts";

test("loadPolicies returns the policy markdown", async () => {
  const md = await loadPolicies();
  assert.match(md, /Shipping/);
});

test("searchFaq surfaces the relevant section for a returns question", async () => {
  const result = await searchFaq("how do I return an item");
  assert.match(result.toLowerCase(), /return/);
});

test("searchFaq gives a graceful note when nothing matches", async () => {
  const result = await searchFaq("zzqqxx nonexistent topic");
  assert.match(result, /No matching policy section|human/i);
});
