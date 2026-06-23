"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Coffee,
  Users,
  CalendarClock,
  PartyPopper,
  Tags,
  UserCog,
  Receipt,
  LayoutGrid,
  BarChart3,
  Settings,
  ChevronsUpDown,
  KeyRound,
  LogOut,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
};

const items: NavItem[] = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "New Order", url: "/pos", icon: ShoppingCart },
  { title: "Orders", url: "/orders", icon: Receipt },
  { title: "Menu", url: "/products", icon: Coffee },
  { title: "Categories", url: "/categories", icon: Tags },
  { title: "Customers", url: "/customers", icon: Users },
  { title: "Tables", url: "/tables", icon: LayoutGrid },
  { title: "Reservations", url: "/reservations", icon: CalendarClock },
  { title: "Events", url: "/events", icon: PartyPopper },
  { title: "Staff", url: "/staff", icon: UserCog, adminOnly: true },
  { title: "Reports", url: "/reports", icon: BarChart3, adminOnly: true },
  { title: "Settings", url: "/settings", icon: Settings, adminOnly: true },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = usePathname();
  const { user, isAdmin, logout } = useAuth();
  const [pwdOpen, setPwdOpen] = useState(false);

  const visibleItems = items.filter((item) => !item.adminOnly || isAdmin);
  const initial = (user?.name ?? "?").charAt(0).toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary font-bold text-primary-foreground">
            ☕
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-bold">Lucifer Cafe</div>
              <div className="text-[10px] text-muted-foreground">POS System</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === item.url}
                    tooltip={item.title}
                  >
                    <Link href={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  tooltip={user?.name ?? "Account"}
                  className="data-[state=open]:bg-sidebar-accent"
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sidebar-accent text-xs font-semibold">
                    {initial}
                  </div>
                  {!collapsed && (
                    <>
                      <div className="grid flex-1 text-left leading-tight">
                        <span className="truncate text-sm font-medium">
                          {user?.name ?? "Account"}
                        </span>
                        <Badge
                          variant={isAdmin ? "default" : "secondary"}
                          className="mt-0.5 w-fit px-1.5 py-0 text-[10px]"
                        >
                          {isAdmin ? "Admin" : "Staff"}
                        </Badge>
                      </div>
                      <ChevronsUpDown className="ml-auto h-4 w-4" />
                    </>
                  )}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-56"
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{user?.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {isAdmin ? "Administrator" : "Staff member"}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setPwdOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Change password
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => logout()}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </Sidebar>
  );
}
