// The page header's words before a page's own PageHeader mounts (U0 Task 3, values 2.5, design 5.3): the shell's
// header shows pageTitleFor(pathname) at once, so the title never flashes, and the HTML's "{cafe} · {weekday, day
// month}" line when a page gives no description of its own. Each title equals the one the page passes to its
// PageHeader (lib/page-header-slot.test.ts reads every page and checks). No React import: node tests read this file.
import { FESTIVAL_CARDS_TITLE } from "@pos/shared/reward-campaigns";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { REPORTS_BASE_PATH, REPORT_SECTIONS } from "@/lib/report-sections";
import { SETTINGS_BASE_PATH, SETTINGS_SECTIONS } from "@/lib/settings-sections";

const PAGE_TITLES: Readonly<Record<string, string>> = {
  "/": "Dashboard",
  "/pos": "POS Terminal",
  "/orders": "Orders",
  "/requests": "Order Requests",
  "/kitchen": "Kitchen",
  "/now-serving": "Now Serving",
  "/reservations": "Reservations",
  "/tables": "Floor",
  "/tables/setup": "Setup",
  "/tables/qr": "QR codes",
  "/products": "Items",
  "/categories": "Categories",
  "/customers": "Customers",
  "/customers/festival-cards": FESTIVAL_CARDS_TITLE,
  "/expenses": "Expenses",
  "/expenses/categories": "Expense categories",
  "/events": "Events",
  "/staff": "Staff",
  "/printers": "Printer setup",
  [SETTINGS_BASE_PATH]: "Settings",
  ...Object.fromEntries(SETTINGS_SECTIONS.map((s) => [`${SETTINGS_BASE_PATH}/${s.slug}`, s.title])),
  ...Object.fromEntries(REPORT_SECTIONS.map((s) => [`${REPORTS_BASE_PATH}/${s.slug}`, s.title])),
};

/** The page's title for the header; a path below a known page takes that page's title, an unknown one "". */
export function pageTitleFor(pathname: string): string {
  let path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (;;) {
    if (Object.hasOwn(PAGE_TITLES, path)) return PAGE_TITLES[path];
    const cut = path.lastIndexOf("/");
    if (cut <= 0) return "";
    path = path.slice(0, cut);
  }
}

const HEADER_DATE = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: CAFE_TIMEZONE });

/** The HTML header's second line: "{cafe name} · {weekday, day month}" (e.g. "Monday, 19 October"), cafe time. */
export function defaultPageSubtitle(cafeName: string, now: Date): string {
  return `${cafeName} · ${HEADER_DATE.format(now)}`;
}
