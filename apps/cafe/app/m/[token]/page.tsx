import { notFound } from "next/navigation";
import { isPublicToken } from "@pos/shared/public";
import { readPublicAppearance } from "@/lib/public-appearance";
import { PublicOrderFlow } from "@/components/public/PublicOrderFlow";

interface PublicMenuTokenPageProps {
  params: Promise<{ token: string }>;
}

// A table's own URL — /m/<token>. Shape-validated here, BEFORE the token ever
// reaches a client fetch to /api/public/table/<token>, same discipline the
// route itself repeats server-side (packages/shared/src/public.ts). A
// malformed segment 404s at the page boundary rather than round-tripping to
// the API with garbage. This page's only server-side DB reach is
// readPublicAppearance() (A13.5, same invariant as app/m/page.tsx's comment)
// — the table/menu payload itself still resolves client-side inside
// PublicOrderFlow (SLICE 4 §1/§2).
export default async function PublicMenuTokenPage({
  params,
}: PublicMenuTokenPageProps) {
  const { token } = await params;
  if (!isPublicToken(token)) notFound();

  const appearance = await readPublicAppearance();
  const chrome = { heroImage: appearance.heroImage, logoPlacement: appearance.logoPlacement };
  return <PublicOrderFlow token={token} chrome={chrome} />;
}
