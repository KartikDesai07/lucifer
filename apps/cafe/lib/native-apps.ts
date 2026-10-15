// Native apps 2.0 (the owner's ask of 2026-10-15): Admin → Printer setup offers the latest Android and Windows app
// from files.sandbee.in, so a cafe downloads a first install, or a newer version by hand, from the POS itself. The two
// small manifests the apps' own updaters read (android/latest.json, windows/latest.yml) are read on the server and
// cached for 10 minutes, so a new release shows here on its own and the page costs files.sandbee.in at most one read
// of each per 10 minutes. A link is always <base>/<platform>/<plain file name>, as the apps' updaters build it, never
// an address from a manifest. Nothing here throws: no answer, an error page or a manifest that is not the POS app's
// release is no release for that app.

export const NATIVE_APPS_BASE = "https://files.sandbee.in/pos";
export const ANDROID_MANIFEST_URL = `${NATIVE_APPS_BASE}/android/latest.json`;
export const WINDOWS_FEED_URL = `${NATIVE_APPS_BASE}/windows/latest.yml`;
export const NATIVE_APPS_REVALIDATE_S = 600;
export const NATIVE_APPS_TIMEOUT_MS = 4000;
const ANDROID_PACKAGE = "com.possoftware.pos";
const MAX_MANIFEST_CHARS = 16_384;

const VERSION = /^\d{1,3}\.\d{1,2}\.\d{1,2}$/;
const PLAIN_APK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.apk$/;
const PLAIN_EXE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,98}\.exe$/;

export interface AndroidRelease {
  version: string;
  /** The 64-bit APK (nearly every phone and tablet). */
  arm64Url: string;
  /** The 32-bit APK for an old phone; null when the manifest names none. */
  armv7Url: string | null;
}

export interface WindowsRelease {
  version: string;
  installerUrl: string;
}

export interface NativeApps {
  android: AndroidRelease | null;
  windows: WindowsRelease | null;
}

function plainFile(file: unknown, pattern: RegExp): string | null {
  return typeof file === "string" && pattern.test(file) && !file.includes("..") ? file : null;
}

function apkFile(apks: Record<string, unknown>, abi: string): string | null {
  const apk = apks[abi];
  return typeof apk === "object" && apk !== null ? plainFile((apk as { file?: unknown }).file, PLAIN_APK) : null;
}

/** android/latest.json → the version and the APK links; null unless it is the POS app's release with a 64-bit APK. */
export function androidRelease(json: unknown): AndroidRelease | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const m = json as { package?: unknown; version?: unknown; apks?: unknown };
  if (m.package !== ANDROID_PACKAGE || typeof m.version !== "string" || !VERSION.test(m.version)) return null;
  if (typeof m.apks !== "object" || m.apks === null || Array.isArray(m.apks)) return null;
  const apks = m.apks as Record<string, unknown>;
  const arm64 = apkFile(apks, "arm64-v8a");
  if (arm64 === null) return null;
  const armv7 = apkFile(apks, "armeabi-v7a");
  return {
    version: m.version,
    arm64Url: `${NATIVE_APPS_BASE}/android/${arm64}`,
    armv7Url: armv7 === null ? null : `${NATIVE_APPS_BASE}/android/${armv7}`,
  };
}

/** electron-builder's windows/latest.yml → the version and the installer link (its top-level version and path). */
export function windowsRelease(text: string): WindowsRelease | null {
  const top: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^(version|path): (.+)$/.exec(line);
    if (m) top[m[1]] = m[2].trim().replace(/^'(.*)'$|^"(.*)"$/, "$1$2");
  }
  const installer = plainFile(top.path, PLAIN_EXE);
  if (top.version === undefined || !VERSION.test(top.version) || installer === null) return null;
  return { version: top.version, installerUrl: `${NATIVE_APPS_BASE}/windows/${installer}` };
}

async function readText(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      next: { revalidate: NATIVE_APPS_REVALIDATE_S },
      signal: AbortSignal.timeout(NATIVE_APPS_TIMEOUT_MS),
    } as RequestInit);
    if (res.status !== 200) return null;
    const text = await res.text();
    return text.length <= MAX_MANIFEST_CHARS ? text : null;
  } catch {
    return null;
  }
}

/** Both apps' latest releases; each null when its manifest cannot be read or is not a release. */
export async function readNativeApps(fetchImpl: typeof fetch = fetch): Promise<NativeApps> {
  const [json, yml] = await Promise.all([readText(ANDROID_MANIFEST_URL, fetchImpl), readText(WINDOWS_FEED_URL, fetchImpl)]);
  let android: AndroidRelease | null = null;
  if (json !== null) {
    try {
      android = androidRelease(JSON.parse(json));
    } catch {
      android = null;
    }
  }
  return { android, windows: yml === null ? null : windowsRelease(yml) };
}
