"use client";

import { fontVariables } from "@/lib/fonts";
import "./globals.css";

// Last-resort boundary: catches errors thrown in the root layout itself. It
// REPLACES the root layout, so it must render its own <html>/<body> and re-apply
// the font variables (else it falls back to the system font). Kept free of shared
// UI imports so the fallback itself can't fail to render.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Don't surface raw internal error text to users in production.
  const detail =
    process.env.NODE_ENV === "production" ? null : error.message;

  return (
    <html lang="en" className={fontVariables}>
      <body className="font-sans antialiased">
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
          <p className="text-lg font-semibold">Something went wrong</p>
          <p className="max-w-md text-sm text-muted-foreground">
            The app hit an unexpected error. Please try again.
          </p>
          {detail && (
            <p className="max-w-md text-xs text-muted-foreground">{detail}</p>
          )}
          {error.digest && (
            <p className="text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
