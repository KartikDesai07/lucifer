"use client";

import { useState } from "react";
import Image from "next/image";

import { productImageUrl } from "@/lib/images";
import { cn } from "@/lib/utils";

// CB-6C — the diner surface's image-or-initial tile. Most cafes ship with NO
// product photos at all (the live client: 189 items, 0 photos), so the
// fallback is the PRIMARY design, not an afterthought: the item's initial in
// the display font on a brand tint. Three tints, chosen by a stable hash of
// `tintKey` (the category name on the menu, so one category's tiles share a
// tone and the list reads grouped rather than random). All three are tokens
// the owner's preset emits, so every cafe stays on-brand in light AND dark.
//
// Once a photo exists it simply replaces the initial — no layout change.

export type InitialTileSize = 40 | 48 | 64 | 80;

// Whole literals per size (Tailwind JIT needs them spelled out).
const SIZE_CLASS: Record<InitialTileSize, string> = {
  40: "h-10 w-10 rounded-lg text-sm",
  48: "h-12 w-12 rounded-lg text-base",
  64: "h-16 w-16 rounded-xl text-xl",
  80: "h-20 w-20 rounded-xl text-2xl",
};

const TINT_CLASSES = [
  "bg-primary/10 text-primary",
  "bg-secondary text-secondary-foreground",
  "bg-muted text-foreground",
] as const;

// Stable, cheap string hash → tint index. Deterministic across renders and
// devices, so the same category always gets the same tone.
export function tintIndexFor(key: string): number {
  let hash = 0;
  for (const ch of key) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return hash % TINT_CLASSES.length;
}

// First CODE POINT, never the first UTF-16 code unit: a name that starts with
// an emoji or a Devanagari letter would otherwise render a broken half-char
// (memory: code-unit cuts break emoji/Devanagari).
export function initialOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "•";
  return (Array.from(trimmed)[0] ?? "•").toUpperCase();
}

interface PublicInitialTileProps {
  name: string;
  // What the tint is keyed on — the category for menu tiles, the name itself
  // for an avatar. Defaults to `name`.
  tintKey?: string;
  // Opaque image ref (r2:/local:/cloudinary) — "" or undefined = no photo.
  imageRef?: string;
  size: InitialTileSize;
  // Sold-out / disabled look: greyscale + dimmed, the tile itself stays.
  muted?: boolean;
  className?: string;
}

export function PublicInitialTile({ name, tintKey, imageRef, size, muted = false, className }: PublicInitialTileProps) {
  const [failed, setFailed] = useState(false);
  const url = imageRef ? productImageUrl(imageRef, size * 2) : null;

  if (url && !failed) {
    return (
      <Image
        src={url}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(SIZE_CLASS[size], "shrink-0 object-cover", muted && "grayscale opacity-60", className)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        SIZE_CLASS[size],
        TINT_CLASSES[tintIndexFor(tintKey ?? name)],
        "grid shrink-0 place-items-center font-pub-display font-semibold",
        muted && "grayscale opacity-60",
        className,
      )}
    >
      {initialOf(name)}
    </span>
  );
}
