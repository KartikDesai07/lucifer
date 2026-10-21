// The customer sheet's words (U1 Task 10; values 8.2-8.3 in docs/superpowers/specs/2026-10-20-pos-html-values.md; owner
// Q1: the HTML's words where it has the element; rulings P34-P37), shared by CustomerSearch and CustomerAddForm. Pure:
// no React, no fetching; client-safe.

/** The sheet's title while searching, and over the add form (P36). */
export const CUSTOMER_TITLE = "Customer";
export const NEW_CUSTOMER_TITLE = "New customer";
/** The foot link (P37; was "Walk-In"): removes an attached customer, else just closes. */
export const SKIP_CUSTOMER_LABEL = "Continue without customer";
/** The no-match line's second line (P34). */
export const NO_MATCH_HINT = "Add them as new, it takes 5 seconds.";

/** The caption over the list, from the rows on screen (P34): "No matches", "1 match", "{n} matches" (upper-cased by its
 *  style). */
export function customerListCaption(count: number): string {
  if (count === 0) return "No matches";
  return `${count} ${count === 1 ? "match" : "matches"}`;
}

/** The no-match line's first line (P34): the query that found nobody, in curly quotes. */
export function noMatchText(query: string): string {
  return `No customer found for “${query}”.`;
}

/** The new-customer button (P35): the query typed, in curly quotes, as the form will be seeded from it (trimmed). */
export function newCustomerLabel(term: string): string {
  const q = term.trim();
  return q ? `+ New customer “${q}”` : "+ New customer";
}

/** The mobile field's count: what today's rule counts (the trimmed length; it passes at 10), never more than 10. */
export function mobileCountText(mobile: string): string {
  return `${Math.min(mobile.trim().length, 10)}/10`;
}
