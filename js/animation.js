/* ============================================================
   Geo Drone — motion helpers

   Everything here returns a Promise so script.js can read as a
   straight-line script: await the line, await the sweep, await
   the shapes surfacing.

   Every delay goes through GeoLife.wait, so a hidden tab freezes
   the flow instead of running it out behind the player's back.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = document;

  /* ---------------------------------------------------------- primitives */
  /* pausable: time spent on another tab does not count */
  function wait(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  function nextFrame() {
    return new Promise(function (r) { requestAnimationFrame(function () { r(); }); });
  }

  function reduced() {
    return global.matchMedia &&
           global.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------------------------------------------------------- starfield */
  function starfield(host, count) {
    if (!host) return;
    var frag = doc.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var s = doc.createElement('i');
      var size = Math.random() < 0.82 ? 1 + Math.random() : 2 + Math.random() * 1.4;
      /* keep them in the upper band — that is where the canopy is */
      s.style.left = (Math.random() * 100).toFixed(2) + '%';
      s.style.top = (Math.random() * 62).toFixed(2) + '%';
      s.style.width = size.toFixed(2) + 'px';
      s.style.height = size.toFixed(2) + 'px';
      s.style.setProperty('--dur', (2.6 + Math.random() * 5).toFixed(2) + 's');
      s.style.setProperty('--delay', (Math.random() * 6).toFixed(2) + 's');
      s.style.setProperty('--peak', (0.35 + Math.random() * 0.6).toFixed(2));
      frag.appendChild(s);
    }
    host.appendChild(frag);
  }

  /* ---------------------------------------------------------- drone fly-out
     Driven by the Web Animations API off a generated step list
     rather than a CSS @keyframes block.

     WHY: a CSS animation applies its timing function to EVERY pair
     of keyframes, not once across the whole run. The old five-stop
     @keyframes with cubic-bezier(.34,.06,.3,1) therefore eased in
     and out five separate times, braking at each stop — that is the
     stutter that read as the drone slowing down on its way out.

     Here the shape of the motion lives in the numbers and every
     step is `linear`, so screen velocity is continuous end to end.  */

  var STEPS = 48;
  var TRAVEL_VH = 47;        // how far up the canopy it climbs
  var DRIFT_VW = 3.2;        // and how far it leans toward the planet
  var END_SCALE = 0.06;

  function smoothstep(u) { return u * u * (3 - 2 * u); }

  /* Speed along the path: eases up out of the bay, then holds a
     steady cruise for the entire rest of the climb. Deliberately no
     ease-out — the drone must not appear to brake once it is far
     from the ship, which is exactly what the old curve did. The
     ramp is smoothstep, so it is flat-sloped where it meets the
     cruise and there is no kink. */
  function cruise(t) {
    return t < 0.16 ? 0.32 + 0.68 * smoothstep(t / 0.16) : 1;
  }

  /* Integrate cruise() into a cumulative distance table, normalised
     to 0..1. Position comes from this, so the drone can never stall
     or surge between steps. */
  function pathTable(steps) {
    var acc = [0], sum = 0, i;
    for (i = 1; i <= steps; i++) {
      sum += cruise((i - 0.5) / steps);   // midpoint sample
      acc.push(sum);
    }
    for (i = 0; i <= steps; i++) acc[i] /= sum;
    return acc;
  }

  /* Shrink with distance travelled, not with time — this is what
     sells "receding" while the screen speed stays even. */
  function depthScale(e) {
    return END_SCALE + (1 - END_SCALE) * Math.pow(1 - e, 1.35);
  }

  function droneOpacity(t) {
    if (t < 0.06) return t / 0.06;                       // clears the console
    if (t > 0.88) return Math.max(0, 1 - (t - 0.88) / 0.12);
    return 1;
  }

  function flyDrone(droneEl, trailEl) {
    if (!droneEl || !droneEl.animate) return Promise.resolve();

    var soft = reduced();
    var dur = soft ? 900 : 3400;
    var steps = soft ? 14 : STEPS;
    var path = pathTable(steps);
    var frames = [];
    var trail = [];
    var i, t, e;

    for (i = 0; i <= steps; i++) {
      t = i / steps;
      e = path[i];

      /* one slow sine of sway — smooth by construction, no kinks */
      var tilt = (Math.sin(t * Math.PI * 2.2) * 1.6).toFixed(3);

      frames.push({
        offset: t,
        opacity: droneOpacity(t),
        transform:
          'translate(calc(-50% + ' + (DRIFT_VW * e).toFixed(3) + 'vw),' +
          ' calc(-50% - ' + (TRAVEL_VH * e).toFixed(3) + 'vh))' +
          ' scale(' + depthScale(e).toFixed(4) + ')' +
          ' rotate(' + tilt + 'deg)',
        easing: 'linear'
      });

      /* exhaust puff: grows with the first third of the climb, then
         thins out and is gone well before the drone is */
      trail.push({
        offset: t,
        height: (15 * Math.min(1, e / 0.30)).toFixed(2) + '%',
        opacity: t < 0.10
          ? (t / 0.10) * 0.8
          : Math.max(0, 0.8 * (1 - (t - 0.10) / 0.38)),
        easing: 'linear'
      });
    }

    var opts = { duration: dur, easing: 'linear', fill: 'forwards' };
    var anim = droneEl.animate(frames, opts);
    if (trailEl && trailEl.animate) trailEl.animate(trail, opts);

    return Promise.race([
      anim.finished.catch(function () {}),
      wait(dur + 400)
    ]);
  }

  /* ---------------------------------------------------------- scanner sweep
     A hard red vertical line crossing the feed left → right,
     right → left, twice over. Resolves when the last leg lands. */
  function sweep(scannerEl, opts) {
    opts = opts || {};
    if (!scannerEl) return Promise.resolve();

    var bar = scannerEl.querySelector('.scanner__bar');
    var legs = opts.legs || 4;
    var legMs = reduced() ? 420 : (opts.legMs || 1150);

    scannerEl.classList.add('is-on');

    /* the HUD frame eats the outer ~3%, so the line turns around
       just inside it instead of vanishing under the bezel */
    var INSET = 0.032;

    function bounds() {
      var stage = scannerEl.parentElement || doc.body;
      var W = stage.getBoundingClientRect().width;
      var bw = bar.getBoundingClientRect().width;
      var lo = W * INSET;
      var hi = W * (1 - INSET) - bw;
      return [lo, Math.max(lo, hi)];
    }

    function leg(n) {
      if (n >= legs) return Promise.resolve();
      var b = bounds();
      var toRight = n % 2 === 0;
      var from = toRight ? b[0] : b[1];
      var to = toRight ? b[1] : b[0];

      return new Promise(function (resolve) {
        var anim = bar.animate(
          [
            { transform: 'translateX(' + from + 'px)' },
            { transform: 'translateX(' + to + 'px)' }
          ],
          {
            duration: legMs,
            easing: n === legs - 1 ? 'cubic-bezier(.4,0,.2,1)'
                                   : 'cubic-bezier(.45,.05,.55,.95)',
            fill: 'forwards'
          }
        );
        anim.onfinish = resolve;
        anim.oncancel = resolve;
        wait(legMs + 250).then(resolve);
      }).then(function () { return leg(n + 1); });
    }

    return leg(0).then(function () {
      return wait(180);
    }).then(function () {
      scannerEl.classList.remove('is-on');
      return wait(420);
    });
  }

  /* ---------------------------------------------------------- landing zones
     Shapes breach the surface one after another, each with its
     own splash. Resolves once the last one has settled.        */
  function surfaceZones(zoneEls, onEach, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(zoneEls || []);
    if (!list.length) return Promise.resolve();

    var gap = reduced() ? 120 : (opts.gap || 480);
    var settle = reduced() ? 300 : 1600;

    list.forEach(function (el, i) {
      wait(i * gap).then(function () {
        el.classList.add('is-up');
        if (onEach) onEach(el, i);
      });
    });

    return wait((list.length - 1) * gap + settle);
  }

  /* ---------------------------------------------------------- zones sink
     The mirror of surfaceZones: the shapes that do NOT match the
     spaceship slide back under the water, each with its own splash
     and rings, so the surface closes over them rather than the
     images simply blinking out.

     Ordered nearest-first (largest `--w`) so the sinking reads as a
     deliberate sweep instead of a random pop-pop.                */
  function sinkZones(zoneEls, onEach, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(zoneEls || []);
    if (!list.length) return Promise.resolve();

    var gap = reduced() ? 120 : (opts.gap || 560);
    var settle = reduced() ? 300 : 1450;

    list.forEach(function (el, i) {
      wait(i * gap).then(function () {
        el.classList.add('is-sunk');
        if (onEach) onEach(el, i);
      });
    });

    return wait((list.length - 1) * gap + settle);
  }

  /* ---------------------------------------------------------- the landing

     Where the ship ends up is arithmetic, not art direction. Both
     pieces of artwork are square canvases with a triangle inscribed,
     and the triangles were measured off the alpha channel:

       spaceship   base centre (49.84%, 69.8%) of its box
       pad         top-face base centre (49.5%, 70.0%) of its box
       widths      the pad's top face is 0.9688 x the ship's triangle

     padPlan() turns those four numbers plus two live rects into the
     transforms for every beat of a landing, so the craft sits on the
     painted surface at any --pu, any aspect ratio, any zoom.

     The critical one is `s`: the scale ALWAYS comes from the pad the
     ship actually matches (20 sq units), never from the pad it is
     being flown to. That is what makes the outcome honest — the
     craft is drawn at its true size, so it visibly overhangs a
     12-unit pad and visibly rattles about inside a 30-unit one
     instead of being told which face to pull.                     */

  var SHIP_BX = 0.4984, SHIP_BY = 0.698;   /* ship base centre, box units */
  var PAD_BX  = 0.495,  PAD_BY  = 0.700;   /* pad top-face base centre    */
  var SHIP_FIT = 0.9688;                   /* pad face / ship triangle    */

  function xf(dx, dy, s) {
    return 'translate(' + dx.toFixed(2) + 'px,' + dy.toFixed(2) + 'px)' +
           ' scale(' + s.toFixed(4) + ')';
  }

  /* offset* rather than getBoundingClientRect: these are the LAYOUT
     box and ignore the transforms we are in the middle of applying,
     so a plan built mid-flight is still built from the same origin
     as the one before it. */
  function originOf(el) {
    var x = 0, y = 0;
    /* walk up to the screen, which is the offsetParent both the ship
       and the pads ultimately hang from */
    while (el && !/\bscreen\b/.test(el.className || '')) {
      x += el.offsetLeft;
      y += el.offsetTop;
      el = el.offsetParent;
    }
    return { x: x, y: y };
  }

  function padPlan(ship, pad, refPad) {
    var sw = ship.offsetWidth;
    var pw = pad.offsetWidth;
    var ph = pad.offsetHeight;
    var s = SHIP_FIT * refPad.offsetWidth / sw;

    var so = originOf(ship);
    var po = originOf(pad);

    var dx = po.x + PAD_BX * pw - so.x - s * SHIP_BX * sw;
    var dy = po.y + PAD_BY * ph - so.y - s * SHIP_BY * sw;

    /* it goes over AWAY from the middle of the row, so a failed
       landing always drops into open water and never falls through
       one of the other pads */
    var dir = dx < 0 ? -1 : 1;

    var fx = dx + dir * sw * 0.46;
    var fy = dy + sw * 0.42;

    return {
      s: s, sw: sw, dx: dx, dy: dy, dir: dir,
      landed: xf(dx, dy, s),
      above:  xf(dx, dy - sw * 0.44, s),
      fell:   xf(fx, fy, s),
      gone:   xf(fx + dir * sw * 0.05, fy + sw * 0.30, s * 0.88),
      /* where the water gets hit: the craft's base centre at the
         bottom of the fall, in screen coordinates */
      impact: {
        x: so.x + fx + s * SHIP_BX * sw,
        y: so.y + fy + s * SHIP_BY * sw
      }
    };
  }

  function settle(anim, ms) {
    return Promise.race([
      anim.finished.catch(function () {}),
      wait(ms + 300)
    ]);
  }

  /* Read the angle the craft is actually sitting at. The tremble and
     the rock are CSS keyframes, so their end angle lives in the
     stylesheet; reading it back beats hard-coding a copy here that
     would silently drift the day someone retunes the wobble. */
  function angleOf(el) {
    var t = global.getComputedStyle(el).transform;
    if (!t || t === 'none') return 0;
    try {
      var m = new DOMMatrixReadOnly(t);
      return Math.atan2(m.b, m.a) * 180 / Math.PI;
    } catch (e) {
      return 0;
    }
  }

  /* Cross to above the pad, then come down onto it. Two legs in one
     animation so the traverse and the descent read as one approach
     rather than a move followed by a drop. */
  function shipDescend(ship, plan, ms) {
    if (!ship.animate) return Promise.resolve();
    ms = reduced() ? 620 : (ms || 2100);

    var anim = ship.animate([
      { offset: 0,    transform: 'none',      easing: 'cubic-bezier(.4,0,.5,.4)' },
      { offset: 0.54, transform: plan.above,  easing: 'cubic-bezier(.3,0,.2,1)' },
      { offset: 1,    transform: plan.landed }
    ], { duration: ms, fill: 'forwards' });

    return settle(anim, ms);
  }

  /* It loses the argument with gravity: the craft keeps turning from
     wherever the judder left it, while the whole ship slides off the
     edge and drops. Resolves at the moment of impact, handing back
     the point the water was hit so the splash can be parked there. */
  function shipTopple(ship, craft, plan, ms) {
    if (!ship.animate) return Promise.resolve(plan.impact);
    ms = reduced() ? 420 : (ms || 880);

    var from = angleOf(craft);

    craft.animate([
      { transform: 'rotate(' + from.toFixed(2) + 'deg)' },
      { transform: 'rotate(' + (from + plan.dir * 64).toFixed(2) + 'deg)' }
    ], { duration: ms, easing: 'cubic-bezier(.5,.02,.9,.6)', fill: 'forwards' });

    var anim = ship.animate([
      { transform: plan.landed, easing: 'cubic-bezier(.4,0,.86,.44)' },
      { transform: plan.fell }
    ], { duration: ms, fill: 'forwards' });

    return settle(anim, ms).then(function () { return plan.impact; });
  }

  /* Under it goes. */
  function shipSink(ship, plan, ms) {
    if (!ship.animate) return Promise.resolve();
    ms = reduced() ? 420 : (ms || 1000);

    var anim = ship.animate([
      { offset: 0,   transform: plan.fell, opacity: 1 },
      { offset: 0.4, opacity: 0.72 },
      { offset: 1,   transform: plan.gone, opacity: 0 }
    ], { duration: ms, easing: 'cubic-bezier(.35,.1,.7,.6)', fill: 'forwards' });

    return settle(anim, ms);
  }

  /* Back to the hover, ready for another go. Cancelling is enough:
     every beat above is a fill:forwards Web Animation, so with them
     gone the element falls back to its stylesheet position. */
  function shipReset(ship, craft) {
    [ship, craft].forEach(function (el) {
      if (el && el.getAnimations) {
        el.getAnimations().forEach(function (a) {
          /* leave the CSS idle bob alone — it is declared, not driven */
          if (a.animationName !== 'shipBob') a.cancel();
        });
      }
    });
  }

  /* ---------------------------------------------------------- screen swap */
  function swapScreens(from, to, veil, ms) {
    ms = ms || 1250;

    if (veil) veil.classList.add('is-on');

    return wait(ms * 0.42).then(function () {
      if (from) {
        from.classList.add('is-leaving');
        from.classList.remove('is-active');
      }
      if (to) to.classList.add('is-active');
      return wait(ms * 0.34);
    }).then(function () {
      if (veil) veil.classList.remove('is-on');
      return wait(ms * 0.5);
    }).then(function () {
      if (from) from.classList.remove('is-leaving');
    });
  }

  global.GeoMotion = {
    wait: wait,
    nextFrame: nextFrame,
    reduced: reduced,
    starfield: starfield,
    flyDrone: flyDrone,
    sweep: sweep,
    surfaceZones: surfaceZones,
    sinkZones: sinkZones,
    padPlan: padPlan,
    shipDescend: shipDescend,
    shipTopple: shipTopple,
    shipSink: shipSink,
    shipReset: shipReset,
    swapScreens: swapScreens
  };
})(window);
