import type { Metadata, Viewport } from "next";
import { APP_NAME } from "@pos/shared/constants";
import { getSettings } from "@/lib/settings";
import {
  MANIFEST_PATH,
  APPLE_TOUCH_ICON_PATH,
  MANIFEST_THEME_COLOR,
} from "@/lib/pos-install";
import { brandingUrl, productImageUrl } from "@/lib/images";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Header } from "@/components/layout/Header";
import { MasterDataProvider } from "@/components/layout/MasterDataProvider";
import { PosPulseProvider } from "@/components/layout/PosPulseProvider";
import { PrintHostProvider } from "@/components/layout/PrintHostProvider";
import { SessionKeepalive } from "@/components/layout/SessionKeepalive";
import { RequestAlertBar } from "@/components/orders/RequestAlertBar";
import { PrintHostPrintSources } from "@/components/print/PrintHostPrintSources";
import { TouchFeel } from "@/components/shared/TouchFeel";

// Tab title mirrors the cafe's own branding once Settings is configured,
// falling back to the generic product name (never a hardcoded cafe name).
// Rides getSettings' own cache — no extra DB round trip on top of the page's.
//
// The manifest link (CB-1d.2) is advertised from the DASHBOARD ONLY — never
// the root layout or /m — so diners on the public QR flow never see an
// install hint; only staff devices get the "install as app" prompt.
//
// Next merges `metadata.icons` by REPLACING the whole object per segment
// (node_modules/next/dist/lib/metadata/resolve-metadata.js, case 'icons' →
// resolveIcons(source.icons)), not by deep-merging with the root layout's
// `icons`. So the tab icon the root layout declares must be RE-DECLARED
// here alongside the apple icon, or every dashboard route would silently
// lose its tab icon.
export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await getSettings();
    return {
      title: settings.restaurantName?.trim() || APP_NAME,
      manifest: MANIFEST_PATH,
      icons: {
        icon: [{ url: productImageUrl(settings.productLogo) ?? brandingUrl("productLogo") }],
        apple: [{ url: APPLE_TOUCH_ICON_PATH }],
      },
    };
  } catch {
    return {
      title: APP_NAME,
      manifest: MANIFEST_PATH,
      icons: {
        icon: [{ url: brandingUrl("productLogo") }],
        apple: [{ url: APPLE_TOUCH_ICON_PATH }],
      },
    };
  }
}

// Android Chrome (>=108) defaults to resizes-visual, which leaves the POS's
// fixed bottom bar and the cart sheet's discount/notes inputs UNDER the
// on-screen keyboard. resizes-content shrinks the layout viewport (so 100dvh
// shrinks too) and lifts fixed elements above the keyboard instead. Scoped to
// the staff dashboard ONLY — the public QR diner flow under /m was
// device-tested with the default and must not change. No effect on iOS.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  themeColor: MANIFEST_THEME_COLOR,
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <PosPulseProvider>
        {/* Print-host plan §B5 (PH-5): the host bridge lives in the shell so a
            designated PC prints from ANY screen (owner Q7). PrintHostPrintSources
            sits inside SidebarInset after <main> — absolute, zero in-flow height,
            null while idle — so the height-chain matrix is untouched. */}
        <PrintHostProvider>
          {/* CB-DL-1: one master-data call per page load. Seeds the five master
              query keys from this tab's stored copy synchronously (before any
              screen renders) and fetches GET /api/bootstrap once; a fresh tab
              waits behind a placeholder so the mounted screens cannot each fire
              their own master fetch first. */}
          <MasterDataProvider>
            {/* CB-U1: the session keepalive rolls the 30-day cookie for a tab
                that never navigates — staff screens only, never /login or /m. */}
            <SessionKeepalive />
            <AppSidebar />
            <SidebarInset>
              <Header />
              <RequestAlertBar />
              <TouchFeel />
              <main className="flex-1 p-4 md:p-6">{children}</main>
              <PrintHostPrintSources />
            </SidebarInset>
          </MasterDataProvider>
        </PrintHostProvider>
      </PosPulseProvider>
    </SidebarProvider>
  );
}
