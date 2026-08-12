import type { Metadata } from "next";
import { APP_NAME } from "@pos/shared/constants";
import "./globals.css";

// The Hub is owner-only and must never be publicly discoverable (§6 risk row) —
// noindex/nofollow at the document level; F3.4 adds the auth gate on every route.
export const metadata: Metadata = {
  title: `${APP_NAME} — Control Plane`,
  description: "Owner-only control plane: tenant registry, provisioning, monitoring.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
