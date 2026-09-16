// Records demo-video.html to an MP4 by stepping its timeline frame by frame.
// usage: electron record-video.cjs <file.html> <file.mp4> [width=1080] [height=1920] [fps=30]
// Window A (offscreen) renders the page and emits a paint per seek; window B
// (encoder.html) turns the BGRA frames into H.264 and muxes the MP4. Local only.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const DEFAULTS = { width: 1080, height: 1920, fps: 30 };
const CODEC = "avc1.640028";
const READY_POLL_MS = 100;
const READY_MAX_MS = 10000;
const PAINT_TIMEOUT_MS = 250;
const PROGRESS_EVERY = 90;
const EXIT = { ok: 0, usage: 2, render: 3 };

const positional = process.argv.filter((a) => !a.startsWith("--"));
const here = positional.findIndex((a) => path.resolve(a) === __filename);
const [htmlArg, outArg, widthArg, heightArg, fpsArg] = positional.slice(here + 1);
if (!htmlArg || !outArg || path.extname(htmlArg) !== ".html" || path.extname(outArg) !== ".mp4") {
  process.stderr.write("usage: electron record-video.cjs <file.html> <file.mp4> [width] [height] [fps]\n");
  app.exit(EXIT.usage);
}
const width = Number(widthArg) || DEFAULTS.width;
const height = Number(heightArg) || DEFAULTS.height;
const fps = Number(fpsArg) || DEFAULTS.fps;
const htmlPath = path.resolve(htmlArg);
const outPath = path.resolve(outArg);

const WAIT_READY = `new Promise((resolve) => { const t0 = Date.now(); (function tick() {
  if (document.documentElement.dataset.ready === "1") return resolve("ready");
  if (Date.now() - t0 > ${READY_MAX_MS}) return resolve("timeout");
  setTimeout(tick, ${READY_POLL_MS}); })(); })`;

const once = (emitter, event, timeoutMs) => new Promise((resolve) => {
  const timer = timeoutMs ? setTimeout(() => { emitter.removeListener(event, handler); resolve(null); }, timeoutMs) : null;
  function handler(...args) { if (timer) clearTimeout(timer); resolve(args); }
  emitter.once(event, handler);
});
const ipcOnce = (channel) => new Promise((resolve) => ipcMain.once(channel, (_e, payload) => resolve(payload)));

async function record() {
  const page = new BrowserWindow({
    show: false, width, height, useContentSize: true, frame: false, resizable: false, enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, sandbox: true },
  });
  page.setContentSize(width, height);  // creation size may be clamped to the screen; this is not
  page.webContents.setFrameRate(60);
  let lastFrame = null;
  page.webContents.on("paint", (_e, _dirty, image) => { lastFrame = image; });
  await page.loadFile(htmlPath, { query: { driven: "1" } });
  const readiness = await page.webContents.executeJavaScript(WAIT_READY, true);
  if (readiness !== "ready") throw new Error("page never reported ready");
  const totalMs = await page.webContents.executeJavaScript("window.__TOTAL_MS", true);
  const frames = Math.round((totalMs / 1000) * fps);

  const enc = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false, sandbox: false } });
  await enc.loadFile(path.join(__dirname, "encoder.html"));
  const configured = ipcOnce("configured");
  enc.webContents.send("configure", { width, height, fps, codec: CODEC });
  await configured;

  process.stdout.write(`recording ${frames} frames at ${fps} fps (${width}x${height}, ${CODEC})\n`);
  const frameUs = Math.round(1e6 / fps);
  for (let i = 0; i < frames; i++) {
    const paint = once(page.webContents, "paint", PAINT_TIMEOUT_MS);
    await page.webContents.executeJavaScript(`window.__seek(${(i * 1000) / fps})`, true);
    await paint;
    if (!lastFrame) throw new Error("no frame painted");
    const size = lastFrame.getSize();
    if (size.width !== width || size.height !== height) throw new Error(`frame is ${size.width}x${size.height}, expected ${width}x${height}`);
    const ack = ipcOnce("ack");
    enc.webContents.send("frame", { index: i, timestampUs: i * frameUs, durationUs: frameUs, data: lastFrame.toBitmap() });
    const result = await ack;
    if (result.error) throw new Error(`encode failed at frame ${i}: ${result.error}`);
    if (i % PROGRESS_EVERY === 0) process.stdout.write(`  frame ${i}/${frames}\n`);
  }
  const done = ipcOnce("done");
  enc.webContents.send("finish", { out: outPath });
  const result = await done;
  if (!result.ok) throw new Error(`finalize failed: ${result.error}`);
  process.stdout.write(`wrote ${outPath} (${(result.bytes / 1e6).toFixed(1)} MB, ${frames} frames, ${(totalMs / 1000).toFixed(1)} s)\n`);
  page.destroy(); enc.destroy();
}

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");
app.whenReady().then(record).then(
  () => app.exit(EXIT.ok),
  (error) => { process.stderr.write(`record failed: ${error instanceof Error ? error.message : String(error)}\n`); app.exit(EXIT.render); },
);
