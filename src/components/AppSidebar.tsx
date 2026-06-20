import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, ShoppingCart, Coffee, Users, CalendarClock, PartyPopper, Tags, UserCog, Receipt } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "New Order", url: "/pos", icon: ShoppingCart },
  { title: "Orders", url: "/orders", icon: Receipt },
  { title: "Menu", url: "/products", icon: Coffee },
  { title: "Categories", url: "/categories", icon: Tags },
  { title: "Customers", url: "/customers", icon: Users },
  { title: "Staff", url: "/staff", icon: UserCog },
  { title: "Reservations", url: "/reservations", icon: CalendarClock },
  { title: "Events", url: "/events", icon: PartyPopper },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const path = useRouterState({ select: (r) => r.location.pathname });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">
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
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={path === item.url}>
                    <Link to={item.url} className="flex items-center gap-2">
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
    </Sidebar>
  );
}
