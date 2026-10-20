import assert from "node:assert/strict";

// Shared by the render tests that read class tokens off static markup (U0 match Task 10, review m8): the opening tag of
// an element carrying data-ui="<name>", its class tokens (with React's &amp; escape undone, so an arbitrary variant
// like [&::-webkit-search-cancel-button]:… reads as written), and an assertion that every token is there.

/** The opening tag of the nth element with data-ui="<name>" ("" when there is none). */
export const tagOf = (html: string, name: string, nth = 0): string =>
  (html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [])[nth] ?? "";

/** The class tokens of an opening tag. */
export const classesOf = (tag: string): string[] =>
  (tag.match(/class="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);

/** Every class token is on the tag; the tag must exist. */
export const expectAll = (tag: string, classes: string[], label: string): void => {
  assert.ok(tag.length > 0, `landmark: ${label} renders`);
  const have = classesOf(tag);
  for (const c of classes) assert.ok(have.includes(c), `${label} carries ${c} (got "${have.join(" ")}")`);
};
