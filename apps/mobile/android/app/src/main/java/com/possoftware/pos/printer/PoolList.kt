package com.possoftware.pos.printer

/**
 * The app's printers in order and its default (Phase 2 Session 2F2, spec §9.2): what bridge v2 lists and every v1
 * message acts on. Pure (no Android), so its rules are unit-tested: the first printer of an empty list becomes the
 * default; the default leaving promotes the first remaining one; one entry per printer id; a v1 select of a new
 * printer replaces the default in its place, as v1 always replaced its one printer. Not thread-safe: [PrinterPool]
 * guards it.
 */
class PoolList<T>(private val idOf: (T) -> String) {
  private val items = ArrayList<T>()

  var defaultId: String? = null
    private set

  fun all(): List<T> = ArrayList(items)

  fun find(id: String): T? = items.firstOrNull { idOf(it) == id }

  fun default(): T? = defaultId?.let { find(it) }

  /** v2 select: [item] joins the list (in the place of a listed one with its id, which is returned to retire). */
  fun put(item: T): List<T> {
    val at = items.indexOfFirst { idOf(it) == idOf(item) }
    val retired = if (at >= 0) listOf(items.set(at, item)) else emptyList()
    if (at < 0) items.add(item)
    if (defaultId == null) defaultId = idOf(item)
    return retired
  }

  /** v1 select: [item] becomes the default. A printer already listed is started anew in its own place and the old
   *  default stays listed (a v2 page's "Change printer" to one of the app's other printers); a new one takes the
   *  default's place and the old default leaves the list, as v1 always replaced its one printer. What leaves is
   *  returned to retire. */
  fun putDefault(item: T): List<T> {
    if (find(idOf(item)) != null) {
      val retired = put(item)
      defaultId = idOf(item)
      return retired
    }
    val current = defaultId?.let { id -> items.indexOfFirst { idOf(it) == id } } ?: -1
    if (current < 0) {
      val retired = put(item)
      defaultId = idOf(item)
      return retired
    }
    val retired = listOf(items.set(current, item))
    defaultId = idOf(item)
    return retired
  }

  /** Makes [id] the default when it is listed (a saved list's own default); false otherwise. */
  fun makeDefault(id: String): Boolean {
    if (find(id) == null) return false
    defaultId = id
    return true
  }

  /** Removes [id] (returned to retire); the default leaving promotes the first remaining printer. */
  fun remove(id: String): T? {
    val at = items.indexOfFirst { idOf(it) == id }
    if (at < 0) return null
    val gone = items.removeAt(at)
    if (defaultId == id) defaultId = items.firstOrNull()?.let(idOf)
    return gone
  }

  companion object {
    /**
     * The saved list as this app starts. [listed] and [listedDefault] are the saved list (null when none was ever
     * saved: an app updated from v1, whose one printer [v1] becomes the list and its default). [v1] is the printer
     * the v1 keys name, which always name the default (an older app reinstalled over this one keeps reading and
     * writing them): when they name another printer, or none, an older app changed it, and this app follows as a
     * v1 select or forget would.
     */
    fun restore(listed: List<PrinterInfo>?, listedDefault: String?, v1: PrinterInfo?): PoolList<PrinterInfo> {
      val pool = PoolList<PrinterInfo> { it.id }
      if (listed == null) {
        if (v1 != null) pool.put(v1)
        return pool
      }
      for (info in listed) if (pool.find(info.id) == null) pool.put(info)
      if (listedDefault != null) pool.makeDefault(listedDefault)
      if (v1 == null) {
        pool.defaultId?.let { pool.remove(it) }
      } else if (v1 != pool.default()) {
        pool.putDefault(v1)
      }
      return pool
    }
  }
}
