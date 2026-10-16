package com.possoftware.pos.printer

import java.net.InetAddress
import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Printing Phase 4 (spec 2026-10-15 §7.1): "Find network printers". The plan (which /24s, which hosts) and the run (the
 * connects, the limits) are plain JVM code; only the network choice and the bound sockets are Android's.
 */
class LanScanTest {
  private fun ip(text: String): Int = LanScanPlan.parse(text)

  private fun address(text: String, prefix: Int = 24): LanAddress = LanAddress(ip(text), prefix)

  @Test
  fun aPrivateNetworksSlash24IsPlannedAndTheDevicesOwnAddressIsNeverProbed() {
    val plan = LanScanPlan.targets(listOf(address("192.168.1.37")))
    assertEquals("one /24", listOf("192.168.1.0/24"), plan.subnets)
    assertEquals(".1 to .254 less this phone's own address", 253, plan.hosts.size)
    assertTrue("never its own address", ip("192.168.1.37") !in plan.hosts)
    assertTrue("never the network or broadcast address", ip("192.168.1.0") !in plan.hosts && ip("192.168.1.255") !in plan.hosts)
    assertEquals("in address order", "192.168.1.1", LanScanPlan.dotted(plan.hosts.first()))
  }

  @Test
  fun everyPrivateRangeIsScannedAndNothingElse() {
    assertEquals("10/8 (the emulator's own network)", listOf("10.0.2.0/24"), LanScanPlan.targets(listOf(address("10.0.2.15"))).subnets)
    assertEquals("172.16/12, a /20 network: the /24 around the address", listOf("172.20.31.0/24"), LanScanPlan.targets(listOf(address("172.20.31.58", 20))).subnets)
    assertEquals("172.31 is private", listOf("172.31.0.0/24"), LanScanPlan.targets(listOf(address("172.31.0.9"))).subnets)
    for (public in listOf("172.32.0.5", "172.15.0.5", "8.8.8.8", "169.254.10.20", "100.64.1.2", "127.0.0.1")) {
      assertEquals("$public is not a private LAN address: nothing to scan", emptyList<String>(), LanScanPlan.targets(listOf(address(public))).subnets)
    }
  }

  @Test
  fun aNetworkSmallerThanASlash24IsScannedOnlyInsideItsOwnRange() {
    val plan = LanScanPlan.targets(listOf(address("192.168.1.130", 26)))
    assertEquals("the network's own prefix", listOf("192.168.1.128/26"), plan.subnets)
    assertEquals(".129 to .190 less its own address", 61, plan.hosts.size)
    assertEquals("192.168.1.129", LanScanPlan.dotted(plan.hosts.first()))
    assertEquals("192.168.1.190", LanScanPlan.dotted(plan.hosts.last()))
  }

  @Test
  fun atMostTwoNetworksOnceEachAtMost508Addresses() {
    val two = LanScanPlan.targets(listOf(address("192.168.1.37"), address("192.168.1.38"), address("10.0.0.4"), address("10.1.0.4")))
    assertEquals("the same /24 once; at most two", listOf("192.168.1.0/24", "10.0.0.0/24"), two.subnets)
    assertEquals("both /24s, less the two own addresses in the first and the one in the second", 252 + 253, two.hosts.size)
    assertTrue("never more than 508", two.hosts.size <= 2 * 254)
    assertTrue("no host twice", two.hosts.toSet().size == two.hosts.size)
  }

  @Test
  fun theNetworkIsTheWiFiOrEthernetOneNeverAVpnWiFiFirst() {
    assertEquals("Wi-Fi", 0, LanScanPlan.rank(wifi = true, ethernet = false, vpn = false))
    assertEquals("Ethernet after Wi-Fi", 1, LanScanPlan.rank(wifi = false, ethernet = true, vpn = false))
    assertNull("a VPN, even over Wi-Fi", LanScanPlan.rank(wifi = true, ethernet = false, vpn = true))
    assertNull("mobile data", LanScanPlan.rank(wifi = false, ethernet = false, vpn = false))
  }

  @Test
  fun theRunAnswersTheHostsThatAcceptSortedAtMost64() {
    val hosts = (1..200).map { ip("192.168.1.0") + it }.shuffled()
    val found = LanScanRun.run(hosts, { host, _, _ -> (ip(host) and 1) == 1 })
    assertEquals("100 accept, at most 64 are answered", LanScanPlan.LAN_SCAN_MAX_FOUND, found.size)
    assertEquals("sorted by address, the lowest first", "192.168.1.1", found.first())
    assertEquals("the 64 lowest", "192.168.1.127", found.last())
    assertEquals(found.sortedBy { ip(it).toLong() and 0xFFFFFFFFL }, found)
  }

  @Test
  fun theRunAsksThePort9100AtMost32AtATimeWith500MsEach() {
    val busy = AtomicInteger(0)
    val most = AtomicInteger(0)
    val asked = Collections.synchronizedList(mutableListOf<String>())
    LanScanRun.run((1..100).map { ip("10.0.0.0") + it }, { host, port, timeoutMs ->
      asked.add("$port/$timeoutMs")
      most.accumulateAndGet(busy.incrementAndGet()) { a, b -> maxOf(a, b) }
      Thread.sleep(5)
      busy.decrementAndGet()
      host == "10.0.0.50"
    })
    assertEquals("every host once", 100, asked.size)
    assertEquals("port 9100, 500 ms", setOf("9100/500"), asked.toSet())
    assertTrue("never more than 32 at once (saw ${most.get()})", most.get() <= LanScanPlan.LAN_SCAN_PARALLEL)
  }

  @Test
  fun theRunStopsAtItsTimeLimit() {
    val started = System.nanoTime()
    val found = LanScanRun.run((1..64).map { ip("10.0.0.0") + it }, { _, _, _ -> Thread.sleep(400); true }, maxMs = 500, parallel = 2)
    val ms = (System.nanoTime() - started) / 1_000_000
    assertTrue("answers by its limit, not after every probe (took $ms ms)", ms < 2_000)
    assertTrue("only the probes done in time (found ${found.size})", found.size < 64)
  }

  @Test
  fun aProbeConnectsSendsNothingAndClosesAtOnce() {
    ServerSocket(0, 8, InetAddress.getLoopbackAddress()).use { server ->
      server.soTimeout = 5_000
      val connector = SocketConnector()
      val accepted = Thread {
        server.accept().use { peer ->
          peer.soTimeout = 5_000
          assertEquals("no byte, then the probe's close (EOF)", -1, peer.getInputStream().read())
        }
      }
      accepted.start()
      assertTrue("a listening port is found", connector.reachable("127.0.0.1", server.localPort, LanScanPlan.LAN_SCAN_CONNECT_MS))
      accepted.join(5_000)
    }
    val closed = ServerSocket(0, 1, InetAddress.getLoopbackAddress()).use { it.localPort }
    assertTrue("a closed port is not", !SocketConnector().reachable("127.0.0.1", closed, LanScanPlan.LAN_SCAN_CONNECT_MS))
  }

  @Test
  fun theAnswerNamesTheNetworksOrSaysThereIsNone() {
    val answer = LanScanAnswer.of(listOf("192.168.1.0/24"), listOf("192.168.1.50"))
    assertEquals(listOf("192.168.1.50"), answer.found)
    assertEquals("192.168.1.0/24", answer.subnet)
    assertNull(answer.reason)
    val none = LanScanAnswer.of(emptyList(), emptyList())
    assertEquals("no Wi-Fi or Ethernet network with a private address", "no-network", none.reason)
    assertNull(none.subnet)
    assertEquals("two networks", "192.168.1.0/24, 10.0.0.0/24", LanScanAnswer.of(listOf("192.168.1.0/24", "10.0.0.0/24"), emptyList()).subnet)
  }
}
