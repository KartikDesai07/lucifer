import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";
import { fontVariables } from "@/lib/fonts";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import { readSettings } from "@/lib/settings";
import { APP_NAME } from "@/lib/constants";
import { brandingUrl, productImageUrl } from "@/lib/images";
import "./globals.css";

const METADATA_DESCRIPTION =
  "Point-of-sale and management system for restaurants and cafes";

// File-based metadata (app/favicon.ico) OVERRIDES the metadata object and
// generateMetadata — Next.js docs: "File-based metadata has the higher
// priority and will override the metadata object and generateMetadata
// function." That file is deleted (see report) so this is now the single
// source for the tab title/icon, and it must read Settings to brand them.
export async function generateMetadata(): Promise<Metadata> {
  try {
    // readSettings(), NOT getSettings(): this runs on `/login`, which is public,
    // and getSettings() upserts — its `timestamps: true` bumps `updatedAt` on
    // every call, so anonymous traffic would drive writes against a 512MB M0.
    const settings = await readSettings();
    // `?.` deliberately: this is a `.lean()` read of a document that may predate
    // a field (and may not exist at all on a freshly provisioned cluster) — a
    // bare `.trim()` would throw into the catch below and cost the cafe its tab
    // ICON as well as its name. Same defensive read the sidebar already uses.
    const title = settings?.restaurantName?.trim() || APP_NAME;
    const iconHref =
      productImageUrl(settings?.productLogo) ?? brandingUrl("productLogo");
    return {
      title,
      description: METADATA_DESCRIPTION,
      icons: { icon: [{ url: iconHref }] },
    };
  } catch {
    // A DB-down Settings read must never throw here — generateMetadata
    // throwing turns the LOGIN page into a 500, locking every operator out of
    // a POS whose shell would otherwise render fine. A missing tab icon is
    // not worth that; fall back to static, DB-free metadata.
    return {
      title: APP_NAME,
      description: METADATA_DESCRIPTION,
      icons: { icon: [{ url: brandingUrl("productLogo") }] },
    };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  return (
    <html lang="en" className={fontVariables}>
      <body className="font-sans antialiased min-h-screen bg-background text-foreground">
        <SessionProvider session={session}>
          <Providers>{children}</Providers>
          <Toaster richColors position="top-right" />
        </SessionProvider>
      </body>
    </html>
  );
}
