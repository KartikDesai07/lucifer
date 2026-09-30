// Pure helpers for the Categories drag-and-drop screen (Menu redesign, slice
// C). No React, no dnd-kit import here — CategoryArrangeList/CategoryRow call
// these; node:test exercises them directly.

import type { Category, Product } from "@/types";

/** Move `id` by `delta` positions in an ordered id list (arrow-button step). */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id);
  if (index < 0) return [...ids];
  const target = index + delta;
  if (target < 0 || target >= ids.length) return [...ids];
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** A new category goes after the last one (max + 1) — stable even after a
 * delete leaves a gap, unlike the old `list.length` (owner clause 3e/5). */
export function nextCategoryOrder(list: readonly Category[]): number {
  if (list.length === 0) return 0;
  return Math.max(...list.map((c) => c.order)) + 1;
}

export interface CategoryItemCounts {
  active: number;
  archived: number;
}

/** Same all-items rule as the server's category-delete 409 (archived items
 * still count): active items NOT counted differently from archived ones for
 * the "can this be deleted" question — the two are reported separately here
 * so the row can say "N items · M archived", but a delete is blocked by
 * active + archived together. */
export function itemCountsByCategory(
  active: readonly Product[],
  archived: readonly Product[],
): Map<string, CategoryItemCounts> {
  const counts = new Map<string, CategoryItemCounts>();
  const bump = (categoryId: string, key: keyof CategoryItemCounts) => {
    const existing = counts.get(categoryId) ?? { active: 0, archived: 0 };
    existing[key] += 1;
    counts.set(categoryId, existing);
  };
  for (const product of active) bump(product.categoryId, "active");
  for (const product of archived) bump(product.categoryId, "archived");
  return counts;
}

// Plain-English screen-reader announcements for the drag (DndContext
// `accessibility.announcements`). `position`/`total` are 1-based.
export function pickedUpAnnouncement(name: string, position: number, total: number): string {
  return `Picked up ${name}. Position ${position} of ${total}.`;
}

export function movedAnnouncement(name: string, position: number, total: number): string {
  return `${name} moved to position ${position} of ${total}.`;
}

export function droppedAnnouncement(name: string, position: number, total: number): string {
  return `${name} dropped at position ${position} of ${total}.`;
}

export function cancelledAnnouncement(name: string): string {
  return `Moving ${name} was cancelled.`;
}
