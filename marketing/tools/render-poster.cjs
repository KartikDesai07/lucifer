// Renders a poster HTML file to a PNG with the Electron binary from apps/desktop.
// usage: electron render-poster.cjs <html> <png> [width=1080] [height=1350] [scale=2] [seekMs]
// seekMs: for timeline pages (demo-video.html) call window.__seek(ms) before capturing.
// Local only: the page is loaded from disk and captured offscreen; nothing is uploaded.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1350;
const DEFAULT_SCALE = 2;
const READY_POLL_MS = 100;
const READY_MAX_MS = 8000;
const SETTLE_MS = 400;
const PAINT_TIMEOUT_MS = 1500;
const FONTS_MAX_MS = 8000;
// The page races its own fonts wait against a short timeout; make sure the web fonts really finished.
const WAIT_FONTS_SCRIPT = `Promise.race([document.fonts.ready.then(() => document.fonts.status), new Promise((r) => setTimeout(() => r("timeout"), ${FONTS_MAX_MS}))])`;
const EXIT_OK = 0;
const EXIT_USAGE = 2;
const EXIT_RENDER = 3;

// Electron keeps Chromium switches (e.g. --no-sandbox) in argv, so anchor on this
// script's own path instead of a fixed slice offset; the html must be a .html file.
const positional = process.argv.filter((arg) => !arg.startsWith("--"));
const scriptIndex = positional.findIndex((arg) => path.resolve(arg) === __filename);
const [htmlArg, pngArg, widthArg, heightArg, scaleArg, seekArg] = positional.slice(scriptIndex + 1);
if (!htmlArg || !pngArg || path.extname(htmlArg).toLowerCase() !== ".html" || path.extname(pngArg).toLowerCase() !== ".png") {
  process.stderr.write("usage: electron render-poster.cjs <file.html> <file.png> [width] [height] [scale]\n");
  app.exit(EXIT_USAGE);
}
const width = Number(widthArg) || DEFAULT_WIDTH;
const height = Number(heightArg) || DEFAULT_HEIGHT;
const scale = Number(scaleArg) || DEFAULT_SCALE;
const htmlPath = path.resolve(htmlArg);
const pngPath = path.resolve(pngArg);
const seekMs = seekArg === undefined ? null : Number(seekArg);

const WAIT_READY_SCRIPT = `new Promise((resolve) => {
  const started = Date.now();
  const tick = () => {
    if (document.documentElement.dataset.ready === "1") return resolve("ready");
    if (Date.now() - started > ${READY_MAX_MS}) return resolve("timeout");
    setTimeout(tick, ${READY_POLL_MS});
  };
  tick();
})`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function render() {
  const targetWidth = width * scale;
  const targetHeight = height * scale;
  // resizable:false drops the thick frame, so Windows does not clamp the window to the screen.
  const win = new BrowserWindow({
    show: false,
    width: targetWidth,
    height: targetHeight,
    useContentSize: true,
    frame: false,
    resizable: false,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, zoomFactor: scale, backgroundThrottling: false, sandbox: true },
  });
  win.webContents.setFrameRate(60);
  win.setContentSize(targetWidth, targetHeight);
  await win.loadFile(htmlPath, seekMs === null ? undefined : { query: { driven: "1" } });
  win.webContents.setZoomFactor(scale);
  const readiness = await win.webContents.executeJavaScript(WAIT_READY_SCRIPT, true);
  const fontsStatus = await win.webContents.executeJavaScript(WAIT_FONTS_SCRIPT, true);
  if (seekMs !== null) {
    // Offscreen frames arrive asynchronously: wait for the paint that follows the seek.
    const painted = new Promise((resolve) => {
      const timer = setTimeout(() => resolve("no paint"), PAINT_TIMEOUT_MS);
      win.webContents.once("paint", () => { clearTimeout(timer); resolve("painted"); });
    });
    await win.webContents.executeJavaScript(`window.__seek && window.__seek(${seekMs})`, true);
    await painted;
  }
  await sleep(SETTLE_MS);
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  if (size.width !== targetWidth || size.height !== targetHeight) {
    throw new Error(`captured ${size.width}x${size.height}, expected ${targetWidth}x${targetHeight} (window clamped?)`);
  }
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, image.toPNG());
  process.stdout.write(`rendered ${pngPath} ${size.width}x${size.height} (page: ${readiness}, fonts: ${fontsStatus})\n`);
  win.destroy();
}

app.disableHardwareAcceleration();
// Windows display scaling (e.g. 125%) would otherwise multiply the capture size.
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(render).then(
  () => app.exit(EXIT_OK),
  (error) => {
    process.stderr.write(`render failed: ${error instanceof Error ? error.message : String(error)}\n`);
    app.exit(EXIT_RENDER);
  },
);
