"use strict";
// Old Android WebViews (Chromium < 111, e.g. 109 on Android 13 counter tablets) cannot read
// color-mix(). Tailwind v4 writes an opacity utility on a theme colour as a SOLID fallback plus a
// color-mix() override inside @supports, so on those engines bg-primary/10 paints the full colour.
// This step runs AFTER Tailwind and the oklab fallback:
//   1. for each colour custom property --x that a tint needs, it adds --x-rgb next to EVERY
//      definition of --x (outside @supports), so light (:root) and dark (.dark) each get their own:
//      "R G B" for a plain sRGB value, var(--y-rgb) for an alias var(--y);
//   2. it rewrites each solid fallback var(--x) whose @supports twin is
//      color-mix(in oklab, var(--x) N%, transparent) to rgb(var(--x-rgb) / N%). A fallback rule the
//      optimizer merged with other selectors (.bg-x,.bg-x\/10) is split first, so the plain
//      utility keeps its solid colour.
// Space-separated rgb() with a slash alpha works from Chromium 65. A token that is not plain sRGB
// in every definition (its own alpha, a gradient, an unknown alias) gets no twin anywhere and keeps
// Tailwind's fallback: a twin missing in one theme would inherit the other theme's channels.

const MIX = /^color-mix\(in oklab,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*transparent\)$/;
const SUPPORTS_MIX = /color:\s*color-mix\(in lab,\s*red,\s*red\)/;
const ALIAS = /^var\((--[\w-]+)\)$/;

/** "rgb(37 99 235)", "rgb(37, 99, 235)", "#2563eb" or "#26e" → "37 99 235"; anything else → null. */
function channelsOf(value) {
  const v = value.trim().toLowerCase();
  let m = /^rgb\(\s*(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)\s*\)$/.exec(v);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  m = /^#([\da-f]{3}|[\da-f]{6})$/.exec(v);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(" ");
}

function insideSupports(node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === "atrule" && p.name === "supports") return true;
  return false;
}

/** @returns {import("postcss").Declaration | null} */
function declOf(rule, prop) {
  /** @type {import("postcss").Declaration | null} */
  let found = null;
  rule.each((node) => {
    if (node.type === "decl" && node.prop === prop) found = node;
  });
  return found;
}

/** The rule holding the solid declaration Tailwind wrote for the same property: the nearest earlier
 *  sibling whose selector list includes the @supports rule's selector (optimized, flattened CSS), or
 *  the rule the @supports block is nested in (dev CSS). */
function fallbackRule(supports, modern) {
  const owner = modern.parent;
  if (owner && owner.type === "rule") {
    for (let node = supports.prev(); node; node = node.prev()) {
      if (node.type === "rule" && node.selectors.includes(owner.selector) && declOf(node, modern.prop)) return node;
    }
  }
  if (supports.parent && supports.parent.type === "rule" && declOf(supports.parent, modern.prop)) return supports.parent;
  return null;
}

/** @returns {import("postcss").Declaration | null} */
function findFallback(supports, modern) {
  const rule = fallbackRule(supports, modern);
  return rule === null ? null : declOf(rule, modern.prop);
}

/** @type {import("postcss").PluginCreator<Record<string, never>>} */
function tintFallback() {
  return {
    postcssPlugin: "pos-tint-fallback",
    OnceExit(root) {
      // Every definition of each custom property that an old engine actually reads.
      const defs = new Map();
      root.walkDecls(/^--/, (decl) => {
        if (decl.prop.endsWith("-rgb") || insideSupports(decl)) return;
        if (!defs.has(decl.prop)) defs.set(decl.prop, []);
        defs.get(decl.prop).push(decl);
      });
      const verdict = new Map();
      const twinnable = (prop, seen = new Set()) => {
        if (verdict.has(prop)) return verdict.get(prop);
        if (seen.has(prop) || !defs.has(prop)) return false;
        seen.add(prop);
        const ok = defs.get(prop).every((decl) => {
          if (channelsOf(decl.value) !== null) return true;
          const alias = ALIAS.exec(decl.value.trim());
          return alias !== null && twinnable(alias[1], seen);
        });
        verdict.set(prop, ok);
        return ok;
      };

      const rewrites = [];
      root.walkAtRules("supports", (supports) => {
        if (!SUPPORTS_MIX.test(supports.params)) return;
        supports.walkDecls((modern) => {
          const m = MIX.exec(modern.value);
          if (!m || !twinnable(m[1])) return;
          const rule = fallbackRule(supports, modern);
          if (rule !== null && declOf(rule, modern.prop).value.trim() === `var(${m[1]})`) rewrites.push({ rule, modern, token: m[1], pct: m[2] });
        });
      });

      const twinned = new Set();
      const twin = (prop) => {
        if (twinned.has(prop)) return;
        twinned.add(prop);
        for (const decl of defs.get(prop)) {
          const channels = channelsOf(decl.value);
          const alias = channels === null ? ALIAS.exec(decl.value.trim())[1] : null;
          if (alias !== null) twin(alias);
          decl.cloneAfter({ prop: `${prop}-rgb`, value: channels ?? `var(${alias}-rgb)` });
        }
      };

      for (const { rule, modern, token, pct } of rewrites) {
        twin(token);
        let target = rule;
        if (rule.type === "rule" && rule.selectors.length > 1) {
          // Split .bg-x,.bg-x\/10 so only the tint changes; the copy sits where the merged rule was.
          target = rule.cloneAfter({ selectors: [modern.parent.selector] });
          rule.selectors = rule.selectors.filter((s) => s !== modern.parent.selector);
        }
        declOf(target, modern.prop).value = `rgb(var(${token}-rgb) / ${pct}%)`;
      }
    },
  };
}
tintFallback.postcss = true;
tintFallback.channelsOf = channelsOf;
tintFallback.findFallback = findFallback;

module.exports = tintFallback;
