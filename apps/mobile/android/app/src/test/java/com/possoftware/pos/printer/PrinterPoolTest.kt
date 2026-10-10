package com.possoftware.pos.printer

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Phase 3 Session 3C: the app's printer list end to end on the JVM, through [PrinterPool]'s seams (the 2F2 gate's
 * publish-chain test): a change halts the printers that left, then saves, then publishes the v1 and the v2 event, each
 * once and only when it changed; and the 2G review's m-3: a v1 select of a printer already listed only moves the default.
 */
class PrinterPoolTest {
  private val events = ArrayList<String>()
  private val savedSaver = PrinterPool.saver
  private val savedPublisher = PrinterPool.publisher
  private val kitchen = tcpPrinter(9100)
  private val bar = tcpPrinter(9101)

  @Before
  fun seams() {
    PrinterPool.saver = { printers, defaultId -> events.add("save " + printers.joinToString(",") { it.id } + " default " + defaultId) }
    PrinterPool.publisher = { one, all ->
      if (one != null) events.add("v1 " + (one.printer?.id ?: "none"))
      if (all != null) events.add("v2 " + all.printers.joinToString(",") { it.printer.id } + " default " + all.defaultId)
    }
    PrinterPool.managers().forEach { PrinterPool.remove(it.id) }
    events.clear()
  }

  @After
  fun restore() {
    PrinterPool.managers().forEach { PrinterPool.remove(it.id) }
    PrinterPool.saver = savedSaver
    PrinterPool.publisher = savedPublisher
  }

  @Test
  fun aChangeSavesThenPublishesEachVersionOnceInOrder() {
    PrinterPool.add(kitchen)
    assertEquals(
        "the first printer: saved as the default, then v1 and v2",
        listOf("save ${kitchen.id} default ${kitchen.id}", "v1 ${kitchen.id}", "v2 ${kitchen.id} default ${kitchen.id}"),
        events,
    )
    events.clear()
    PrinterPool.add(bar)
    assertEquals(
        "another printer: the default did not change, so v2 only",
        listOf("save ${kitchen.id},${bar.id} default ${kitchen.id}", "v2 ${kitchen.id},${bar.id} default ${kitchen.id}"),
        events,
    )
    events.clear()
    PrinterPool.publish()
    assertTrue("nothing changed: no event", events.isEmpty())
  }

  @Test
  fun aPrinterThatLeftIsHaltedBeforeTheSaveAndTheDefaultMovesInOneV1Event() {
    val gone = PrinterPool.add(kitchen)
    PrinterPool.add(bar)
    var haltedAtSave = false
    PrinterPool.saver = { printers, defaultId ->
      haltedAtSave = gone.state() == BridgeCodes.STATE_NONE
      events.add("save " + printers.joinToString(",") { it.id } + " default " + defaultId)
    }
    events.clear()
    PrinterPool.remove(kitchen.id)
    assertTrue("halted before it was saved away", haltedAtSave)
    assertEquals(listOf("save ${bar.id} default ${bar.id}", "v1 ${bar.id}", "v2 ${bar.id} default ${bar.id}"), events)
  }

  @Test
  fun aV1SelectOfAListedPrinterOnlyMovesTheDefault() {
    PrinterPool.add(kitchen)
    val added = PrinterPool.add(bar)
    events.clear()
    val selected = PrinterPool.replaceDefault(bar)
    assertFalse("no new manager (m-3: it connects once, never twice)", selected.fresh)
    assertSame("the printer the page just added keeps its manager", added, selected.manager)
    assertSame(added, PrinterPool.defaultManager())
    assertTrue("never halted", added.state() != BridgeCodes.STATE_NONE)
    assertEquals("both stay listed", 2, PrinterPool.managers().size)
    assertEquals(listOf("save ${kitchen.id},${bar.id} default ${bar.id}", "v1 ${bar.id}", "v2 ${kitchen.id},${bar.id} default ${bar.id}"), events)
    val usb = usbPrinter()
    val fresh = PrinterPool.replaceDefault(usb)
    assertTrue("a printer not listed is new", fresh.fresh)
    assertEquals("it takes the default's place, as v1 always replaced its one printer", listOf(kitchen.id, usb.id), PrinterPool.managers().map { it.id })
    assertEquals(BridgeCodes.STATE_NONE, added.state())
  }
}
