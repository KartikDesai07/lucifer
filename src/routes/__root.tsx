import { Outlet, Link, createRootRoute, HeadContent, Scripts, useRouterState, useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lucifer Cafe — POS & Management" },
      { name: "description", content: "Modern POS, menu, customer and order management for cafés." },
      { property: "og:title", content: "Lucifer Cafe — POS & Management" },
      { name: "twitter:title", content: "Lucifer Cafe — POS & Management" },
      { property: "og:description", content: "Modern POS, menu, customer and order management for cafés." },
      { name: "twitter:description", content: "Modern POS, menu, customer and order management for cafés." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2c6ca4aa-4282-4276-9e91-2833ae6e019d/id-preview-b8cecdee--ad5b8b42-d125-4c66-bbaa-3ba8da439e83.lovable.app-1777968542017.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2c6ca4aa-4282-4276-9e91-2833ae6e019d/id-preview-b8cecdee--ad5b8b42-d125-4c66-bbaa-3ba8da439e83.lovable.app-1777968542017.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

const titles: Record<string, string> = {
  "/": "Dashboard",
  "/pos": "New Order",
  "/products": "Product Menu",
  "/categories": "Categories",
  "/customers": "Customers",
  "/staff": "Staff",
  "/reservations": "Reservations",
  "/events": "Events",
};

function RootComponent() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const navigate = useNavigate();
  const { user, ready, signOut } = useAuth();

  // Redirect unauthenticated users to /auth (except on the auth page itself)
  useEffect(() => {
    if (!ready) return;
    if (!user && path !== "/auth") {
      navigate({ to: "/auth", replace: true });
    }
  }, [ready, user, path, navigate]);

  // Render the auth page bare (no sidebar/header)
  if (path === "/auth") {
    return (
      <>
        <Outlet />
        <Toaster />
      </>
    );
  }

  if (!ready || !user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b bg-card px-4 sticky top-0 z-10">
            <SidebarTrigger />
            <h1 className="text-base font-semibold">{titles[path] ?? "Lucifer Cafe"}</h1>
            <div className="ml-auto flex items-center gap-3">
              <div className="text-xs text-muted-foreground hidden sm:block">
                {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
              </div>
              <div className="text-xs text-muted-foreground hidden md:block max-w-[160px] truncate">
                {user.email}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/auth", replace: true });
                }}
              >
                <LogOut className="h-4 w-4" /> Sign out
              </Button>
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6">
            <Outlet />
          </main>
        </div>
        <Toaster />
      </div>
    </SidebarProvider>
  );
}
