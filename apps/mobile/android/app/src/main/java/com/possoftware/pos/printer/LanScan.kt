package com.possoftware.pos.printer

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import java.io.IOException
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.net.SocketFactory

// Printing Phase 4 (spec 2026-10-15 §7.1): "Find network printers". Only when the page asks (network.findPrinters): a
// TCP connect to port 9100 on each address of this phone's own Wi-Fi or Ethernet network, nothing sent, each socket
// closed at once. New code apart from printing: no printer manager, pool or io thread is touched, and no new permission
// is needed (ACCESS_NETWORK_STATE is already granted).

/** One IPv4 address of a network: the address (big-endian, as an Int) and its prefix length. */
data class LanAddress(val address: Int, val prefix: Int)

/** What a scan looks at: each network as "192.168.1.0/24", and the addresses to ask, network by network in order. */
data class LanScanTargets(val subnets: List<String>, val hosts: List<Int>)

/** Asks one address whether it takes a TCP connection on [port] within [timeoutMs]. */
fun interface LanConnector {
  fun reachable(host: String, port: Int, timeoutMs: Int): Boolean
}

/** The scan's answer: the addresses found, or no network (not on a Wi-Fi or wired network with a private address). */
data class LanScanAnswer(val found: List<String>, val subnet: String?, val reason: String?) {
  companion object {
    const val NO_NETWORK = "no-network"

    fun of(subnets: List<String>, found: List<String>): LanScanAnswer =
        if (subnets.isEmpty()) LanScanAnswer(emptyList(), null, NO_NETWORK)
        else LanScanAnswer(found, subnets.joinToString(", "), null)
  }
}

/** The plan of a scan: pure, so it is tested on the JVM. */
object LanScanPlan {
  const val LAN_SCAN_PORT = 9100
  const val LAN_SCAN_CONNECT_MS = 500
  const val LAN_SCAN_PARALLEL = 32
  const val LAN_SCAN_MAX_MS = 10_000L
  const val LAN_SCAN_MAX_FOUND = 64
  const val LAN_SCAN_MAX_SUBNETS = 2
  private const val SLASH_24 = 24
  private const val BITS = 32
  private const val OCTETS = 4
  private const val OCTET_BITS = 8
  private const val OCTET = 0xFF
  private const val TEN = 10
  private const val ONE_SEVENTY_TWO = 172
  private const val ONE_NINETY_TWO = 192
  private const val ONE_SIXTY_EIGHT = 168
  private val PRIVATE_172 = 16..31
  private const val UNSIGNED = 0xFFFFFFFFL

  fun parse(text: String): Int {
    val parts = text.split('.')
    require(parts.size == OCTETS) { "not an IPv4 address" }
    return parts.fold(0) { acc, part -> (acc shl OCTET_BITS) or (part.toInt() and OCTET) }
  }

  fun dotted(address: Int): String =
      (OCTETS - 1 downTo 0).joinToString(".") { i -> ((address ushr (i * OCTET_BITS)) and OCTET).toString() }

  fun ofInet(address: Inet4Address): Int = address.address.fold(0) { acc, b -> (acc shl OCTET_BITS) or (b.toInt() and OCTET) }

  /** In address order (an Int is signed; an address is not). */
  fun unsigned(address: Int): Long = address.toLong() and UNSIGNED

  /** 10/8, 172.16/12 and 192.168/16: the ranges a cafe's own network uses. */
  fun isPrivate(address: Int): Boolean {
    val a = (address ushr (3 * OCTET_BITS)) and OCTET
    val b = (address ushr (2 * OCTET_BITS)) and OCTET
    return a == TEN || (a == ONE_SEVENTY_TWO && b in PRIVATE_172) || (a == ONE_NINETY_TWO && b == ONE_SIXTY_EIGHT)
  }

  /** Which network to scan: Wi-Fi first, then Ethernet; never a VPN; anything else (mobile data) is none. */
  fun rank(wifi: Boolean, ethernet: Boolean, vpn: Boolean): Int? =
      when {
        vpn -> null
        wifi -> 0
        ethernet -> 1
        else -> null
      }

  private fun mask(prefix: Int): Int = if (prefix <= 0) 0 else (-1 shl (BITS - prefix))

  /**
   * The /24 around each private address (inside the network's own range when its prefix is longer), at most
   * [LAN_SCAN_MAX_SUBNETS] of them, each once; never one of the phone's own addresses, the network's or its broadcast.
   */
  fun targets(addresses: List<LanAddress>): LanScanTargets {
    val own = addresses.map { it.address }.toSet()
    val subnets = mutableListOf<String>()
    val hosts = LinkedHashSet<Int>()
    for (entry in addresses) {
      if (subnets.size >= LAN_SCAN_MAX_SUBNETS) break
      if (!isPrivate(entry.address)) continue
      val prefix = entry.prefix.coerceIn(SLASH_24, BITS)
      val base = entry.address and mask(prefix)
      val label = dotted(base) + "/" + prefix
      if (label in subnets) continue
      subnets.add(label)
      val size = 1 shl (BITS - prefix)
      val range = if (size > 2) 1..(size - 2) else 0 until size
      for (i in range) {
        val host = base + i
        if (host !in own) hosts.add(host)
      }
    }
    return LanScanTargets(subnets, hosts.toList())
  }
}

/** The connects: [LanScanPlan.LAN_SCAN_PARALLEL] at a time on the scan's own threads, all within [maxMs]. */
object LanScanRun {
  fun run(
      hosts: List<Int>,
      connector: LanConnector,
      maxMs: Long = LanScanPlan.LAN_SCAN_MAX_MS,
      parallel: Int = LanScanPlan.LAN_SCAN_PARALLEL,
  ): List<String> {
    if (hosts.isEmpty()) return emptyList()
    val count = AtomicInteger(0)
    val pool =
        Executors.newFixedThreadPool(parallel) { r ->
          Thread(r, "pos-lan-scan-" + count.incrementAndGet()).apply { isDaemon = true }
        }
    val found = ConcurrentLinkedQueue<Int>()
    val answered: List<Int>
    try {
      for (host in hosts) pool.execute { if (probe(connector, host)) found.add(host) }
      pool.shutdown()
      pool.awaitTermination(maxMs, TimeUnit.MILLISECONDS)
    } catch (e: InterruptedException) {
      Thread.currentThread().interrupt()
    } finally {
      // What answered by the limit is the answer; a probe still out is dropped.
      answered = found.toList()
      pool.shutdownNow()
    }
    return answered
        .sortedBy { LanScanPlan.unsigned(it) }
        .take(LanScanPlan.LAN_SCAN_MAX_FOUND)
        .map { LanScanPlan.dotted(it) }
  }

  private fun probe(connector: LanConnector, host: Int): Boolean =
      try {
        connector.reachable(LanScanPlan.dotted(host), LanScanPlan.LAN_SCAN_PORT, LanScanPlan.LAN_SCAN_CONNECT_MS)
      } catch (e: Exception) {
        false
      }
}

/** A connect and an immediate close: no byte is sent. The socket comes from [factory] (the chosen network's). */
class SocketConnector(private val factory: SocketFactory = SocketFactory.getDefault()) : LanConnector {
  override fun reachable(host: String, port: Int, timeoutMs: Int): Boolean =
      try {
        factory.createSocket().use { socket ->
          socket.connect(InetSocketAddress(InetAddress.getByName(host), port), timeoutMs)
          true
        }
      } catch (e: IOException) {
        false
      } catch (e: SecurityException) {
        false
      } catch (e: IllegalArgumentException) {
        false
      }
}

/** The Android side: which network, and one scan on its own thread. */
object LanScan {
  private class Chosen(val addresses: List<LanAddress>, val factory: SocketFactory)

  /** One scan on a thread of its own (never a printer's io thread); [done] is called once, with the answer. */
  fun findPrinters(context: Context, done: (LanScanAnswer) -> Unit) {
    val thread = Thread({ done(scan(context)) }, "pos-lan-scan")
    thread.isDaemon = true
    thread.start()
  }

  private fun scan(context: Context): LanScanAnswer {
    val chosen =
        try {
          chosenNetwork(context)
        } catch (e: Exception) {
          null
        } ?: return LanScanAnswer.of(emptyList(), emptyList())
    val targets = LanScanPlan.targets(chosen.addresses)
    if (targets.subnets.isEmpty()) return LanScanAnswer.of(emptyList(), emptyList())
    return LanScanAnswer.of(targets.subnets, LanScanRun.run(targets.hosts, SocketConnector(chosen.factory)))
  }

  // The review's I-6: every network the phone has, not only the default one: a cafe Wi-Fi with no internet leaves
  // mobile data as the default, and the printer is still on the Wi-Fi. allNetworks is deprecated since API 31 (a
  // NetworkCallback is the new way) and still works; one look on a tap needs no callback.
  @Suppress("DEPRECATION")
  private fun chosenNetwork(context: Context): Chosen? {
    val cm = context.getSystemService(ConnectivityManager::class.java) ?: return null
    val ranked =
        cm.allNetworks
            .mapNotNull { network ->
              val caps = cm.getNetworkCapabilities(network) ?: return@mapNotNull null
              val rank =
                  LanScanPlan.rank(
                      wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI),
                      ethernet = caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET),
                      vpn = caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN),
                  ) ?: return@mapNotNull null
              rank to network
            }
            .sortedBy { it.first }
    for ((_, network) in ranked) {
      val links = cm.getLinkProperties(network) ?: continue
      val addresses =
          links.linkAddresses.mapNotNull { link ->
            (link.address as? Inet4Address)?.let { LanAddress(LanScanPlan.ofInet(it), link.prefixLength) }
          }
      if (addresses.any { LanScanPlan.isPrivate(it.address) }) return Chosen(addresses, network.socketFactory)
    }
    return null
  }
}
