// CB-1d.3a / C2 — ProductCard memo + stable-handler source pins. Companion to
// lib/pos-layout-paths.test.ts (the grid and the loading skeleton). The memo +
// product-bound callbacks let 127/128 tiles bail out of a re-render that used
// to touch every ProductCard on the screen. Raw readFileSync pins, same
// REPO_ROOT/readSrc/stripComments idiom as pos-layout-paths.test.ts.
//
// U1 Task 3 (2026-10-21; owner Q5-Q7, design 6.4, values 4.1-4.6 in docs/superpowers/specs/2026-10-20-pos-html-values.md):
// the tile is the owner's HTML card. Its price buttons add at once (owner Q5) with exactly the options modal's untouched
// add (lib/pos-price-buttons.ts), the name opens the modal, so the corner "Add with note or quantity" button and its
// NotebookPen icon are gone (the pinned words now name the name button); today's 40px thumbnail / icon / initial square
// gives way to the HTML's photo area, shown only for an item with a photo (owner Q6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const PRODUCT_CARD = "apps/cafe/components/pos/ProductCard.tsx";
const PRODUCT_GRID = "apps/cafe/components/pos/ProductGrid.tsx";
const MODIFIER_MODAL = "apps/cafe/components/pos/ModifierModal.tsx";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const GLOBALS_CSS = "apps/cafe/app/globals.css";

/** The class-string literal a `const NAME = "...";` (or `export const`) declares. */
function constString(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} =\\s*"([^"]*)";`));
  assert.ok(m, `${name} must be declared as one plain string literal`);
  return m![1];
}
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

test("PIN: ProductCard is wrapped in a named, exported React.memo", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.match(src, /import\s*\{[^}]*\bmemo\b[^}]*\}\s*from\s*"react"/, 'ProductCard.tsx must import memo from "react"');
  assert.match(
    src,
    /export const ProductCard = memo\(function ProductCard\(/,
    "ProductCard.tsx must declare export const ProductCard = memo(function ProductCard( — named wrapper, so the profiler row stays comparable",
  );
});

test("PIN: the card's callbacks are product-bound (onAdd also takes the price button's variation); the name opens the options modal under the pinned words; the qty badge keeps its words", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.match(src, /onAdd:\s*\(product:\s*Product,\s*variation\?:\s*string\)\s*=>\s*void;/, "ProductCardProps must declare onAdd: (product: Product, variation?: string) => void;");
  assert.match(src, /onOptions:\s*\(product:\s*Product\)\s*=>\s*void;/, "ProductCardProps must declare onOptions: (product: Product) => void;");
  // The name button (values 4.1 name button): it opens the modal; the corner button's pinned words follow the name.
  const name = src.slice(src.indexOf('data-ui="pos-card-name"'), src.indexOf("</button>", src.indexOf('data-ui="pos-card-name"')));
  assert.ok(name.length > 0, "landmark: the name button");
  assert.ok(name.includes("onClick={() => onOptions(product)}"), "a tap on the name opens the options modal");
  assert.ok(name.includes("aria-label={`${product.name}: Add with note or quantity`}"), "the pinned words, after the visible name");
  assert.ok(name.includes("disabled={outOfStock}"), "an out-of-stock name opens nothing (values 4.2)");
  assert.ok(name.includes("title={product.name}"), "a name cut by the ellipsis stays readable (values 4.1)");
  assert.match(src, /aria-label=\{`\$\{qty\} in cart`\}/, "landmark: the qty badge must keep aria-label={`${qty} in cart`}");
  // U1 final fix wave: the tag line is heard too (its words were hidden behind the aria-label), then the badge.
  assert.ok(
    name.includes("aria-describedby={cardNameDescribedBy({ tagId, badgeId, tag: tag.text, inCart })}"),
    "the name button is described by the tag line and the badge (lib/pos-price-buttons.ts, unit-tested), so both are heard",
  );
  assert.match(src, /<span id=\{tagId\} data-ui="pos-card-tag"/, "the tag line carries its own id");
  // The corner options button and its icon are gone (owner Q5: the name opens the modal).
  assert.ok(!src.includes("NotebookPen"), "no NotebookPen corner button");
  assert.ok(!src.includes("POS_TILE_OPTIONS"), "no corner-button classes");
  assert.equal(src.split("Add with note or quantity").length - 1, 1, "the pinned words appear once, on the name button");
});

test("PIN: a price button adds its own item or variation at once; \"Choose\" opens the modal; both buttons lock when out of stock (owner Q5, values 4.1-4.2)", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.match(src, /import \{[^}]*\bpriceButtonsFor\b[^}]*\} from "@\/lib\/pos-price-buttons"/, "the buttons come from the pure, unit-tested helper");
  assert.ok(src.includes("const buttons = priceButtonsFor(product);"), "one button list per card");
  const strip = src.slice(src.indexOf("{buttons.map((b) => ("));
  assert.ok(strip.length > 0, "landmark: the price buttons");
  assert.ok(
    strip.includes("onClick={() => (b.opensOptions ? onOptions(product) : onAdd(product, b.variation))}"),
    "a price adds with the button's own variation; the Choose button opens the modal (never a silent default size)",
  );
  assert.ok(strip.includes("disabled={outOfStock}"), "an out-of-stock price adds nothing (values 4.2)");
  // Ruling P9: not the HTML's "Add {label}" ("Add Add" on a plain item): the title names the item (and the variation).
  assert.ok(strip.includes("title={priceButtonTitle(product.name, b)}"), "the title comes from the unit-tested priceButtonTitle");
  assert.ok(!strip.includes("`Add ${b.label}`"), "never the HTML's \"Add {label}\" title");
  assert.ok(src.includes("const outOfStock = product.available === false;"), "only an explicit available:false locks the card");
  assert.equal(src.split("disabled={outOfStock}").length - 1, 2, "exactly the name button and the price buttons lock");
  assert.ok(src.includes("const tag = cardTag(product, { showCategory, categoryLabel });"), "the tag line comes from the pure helper");
});

test("PIN: pos/page.tsx's price-button add is the modal's untouched add (owner Q5); both handlers stay useCallback'd; the page stays 299 lines", () => {
  const src = readSrc(POS_PAGE);
  const stripped = stripComments(src);

  assert.match(stripped, /import\s*\{[^}]*\buseCallback\b[^}]*\}\s*from\s*"react"/, 'pos/page.tsx must import useCallback from "react"');
  assert.match(stripped, /const handleProductClick = useCallback\(\(product: Product, variation\?: string\) => \{\s*addToCart\(product, defaultAddOptions\(product, variation\)\);\s*\}, \[addToCart\]\);/, "a price button adds exactly the modal's untouched add, with its variation");
  assert.match(stripped, /import \{ defaultAddOptions \} from "@\/lib\/pos-price-buttons";/, "the add's options come from the unit-tested helper");
  assert.match(stripped, /const handleProductOptions = useCallback\(/, "pos/page.tsx must declare const handleProductOptions = useCallback(");
  assert.match(stripped, /const \{ addToCart \} = pos;/, "pos/page.tsx must destructure addToCart from pos once — a method call pos.addToCart() makes eslint's exhaustive-deps demand the whole per-render pos object, which would defeat the memo");
  assert.match(stripped, /onProductClick=\{handleProductClick\}/, "the grid's price buttons add through it");
  assert.match(stripped, /onProductOptions=\{handleProductOptions\}/, "the grid's names (and Choose) open the modal through it");

  const lineCount = src.replace(/\n$/, "").split("\n").length;
  // CB-DL-2: the category state now holds a category _id (or the ALL sentinel)
  // instead of a name, but pos/page.tsx stays at 299 lines: the explanatory
  // comment that would have made it 300 was dropped because the sibling pin
  // in pos-modals-paths.test.ts requires strictly < 300 and the ceiling is
  // the whole point of both pins. The meaning lives in CategorySidebar's
  // value/label split and ProductGrid's categoryId filter instead.
  assert.equal(lineCount, 299, "CB-1d.4: pos/page.tsx is 299 (CB-1d.3c's PosModals extraction took it 314 -> 296; CB-1d.4 added the useUnsavedGuard import + call + one comment = +3 for the browser-close warning; CB-DL-2 changed no line count; the 2026-09-28 foreground settle added the paymentNotice prop and shortened the PosModals comment by one line = net 0; U1 Tasks 1-3 kept it at 299) - re-point this number only when a slice deliberately moves code in or out of this file, never upward past 300, got " + lineCount);
});

// lib/pos-price-buttons.ts's defaultAddOptions mirrors the modal's untouched add; if the modal changes how it builds its
// add (or how it opens), these needles fail and the helper must follow.
test("PIN: the options modal still opens with initialSelected / no note / qty 1 and adds {...pickModifierResult(product, selected), note, qty, variation} — what defaultAddOptions mirrors", () => {
  const src = stripComments(readSrc(MODIFIER_MODAL));
  assert.match(src, /setSelected\(initialSelected\(product\)\);\s*setInstructions\(""\);\s*setQty\(1\);/, "the modal opens untouched: the item's initial ticks, no note, qty 1");
  assert.match(
    src,
    /onConfirm\(product, \{\s*\.\.\.pickModifierResult\(product, selected\),\s*instructions: instructions\.trim\(\),\s*qty,\s*variation,\s*\}\);/,
    "the modal's add: the modifier split, the trimmed note, the qty and the variation",
  );
});

test("PIN: ProductGrid passes ONE stable handler per callback into filtered.map — no fresh inline arrow prop on <ProductCard, and the old inline card/import are gone", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));

  const mapIdx = src.indexOf("filtered.map(");
  assert.ok(mapIdx >= 0, "landmark: ProductGrid.tsx must still call filtered.map(");
  const closeIdx = src.indexOf("</div>", mapIdx);
  assert.ok(closeIdx > mapIdx, "must find a closing </div> after filtered.map(");
  const block = src.slice(mapIdx, closeIdx);

  assert.ok(block.includes("<ProductCard"), "the filtered.map( block must render <ProductCard");
  assert.ok(block.includes("onAdd={onProductClick}"), "the filtered.map( block must pass onAdd={onProductClick}");
  assert.ok(block.includes("onOptions={onProductOptions}"), "the filtered.map( block must pass onOptions={onProductOptions}");

  // Negative pin: no inline arrow prop anywhere in the block besides the
  // map's own "(product) =>" — strip that one occurrence, then nothing named
  // "=>" may remain (a fresh `() => ...` prop would defeat the whole memo).
  const withoutMapArrow = block.replace("filtered.map(", "").replace(/\(product\)\s*=>/, "");
  assert.ok(!withoutMapArrow.includes("=>"), `filtered.map( block must carry no inline arrow prop besides its own (product) =>, got:\n${block}`);

  // The grouped layout passes the same two stable handlers.
  const groupIdx = src.indexOf("group.items.map(");
  assert.ok(groupIdx >= 0, "landmark: the By category layout maps each group's items");
  const groupBlock = src.slice(groupIdx, src.indexOf("</div>", groupIdx));
  assert.ok(groupBlock.includes("onAdd={onProductClick}") && groupBlock.includes("onOptions={onProductOptions}"), "the groups pass the same handlers");
  assert.ok(!groupBlock.replace("group.items.map(", "").replace(/\(product\)\s*=>/, "").includes("=>"), "no inline arrow prop in the groups either");

  assert.ok(!src.includes("function ProductCard("), "ProductGrid.tsx must no longer declare function ProductCard( — it moved to ./ProductCard");
  assert.ok(!src.includes("NotebookPen"), "ProductGrid.tsx must not reference NotebookPen");
});

// ── The HTML's card (values 4.1-4.6) ─────────────────────────────────────────────────────────────────────────────

test("PIN: the card is the HTML's: radius 14, 12px padding, its parts 10px apart, the lift on hover, the accent border and ring in the cart, .45 out of stock", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  const shell = tokens(constString(src, "CARD_SHELL_CLASS"));
  for (const t of ["flex", "flex-col", "gap-2.5", "rounded-[14px]", "border", "bg-card", "p-3"]) assert.ok(shell.includes(t), `the card shell (values 4.1): "${t}"`);
  const motion = constString(src, "CARD_MOTION_CLASS");
  assert.ok(motion.includes("[transition:transform_.28s_cubic-bezier(.2,.8,.2,1),box-shadow_.28s,border-color_.2s]"), "the HTML's card transition");
  assert.ok(motion.includes("hover:[transform:translateY(-2px)]") && motion.includes("hover:[box-shadow:0_10px_26px_rgba(0,0,0,.08)]"), "the hover lift and shadow");
  assert.ok(motion.includes("motion-reduce:transition-none"), "no motion with reduced motion");
  assert.equal(constString(src, "IN_CART_CLASS"), "border-primary [box-shadow:0_0_0_1px_var(--primary)]", "in the cart: the accent border and a 1px accent ring");
  assert.ok(src.includes('inCart ? IN_CART_CLASS : "border-border"'), "else the plain border");
  assert.ok(src.includes('outOfStock && "opacity-45"'), "out of stock: .45 (values 4.2)");
});

test("PIN: the name (14.5/500, -.005em, one line with an ellipsis), the 12px tag (--bad-i when unavailable) and the 20px qty badge with the HTML's pop", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.ok(src.includes('className="truncate text-[14.5px] font-medium tracking-[-0.005em]"'), "the name (values 4.1)");
  assert.ok(src.includes('tag.tone === "bad" ? "text-status-bad-ink" : "text-muted-foreground"'), "the tag's colour (values 4.2 tagColor)");
  const badge = tokens(constString(src, "BADGE_CLASS"));
  for (const t of ["h-5", "min-w-5", "flex-none", "rounded-[10px]", "bg-primary", "px-1.5", "text-[12px]", "font-semibold", "text-primary-foreground", "motion-safe:animate-html-pop"]) {
    assert.ok(badge.includes(t), `the qty badge (values 4.1): "${t}"`);
  }
  assert.ok(!src.includes("productIconComponent"), "no icon / initial square: the photo area or nothing (owner Q6)");
  const css = readSrc(GLOBALS_CSS);
  assert.match(css, /--animate-html-pop: html-pop 0\.35s cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) both;/, "the HTML's pop timing (values 4.1)");
  assert.match(
    css,
    /@keyframes html-pop \{\s*0% \{\s*transform: scale\(0\.4\);\s*opacity: 0;\s*\}\s*60% \{\s*transform: scale\(1\.18\);\s*\}\s*100% \{\s*transform: scale\(1\);\s*opacity: 1;\s*\}\s*\}/,
    "the HTML's pop keyframes, verbatim",
  );
});

test("PIN: the price strip and its buttons are the HTML's (values 4.1, 0.3 priceH): --surface-2, radius 8, 2px; buttons 40px (46px below 1100px), 10.5px label in --text-2 over a 13.5px/600 price, line-height 1.15", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  const strip = tokens(constString(src, "PRICE_STRIP_CLASS"));
  for (const t of ["grid", "gap-0.5", "rounded-[8px]", "bg-surface-2", "p-0.5"]) assert.ok(strip.includes(t), `the strip: "${t}"`);
  assert.equal(constString(src, "PRICE_HEIGHT_CLASS"), "h-10 max-desk:h-[46px]", "values 0.3 priceH: desk 40, else 46");
  const button = tokens(constString(src, "PRICE_BUTTON_CLASS"));
  for (const t of [
    "flex", "flex-col", "items-center", "justify-center", "rounded-[6px]", "bg-transparent", "px-1.5", "py-px", "leading-[1.15]", "text-foreground",
    "hover:bg-card", "hover:[box-shadow:0_1px_2px_rgba(0,0,0,.1)]", "not-disabled:active:bg-accent", "disabled:cursor-not-allowed",
  ]) {
    assert.ok(button.includes(t), `a price button (values 4.1): "${t}"`);
  }
  assert.ok(src.includes('className="max-w-full truncate text-[10.5px] text-muted-foreground"'), "the size word, cut with an ellipsis when long (design 6.4)");
  assert.ok(src.includes('className="max-w-full truncate text-[13.5px] font-semibold"'), "the price");
  assert.match(src, /const STRIP_COLUMNS = \["grid-cols-1", "grid-cols-2", "grid-cols-3"\] as const;/, "one column per button (values 4.2 cols)");
});

test("PIN: the card's height is the HTML's 117px (123px below 1100px): 1 + 12 + the 37px name block + 10 + the strip (priceH + 4) + 12 + 1 (values 4.3)", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  const shell = tokens(constString(src, "CARD_SHELL_CLASS"));
  const pad = Number(shell.find((t) => /^p-[\d.]+$/.test(t))!.slice(2)) * 4;
  const gap = Number(shell.find((t) => /^gap-[\d.]+$/.test(t))!.slice(4)) * 4;
  const stripPad = Number(tokens(constString(src, "PRICE_STRIP_CLASS")).find((t) => /^p-[\d.]+$/.test(t))!.slice(2)) * 4;
  const [desk, below] = constString(src, "PRICE_HEIGHT_CLASS").split(" ");
  const priceDesk = Number(desk.slice(2)) * 4;
  const priceBelow = Number(below.match(/\[(\d+)px\]/)![1]);
  const NAME_BLOCK = 19 + 2 + 16; // the name (14.5px, normal) + the column's 2px gap + the tag (12px, normal)
  assert.ok(src.includes('className="flex min-w-0 flex-1 flex-col gap-0.5"'), "the name column is 2px apart (values 4.1)");
  const height = (price: number) => 1 + pad + NAME_BLOCK + gap + (price + 2 * stripPad) + pad + 1;
  assert.equal(height(priceDesk), 117, "from 1100px (values 4.3)");
  assert.equal(height(priceBelow), 123, "below 1100px (values 4.3)");
});

test("PIN: the photo area shows only for an item with a photo: 112px (96px on a phone), radius 10, --surface-2, cover, greyscale when out of stock (owner Q6, values 4.1/4.6)", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  // U1 final fix wave: Cloudinary scales the photo to fit (c_fit, no crop) and the box's object-cover crops it once,
  // instead of a c_fill square crop cropped again by the 194x112 / 340x96 box.
  assert.ok(src.includes("const photo = productImageUrl(product.image, CARD_PHOTO_PX, { fit: true });"), "the stored ref resolved by lib/images.ts, cropped once");
  const at = src.indexOf("{photo && (");
  assert.ok(at >= 0, "the area renders only when there is a photo");
  const area = src.slice(at, src.indexOf("</div>", at));
  assert.ok(area.includes('"relative h-28 overflow-hidden rounded-[10px] bg-surface-2 max-tab:h-24"'), "the HTML's box");
  assert.ok(area.includes('outOfStock && "[filter:grayscale(1)]"'), "greyscale when out of stock (values 4.2 photoFilter)");
  assert.match(area, /<Image src=\{photo\} alt="" fill sizes="[^"]+" className="object-cover" \/>/, "next/image fills the box, cover");
  assert.ok(src.indexOf("{photo && (") < src.indexOf('data-ui="pos-card-name"'), "the photo sits above the name (values 4.1)");
});
