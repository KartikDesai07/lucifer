import { LoginScreen } from "@/components/auth/LoginScreen";
import { readLoginBrandName } from "@/lib/login-brand";

// Staff sign-in. The header names the cafe, as the owner's HTML lock/login header does (ruling R39, design 5.6): read
// here on the server with readSettings(), the same cached, read-only look-up the root layout already makes on /login
// for the tab title (lib/login-brand.ts), so it costs no request and no write. Everything else is the client screen.
export default async function LoginPage() {
  return <LoginScreen brandName={await readLoginBrandName()} />;
}
