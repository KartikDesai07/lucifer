// Locks down Electron's permission prompts to a tiny allow-list, scoped to
// the app's own saved server address (so no other origin can ever ask).
import type { Session } from "electron";
import { isSameOrigin } from "./server-url";

// "screen-wake-lock" is a real member of Electron's permission union
// (checked in node_modules/electron/electron.d.ts, 44.2.0) — kept so the
// counter screen can stay on during a sale if the web app ever requests it.
export const ALLOWED_PERMISSIONS = [
  "clipboard-sanitized-write",
  "screen-wake-lock",
] as const;

type AllowedPermission = (typeof ALLOWED_PERMISSIONS)[number];

function isAllowedPermission(permission: string): permission is AllowedPermission {
  return (ALLOWED_PERMISSIONS as readonly string[]).includes(permission);
}

export function installPermissionHandlers(
  ses: Session,
  getOrigin: () => string | null,
): void {
  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const origin = getOrigin() ?? "";
    callback(isAllowedPermission(permission) && isSameOrigin(details.requestingUrl, origin));
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    const origin = getOrigin() ?? "";
    return isAllowedPermission(permission) && isSameOrigin(requestingOrigin, origin);
  });
}
