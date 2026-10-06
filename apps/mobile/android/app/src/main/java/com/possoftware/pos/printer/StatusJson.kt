package com.possoftware.pos.printer

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject

/** PrinterStatus / NativePrinter (and bridge v2's list of printers) in the two shapes the app needs: RN maps and page
 *  JSON. */
object StatusJson {
  fun printerJson(p: PrinterInfo): JSONObject {
    val json = JSONObject()
    json.put("id", p.id)
    json.put("name", p.name)
    json.put("transport", p.transport)
    if (p.address != null) json.put("address", p.address)
    if (p.paired != null) json.put("paired", p.paired)
    return json
  }

  fun toJson(s: StatusSnapshot): JSONObject {
    val json = JSONObject()
    json.put("state", s.state)
    json.put("printer", if (s.printer != null) printerJson(s.printer) else JSONObject.NULL)
    json.put("bluetooth", s.bluetooth)
    return json
  }

  fun printerMap(p: PrinterInfo): WritableMap {
    val map = Arguments.createMap()
    map.putString("id", p.id)
    map.putString("name", p.name)
    map.putString("transport", p.transport)
    if (p.address != null) map.putString("address", p.address)
    if (p.paired != null) map.putBoolean("paired", p.paired)
    return map
  }

  fun toMap(s: StatusSnapshot): WritableMap {
    val map = Arguments.createMap()
    map.putString("state", s.state)
    if (s.printer != null) map.putMap("printer", printerMap(s.printer)) else map.putNull("printer")
    map.putString("bluetooth", s.bluetooth)
    return map
  }

  /** Bridge v2's list: { printers: [{ state, printer }], defaultId, bluetooth }, every key always there. */
  fun poolJson(s: PoolSnapshot): JSONObject {
    val printers = JSONArray()
    for (entry in s.printers) printers.put(JSONObject().put("state", entry.state).put("printer", printerJson(entry.printer)))
    val json = JSONObject()
    json.put("printers", printers)
    json.put("defaultId", s.defaultId ?: JSONObject.NULL)
    json.put("bluetooth", s.bluetooth)
    return json
  }

  fun poolMap(s: PoolSnapshot): WritableMap {
    val printers = Arguments.createArray()
    for (entry in s.printers) {
      val item = Arguments.createMap()
      item.putString("state", entry.state)
      item.putMap("printer", printerMap(entry.printer))
      printers.pushMap(item)
    }
    val map = Arguments.createMap()
    map.putArray("printers", printers)
    if (s.defaultId != null) map.putString("defaultId", s.defaultId) else map.putNull("defaultId")
    map.putString("bluetooth", s.bluetooth)
    return map
  }
}
