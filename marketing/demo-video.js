// Timeline for demo-video.html. Every frame is a pure function of t (ms):
// window.__seek(t) draws it; the recorder steps t frame by frame, a browser
// preview loops it with requestAnimationFrame. Scene times are LOCAL (ms from
// the scene's start), so a scene can be moved by editing SCENES alone.
(function () {
  "use strict";
  var SCENES = { s1: [0, 4500], s2: [4500, 13000], s3: [13000, 20000], s4: [20000, 31000], s5: [31000, 38000], s7: [38000, 45000], s6: [45000, 52000] };
  var TOTAL_MS = SCENES.s6[1];
  var FADE_MS = 500;
  var TAP_MS = 500;
  var PRESS_MS = 260;
  var QR_MODULES = 25;
  var TABLES = [
    ["T1", "busy", "₹640"], ["T2", "", "Free"], ["T3", "busy", "₹1,120"], ["T4", "busy", "₹567"],
    ["T5", "", "Free"], ["T6", "busy", "₹300 · QR"], ["T7", "due", "Udhaar ₹450"], ["T8", "busy", "₹890"],
    ["T9", "", "Free"], ["T10", "busy", "₹1,480"], ["T11", "", "Free"], ["T12", "", "Free"]
  ];
  var REPORT = { sales: 18460, bills: 42, dues: 1200, cashPct: 38 };

  var $ = function (id) { return document.getElementById(id); };
  var clamp01 = function (v) { return v < 0 ? 0 : v > 1 ? 1 : v; };
  var linear = function (p) { return p; };
  var easeOut = function (p) { return 1 - Math.pow(1 - p, 3); };
  var back = function (p) { var c1 = 1.4, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  function seg(t, a, b, e) { return (e || easeOut)(clamp01((t - a) / (b - a))); }
  function lerp(a, b, p) { return a + (b - a) * p; }
  function inr(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
  function rise(el, p, y, s) {
    el.style.opacity = p;
    el.style.transform = "translateY(" + ((1 - p) * (y == null ? 40 : y)) + "px)" + (s ? " scale(" + lerp(s, 1, p) + ")" : "");
  }
  function pop(el, p, extra) { el.style.opacity = clamp01(p * 2); el.style.transform = (extra || "") + " scale(" + lerp(0.6, 1, back(p)) + ")"; }
  function slideX(el, p, x) { el.style.opacity = p; el.style.transform = "translateX(" + ((1 - p) * x) + "px)"; }
  function sceneVis(el, t, range, holdEnd) {
    var a = range[0], b = range[1];
    if (t < a || t >= b) { el.style.visibility = "hidden"; el.style.opacity = 0; return -1; }
    var pin = seg(t, a, a + FADE_MS, linear), pout = holdEnd ? 1 : 1 - seg(t, b - FADE_MS, b, linear);
    el.style.visibility = "visible"; el.style.opacity = Math.min(pin, pout); return t - a;
  }
  function center(el, container) {
    var r = el.getBoundingClientRect(), c = container.getBoundingClientRect();
    return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2 };
  }
  function tapRing(ring, t, taps) {
    ring.style.opacity = 0;
    for (var i = 0; i < taps.length; i++) {
      var p = (t - taps[i][0]) / TAP_MS;
      if (p >= 0 && p <= 1) {
        ring.style.left = taps[i][1].x + "px"; ring.style.top = taps[i][1].y + "px";
        ring.style.opacity = 1 - p; ring.style.transform = "scale(" + lerp(0.5, 1.5, p) + ")";
      }
    }
  }
  function within(t, at) { return t >= at && t < at + PRESS_MS; }
  function stepTween(t, steps, dur) {
    var v = 0;
    for (var i = 0; i < steps.length; i++) if (t >= steps[i][0]) v = lerp(v, steps[i][1], seg(t, steps[i][0], steps[i][0] + dur));
    return v;
  }
  function buildQr(container, n) {
    var state = 20260912;
    var rand = function () { state = (state * 1103515245 + 12345) & 0x7fffffff; return state / 0x7fffffff; };
    var out = [];
    var rect = function (x, y, w, h, fill) { out.push('<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + fill + '"/>'); };
    var inFinder = function (x, y) { return (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8); };
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (!inFinder(x, y) && rand() < 0.46) rect(x, y, 1, 1, "#10261c");
    [[0, 0], [n - 7, 0], [0, n - 7]].forEach(function (f) { rect(f[0], f[1], 7, 7, "#10261c"); rect(f[0] + 1, f[1] + 1, 5, 5, "#fff"); rect(f[0] + 2, f[1] + 2, 3, 3, "#10261c"); });
    container.innerHTML = '<svg viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges">' + out.join("") + "</svg>";
  }

  var el = {}, pos = {}, slipHeight = 0;
  ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s1-mark", "s1-brand", "s1-l1", "s1-l2", "s1-chips",
    "s2-cap", "s2-tablet", "s2-screen", "t-cap", "t-sand", "t-fries", "cl-cap", "cl-cap-q", "cl-cap-a", "cl-sand", "cl-fries", "c-sub", "c-gst", "c-tot", "pay", "rc-pop", "rc-stamp", "tap",
    "s3-cap", "slip-out", "printer", "led", "printed-badge", "s3-badges",
    "s4-cap", "phone", "pscreen", "p-scan", "qr", "scan-line", "scan-ok", "p-hero", "p-menu", "pi1", "pi2", "pi3", "pi4", "pa1", "pa2", "p-cartbar", "p-cart-txt", "p-sent", "ptap", "req", "req-approve", "req-status", "rtap",
    "s5-cap", "floor-card", "floor", "report", "rp-sales", "rp-bills", "rp-avg", "rp-dues", "rp-cash", "rp-cash-lbl", "rp-upi-lbl",
    "s7-cap", "wa-phone", "wa-b1", "wa-b2", "wa-b3", "tg-card",
    "s6-eyebrow", "s6-price", "s6-credit", "s6-lines", "s6-cta", "s6-brand"].forEach(function (id) { el[id] = $(id); });
  var s1Chips = Array.prototype.slice.call(el["s1-chips"].children);
  var s3Badges = Array.prototype.slice.call(el["s3-badges"].children);
  var s6Lines = Array.prototype.slice.call(el["s6-lines"].children);
  var pItems = [el.pi1, el.pi2, el.pi3, el.pi4];
  var tables = TABLES.map(function (row) {
    var d = document.createElement("div"); d.className = "tb " + row[1];
    var b = document.createElement("b"); b.textContent = row[0]; var s = document.createElement("span"); s.textContent = row[2];
    d.appendChild(b); d.appendChild(s); el.floor.appendChild(d); return d;
  });
  buildQr(el.qr, QR_MODULES);

  function drawS1(l) {
    pop(el["s1-mark"], seg(l, 100, 900));
    rise(el["s1-brand"], seg(l, 500, 1200), 30);
    rise(el["s1-l1"], seg(l, 1200, 1900), 60);
    rise(el["s1-l2"], seg(l, 1600, 2300), 60);
    s1Chips.forEach(function (c, i) { rise(c, seg(l, 2500 + i * 150, 3100 + i * 150), 24); });
  }

  var TAP1 = 1600, TAP2 = 2300, TAP3 = 3000, TAP4 = 3700, PAY = 4800;
  function drawS2(l) {
    rise(el["s2-cap"], seg(l, 200, 800), 40);
    rise(el["s2-tablet"], seg(l, 500, 1300), 80, 0.94);
    tapRing(el.tap, l, [[TAP1, pos.cap], [TAP2, pos.cap], [TAP3, pos.sand], [TAP4, pos.fries], [PAY, pos.pay]]);
    el["t-cap"].classList.toggle("pressed", within(l, TAP1) || within(l, TAP2));
    el["t-sand"].classList.toggle("pressed", within(l, TAP3));
    el["t-fries"].classList.toggle("pressed", within(l, TAP4));
    slideX(el["cl-cap"], seg(l, TAP1, TAP1 + 350), 24);
    var qty = l >= TAP2 ? 2 : 1; el["cl-cap-q"].textContent = qty; el["cl-cap-a"].textContent = qty * 120;
    slideX(el["cl-sand"], seg(l, TAP3, TAP3 + 350), 24);
    slideX(el["cl-fries"], seg(l, TAP4, TAP4 + 350), 24);
    var sub = stepTween(l, [[TAP1, 120], [TAP2, 240], [TAP3, 420], [TAP4, 540]], 300);
    el["c-sub"].textContent = inr(sub); el["c-gst"].textContent = inr(sub * 0.05); el["c-tot"].textContent = inr(sub * 1.05);
    var paid = l >= PAY + 200;
    el.pay.classList.toggle("done", paid);
    el.pay.textContent = paid ? "Paid ✓ · " + inr(sub * 1.05) : sub > 0 ? "Pay " + inr(sub * 1.05) + " · UPI" : "Pay · UPI";
    el["rc-pop"].style.transform = "translateY(" + lerp(110, 0, seg(l, PAY + 400, PAY + 1200)) + "%)";
    pop(el["rc-stamp"], seg(l, PAY + 1500, PAY + 1900), "rotate(-10deg)");
  }

  var PRINT0 = 1500, PRINT1 = 3800;
  function drawS3(l) {
    rise(el["s3-cap"], seg(l, 200, 800), 40);
    rise(el.printer, seg(l, 400, 1100), 80, 0.96);
    var printing = l >= 1200 && l < PRINT1 + 300;
    el.led.classList.toggle("on", l >= 1200 && (!printing || Math.floor(l / 250) % 2 === 0));
    el["slip-out"].style.height = (seg(l, PRINT0, PRINT1, linear) * slipHeight) + "px";
    pop(el["printed-badge"], seg(l, PRINT1 + 200, PRINT1 + 700), "translateX(-50%)");
    s3Badges.forEach(function (c, i) { rise(c, seg(l, 4400 + i * 180, 5000 + i * 180), 24); });
  }

  var SCAN0 = 700, SCAN1 = 2400, MENU = 2900, ADD1 = 3900, ADD2 = 4500, PLACE = 5300, SENT = 5700, REQ = 6400, APPROVE = 7900;
  function drawS4(l) {
    rise(el["s4-cap"], seg(l, 200, 800), 40);
    rise(el.phone, seg(l, 500, 1200), 80, 0.95);
    var scanning = l >= SCAN0 && l < SCAN1;
    el["scan-line"].style.opacity = scanning ? 1 : 0;
    el["scan-line"].style.transform = "translateY(" + (((l - SCAN0) % 1100) / 1100 * 300) + "px)";
    pop(el["scan-ok"], seg(l, SCAN1, SCAN1 + 400), "translateX(-50%)");
    var toMenu = seg(l, MENU, MENU + 400);
    el["p-scan"].style.opacity = 1 - toMenu; el["p-hero"].style.opacity = toMenu;
    pItems.forEach(function (it, i) { rise(it, seg(l, MENU + 300 + i * 120, MENU + 800 + i * 120), 20); });
    el.pa1.classList.toggle("in", l >= ADD1); el.pa1.textContent = l >= ADD1 ? "Added ✓" : "+ Add";
    el.pa2.classList.toggle("in", l >= ADD2); el.pa2.textContent = l >= ADD2 ? "Added ✓" : "+ Add";
    rise(el["p-cartbar"], seg(l, ADD1, ADD1 + 350), 20);
    el["p-cart-txt"].textContent = l >= ADD2 ? "2 items · ₹300" : "1 item · ₹120";
    tapRing(el.ptap, l, [[ADD1, pos.pa1], [ADD2, pos.pa2], [PLACE, pos.cartbar]]);
    var sent = seg(l, SENT, SENT + 400);
    el["p-menu"].style.opacity = toMenu * (1 - sent); el["p-sent"].style.opacity = sent;
    pop(el["p-sent"].firstElementChild, seg(l, SENT + 100, SENT + 700));
    rise(el.req, seg(l, REQ, REQ + 600), 60);
    tapRing(el.rtap, l, [[APPROVE, pos.approve]]);
    var approved = l >= APPROVE + 200;
    el["req-approve"].textContent = approved ? "Approved ✓" : "Approve";
    el.req.querySelector(".req-badge").style.opacity = approved ? 0 : 1;
    rise(el["req-status"], seg(l, APPROVE + 300, APPROVE + 700), 10);
  }

  var COUNT0 = 3500, COUNT1 = 4800;
  function drawS5(l) {
    rise(el["s5-cap"], seg(l, 200, 800), 40);
    rise(el["floor-card"], seg(l, 500, 1200), 80, 0.96);
    tables.forEach(function (tb, i) { rise(tb, seg(l, 1200 + i * 70, 1600 + i * 70), 16, 0.9); });
    rise(el.report, seg(l, 2900, 3600), 80, 0.96);
    var p = seg(l, COUNT0, COUNT1);
    el["rp-sales"].textContent = inr(REPORT.sales * p);
    el["rp-bills"].textContent = Math.round(REPORT.bills * p);
    el["rp-avg"].textContent = inr((REPORT.sales / REPORT.bills) * p);
    el["rp-dues"].textContent = inr(REPORT.dues * p);
    var cash = Math.round(REPORT.cashPct * p);
    el["rp-cash"].style.width = cash + "%";
    el["rp-cash-lbl"].textContent = "Cash " + cash + "%"; el["rp-upi-lbl"].textContent = "UPI " + Math.round((100 - REPORT.cashPct) * p) + "%";
  }

  function drawS7(l) {
    rise(el["s7-cap"], seg(l, 200, 800), 40);
    rise(el["wa-phone"], seg(l, 500, 1200), 80, 0.95);
    rise(el["wa-b1"], seg(l, 1500, 2000), 30, 0.96);
    rise(el["wa-b2"], seg(l, 3000, 3500), 30, 0.96);
    rise(el["wa-b3"], seg(l, 4300, 4800), 30, 0.96);
    rise(el["tg-card"], seg(l, 5300, 5900), 40, 0.94);
  }

  function drawS6(l) {
    rise(el["s6-eyebrow"], seg(l, 200, 700), 30);
    pop(el["s6-price"], seg(l, 400, 1100));
    rise(el["s6-credit"], seg(l, 1100, 1600), 20);
    s6Lines.forEach(function (li, i) { rise(li, seg(l, 1600 + i * 200, 2100 + i * 200), 24); });
    rise(el["s6-cta"], seg(l, 2600, 3200), 60, 0.96);
    rise(el["s6-brand"], seg(l, 3300, 3800), 30);
  }

  var tick = document.createElement("div");
  tick.style.cssText = "position:absolute;right:0;bottom:0;width:2px;height:2px;background:#fff;opacity:.02";
  $("stage").appendChild(tick);

  function seek(t) {
    t = Math.max(0, Math.min(TOTAL_MS - 1, t));
    var l;
    if ((l = sceneVis(el.s1, t, SCENES.s1)) >= 0) drawS1(l);
    if ((l = sceneVis(el.s2, t, SCENES.s2)) >= 0) drawS2(l);
    if ((l = sceneVis(el.s3, t, SCENES.s3)) >= 0) drawS3(l);
    if ((l = sceneVis(el.s4, t, SCENES.s4)) >= 0) drawS4(l);
    if ((l = sceneVis(el.s5, t, SCENES.s5)) >= 0) drawS5(l);
    if ((l = sceneVis(el.s7, t, SCENES.s7)) >= 0) drawS7(l);
    if ((l = sceneVis(el.s6, t, SCENES.s6, true)) >= 0) drawS6(l);
    tick.style.opacity = (Math.floor(t / 33) % 2) ? ".02" : ".03";  // guarantees a repaint per frame
  }

  function measure() {
    pos.cap = center(el["t-cap"], el["s2-screen"]); pos.sand = center(el["t-sand"], el["s2-screen"]);
    pos.fries = center(el["t-fries"], el["s2-screen"]); pos.pay = center(el.pay, el["s2-screen"]);
    pos.pa1 = center(el.pa1, el.pscreen); pos.pa2 = center(el.pa2, el.pscreen); pos.cartbar = center(el["p-cartbar"], el.pscreen);
    pos.approve = center(el["req-approve"], el.req);
    slipHeight = el["slip-out"].firstElementChild.offsetHeight + 12;
  }

  var FONT_WAIT_MS = 4000;
  var driven = /[?&]driven=1/.test(location.search);
  window.__seek = seek; window.__TOTAL_MS = TOTAL_MS;
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, FONT_WAIT_MS); })]).then(function () {
    measure(); seek(0);
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      document.documentElement.dataset.ready = "1";
      if (driven) return;
      var t0 = performance.now();
      (function loop(now) { seek((now - t0) % TOTAL_MS); requestAnimationFrame(loop); })(t0);
    }); });
  });
})();
