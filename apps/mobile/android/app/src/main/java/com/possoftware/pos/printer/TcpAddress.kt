package com.possoftware.pos.printer

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException

/**
 * Network printers live on the local network. A host name is resolved here and only a private
 * address is ever connected to, so a typed public host cannot become a way to send slips out.
 */
object TcpAddress {
  private const val IPV6_UNIQUE_LOCAL_MASK = 0xFE
  private const val IPV6_UNIQUE_LOCAL_PREFIX = 0xFC

  /** Site-local (10/8, 172.16/12, 192.168/16), link-local (169.254/16), loopback, IPv6 fc00::/7. */
  fun isPrivate(address: InetAddress): Boolean =
      address.isSiteLocalAddress ||
          address.isLinkLocalAddress ||
          address.isLoopbackAddress ||
          isUniqueLocalV6(address)

  private fun isUniqueLocalV6(address: InetAddress): Boolean =
      address is Inet6Address &&
          (address.address[0].toInt() and IPV6_UNIQUE_LOCAL_MASK) == IPV6_UNIQUE_LOCAL_PREFIX

  /**
   * Every private address of [host], IPv4 first (printers listen on IPv4; the resolver's own order
   * may put IPv6 ahead), each group in resolver order. The caller connects to exactly these.
   * Blocks on DNS, so never the UI thread. BAD_REQUEST: no private address; NOT_CONNECTED: no answer.
   */
  fun resolveAll(host: String): List<InetAddress> {
    if (!PrinterIds.validHost(host)) throw TransportException(BridgeCodes.BAD_REQUEST, "Bad address")
    val all =
        try {
          InetAddress.getAllByName(host)
        } catch (e: UnknownHostException) {
          throw TransportException(BridgeCodes.NOT_CONNECTED, "Could not find the printer")
        } catch (e: SecurityException) {
          throw TransportException(BridgeCodes.UNSUPPORTED, "Network not allowed")
        }
    val local = all.filter { isPrivate(it) }.sortedBy { if (it is Inet4Address) 0 else 1 }
    if (local.isEmpty()) throw TransportException(BridgeCodes.BAD_REQUEST, "Not a local address")
    return local
  }

  /** True only when [host] resolves and none of its addresses is private. */
  fun isForbidden(host: String): Boolean =
      try {
        resolveAll(host)
        false
      } catch (e: TransportException) {
        e.code == BridgeCodes.BAD_REQUEST
      }
}
