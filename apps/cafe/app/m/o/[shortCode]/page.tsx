import { notFound } from "next/navigation";
import { isPublicCode } from "@pos/shared/public";
import { PublicOrderStatus } from "@/components/public/PublicOrderStatus";

interface PublicOrderStatusPageProps {
  params: Promise<{ shortCode: string }>;
}

// A diner's order-status URL — /m/o/<shortCode> (publicOrderStatusPath).
// Shape-validated here, same discipline as /m/[token]: a malformed segment
// 404s at the page boundary rather than round-tripping to the API with
// garbage. This path sits under /m/, so the middleware's public exemption
// already covers it (isPublicPath matches "/m" and "/m/<anything>").
export default async function PublicOrderStatusPage({
  params,
}: PublicOrderStatusPageProps) {
  const { shortCode } = await params;
  if (!isPublicCode(shortCode)) notFound();

  return <PublicOrderStatus code={shortCode} />;
}
