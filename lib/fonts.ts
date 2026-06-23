import { Geist, Geist_Mono } from "next/font/google";

// Shared font instances. Both the root layout AND the global-error boundary use
// these: global-error replaces the root layout entirely, so it must set the same
// font CSS variables on its own <html> or it would fall back to the system font.
export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Convenience: the className that defines both font variables on an element.
export const fontVariables = `${geistSans.variable} ${geistMono.variable}`;
