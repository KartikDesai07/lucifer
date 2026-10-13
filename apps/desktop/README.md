# POS Software by sandbee: Windows app

The counter PC's Windows app (Electron 44). It opens the cafe's POS from one
saved address, stays in the tray, starts with Windows, and prints slips
silently. It sits outside the npm workspace, with its own `node_modules`.

## Checks

`npm test` (the node:test suites in `src/`, with the source pins),
`npm run typecheck` and `npm run lint`.

## The address window

At the first start, and from **Help → Change POS address…**, the app asks for the
POS address in a window that looks like the Android app's start screen. It reads
the address by the Android app's rules (`src/pos-url.ts`: a bare workspace name
means `<name>.sandbee.in`) and checks it once with `GET /api/health`
(`src/pos-health.ts`) before it saves it.

## Updates

The app updates itself with electron-updater's generic provider from
`https://files.sandbee.in/pos/windows/` (`build.publish` in `package.json`;
electron-builder writes it into `resources\app-update.yml`). It looks one minute
after it starts and then every 24 hours, downloads a new version in the
background, shows one notification, and installs it when the app is closed, or
at once with **Restart to update** in the tray and the Help menu. Never a dialog,
never an automatic restart. Errors go to the app's log,
`%APPDATA%\POS Software by sandbee\pos-desktop.log`.

## Build the installer

`npm run dist` writes `dist\POS-Software-Setup-<version>.exe`, its `.blockmap` and
`latest.yml`, and publishes nothing. A release is packaged with
`scripts/release-native.mjs` (`apps/mobile/README.md` → "Release a new version
(both apps)"), and the owner uploads it, `latest.yml` last.

A test build for this PC only takes another feed and version, for example
`npx electron-builder --win nsis --publish never "-c.publish.url=http://127.0.0.1:8766/pos/windows" "-c.extraMetadata.version=2.0.1"`;
the packaging refuses such a build. Where `ELECTRON_RUN_AS_NODE` is set in the
environment, unset it before building or starting the app.
