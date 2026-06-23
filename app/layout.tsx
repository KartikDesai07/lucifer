import type { Metadata } from "next";
import { SessionProvider } from "next-auth/react";
import { auth } from "@/lib/auth";
import { fontVariables } from "@/lib/fonts";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lucifer Cafe POS",
  description: "Point-of-sale and management system for Lucifer Cafe",
};

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
