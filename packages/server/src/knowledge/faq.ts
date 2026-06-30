import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// dist/knowledge/faq.js → ../../knowledge/policies.md ; works from src too.
const policiesPath = join(here, "..", "..", "knowledge", "policies.md");

let cachedPolicies: string | null = null;

/**
 * The full policy/FAQ knowledge base as Markdown. Read once and cached in
 * memory. This text is injected into the (prompt-cached) system prompt, so the
 * assistant always has the policies available without a tool round-trip.
 */
export async function loadPolicies(): Promise<string> {
  if (cachedPolicies !== null) return cachedPolicies;
  try {
    cachedPolicies = await readFile(policiesPath, "utf8");
  } catch {
    cachedPolicies = "(No store policies have been configured yet.)";
  }
  return cachedPolicies;
}

/**
 * search_faq tool backing. Because the whole KB is already in the system
 * prompt, this returns relevant sections by simple heading/keyword match — a
 * lightweight retrieval that nudges the model toward the right passage and
 * confirms a policy exists. Swap for embeddings if the KB grows large.
 */
export async function searchFaq(query: string): Promise<string> {
  const md = await loadPolicies();
  const sections = splitSections(md);
  const q = query.toLowerCase();
  const terms = q.split(/\s+/).filter((t) => t.length > 2);

  const scored = sections
    .map((s) => {
      const hay = s.toLowerCase();
      const score = terms.reduce((acc, t) => acc + (hay.includes(t) ? 1 : 0), 0);
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.s);

  if (scored.length === 0) {
    return "No matching policy section found. If the answer isn't in the store policies, say so and offer to connect the shopper to a human.";
  }
  return scored.join("\n\n---\n\n");
}

function splitSections(md: string): string[] {
  // Split on level-2 headings, keeping the heading with its body.
  const parts = md.split(/\n(?=## )/);
  return parts.map((p) => p.trim()).filter(Boolean);
}
