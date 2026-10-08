package com.possoftware.pos.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The state machine of one printer (Phase 2 Session 2F2, spec §9.2, §13): the reconnect backoff, the pause flags
 * (Bluetooth off, a USB permission), a dropped link, BUSY per printer, NOT_CONNECTED only before any byte, the print
 * watchdog and a printer that left the list. On the JVM, with a hand-cranked io thread and virtual time.
 */
class PrinterManagerTest {
  private fun notConnected(): () -> Unit = { throw TransportException(BridgeCodes.NOT_CONNECTED, "no answer") }

  private fun started(info: PrinterInfo, env: FakeEnv, io: ManualIo = ManualIo()): Pair<PrinterManager, ManualIo> {
    val manager = PrinterManager(info, env, io)
    manager.connectAsync(manager.begin()) {}
    io.runAll()
    return Pair(manager, io)
  }

  @Test
  fun backoffWaitsTwoFiveTenThenEveryThirtySeconds() {
    assertEquals("the waits, attempt by attempt", listOf(2_000L, 5_000L, 10_000L, 30_000L, 30_000L), (0..4).map { PrinterManager.backoffMs(it) })
  }

  @Test
  fun failedConnectsRetryOnTheBackoffAndAConnectResetsIt() {
    val env = FakeEnv()
    env.nextOpen = notConnected()
    val (manager, io) = started(tcpPrinter(), env)
    assertEquals("down after its first attempt", BridgeCodes.STATE_DISCONNECTED, manager.state())
    val seen = ArrayList<Long>()
    repeat(4) {
      val wait = env.waiting().single()
      seen.add(wait)
      env.advance(wait)
      io.runAll()
    }
    assertEquals("2 s, 5 s, 10 s, then 30 s", listOf(2_000L, 5_000L, 10_000L, 30_000L), seen)
    env.nextOpen = {}
    env.advance(env.waiting().single())
    io.runAll()
    assertEquals("the printer answered", BridgeCodes.STATE_CONNECTED, manager.state())
    assertTrue("no reconnect waits while connected", env.waiting().isEmpty())
    env.made.last().listener.onLinkLost(env.made.last())
    assertEquals("a dropped link reads as down at once", BridgeCodes.STATE_DISCONNECTED, manager.state())
    assertEquals("and the backoff starts again from 2 s", listOf(2_000L), env.waiting())
  }

  @Test
  fun bluetoothOffPausesABluetoothPrinterUntilItIsOnAgain() {
    val env = FakeEnv()
    env.bluetooth = false
    val (manager, io) = started(btPrinter(), env)
    assertEquals("down", BridgeCodes.STATE_DISCONNECTED, manager.state())
    assertTrue("no link was even tried", env.made.isEmpty())
    assertTrue("and no reconnect loop", env.waiting().isEmpty())
    manager.resumeIfPaused()
    io.runAll()
    assertTrue("Bluetooth still off: still nothing", env.made.isEmpty())
    env.bluetooth = true
    manager.resumeIfPaused()
    io.runAll()
    assertEquals("Bluetooth back: it connects", BridgeCodes.STATE_CONNECTED, manager.state())
  }

  @Test
  fun aUsbPrinterThatNeedsTheScreenWaitsAndAsksAgainOnceVisible() {
    val env = FakeEnv()
    env.shown = false
    env.nextOpen = { throw TransportException(BridgeCodes.UNAUTHORIZED, "USB permission needed", needsForeground = true) }
    val (manager, io) = started(usbPrinter(), env)
    assertEquals("down", BridgeCodes.STATE_DISCONNECTED, manager.state())
    assertTrue("no reconnect loop while it waits for the screen", env.waiting().isEmpty())
    assertTrue("hidden: nothing asked at once", env.onTimerRuns.isEmpty())
    manager.resumeIfPaused()
    io.runAll()
    assertEquals("still hidden: not asked again", 1, env.made.size)
    env.shown = true
    env.nextOpen = {}
    manager.resumeIfPaused()
    io.runAll()
    assertEquals("visible: asked again, and granted", BridgeCodes.STATE_CONNECTED, manager.state())
  }

  @Test
  fun aUsbPrinterTurnedVisibleDuringItsAttemptAsksOnTheTimer() {
    val env = FakeEnv()
    env.nextOpen = { throw TransportException(BridgeCodes.UNAUTHORIZED, "USB permission needed", needsForeground = true) }
    started(usbPrinter(), env)
    assertEquals("the cold-start race: one resume queued on the timer thread", 1, env.onTimerRuns.size)
  }

  @Test
  fun aUsbDenialWaitsForAnExplicitReconnect() {
    val env = FakeEnv()
    env.nextOpen = { throw TransportException(BridgeCodes.UNAUTHORIZED, "USB permission denied") }
    val (manager, io) = started(usbPrinter(), env)
    assertTrue("a denial starts no loop", env.waiting().isEmpty())
    manager.resumeIfPaused()
    io.runAll()
    assertEquals("and no prompt loop on resume", 1, env.made.size)
    env.nextOpen = {}
    manager.connectAsync(manager.begin()) {}
    io.runAll()
    assertEquals("an explicit reconnect asks again", BridgeCodes.STATE_CONNECTED, manager.state())
  }

  @Test
  fun busyIsPerPrinter() {
    val env = FakeEnv()
    val (kitchen, kitchenIo) = started(tcpPrinter(9100), env)
    val (bar, barIo) = started(tcpPrinter(9101), env, ManualIo())
    val first = Replies<Int>()
    val second = Replies<Int>()
    val other = Replies<Int>()
    kitchen.print("AAAA", first.cb)
    kitchen.print("BBBB", second.cb)
    assertEquals("a second print on one printer is BUSY at once, before any byte", listOf(BridgeCodes.BUSY), second.codes())
    bar.print("CCCC", other.cb)
    assertEquals("another printer is not busy", 1, barIo.pending())
    kitchenIo.runAll()
    barIo.runAll()
    assertEquals("the first job printed", listOf("OK"), first.codes())
    assertEquals("so did the other printer's", listOf("OK"), other.codes())
    val third = Replies<Int>()
    kitchen.print("DDDD", third.cb)
    kitchenIo.runAll()
    assertEquals("the printer is free again after its job", listOf("OK"), third.codes())
    assertEquals("each printer's own bytes", listOf(2, 1), listOf(env.made[0].written.size, env.made[1].written.size))
  }

  @Test
  fun notConnectedComesBeforeAnyByteAndAFailedWriteMarksThePrinterDown() {
    val env = FakeEnv()
    env.nextOpen = notConnected()
    val (down, _) = started(tcpPrinter(), env)
    val refused = Replies<Int>()
    down.print("AAAA", refused.cb)
    assertEquals("not connected: refused before any byte", listOf(BridgeCodes.NOT_CONNECTED), refused.codes())
    val env2 = FakeEnv()
    val (manager, io) = started(tcpPrinter(), env2)
    env2.made.last().onWrite = { throw TransportException(BridgeCodes.NOT_CONNECTED, "Could not connect") }
    val gone = Replies<Int>()
    manager.print("AAAA", gone.cb)
    io.runAll()
    assertEquals("a network printer that no longer answers: its connect failed, nothing sent", listOf(BridgeCodes.NOT_CONNECTED), gone.codes())
    assertEquals("and it reads as down, with its reconnect loop", BridgeCodes.STATE_DISCONNECTED, manager.state())
    assertEquals(listOf(2_000L), env2.waiting())
    val env3 = FakeEnv()
    val (broken, brokenIo) = started(tcpPrinter(), env3)
    env3.made.last().onWrite = { throw TransportException(BridgeCodes.WRITE_FAILED, "Write failed") }
    val partial = Replies<Int>()
    broken.print("AAAA", partial.cb)
    brokenIo.runAll()
    assertEquals("a write that failed part way is WRITE_FAILED", listOf(BridgeCodes.WRITE_FAILED), partial.codes())
    val bad = Replies<Int>()
    broken.print("!", bad.cb)
    assertEquals("down now: refused", listOf(BridgeCodes.NOT_CONNECTED), bad.codes())
  }

  @Test
  fun aPrintPayloadThatIsNotBase64IsABadRequest() {
    val env = FakeEnv()
    val (manager, io) = started(tcpPrinter(), env)
    val bad = Replies<Int>()
    manager.print("!", bad.cb)
    io.runAll()
    assertEquals(listOf(BridgeCodes.BAD_REQUEST), bad.codes())
    assertEquals("still connected: nothing was written", BridgeCodes.STATE_CONNECTED, manager.state())
  }

  @Test
  fun aWriteThatOutlivesTheWatchdogIsATimeoutNeverPrinted() {
    val env = FakeEnv()
    val (manager, io) = started(tcpPrinter(), env)
    val link = env.made.last()
    link.onWrite = { env.advance(PrinterManager.PRINT_JOB_TIMEOUT_MS) }
    val late = Replies<Int>()
    manager.print("AAAA", late.cb)
    io.runAll()
    assertEquals("the watchdog fired: TIMEOUT", listOf(BridgeCodes.TIMEOUT), late.codes())
    assertTrue("it closed the link", link.closed > 0)
    assertEquals("the printer reads as down", BridgeCodes.STATE_DISCONNECTED, manager.state())
  }

  @Test
  fun aPrinterThatLeftTheListClosesItsLiveLinkAndALateDropIsIgnored() {
    val env = FakeEnv()
    val (manager, _) = started(tcpPrinter(), env)
    val link = env.made.last()
    assertEquals("connected before it leaves", BridgeCodes.STATE_CONNECTED, manager.state())
    val before = env.changes
    manager.halt()
    assertTrue("halt closes the live link", link.closed > 0)
    link.listener.onLinkLost(link)
    assertEquals("a late drop of the closed link publishes nothing", before, env.changes)
    assertTrue("and schedules no reconnect", env.waiting().isEmpty())
    assertEquals(BridgeCodes.STATE_NONE, manager.state())
  }

  @Test
  fun aStaleAttemptPublishesNothingAndMakesNoLink() {
    val env = FakeEnv()
    val io = ManualIo()
    val manager = PrinterManager(tcpPrinter(), env, io)
    assertEquals("a new printer reads as connecting until its first attempt", BridgeCodes.STATE_CONNECTING, manager.state())
    manager.connectAsync(manager.begin()) {}
    manager.connectAsync(manager.begin()) {}
    val before = env.changes
    io.runAll()
    assertEquals("only the newer attempt publishes: connecting, then connected", before + 2, env.changes)
    assertEquals("the stale attempt never made a transport", 1, env.made.size)
    assertEquals(BridgeCodes.STATE_CONNECTED, manager.state())
  }

  @Test
  fun aPrinterThatLeftTheListStopsItsLoopAndTakesNoNewWork() {
    val env = FakeEnv()
    env.nextOpen = notConnected()
    val (manager, io) = started(tcpPrinter(), env)
    assertEquals(listOf(2_000L), env.waiting())
    manager.halt()
    assertEquals("none once it left the list", BridgeCodes.STATE_NONE, manager.state())
    assertTrue("its reconnect wait is cancelled", env.waiting().isEmpty())
    var settled = 0
    manager.connectAsync(manager.begin()) { settled++ }
    assertEquals("a late reconnect still answers its caller, at once", 1, settled)
    assertEquals("and runs nothing", 0, io.pending())
    val refused = Replies<Int>()
    manager.print("AAAA", refused.cb)
    assertEquals("a late print: not connected", listOf(BridgeCodes.NOT_CONNECTED), refused.codes())
  }

  // ── Phase 3 Session 3C (the 2F2 gold review's M-5) ────────────────────────────────────────────────────────────────

  @Test
  fun aJobThatFinishedFirstIsNeverClosedUnderByItsWatchdog() {
    // The 2F2 gold review's M-5: a timer's cancel() can win while the watchdog's task already runs. Running that task
    // after the job finished is that race: it must neither close the link nor turn the job into a timeout.
    val env = FakeEnv()
    val (manager, io) = started(tcpPrinter(), env)
    val link = env.made.last()
    val done = Replies<Int>()
    val before = env.scheduled.size
    manager.print("AAAA", done.cb)
    io.runAll()
    assertEquals(listOf("OK"), done.codes())
    // The job's watchdog is the first task scheduled after the print.
    env.scheduled[before].run()
    assertEquals("the link stays open", 0, link.closed)
    assertEquals(BridgeCodes.STATE_CONNECTED, manager.state())
  }
}
