package com.possoftware.pos.printer

import java.io.IOException
import java.util.Locale

/** One printer as the page sees it. [address] is a MAC or host:port; [paired] only for Bluetooth. */
data class PrinterInfo(
    val id: String,
    val name: String,
    val transport: String,
    val address: String? = null,
    val paired: Boolean? = null,
)

/** The PrinterStatus map of the bridge. Data-class equality drives the change de-duplication. */
data class StatusSnapshot(val state: String, val printer: PrinterInfo?, val bluetooth: String)

/** Phase 2 Session 2F2 (spec §9.2): one printer of the app's list as bridge v2 reports it. */
data class PoolEntry(val state: String, val printer: PrinterInfo)

/** Bridge v2's printer.status: every printer in the app's order, the default's id (null only for an empty list) and
 *  Bluetooth. Data-class equality drives the change de-duplication. */
data class PoolSnapshot(val printers: List<PoolEntry>, val defaultId: String?, val bluetooth: String)

/** Result of an asynchronous manager call; the module turns it into a promise settlement. */
sealed class Reply<out T> {
  class Ok<out T>(val value: T) : Reply<T>()

  class Err(val code: String, val message: String) : Reply<Nothing>()

  companion object {
    fun fail(code: String): Err = Err(code, Messages.of(code))
  }
}

typealias ReplyCallback<T> = (Reply<T>) -> Unit

/** Failure of a transport call, carrying the bridge code it maps to. [needsForeground]: refused
 *  only because the app is hidden, so a system dialog cannot show yet. Not a denial: the manager
 *  asks again once the app is visible. */
class TransportException(val code: String, message: String, val needsForeground: Boolean = false) : IOException(message)

/** A byte pipe to one printer. open/write run on the io thread; close may run on any thread. */
interface PrinterTransport {
  /** Blocks until connected; throws [TransportException]. */
  fun open()

  /** Blocks until every byte is handed to the link; throws [TransportException]. */
  fun write(data: ByteArray)

  /** Idempotent and safe from any thread; also aborts a blocked open/write. */
  fun close()
}

/** Called when a link that was established drops without close() having been requested. */
fun interface LinkListener {
  fun onLinkLost(source: PrinterTransport)
}

/** English texts for rejections. The JS layer replaces them with its curated copy by code. */
object Messages {
  fun of(code: String): String =
      when (code) {
        BridgeCodes.NOT_CONNECTED -> "The printer is not connected."
        BridgeCodes.WRITE_FAILED -> "The slip could not be sent to the printer."
        BridgeCodes.TOO_LARGE -> "The slip is too large to print."
        BridgeCodes.BUSY -> "The printer is busy."
        BridgeCodes.TIMEOUT -> "The printer took too long to respond."
        BridgeCodes.UNAUTHORIZED -> "Permission is needed to use Bluetooth."
        BridgeCodes.BLUETOOTH_OFF -> "Bluetooth is turned off."
        BridgeCodes.UNSUPPORTED -> "This device cannot do that."
        BridgeCodes.LOCATION_OFF -> "Turn on Location so this tablet can find nearby printers."
        else -> "That request was not valid."
      }
}

/** Printer id grammar: bt-classic:MAC, ble:MAC, usb:VID:PID (hex), tcp:host:port. */
object PrinterIds {
  private const val HEX_RADIX = 16
  private const val PORT_MIN = 1
  private const val PORT_MAX = 65535
  private const val HOST_MAX_CHARS = 253
  private val MAC_REGEX = Regex("^([0-9A-F]{2}:){5}[0-9A-F]{2}$")
  private val HOST_REGEX = Regex("^[A-Za-z0-9._-]+$")

  fun classic(mac: String): String = BridgeCodes.TRANSPORT_BT_CLASSIC + ":" + mac

  fun ble(mac: String): String = BridgeCodes.TRANSPORT_BLE + ":" + mac

  fun usb(vendorId: Int, productId: Int): String =
      String.format(Locale.ROOT, "%s:%04x:%04x", BridgeCodes.TRANSPORT_USB, vendorId, productId)

  fun tcp(host: String, port: Int): String = BridgeCodes.TRANSPORT_TCP + ":" + host + ":" + port

  fun transportOf(id: String): String? {
    val prefix = id.substringBefore(':', "")
    return if (BridgeCodes.TRANSPORTS.contains(prefix)) prefix else null
  }

  /** The MAC of a bt-classic / ble id, upper-cased, or null when malformed. */
  fun macOf(id: String): String? {
    val mac = id.substringAfter(':', "").uppercase(Locale.ROOT)
    return if (MAC_REGEX.matches(mac)) mac else null
  }

  fun usbOf(id: String): Pair<Int, Int>? {
    val parts = id.split(':')
    if (parts.size != 3) return null
    val vendor = parts[1].toIntOrNull(HEX_RADIX) ?: return null
    val product = parts[2].toIntOrNull(HEX_RADIX) ?: return null
    return Pair(vendor, product)
  }

  fun tcpOf(id: String): Pair<String, Int>? {
    val rest = id.substringAfter(':', "")
    val split = rest.lastIndexOf(':')
    if (split <= 0) return null
    val host = rest.substring(0, split)
    val port = rest.substring(split + 1).toIntOrNull() ?: return null
    return if (validHost(host) && port in PORT_MIN..PORT_MAX) Pair(host, port) else null
  }

  fun validHost(host: String): Boolean =
      host.isNotEmpty() && host.length <= HOST_MAX_CHARS && HOST_REGEX.matches(host)

  fun validPort(port: Int): Boolean = port in PORT_MIN..PORT_MAX
}

/** Starts a daemon thread; used for the per-link reader threads. */
fun startDaemon(name: String, body: () -> Unit): Thread {
  val thread = Thread({ body() }, name)
  thread.isDaemon = true
  thread.start()
  return thread
}

/** Sleeps between link chunks; an interrupt aborts the write. */
fun pauseMs(ms: Long) {
  try {
    Thread.sleep(ms)
  } catch (e: InterruptedException) {
    Thread.currentThread().interrupt()
    throw TransportException(BridgeCodes.WRITE_FAILED, "Interrupted")
  }
}
