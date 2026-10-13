// Native apps 2.0 (spec §7): what the Windows updater does when. It looks one minute after start and then every 24
// hours; a downloaded update is announced once per version and the tray offers Restart to update; it installs when the
// app quits. Never a dialog, never an automatic restart (spec D3).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  noticeFor,
  readyNotice,
  RESTART_TO_UPDATE,
  trayUpdateItem,
  UPDATE_IDLE,
} from "./update-plan";

test("the updater looks one minute after start, then every 24 hours", () => {
  assert.equal(FIRST_CHECK_MS, 60_000);
  assert.equal(CHECK_EVERY_MS, 24 * 60 * 60 * 1000);
});

test("the ready notice names the version and says it installs when the app is closed", () => {
  assert.deepEqual(readyNotice("2.0.1"), {
    title: "Update ready",
    body: "POS Software 2.0.1 is ready. It installs when you close the app.",
  });
});

test("one notice per version: the same version again is quiet, a newer one is announced", () => {
  assert.deepEqual(noticeFor(null, "2.0.1"), readyNotice("2.0.1"));
  assert.equal(noticeFor("2.0.1", "2.0.1"), null);
  assert.deepEqual(noticeFor("2.0.1", "2.0.2"), readyNotice("2.0.2"));
});

test("the tray offers Restart to update only once an update is downloaded", () => {
  assert.equal(trayUpdateItem(UPDATE_IDLE), null);
  assert.deepEqual(trayUpdateItem({ kind: "downloaded", version: "2.0.1" }), { label: "Restart to update" });
  assert.equal(RESTART_TO_UPDATE, "Restart to update");
});
