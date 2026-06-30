/**
 * Pure identity-verification helpers for order lookup. Kept dependency-free
 * (no config/client imports) so the security-critical check is unit-testable
 * in isolation.
 */

/**
 * Case-insensitive, whitespace-trimmed email equality. An empty order email
 * never matches (defensive: an order with no billing email can't be verified).
 */
export function emailsMatch(orderEmail: string | undefined, provided: string): boolean {
  const a = (orderEmail ?? "").trim().toLowerCase();
  const b = provided.trim().toLowerCase();
  return a.length > 0 && a === b;
}
