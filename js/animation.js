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
     pieces of artwork are square canvases with a shape painted on
     them, and the shapes were measured off the alpha channel:

       Triangle.png            fills 40.857% of its canvas,
                               centre of area (49.86%, 63.32%)
       Triangle spaceship.png  hull fills 31.389% of its canvas,
                               centre of area (49.92%, 47.72%)

     The feed looks straight down, so there is no ground line for
     the craft to stand on: landing is one flat shape coming down
     onto another, and the anchor on both sides is the CENTRE OF
     AREA. Line those two points up and the craft is square on the
     island by construction, at any --pu, aspect ratio or zoom.

     SHIP_FIT is sqrt(40.857 / 31.389): the ratio of the two fills,
     square-rooted because it scales a length and the fills are
     areas. It is above 1 because the land fills more of its canvas
     than the hull fills its own, so the ship's BOX has to be the
     larger of the two for the two PAINTED shapes to match.

     The critical one is `s`: the scale ALWAYS comes from the island
     the ship actually matches (20 sq units), never from the one it
     is being flown to. That is what makes the outcome honest — the
     craft is drawn at its true size, so it visibly overhangs a
     12-unit island and visibly rattles about on a 30-unit one
     instead of being told which face to pull.

     One thing these numbers cannot fix: the two triangles are not
     the same SHAPE. The land is 97.45% of its box across by 83.73%
     down (ratio 1.164); the hull is 89.87% by 67.86% (ratio 1.324).
     Matched on area, the craft therefore comes out 5.2% wider and
     7.5% shorter than the island it fits. Closing that last gap is
     an artwork change — the hull wants to be ~12% taller for its
     base — not a change that belongs here, because every way of
     forcing it in code (a non-uniform squash, or scaling to the
     base instead of the area) makes the 12 and 30 verdicts lie. */

  /* Screen 3's own figures, and the default when no others are
     handed over. Screens 4-8 land a square, a rectangle, a
     parallelogram, a trapezium and a rhombus through this same
     arithmetic, so the four readings and the fill ratio arrive as a
     `geo` argument instead of being fixed here. Every one of them is
     measured off the artwork's alpha channel — see js/pages.js. */
  var TRI_GEO = {
    shipCX: 0.4992, shipCY: 0.4772,   /* hull centre of area, box units */
    padCX:  0.4986, padCY:  0.6332,   /* island centre of area          */
    fit:    1.1409                    /* sqrt(land fill / hull fill)    */
  };

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
    /* Walk up to the screen, which is the offsetParent both the ship
       and the pads ultimately hang from. classList, not className:
       on an SVG element className is an SVGAnimatedString rather
       than a string, and a regex over it would never match. */
    while (el && !(el.classList && el.classList.contains('screen'))) {
      x += el.offsetLeft;
      y += el.offsetTop;
      el = el.offsetParent;
    }
    return { x: x, y: y };
  }

  function padPlan(ship, pad, refPad, geo) {
    geo = geo || TRI_GEO;

    var sw = ship.offsetWidth;
    var pw = pad.offsetWidth;
    var ph = pad.offsetHeight;
    var s = geo.fit * refPad.offsetWidth / sw;

    var so = originOf(ship);
    var po = originOf(pad);

    var dx = po.x + geo.padCX * pw - so.x - s * geo.shipCX * sw;
    var dy = po.y + geo.padCY * ph - so.y - s * geo.shipCY * sw;

    /* Which way it goes when it loses its footing.

       `dir` is AWAY from the middle of the row, so a craft that
       slides off an island it was too big for always ends up in
       open water and never falls across one of the others.

       `into` is the opposite, and it is what a craft that goes over
       on an island far bigger than itself uses: there the land is
       what it lands on, so it has to fall towards the middle of the
       island rather than off the outer edge of the row. */
    var dir = dx < 0 ? -1 : 1;
    var into = -dir;

    /* Mostly down, only a little sideways: sliding off the near edge
       keeps the whole fall inside the frame, where going out to the
       side put the craft behind the painted bezel on the outer pads.
       The sideways component still tells you WHICH way it went. */
    var fx = dx + dir * sw * 0.26;
    var fy = dy + sw * 0.44;

    /* Where a wreck comes to rest. A short skid towards the middle
       of the island and a nudge down, so the craft ends up lying
       across the land it had too much of instead of pivoting on the
       spot — and, because it is `into`, well clear of the shoreline
       it would otherwise slide over. */
    var wx = dx + into * sw * 0.16;
    var wy = dy + sw * 0.05;

    return {
      s: s, sw: sw, dx: dx, dy: dy, dir: dir, into: into,
      landed:  xf(dx, dy, s),
      above:   xf(dx, dy - sw * 0.44, s),
      fell:    xf(fx, fy, s),
      gone:    xf(fx + dir * sw * 0.03, fy + sw * 0.26, s * 0.88),
      wrecked: xf(wx, wy, s),
      /* where the water gets hit: the craft's centre at the bottom
         of the fall, in screen coordinates */
      impact: {
        x: so.x + fx + s * geo.shipCX * sw,
        y: so.y + fy + s * geo.shipCY * sw
      },
      /* where the LAND gets hit: the nose end of the wreck, which is
         half a hull out from its centre along the way it went over */
      hit: {
        x: so.x + wx + s * geo.shipCX * sw + into * s * sw * 0.3,
        y: so.y + wy + s * geo.shipCY * sw
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

  /* It goes over ON THE LAND. The 30-unit island is half as big
     again as the craft, so there is nothing for it to slide off:
     it overbalances, swings past the point of no return and slams
     down across the rock, where it stays.

     Two curves on purpose. The craft's own rotation runs long and
     overshoots — 112 degrees, then back to 96 — so it lands hard,
     bounces once off the ground and settles; the ship's translate
     runs SHORT, front-loaded, so the skid is all over by the time
     the hull comes down. Resolves at the moment of impact with the
     point the ground was hit, so the dust can be parked there. */
  function shipCrash(ship, craft, plan, ms) {
    if (!ship.animate) return Promise.resolve(plan.hit);
    ms = reduced() ? 440 : (ms || 820);

    var from = angleOf(craft);
    var over = from + plan.into * 112;
    var rest = from + plan.into * 96;

    craft.animate([
      { offset: 0,    transform: 'rotate(' + from.toFixed(2) + 'deg)',
        easing: 'cubic-bezier(.55,.02,.9,.5)' },
      { offset: 0.66, transform: 'rotate(' + over.toFixed(2) + 'deg)',
        easing: 'cubic-bezier(.3,0,.2,1)' },
      { offset: 1,    transform: 'rotate(' + rest.toFixed(2) + 'deg)' }
    ], { duration: ms, fill: 'forwards' });

    var anim = ship.animate([
      { offset: 0,    transform: plan.landed, easing: 'cubic-bezier(.2,.6,.3,1)' },
      { offset: 0.62, transform: plan.wrecked },
      { offset: 1,    transform: plan.wrecked }
    ], { duration: ms, fill: 'forwards' });

    return settle(anim, ms).then(function () { return plan.hit; });
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

  /* ---------------------------------------------------------- confetti

     Built here rather than parked in the markup: the count follows
     the width of the frame, every piece gets its own fall time,
     sway and spin so the shower never reads as a repeating loop,
     and the whole burst can be torn down in one call when the
     screen is reset mid-celebration.

     The fall itself is a CSS keyframe driven by custom properties
     (same idiom as the starfield) — a hundred-odd pieces on the
     compositor, no per-frame JS. */

  var TINTS = ['#4fd8ff', '#3ff5c0', '#ffbe3d', '#eafaff', '#8fb4ff', '#ff8fa3'];

  function confettiClear(host) {
    if (host) host.textContent = '';
  }

  function confetti(host, opts) {
    opts = opts || {};
    if (!host) return Promise.resolve();

    confettiClear(host);

    /* a shower of paper is the one flourish here that is pure
       flourish, so it is the one that goes away entirely */
    if (reduced()) return Promise.resolve();

    /* one piece per ~13px of frame width: a phone is not buried and
       a wide desktop does not look under-dressed */
    var count = opts.count ||
      Math.max(54, Math.min(150, Math.round((host.offsetWidth || 900) / 13)));
    var spread = opts.spread == null ? 1500 : opts.spread;  // launch window
    var fall   = opts.fall   == null ? 2900 : opts.fall;    // slowest fall
    var last   = 0;

    var frag = doc.createDocumentFragment();

    for (var i = 0; i < count; i++) {
      var p = doc.createElement('i');

      /* ribbons tumble, discs flutter — a mix of the two is what
         stops the shower looking like falling pixels */
      var ribbon = Math.random() < 0.62;
      var w = ribbon ? 4 + Math.random() * 3.4 : 5 + Math.random() * 4.5;
      var h = ribbon ? w * (1.9 + Math.random() * 1.5) : w;

      var dur = fall * (0.6 + Math.random() * 0.4);
      var delay = Math.random() * spread;
      if (dur + delay > last) last = dur + delay;

      p.style.left = (Math.random() * 100).toFixed(2) + '%';
      p.style.width = w.toFixed(2) + 'px';
      p.style.height = h.toFixed(2) + 'px';
      p.style.background = TINTS[(Math.random() * TINTS.length) | 0];
      p.style.borderRadius = ribbon ? '1px' : '50%';
      p.style.setProperty('--dur', dur.toFixed(0) + 'ms');
      p.style.setProperty('--delay', delay.toFixed(0) + 'ms');
      p.style.setProperty('--sway', (1.1 + Math.random() * 3.4).toFixed(2) + 'vw');
      /* signed, so half the shower turns the other way */
      p.style.setProperty('--spin',
        ((Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 900)).toFixed(0) + 'deg');

      frag.appendChild(p);
    }

    host.appendChild(frag);

    /* self-clearing: the pieces are gone from the DOM once the last
       one is off the bottom of the frame, so nothing is left
       animating behind a screen the player has moved on from */
    return wait(last + 260).then(function () { confettiClear(host); });
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
    shipCrash: shipCrash,
    shipSink: shipSink,
    shipReset: shipReset,
    confetti: confetti,
    confettiClear: confettiClear,
    swapScreens: swapScreens
  };
})(window);
