/* ============================================================
   Geo Drone — cockpit readout waveform

   Draws the magenta → blue frequency trace on the dashboard
   panel. The shape is a zig-zag polyline (one vertex per band,
   alternating above/below the centre line) which is what gives
   it the spiky EQ look; the vertex heights come straight from
   GeoAudio.fillSpectrum(), so it moves with the voice.
   ============================================================ */

(function (global) {
  'use strict';

  var MAX_BANDS = 46;         // vertices across the panel at full size
  var bands = MAX_BANDS;      // trimmed on narrow panels so spikes stay legible
  var STOPS = [
    [0.00, '#ff2bc4'],
    [0.22, '#f636d9'],
    [0.44, '#b64bff'],
    [0.64, '#7a6bff'],
    [0.82, '#3f8dff'],
    [1.00, '#2fd2ff']
  ];

  var canvas, ctx, dpr = 1;
  var w = 0, h = 0;
  var spectrum = new Float32Array(MAX_BANDS);
  var smooth = new Float32Array(MAX_BANDS);
  var view = spectrum.subarray(0, MAX_BANDS);
  var running = false;
  var gradient = null;

  /* ---------------------------------------------------------- sizing */
  function resize() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    w = Math.max(1, Math.round(r.width));
    h = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* ~9px per spike keeps the trace readable instead of a smear */
    bands = Math.max(16, Math.min(MAX_BANDS, Math.round(w / 9)));
    if (bands % 2 === 0) bands -= 1;   // odd count ends the zig-zag cleanly
    view = spectrum.subarray(0, bands);

    gradient = ctx.createLinearGradient(0, 0, w, 0);
    STOPS.forEach(function (s) { gradient.addColorStop(s[0], s[1]); });
  }

  /* ---------------------------------------------------------- drawing */
  function points(amp) {
    var mid = h / 2;
    var half = h * 0.40;
    var pad = w * 0.035;
    var span = w - pad * 2;
    var pts = [];

    for (var i = 0; i < bands; i++) {
      var x = pad + (span * i) / (bands - 1);
      var dir = i % 2 === 0 ? -1 : 1;
      /* taper the very ends so the trace fades into the bezel */
      var edge = Math.min(1, Math.min(i, bands - 1 - i) / 3.2);
      var y = mid + dir * smooth[i] * half * (0.35 + 0.65 * edge) * amp;
      pts.push(x, y);
    }
    return pts;
  }

  function stroke(pts, width, alpha, blur) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = gradient;
    ctx.shadowColor = 'rgba(150, 90, 255, 0.9)';
    ctx.shadowBlur = blur;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  function frame() {
    if (!running) return;

    var speaking = global.GeoAudio
      ? global.GeoAudio.fillSpectrum(view)
      : false;

    /* ease toward the new spectrum — rises fast, falls softly */
    for (var i = 0; i < bands; i++) {
      var target = spectrum[i];
      var k = target > smooth[i] ? 0.55 : 0.16;
      smooth[i] += (target - smooth[i]) * k;
    }

    ctx.clearRect(0, 0, w, h);

    /* centre rail */
    ctx.beginPath();
    ctx.moveTo(w * 0.035, h / 2);
    ctx.lineTo(w * 0.965, h / 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(130, 200, 255, 0.16)';
    ctx.stroke();

    var scale = Math.max(0.14, h / 120);
    var base = Math.max(1.6, 2.2 * scale);
    /* the idle breath is already scaled down inside GeoAudio, so it
       only needs a light trim here to sit back from a live line */
    var amp = speaking ? 1 : 0.85;

    var pts = points(amp);

    /* soft bloom pass, then the crisp trace on top */
    stroke(pts, base * 2.6, 0.16, 18 * scale);
    stroke(pts, base, 1, 10 * scale);

    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------- api */
  function init(el) {
    canvas = el;
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    resize();
    global.addEventListener('resize', resize, { passive: true });
    if (global.ResizeObserver) {
      new ResizeObserver(resize).observe(canvas);
    }
  }

  function start() {
    if (running || !ctx) return;
    running = true;
    requestAnimationFrame(frame);
  }

  function stop() { running = false; }

  global.GeoWave = { init: init, start: start, stop: stop, resize: resize };
})(window);
