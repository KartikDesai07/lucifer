package com.possoftware.pos.printer

/**
 * Phase 3 Session 3D (spec §9.5): what the print host service and the boot receiver do when Android starts or stops them,
 * and when a device that prints for the cafe says "POS printing is off. Tap to start.". Pure (no Android), so the JVM
 * tests (src/test) pin it.
 *
 * "Printing" is the page's own wish, kept in [Prefs]: on when the page asks this device to print in the background (the
 * print host in simple mode, or a device that writes printers), off only when the page itself says stop. A stop the page
 * did not ask for (the app's task swiped away, its screen destroyed, its process killed, a reboot, an update) leaves it on,
 * so the device says printing is off until the app is open again. Nothing here starts the app: Android blocks starting an
 * activity from the background.
 */
object HostLife {
  /** The start the app asks for (the page said print here); any other start is Android's. */
  const val ACTION_START = "com.possoftware.pos.printer.action.START_HOST"

  /** The broadcasts after which this device's printing is off until the app is opened. */
  const val ACTION_BOOT_COMPLETED = "android.intent.action.BOOT_COMPLETED"
  const val ACTION_MY_PACKAGE_REPLACED = "android.intent.action.MY_PACKAGE_REPLACED"

  enum class Start {
    /** The page asked: run in the foreground with the "Printing is on" notification (sticky: Android restarts it). */
    RUN,

    /** Android restarted the service after its process died (START_STICKY, no intent): the page died with it, so say
     *  printing is off, and stop. */
    NOTICE_THEN_STOP,

    /** A restart for a device that no longer prints for the cafe: stop, silently. */
    STOP,
  }

  /** [action] is the start's intent action (null when Android restarted the service); [printing] is the page's wish. */
  fun onStart(action: String?, printing: Boolean): Start =
      when {
        action == ACTION_START -> Start.RUN
        printing -> Start.NOTICE_THEN_STOP
        else -> Start.STOP
      }

  /** The service stopped (or never ran): the notice while the page still wants this device to print. */
  fun noticeOnStop(printing: Boolean): Boolean = printing

  /** A reboot or an update of the app ended the page: the notice while this device printed for the cafe before. */
  fun noticeOnBroadcast(action: String?, printing: Boolean): Boolean =
      printing && (action == ACTION_BOOT_COMPLETED || action == ACTION_MY_PACKAGE_REPLACED)
}
