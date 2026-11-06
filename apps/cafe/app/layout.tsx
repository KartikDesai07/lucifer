import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { fontVariables } from "@/lib/fonts";
import { AppToaster } from "@/components/layout/AppToaster";
import { Providers } from "@/components/providers";
import { APP_NAME } from "@/lib/constants";
import { DEFAULT_PRODUCT_LOGO_URL } from "@/lib/branding-default-logo";
import { METADATA_DESCRIPTION } from "@/lib/document-branding";
import "./globals.css";

// Static: the root layout reads no Settings and no session, so the staff frames can be served from the CDN. The
// cafe's own name and logo reach the tab on the device (DocumentBranding, staff screens) or from the public pages'
// own generateMetadata (/login, /m). The tab icon is declared here and never as app/favicon.ico: file-based
// metadata OVERRIDES the metadata object (Next.js docs), and that file is deleted.
export const metadata: Metadata = {
  title: APP_NAME,
  description: METADATA_DESCRIPTION,
  icons: { icon: [{ url: DEFAULT_PRODUCT_LOGO_URL }] },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // suppressHydrationWarning covers <html>'s OWN attributes only (React applies it one level deep): the pre-paint
  // scripts set an attribute on <html> before React hydrates it (the dashboard's screen lock, data-pos-locked; the
  // diner's stored theme, data-pub-theme), which React's dev build would otherwise report as a mismatch. Nothing
  // below <html> is affected.
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      {/* min-h-screen = 100vh = the LARGEST mobile viewport (URL bar retracted),
          which made the document scroll by the toolbar height on staff devices.
          Where `dvh` exists the floor becomes the VISIBLE viewport instead; on
          desktop dvh === vh so nothing changes. /login, /m, print and
          global-error carry their own min-height and are unaffected. */}
      <body className="font-sans antialiased min-h-screen supports-[height:1dvh]:min-h-dvh bg-background text-foreground">
        <SessionProvider>
          <Providers>{children}</Providers>
          <AppToaster />
        </SessionProvider>
      </body>
    </html>
  );
}
