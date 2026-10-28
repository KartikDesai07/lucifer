import assert from "node:assert/strict";

// Shared by the render tests that read class tokens off static markup (U0 match Task 10, review m8): the opening tag of
// an element carrying data-ui="<name>", its class tokens (with React's &amp; escape undone, so an arbitrary variant
// like [&::-webkit-search-cancel-button]:… reads as written), and an assertion that every token is there.

/** The opening tag of the nth element with data-ui="<name>" ("" when there is none). */
export const tagOf = (html: string, name: string, nth = 0): string =>
  (html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [])[nth] ?? "";

/** Every opening tag carrying data-ui="<name>". */
export const tagsOf = (html: string, name: string): string[] =>
  html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [];

/** The text of the nth element carrying data-ui="<name>" (its own closing tag found by nesting depth; &amp; undone). */
export const textOf = (html: string, name: string, nth = 0): string => {
  const open = [...html.matchAll(new RegExp(`<([a-z0-9]+) [^>]*data-ui="${name}"[^>]*>`, "g"))][nth];
  assert.ok(open, `landmark: data-ui="${name}" #${nth + 1} renders`);
  const start = (open.index ?? 0) + open[0].length;
  const re = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "g");
  re.lastIndex = start;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  }
  return "";
};

/** The class tokens of an opening tag. */
export const classesOf = (tag: string): string[] =>
  (tag.match(/class="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);

/** Every class token is on the tag; the tag must exist. */
export const expectAll = (tag: string, classes: string[], label: string): void => {
  assert.ok(tag.length > 0, `landmark: ${label} renders`);
  const have = classesOf(tag);
  for (const c of classes) assert.ok(have.includes(c), `${label} carries ${c} (got "${have.join(" ")}")`);
};
