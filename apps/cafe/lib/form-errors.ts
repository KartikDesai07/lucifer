import type { FieldErrors, FieldValues } from "react-hook-form";

// react-hook-form reports a NESTED field's validation errors as a tree: an
// object field (settings `appearance`) or an array field (`promoCodes`) shows
// up under its own top-level key with no `message` of its own, only children
// (`appearance.accentOverride`, `promoCodes.1.code`). A caller that reads
// `errors[firstKey].message` therefore sees `undefined` for exactly those
// fields, and `setFocus(firstKey)` targets a container no input is registered
// under — so the operator gets a generic toast and no focus. This walks down to
// the first leaf that carries a message and returns its dotted path, which IS
// the registered field name react-hook-form's setFocus() expects.
export interface FirstErrorLeaf {
  path: string;
  message: string | undefined;
}

// A react-hook-form error tree is finite (it mirrors the form's own shape), but
// a bounded walk keeps this total against any future shape surprise.
const MAX_ERROR_DEPTH = 8;

// Keys react-hook-form puts on an error NODE itself, never on a child field.
const ERROR_NODE_OWN_KEYS = new Set(["message", "type", "types", "ref"]);

function isErrorNode(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function firstErrorLeaf<T extends FieldValues>(errors: FieldErrors<T>): FirstErrorLeaf | undefined {
  const [rootKey] = Object.keys(errors);
  if (!rootKey) return undefined;

  let path = rootKey;
  let node: unknown = (errors as Record<string, unknown>)[rootKey];

  for (let depth = 0; depth < MAX_ERROR_DEPTH; depth++) {
    if (!isErrorNode(node)) return { path, message: undefined };
    if (typeof node.message === "string") return { path, message: node.message };

    // An array-level error (e.g. "Keep it under N codes") is parked under
    // `root`; it belongs to the array itself, so the path stays put.
    const rootError = node.root;
    if (isErrorNode(rootError) && typeof rootError.message === "string") {
      return { path, message: rootError.message };
    }

    // Otherwise descend into the first child that actually carries an error
    // (array holes are `undefined`; own bookkeeping keys are skipped). `current`
    // pins the narrowed node for the callback, which cannot see the guard above.
    const current = node;
    const childKey = Object.keys(current).find(
      (key) => !ERROR_NODE_OWN_KEYS.has(key) && current[key] !== undefined && current[key] !== null,
    );
    if (!childKey) return { path, message: undefined };
    path = `${path}.${childKey}`;
    node = current[childKey];
  }

  return { path, message: undefined };
}
