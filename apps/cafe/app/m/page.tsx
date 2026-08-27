import { readPublicAppearance } from "@/lib/public-appearance";
import { PublicOrderFlow } from "@/components/public/PublicOrderFlow";

// The diner's landing URL (@pos/shared/public's PUBLIC_MENU_PATH) — no table
// resolved yet, so PublicOrderFlow renders PublicMenu (which itself renders
// the name-based TableChooser, ADDENDUM 1) alongside the cart/sheet/identity
// flow (SLICE 8). A Server Component: the ONLY server-side DB reach anywhere
// under app/m/** is THIS page (and app/m/[token]/page.tsx and app/m/layout.tsx)
// calling @/lib/public-appearance → readSettings for the theme/chrome (A13.5)
// — everything else the diner sees comes from client-side fetches inside
// PublicOrderFlow's own tree, never a Mongoose/requireAuth-gated call here.
export default async function PublicMenuPage() {
  const appearance = await readPublicAppearance();
  const chrome = { heroImage: appearance.heroImage, logoPlacement: appearance.logoPlacement };
  return <PublicOrderFlow chrome={chrome} />;
}
