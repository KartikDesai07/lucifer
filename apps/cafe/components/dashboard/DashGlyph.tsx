// One of the owner's HTML glyphs (values 5: a 24x24 outline path), drawn as the HTML draws its dashboard tiles' icons:
// 16px, stroke 1.8, round caps and joins, in the tile's colour (Money leaks, Where orders came from).
export function DashGlyph({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
