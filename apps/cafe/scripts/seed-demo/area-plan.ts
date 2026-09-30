/**
 * Demo floor areas (pure): the seeded tables are split into contiguous bands,
 * one per area, so the demo Floor / Setup / picker show real headings. The LAST
 * table carries the rooftop seating charge (seed-core.ts), so the last band is
 * the rooftop. No DB, no randomness — deterministic by position.
 */

export const DEMO_AREA_NAMES = ["AC Hall", "Garden", "Rooftop"] as const;

/** Which area (index into DEMO_AREA_NAMES) table `tableIndex` of `totalTables`
 *  belongs to: contiguous bands, non-decreasing; whenever there are at least as
 *  many tables as areas the last index lands in the last area. With fewer tables
 *  than areas the trailing areas may go unused (the seeder only creates areas a
 *  table uses). */
export function demoAreaIndexOf(tableIndex: number, totalTables: number): number {
  const areaCount = DEMO_AREA_NAMES.length;
  if (totalTables <= 0) return 0;
  return Math.min(areaCount - 1, Math.floor((tableIndex * areaCount) / totalTables));
}
