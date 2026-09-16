// Fills book.html from its JSON block. window.__showPage(n) shows one page (1..6) for PNG capture,
// window.__showPage(-1) shows all for the PDF. dataset.ready = "1" once fonts are in.
(function () {
  "use strict";
  var data = JSON.parse(document.getElementById("book-data").textContent);
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  var ICONS = {
    receipt: '<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    printer: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/><path d="M17 11.5h.01"/>',
    qr: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3zM20 14h1v1h-1M17 20h4M20 17v1M14 20h1"/>',
    tables: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.1A8 8 0 1 1 21 12z"/><path d="M8.5 11h7M8.5 14h4"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5M3 16l9 5 9-5"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="M10 14h4M12 14v4"/>',
    book: '<path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3z"/><path d="M4 4v16M8 9h6M8 13h6"/>',
    devices: '<rect x="2" y="5" width="13" height="10" rx="2"/><path d="M6 19h5M8.5 15v4"/><rect x="17" y="8" width="5" height="11" rx="1.5"/>'
  };

  document.querySelectorAll("[data-k]").forEach(function (n) { n.textContent = data[n.getAttribute("data-k")]; });
  $("c-l1").textContent = data.cover.l1; $("c-l2").textContent = data.cover.l2; $("c-tag").textContent = data.cover.tag;

  $("p-eyebrow").textContent = data.pains.eyebrow; $("p-h").textContent = data.pains.h;
  $("p-kicker").textContent = data.pains.kicker;
  data.pains.items.forEach(function (it, i) {
    var c = el("div", "pain"); c.appendChild(el("div", "num", String(i + 1)));
    var art = el("div", "art"); art.innerHTML = '<svg viewBox="0 0 24 24">' + (ICONS[it[0]] || ICONS.receipt) + "</svg>"; c.appendChild(art);
    c.appendChild(el("div", "q", it[1])); c.appendChild(el("div", "a", it[2])); $("pains").appendChild(c);
  });

  $("f-eyebrow").textContent = data.features.eyebrow; $("f-h").textContent = data.features.h; $("f-sub").textContent = data.features.sub;
  data.features.items.forEach(function (it) {
    var c = el("div", "feat"); var ico = el("div", "ico"); ico.innerHTML = '<svg viewBox="0 0 24 24">' + (ICONS[it[0]] || ICONS.receipt) + "</svg>";
    var body = el("div"); body.appendChild(el("h3", null, it[1])); body.appendChild(el("p", null, it[2])); c.appendChild(ico); c.appendChild(body); $("feats").appendChild(c);
  });

  $("q-eyebrow").textContent = data.qr.eyebrow; $("q-h").textContent = data.qr.h; $("q-line").textContent = data.qr.line;
  var ART = [artQr, artPhone, artKot];
  data.qr.steps.forEach(function (s, i) {
    var c = el("div", "fcard"); c.appendChild(el("div", "n", String(i + 1)));
    var art = el("div", "art"); art.appendChild(ART[i]()); c.appendChild(art);
    c.appendChild(el("h3", null, s[0])); c.appendChild(el("p", null, s[1])); $("flow").appendChild(c);
  });

  $("m-eyebrow").textContent = data.msg.eyebrow; $("m-h").textContent = data.msg.h; $("m-line").textContent = data.msg.line;
  var b1 = el("div", "wa-b"); b1.appendChild(document.createTextNode(data.msg.bubble));
  var bill = el("div", "wa-bill"); bill.appendChild(el("b", null, "SUNRISE CAFÉ")); bill.appendChild(el("span", null, "Bill #1042 · Table 4 · 7:42 PM"));
  var amt = el("div", "amt"); amt.appendChild(document.createTextNode("₹567")); amt.appendChild(el("i", null, "PAID · UPI")); bill.appendChild(amt); b1.appendChild(bill); b1.appendChild(el("time", null, "7:42 PM"));
  var b2 = el("div", "wa-b"); b2.appendChild(document.createTextNode(data.msg.status)); b2.appendChild(el("time", null, "7:43 PM"));
  var b3 = el("div", "wa-b"); b3.appendChild(document.createTextNode(data.msg.offer)); b3.appendChild(el("time", null, "7:58 PM"));
  $("wa-body").appendChild(b1); $("wa-body").appendChild(b2); $("wa-body").appendChild(b3);
  data.msg.stats.forEach(function (s, i) {
    var d = el("div", "stat" + (i === data.msg.stats.length - 1 ? " split" : "")); d.appendChild(el("span", null, s[0])); d.appendChild(el("b", null, s[1]));
    if (i === data.msg.stats.length - 1) { var bar = el("div", "bar"); bar.appendChild(el("i")); d.appendChild(bar); var lg = el("div", "lg"); lg.appendChild(el("span", null, "Cash 38%")); lg.appendChild(el("span", null, "UPI 62%")); d.appendChild(lg); }
    $("stats").appendChild(d);
  });

  var h = data.hook;
  $("h-eyebrow").textContent = h.eyebrow; h.headline.forEach(function (line) { $("h-headline").appendChild(el("span", null, line)); });
  $("h-punch").textContent = h.punch; $("h-statement").textContent = h.statement; $("h-statement-sub").textContent = h.statementSub;
  $("h-cta").textContent = h.cta; $("h-fn").textContent = h.footnote;
  var th = el("div", "tr th"); th.appendChild(el("div", "k", "")); th.appendChild(el("div", "l", h.colLeft)); th.appendChild(el("div", "r", h.colRight)); $("h-table").appendChild(th);
  h.rows.forEach(function (row) {
    var tr = el("div", "tr"); tr.appendChild(el("div", "k", row[0]));
    var l = el("div", "l"); l.appendChild(el("span", "ic x", "✕")); l.appendChild(el("span", null, row[1])); tr.appendChild(l);
    var r = el("div", "r"); r.appendChild(el("span", "ic ok", "✓")); r.appendChild(el("span", null, row[2])); tr.appendChild(r);
    $("h-table").appendChild(tr);
  });

  function artQr() {
    var card = el("div", "qr-card"); var n = 21, state = 20260912, out = [];
    var rand = function () { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
    var rect = function (x, y, w, hh, f) { out.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + hh + '" fill="' + f + '"/>'); };
    var inFinder = function (x, y) { return (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8); };
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (!inFinder(x, y) && rand() < 0.46) rect(x, y, 1, 1, "#10261c");
    [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (f) { rect(f[0], f[1], 7, 7, "#10261c"); rect(f[0] + 1, f[1] + 1, 5, 5, "#fff"); rect(f[0] + 2, f[1] + 2, 3, 3, "#10261c"); });
    card.innerHTML = '<svg viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges">' + out.join("") + "</svg>"; return card;
  }
  function artPhone() {
    var p = el("div", "mini-phone"); var s = el("div", "mini-screen");
    [["Cappuccino ₹120", "+ Add", ""], ["Veg Sandwich ₹180", "Added ✓", "in"], ["Fries ₹120", "+ Add", ""]].forEach(function (r) { var row = el("div", "mini-row"); row.appendChild(document.createTextNode(r[0])); row.appendChild(el("span", r[2], r[1])); s.appendChild(row); });
    s.appendChild(el("div", "mini-bar", "1 item · ₹180 · Place order →")); p.appendChild(s); return p;
  }
  function artKot() {
    var k = el("div", "kot"); k.appendChild(el("b", null, "KITCHEN ORDER")); k.appendChild(el("div", null, "Table 6 · Round 1")); k.appendChild(el("div", "r"));
    k.appendChild(el("div", null, "1  Veg Sandwich")); k.appendChild(el("div", "note", "- no onion")); k.appendChild(el("div", "stamp", "PRINTED")); return k;
  }

  var pages = Array.prototype.slice.call(document.querySelectorAll(".page"));
  window.__showPage = function (n) { pages.forEach(function (p, i) { p.style.display = n < 0 || i === n - 1 ? "flex" : "none"; }); return pages.length; };
  window.__PAGES = pages.length;
  var FONT_WAIT_MS = 6000;
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, FONT_WAIT_MS); })]).then(function () {
    requestAnimationFrame(function () { requestAnimationFrame(function () { document.documentElement.dataset.ready = "1"; }); });
  });
})();
