package com.possoftware.pos.printer

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Printing Phase 4 (spec 2026-10-15 §8, Phase 2's m-2): a network printer is named by its address, with the port when it
 * is not 9100, so two printers on one address are told apart in the printer list and the print-host notification; the
 * shown name comes from the printer's id, so one saved under the older name is named apart too, with nothing rewritten.
 */
class PrinterNamesTest {
  private val words: (String) -> String = { label -> "Network printer $label" }

  @Test
  fun port9100KeepsTodaysNameAnyOtherPortIsNamed() {
    assertEquals("9100: as today", "10.0.2.2", PrinterNames.networkLabel("10.0.2.2", 9100))
    assertEquals("another port: the port too", "10.0.2.2:9101", PrinterNames.networkLabel("10.0.2.2", 9101))
    assertEquals("a host name", "kitchen.local:6001", PrinterNames.networkLabel("kitchen.local", 6001))
  }

  @Test
  fun aPrinterSavedWithTheOlderNameIsShownByItsId() {
    val saved = PrinterInfo("tcp:10.0.2.2:9101", "Network printer 10.0.2.2", BridgeCodes.TRANSPORT_TCP, "10.0.2.2:9101")
    assertEquals("named apart from the 9100 printer on that address", "Network printer 10.0.2.2:9101", PrinterNames.shown(saved, words).name)
    val kitchen = PrinterInfo("tcp:10.0.2.2:9100", "Network printer 10.0.2.2", BridgeCodes.TRANSPORT_TCP, "10.0.2.2:9100")
    assertEquals("the 9100 printer keeps its name", kitchen, PrinterNames.shown(kitchen, words))
    assertEquals("only the name changes", saved.copy(name = "Network printer 10.0.2.2:9101"), PrinterNames.shown(saved, words))
  }

  @Test
  fun otherPrintersKeepTheirOwnNames() {
    val bt = PrinterInfo("bt-classic:00:11:22:33:44:55", "RPP02N", BridgeCodes.TRANSPORT_BT_CLASSIC, "00:11:22:33:44:55")
    assertEquals("a Bluetooth printer", bt, PrinterNames.shown(bt, words))
    val usb = PrinterInfo("usb:04b8:0e15", "USB printer", BridgeCodes.TRANSPORT_USB)
    assertEquals("a USB printer", usb, PrinterNames.shown(usb, words))
    val odd = PrinterInfo("tcp:nonsense", "Network printer x", BridgeCodes.TRANSPORT_TCP)
    assertEquals("an id that names no address keeps its saved name", odd, PrinterNames.shown(odd, words))
  }

  @Test
  fun theSavedListAndTheV1PrinterAreShownByTheirIds() {
    val list = listOf(tcpPrinter(9100), tcpPrinter(9101).copy(name = "Network printer 10.0.2.2"), btPrinter())
    assertEquals(
        "every printer of the saved list",
        listOf("Network printer 10.0.2.2", "Network printer 10.0.2.2:9101", "RPP02N"),
        PrinterNames.shownAll(list, words).map { it.name },
    )
  }
}
