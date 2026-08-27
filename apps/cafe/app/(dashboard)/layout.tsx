import type { Metadata } from "next";
import { APP_NAME } from "@pos/shared/constants";
import { getSettings } from "@/lib/settings";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Header } from "@/components/layout/Header";
import { PosPulseProvider } from "@/components/layout/PosPulseProvider";
import { RequestAlertBar } from "@/components/orders/RequestAlertBar";

// Tab title mirrors the cafe's own branding once Settings is configured,
// falling back to the generic product name (never a hardcoded cafe name).
// Rides getSettings' own cache — no extra DB round trip on top of the page's.
export async function generateMetadata(): Promise<Metadata> {
  try {
    const settings = await getSettings();
    return { title: settings.restaurantName?.trim() || APP_NAME };
  } catch {
    return { title: APP_NAME };
  }
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <PosPulseProvider>
        <AppSidebar />
        <SidebarInset>
          <Header />
          <RequestAlertBar />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </SidebarInset>
      </PosPulseProvider>
    </SidebarProvider>
  );
}
