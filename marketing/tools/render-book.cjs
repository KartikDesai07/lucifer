// Renders book.html: one PNG per page (2x) and a single PDF with all pages.
// usage: electron render-book.cjs <book.html> <outDir> <file.pdf> [width=1080] [height=1350] [scale=2]
// Local only — offscreen Electron window, nothing leaves the machine.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = { width: 1080, height: 1350, scale: 2 };
const CSS_PX_PER_INCH = 96;
const READY_POLL_MS = 100;
const READY_MAX_MS = 15000;
const FONTS_MAX_MS = 8000;
const PAINT_TIMEOUT_MS = 1500;
const SETTLE_MS = 300;
const EXIT = { ok: 0, usage: 2, render: 3 };

const positional = process.argv.filter((a) => !a.startsWith("--"));
const here = positional.findIndex((a) => path.resolve(a) === __filename);
const [htmlArg, outDirArg, pdfArg, widthArg, heightArg, scaleArg] = positional.slice(here + 1);
if (!htmlArg || !outDirArg || !pdfArg || path.extname(htmlArg) !== ".html" || path.extname(pdfArg) !== ".pdf") {
  process.stderr.write("usage: electron render-book.cjs <book.html> <outDir> <file.pdf> [width] [height] [scale]\n");
  app.exit(EXIT.usage);
}
const width = Number(widthArg) || DEFAULTS.width;
const height = Number(heightArg) || DEFAULTS.height;
const scale = Number(scaleArg) || DEFAULTS.scale;
const htmlPath = path.resolve(htmlArg);
const outDir = path.resolve(outDirArg);
const pdfPath = path.resolve(pdfArg);

const WAIT_READY = `new Promise((resolve) => { const t0 = Date.now(); (function tick() {
  if (document.documentElement.dataset.ready === "1") return resolve("ready");
  if (Date.now() - t0 > ${READY_MAX_MS}) return resolve("timeout");
  setTimeout(tick, ${READY_POLL_MS}); })(); })`;
const WAIT_FONTS = `Promise.race([document.fonts.ready.then(() => document.fonts.status), new Promise((r) => setTimeout(() => r("timeout"), ${FONTS_MAX_MS}))])`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nextPaint = (wc) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve("no paint"), PAINT_TIMEOUT_MS);
  wc.once("paint", () => { clearTimeout(timer); resolve("painted"); });
});

async function render() {
  const win = new BrowserWindow({
    show: false, width: width * scale, height: height * scale, useContentSize: true, frame: false, resizable: false, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, zoomFactor: scale, backgroundThrottling: false, sandbox: true },
  });
  win.setContentSize(width * scale, height * scale);
  win.webContents.setFrameRate(60);
  await win.loadFile(htmlPath);
  win.webContents.setZoomFactor(scale);
  const readiness = await win.webContents.executeJavaScript(WAIT_READY, true);
  const fonts = await win.webContents.executeJavaScript(WAIT_FONTS, true);
  if (readiness !== "ready") throw new Error("page never reported ready");
  const pages = await win.webContents.executeJavaScript("window.__PAGES", true);
  fs.mkdirSync(outDir, { recursive: true });

  for (let n = 1; n <= pages; n++) {
    const painted = nextPaint(win.webContents);
    await win.webContents.executeJavaScript(`window.__showPage(${n}); window.scrollTo(0, 0);`, true);
    await painted; await sleep(SETTLE_MS);
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    if (size.width !== width * scale || size.height !== height * scale) throw new Error(`page ${n} captured ${size.width}x${size.height}`);
    const file = path.join(outDir, `page-${n}.png`);
    fs.writeFileSync(file, image.toPNG());
    process.stdout.write(`rendered ${file} ${size.width}x${size.height}\n`);
  }

  // PDF: all pages stacked at 1x; the page box is exactly one CSS page (1080x1350 px = 11.25 x 14.0625 in).
  win.webContents.setZoomFactor(1);
  win.setContentSize(width, height);
  await win.webContents.executeJavaScript("window.__showPage(-1); window.scrollTo(0, 0);", true);
  await sleep(SETTLE_MS * 2);
  const pdf = await win.webContents.printToPDF({
    pageSize: { width: width / CSS_PX_PER_INCH, height: height / CSS_PX_PER_INCH },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    printBackground: true, preferCSSPageSize: true, scale: 1,
  });
  fs.writeFileSync(pdfPath, pdf);
  process.stdout.write(`wrote ${pdfPath} (${(pdf.length / 1e6).toFixed(2)} MB, ${pages} pages, page: ${readiness}, fonts: ${fonts})\n`);
  win.destroy();
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(render).then(
  () => app.exit(EXIT.ok),
  (error) => { process.stderr.write(`render failed: ${error instanceof Error ? error.message : String(error)}\n`); app.exit(EXIT.render); },
);
