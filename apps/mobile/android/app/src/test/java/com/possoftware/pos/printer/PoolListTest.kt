package com.possoftware.pos.printer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The app's list of printers and its default (Phase 2 Session 2F2, spec §9.2): what bridge v2 lists and every v1
 * message acts on, and the saved list as the app starts (the one v1 printer migrated into it).
 */
class PoolListTest {
  private val kitchen = tcpPrinter(9100)
  private val bar = tcpPrinter(9101)
  private val bt = btPrinter()

  private fun ids(pool: PoolList<PrinterInfo>): List<String> = pool.all().map { it.id }

  private fun listOf3(): PoolList<PrinterInfo> {
    val pool = PoolList<PrinterInfo> { it.id }
    pool.put(kitchen)
    pool.put(bar)
    pool.put(bt)
    return pool
  }

  @Test
  fun theFirstPrinterOfAnEmptyListIsTheDefaultAndOthersJoinAfterIt() {
    val pool = PoolList<PrinterInfo> { it.id }
    pool.put(kitchen)
    pool.put(bar)
    assertEquals("in the order they were added", listOf(kitchen.id, bar.id), ids(pool))
    assertEquals("the first one is the default", kitchen.id, pool.defaultId)
    val renamed = bar.copy(name = "Bar")
    assertEquals("one entry per printer id: a select again replaces it in its place", listOf(bar), pool.put(renamed))
    assertEquals(listOf(kitchen.id, bar.id), ids(pool))
    assertEquals("Bar", pool.find(bar.id)?.name)
  }

  @Test
  fun theDefaultLeavingPromotesTheFirstRemainingPrinter() {
    val pool = listOf3()
    assertEquals(kitchen, pool.remove(kitchen.id))
    assertEquals("the first remaining one", bar.id, pool.defaultId)
    assertEquals("another printer leaving keeps the default", bt, pool.remove(bt.id))
    assertEquals(bar.id, pool.defaultId)
    assertNull("an unknown id: nothing", pool.remove("tcp:10.0.0.1:9100"))
    pool.remove(bar.id)
    assertNull("an empty list has no default", pool.defaultId)
  }

  @Test
  fun aV1SelectReplacesTheDefaultInItsPlace() {
    val pool = listOf3()
    val usb = usbPrinter()
    assertEquals("the old default retires", listOf(kitchen), pool.putDefault(usb))
    assertEquals("in the default's place", listOf(usb.id, bar.id, bt.id), ids(pool))
    assertEquals(usb.id, pool.defaultId)
    val renamed = bt.copy(name = "Bar Bluetooth")
    assertEquals("a printer already listed is started anew in its own place", listOf(bt), pool.putDefault(renamed))
    assertEquals("and the old default stays listed", listOf(usb.id, bar.id, bt.id), ids(pool))
    assertEquals(bt.id, pool.defaultId)
    val empty = PoolList<PrinterInfo> { it.id }
    assertEquals(emptyList<PrinterInfo>(), empty.putDefault(kitchen))
    assertEquals("into an empty list", kitchen.id, empty.defaultId)
  }

  @Test
  fun anAppUpdatedFromV1KeepsItsOnePrinterAsTheDefault() {
    val pool = PoolList.restore(null, null, kitchen)
    assertEquals(listOf(kitchen.id), ids(pool))
    assertEquals(kitchen.id, pool.defaultId)
    assertEquals("no printer before, none now", 0, PoolList.restore(null, null, null).all().size)
  }

  @Test
  fun aSavedListComesBackWithItsDefault() {
    val pool = PoolList.restore(listOf(kitchen, bar, bar), bar.id, bar)
    assertEquals("a repeated id once", listOf(kitchen.id, bar.id), ids(pool))
    assertEquals("its own default", bar.id, pool.defaultId)
  }

  @Test
  fun anOlderAppsChangeOfItsPrinterIsFollowed() {
    val chose = PoolList.restore(listOf(kitchen, bar), kitchen.id, bt)
    assertEquals("an older app chose another printer: it replaces the default", listOf(bt.id, bar.id), ids(chose))
    assertEquals(bt.id, chose.defaultId)
    val forgot = PoolList.restore(listOf(kitchen, bar), kitchen.id, null)
    assertEquals("an older app forgot its printer: the default leaves", listOf(bar.id), ids(forgot))
    assertEquals(bar.id, forgot.defaultId)
    val emptied = PoolList.restore(emptyList(), null, kitchen)
    assertEquals("a list emptied here, a printer chosen there", listOf(kitchen.id), ids(emptied))
  }
}
