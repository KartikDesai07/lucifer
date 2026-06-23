import NextAuth from "next-auth";
import authConfig from "@/auth.config";

// Edge middleware: only the route-guard logic in authConfig.callbacks.authorized
// runs here. No DB / bcrypt — those live in lib/auth.ts.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Guard page routes only. API routes authorize themselves; Next internals and
  // the favicon are always allowed.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
