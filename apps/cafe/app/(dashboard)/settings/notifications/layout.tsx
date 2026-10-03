import { redirect } from "next/navigation";

import { SETTINGS_BASE_PATH, isSettingsSectionHidden } from "@/lib/settings-sections";

// Notifications is hidden for now (owner 2026-10-03): its page and fields stay,
// but a typed or bookmarked URL goes back to the Settings hub. Removing
// "notifications" from HIDDEN_SETTINGS_SLUGS brings the page back.
export default function NotificationsSettingsLayout({ children }: { children: React.ReactNode }) {
  if (isSettingsSectionHidden("notifications")) redirect(SETTINGS_BASE_PATH);
  return children;
}
