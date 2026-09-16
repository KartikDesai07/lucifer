// CB-1d.3a / C2 — ProductCard memo + stable-handler source pins. Companion to
// lib/pos-layout-paths.test.ts (the POS_TILE_MIN_REM parity pin there now
// reads ProductCard.tsx). This is a PURE REFACTOR: memo + product-bound
// callbacks let 127/128 tiles bail out of a re-render that used to touch
// every ProductCard/NotebookPen/Icon on the screen. Raw readFileSync pins,
// same REPO_ROOT/readSrc/stripComments idiom as pos-layout-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const PRODUCT_CARD = "apps/cafe/components/pos/ProductCard.tsx";
const PRODUCT_GRID = "apps/cafe/components/pos/ProductGrid.tsx";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";

test("PIN: ProductCard is wrapped in a named, exported React.memo", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/, 'ProductCard.tsx must import memo from "react"');
  assert.match(
    src,
    /export const ProductCard = memo\(function ProductCard\(/,
    "ProductCard.tsx must declare export const ProductCard = memo(function ProductCard( — named wrapper, so the profiler row stays comparable",
  );
});

test("PIN: ProductCard's callbacks are product-bound, and the tile keeps its a11y/profiler landmarks (options button, NotebookPen icon, qty badge)", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.match(src, /onClick:\s*\(product:\s*Product\)\s*=>\s*void;/, "ProductCardProps must declare onClick: (product: Product) => void;");
  assert.match(src, /onOptions:\s*\(product:\s*Product\)\s*=>\s*void;/, "ProductCardProps must declare onOptions: (product: Product) => void;");
  assert.match(src, /onClick\(product\)/, "the card body must bind onClick(product)");
  assert.match(src, /onOptions\(product\)/, "the card body must bind onOptions(product)");
  assert.match(src, /aria-label="Add with note or quantity"/, 'landmark: the options button must keep aria-label="Add with note or quantity"');
  assert.match(src, /<NotebookPen/, "landmark: the options button must still render <NotebookPen");
  assert.match(src, /aria-label=\{`\$\{qty\} in cart`\}/, 'landmark: the qty badge must keep aria-label={`${qty} in cart`}');
});

test("PIN: ProductGrid passes ONE stable handler per callback into filtered.map — no fresh inline arrow prop on <ProductCard, and the old inline card/import are gone", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));

  const mapIdx = src.indexOf("filtered.map(");
  assert.ok(mapIdx >= 0, "landmark: ProductGrid.tsx must still call filtered.map(");
  const closeIdx = src.indexOf("</div>", mapIdx);
  assert.ok(closeIdx > mapIdx, "must find a closing </div> after filtered.map(");
  const block = src.slice(mapIdx, closeIdx);

  assert.ok(block.includes("<ProductCard"), "the filtered.map( block must render <ProductCard");
  assert.ok(block.includes("onClick={onProductClick}"), "the filtered.map( block must pass onClick={onProductClick}");
  assert.ok(block.includes("onOptions={onProductOptions}"), "the filtered.map( block must pass onOptions={onProductOptions}");

  // Negative pin: no inline arrow prop anywhere in the block besides the
  // map's own "(product) =>" — strip that one occurrence, then nothing named
  // "=>" may remain (a fresh `() => ...` prop would defeat the whole memo).
  const withoutMapArrow = block.replace("filtered.map(", "").replace(/\(product\)\s*=>/, "");
  assert.ok(!withoutMapArrow.includes("=>"), `filtered.map( block must carry no inline arrow prop besides its own (product) =>, got:\n${block}`);

  // Vision guard for the two negative pins below: confirm ProductGrid still
  // renders something (the positive landmarks above already do this), plus
  // explicit absence checks for what Slice 1 moved out.
  assert.ok(!src.includes("function ProductCard("), "ProductGrid.tsx must no longer declare function ProductCard( — it moved to ./ProductCard");
  assert.ok(!src.includes("NotebookPen"), "ProductGrid.tsx must no longer import/reference NotebookPen — it moved to ./ProductCard");
});

test("PIN: pos/page.tsx wraps both product handlers in useCallback (handleProductClick deps on the destructured [addToCart]), and the file is under the ~300-line invariant after the CB-1d.3c PosModals extraction", () => {
  const src = readSrc(POS_PAGE);
  const stripped = stripComments(src);

  assert.match(stripped, /import\s*\{[^}]*\buseCallback\b[^}]*\}\s*from\s*"react"/, 'pos/page.tsx must import useCallback from "react"');
  assert.match(stripped, /const handleProductClick = useCallback\(/, "pos/page.tsx must declare const handleProductClick = useCallback(");
  assert.match(stripped, /const handleProductOptions = useCallback\(/, "pos/page.tsx must declare const handleProductOptions = useCallback(");
  assert.match(stripped, /const \{ addToCart \} = pos;/, "pos/page.tsx must destructure addToCart from pos once — a method call pos.addToCart() makes eslint's exhaustive-deps demand the whole per-render pos object, which would defeat the memo");
  assert.match(stripped, /\[addToCart\]\);/, "handleProductClick's deps array must be [addToCart] — the destructured, useCallback'd addToCart from use-cart.ts");

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  // CB-DL-2: the category state now holds a category _id (or the ALL sentinel)
  // instead of a name, but pos/page.tsx stays at 299 lines: the explanatory
  // comment that would have made it 300 was dropped because the sibling pin
  // in pos-modals-paths.test.ts requires strictly < 300 and the ceiling is
  // the whole point of both pins. The meaning lives in CategorySidebar's
  // value/label split and ProductGrid's categoryId filter instead.
  assert.equal(lineCount, 299, "CB-1d.4: pos/page.tsx is 299 (CB-1d.3c's PosModals extraction took it 314 -> 296; CB-1d.4 added the useUnsavedGuard import + call + one comment = +3 for the browser-close warning; CB-DL-2 changed no line count) - re-point this number only when a slice deliberately moves code in or out of this file, never upward past 300, got " + lineCount);
});
