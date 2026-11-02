"use client";

import { useLayoutEffect } from "react";
import { acquireHtmlRules } from "@/lib/html-rules-scope";

// The owner's HTML's global rules on the staff screens (values 1.4, ruling R24; F1 perf): while this is mounted,
// <html> carries data-html-rules, which app/globals.css turns into the HTML's body stack and tabular figures
// (lib/html-rules-scope.ts). The first paint is covered by HTML_RULES_SCRIPT (dashboard layout, login page); this keeps
// the attribute across client navigations, ref-counted so the lock closing over the dashboard does not drop it, and
// removes it when the last staff screen unmounts (dashboard -> /m). The /m diner flow never renders it.
export function HtmlRulesScope() {
  useLayoutEffect(() => acquireHtmlRules(document.documentElement), []);
  return null;
}
