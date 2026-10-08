package com.possoftware.pos.printer

import java.io.ByteArrayOutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Phase 3 Session 3C (spec §10, G5): a network printer's job asks DLE EOT on its own connection before it reads printed,
 * and the idle check is one connect and DLE EOT. Against a fake ESC/POS printer on the loopback (as
 * scripts/fake-escpos-printer.mjs answers), with short waits.
 */
class TcpTransportTest {
  /** One fake printer: what it does with each connection; every byte it received, per connection. */
  private class FakePrinter(val behave: (Socket, ByteArrayOutputStream) -> Unit) {
    val server = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"))
    val jobs = LinkedBlockingQueue<ByteArray>()
    @Volatile var connections = 0
    private val thread =
        Thread {
          while (!server.isClosed) {
            val s = try { server.accept() } catch (e: Exception) { break }
            connections++
            Thread {
              val got = ByteArrayOutputStream()
              try {
                behave(s, got)
              } catch (e: Exception) {
                // the test's client went away
              } finally {
                jobs.offer(got.toByteArray())
                try { s.close() } catch (e: Exception) {}
              }
            }.start()
          }
        }.apply { isDaemon = true; start() }

    val port: Int get() = server.localPort

    fun close() = server.close()
  }

  /** A printer that reads everything, answering each DLE EOT n with [answer] (null: no answer). */
  private fun answering(answer: (Int) -> Int?): (Socket, ByteArrayOutputStream) -> Unit = { s, got ->
    val input = s.getInputStream()
    val out = s.getOutputStream()
    var last = ArrayList<Int>()
    while (true) {
      val b = input.read()
      if (b < 0) break
      got.write(b)
      last.add(b)
      if (last.size > 3) last = ArrayList(last.subList(last.size - 3, last.size))
      if (last.size == 3 && last[0] == 0x10 && last[1] == 0x04) {
        answer(last[2])?.let { out.write(it); out.flush() }
        last = ArrayList()
      }
    }
  }

  private val healthy: (Int) -> Int? = { 0x12 }
  private val printers = ArrayList<FakePrinter>()

  private fun printer(behave: (Socket, ByteArrayOutputStream) -> Unit): FakePrinter = FakePrinter(behave).also { printers.add(it) }

  private fun link(p: FakePrinter) = TcpTransport("127.0.0.1", p.port, afterJobMinMs = 600, replyMs = 300)

  @After
  fun closeAll() {
    printers.forEach { it.close() }
  }

  private fun slip(size: Int = 2_000): ByteArray = ByteArray(size) { 0x55 }

  @Test
  fun aJobAsksDleEotOnItsOwnConnectionAndTheNextStatusIsWhatItRead() {
    val p = printer(answering(healthy))
    val t = link(p)
    t.write(slip())
    val got = p.jobs.poll(5, TimeUnit.SECONDS)!!
    assertEquals("the slip, then DLE EOT 1 to 4", listOf(0x10, 0x04, 0x01), got.toList().subList(2_000, 2_003).map { it.toInt() })
    assertEquals(2_000 + 12, got.size)
    assertEquals("the job's own answers", PrinterHealth(DleEot.PAPER_OK, DleEot.COVER_CLOSED, false, false), t.status())
    assertNull("no second connection for it", p.jobs.poll(500, TimeUnit.MILLISECONDS))
    assertEquals(1, p.connections)
  }

  @Test
  fun aPrinterThatNeverAnswersDleEotPrintsAsBefore() {
    val p = printer(answering { null })
    val t = link(p)
    t.write(slip())
    assertNull("nothing said: no false problem", t.status())
    assertNull("its idle check says nothing either", t.status())
    assertTrue("the job's connection and the idle check's", p.jobs.poll(5, TimeUnit.SECONDS) != null && p.jobs.poll(5, TimeUnit.SECONDS) != null)
    assertEquals(2, p.connections)
  }

  @Test
  fun aPrinterThatNeverAnswersAndClosesAfterEachSlipPrintsOnce() {
    // The gate's review (I-1): some printers (or Wi-Fi bridges) close the connection after a job and never answer DLE EOT:
    // their close says nothing, so the slip reads printed, once, never a REPRINT.
    val p =
        printer { s, got ->
          s.soTimeout = 300
          val input = s.getInputStream()
          val buffer = ByteArray(4_096)
          try {
            while (true) {
              val n = input.read(buffer)
              if (n < 0) break
              got.write(buffer, 0, n)
            }
          } catch (e: java.net.SocketTimeoutException) {
            // The slip is in: the printer closes the link without a word.
          }
        }
    link(p).write(slip())
    assertEquals("the slip and its one question reached the printer", 2_003, p.jobs.poll(5, TimeUnit.SECONDS)!!.size)
  }

  @Test
  fun aPrinterWhoseIdleCheckGotNoAnswerIsAskedOnlyBrieflyAfterASlip() {
    // The gate's review (I-2): a silent printer known by its idle check never costs a slip the long wait.
    val p = printer(answering { null })
    val t = TcpTransport("127.0.0.1", p.port, afterJobMinMs = 4_000, replyMs = 300)
    assertNull("its idle check: no answer", t.status())
    val start = System.nanoTime()
    t.write(slip())
    val ms = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start)
    assertTrue("asked for ${ms} ms, not the 4 s a printer that may answer gets", ms < 2_000)
  }

  @Test
  fun aSlipCutOffMidWayIsMaybeNeverPrinted() {
    var connection = 0
    val p =
        printer { s, got ->
          connection++
          if (connection == 1) {
            // Its idle check: the printer answers DLE EOT.
            answering(healthy)(s, got)
          } else {
            val input = s.getInputStream()
            val buffer = ByteArray(100)
            val n = input.read(buffer)
            got.write(buffer, 0, maxOf(n, 0))
            // The printer drops the job after its first bytes (the fake printer's --drop-after).
          }
        }
    val t = link(p)
    assertEquals("its idle check answered", DleEot.PAPER_OK, t.status()?.paper)
    try {
      t.write(slip(64_000))
      fail("a cut slip never reads printed")
    } catch (e: TransportException) {
      assertEquals(BridgeCodes.WRITE_FAILED, e.code)
      assertEquals("a lost link", false, e.linkKept)
    }
  }

  @Test
  fun aPrinterThatAnsweredBeforeAndThenSaysNothingAfterASlipIsMaybe() {
    var silent = false
    val p = printer(answering { if (silent) null else 0x12 })
    val t = link(p)
    assertEquals("its idle check answered", DleEot.PAPER_OK, t.status()?.paper)
    silent = true
    try {
      t.write(slip())
      fail("no answer after the slip from a printer that answers: maybe")
    } catch (e: TransportException) {
      assertEquals(BridgeCodes.WRITE_FAILED, e.code)
    }
  }

  @Test
  fun aPrinterThatSaysItCannotPrintAfterTheSlipIsMaybeButItsLinkIsKept() {
    val p = printer(answering { n -> if (n == 1) 0x1a else if (n == 2) 0x32 else if (n == 4) 0x72 else 0x12 })
    val t = link(p)
    try {
      t.write(slip())
      fail("out of paper: not printed")
    } catch (e: TransportException) {
      assertEquals(BridgeCodes.WRITE_FAILED, e.code)
      assertTrue("the link is fine", e.linkKept)
    }
    assertEquals("what it said", DleEot.PAPER_OUT, t.status()?.paper)
  }

  @Test
  fun theIdleCheckOfAPrinterThatIsGoneIsNotConnected() {
    val p = printer(answering(healthy))
    val port = p.port
    p.close()
    try {
      TcpTransport("127.0.0.1", port, afterJobMinMs = 600, replyMs = 300).status()
      fail("nothing listens: not connected (the 3A gate's m-B)")
    } catch (e: TransportException) {
      assertEquals(BridgeCodes.NOT_CONNECTED, e.code)
    }
  }
}
