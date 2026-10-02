package com.possoftware.pos.printer

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject

/** PrinterStatus / NativePrinter in the two shapes the app needs: RN maps and page JSON. */
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
}
