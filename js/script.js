/* ============================================================
   Geo Drone — mission flow

   Screen 1 · cockpit
     briefing (3 lines, readout waveform live)
     → LAUNCH button rises out of the console
     → prompt to press it
     → press: launch SFX, drone climbs out through the canopy
     → cross-fade to the drone feed

   Screen 2 · drone feed
     black (ocean hidden) + "it is too dark"
     → "start the scanner"
     → red line sweeps left/right/left/right
     → ocean fades up 0 → 1
     → five landing zones breach the surface with splashes
     → "the scanner found several landing zones"

   Screen 2 · shape hunt (continues on the same feed)
     narration bar drops in, typed in step with the voice
     → "look at the shapes of the landing zones"
     → the spaceship chip parks in the corner
     → "the spaceship is a triangle — select all the triangular
        landing zones"
     → the five zones become selectable; three triangles to find
       · right shape → tick stamped on, zone locks in
       · wrong shape → shake, buzzer, "try again"
     → all three found: the square and the trapezium sink back
       under the water, one after the other, each with a splash
     → "correct! these landing zones have the same shape as the
        spaceship"

   Screen 3 · the landing
     the craft rises with its base and height called out
     → "next, we need to find how much space the spaceship needs"
     → three pads surface, each with its area printed on it
     → "calculate the area of spaceship, and select the land with
        required area"
     → the player picks; the craft flies down and the geometry
       decides what happens (see SCREEN 3 below)

   The "<" / ">" nav can cut in at any point, so each screen is
   described as a list of steps run under a generation id. Jumping
   bumps that id, which makes the abandoned chain unwind at its next
   step instead of firing captions and voice lines over the screen
   the player just moved to.
   ============================================================ */

(function (global) {
  'use strict';

  var A = global.GeoAudio;
  var M = global.GeoMotion;
  var W = global.GeoWave;
  var T = global.GeoType;

  var el = {};
  var launched = false;

  /* shape hunt */
  var TARGET_SHAPE = 'triangle';
  var picked = 0;                 // triangles found so far
  var needed = 0;                 // how many there are to find
  var picking = false;            // clicks are being accepted
  var releasePick = null;         // resolves the "wait for all of them" step
  var scolding = false;           // a "try again" is already playing

  var runId = 0;            // bumped on every jump
  var current = 0;          // index into SCREENS
  var busy = false;         // a swap is in flight
  var ABORT = { abort: true };

  /* ---------------------------------------------------------- captions
     Short on-screen echoes of the narration. */
  var LINE = {
    welcome:    'Welcome, Space Commander! We have a new landing mission.',
    safePlace:  'We need to find a safe place for it to land.',
    sendDrone:  'Let’s send the survey drone to check the area.',
    clickLaunch:'Click the LAUNCH button to launch the drone.',
    tooDark:    'It is too dark to see the landing zones.',
    startScan:  'Start the scanner to search the area.',
    foundZones: 'Great! The scanner found several landing zones.',
    lookShapes: 'Look at the shapes of the landing zones.',
    pickTriangles: 'The spaceship is a triangle. Select all the triangular landing zones.',
    shapeMatch: 'Correct! These landing zones have the same shape as the spaceship.',
    tryAgain: 'Try again.',
    spaceNeeded: 'Next, we need to find how much space the spaceship needs.',
    calcArea: 'Calculate the area of spaceship, and select the land with required area.'
  };

  function grab() {
    [
      'stage', 'screenCockpit', 'screenDrone', 'starfield',
      'flyDrone', 'flyTrail', 'dash', 'waveCanvas', 'cockpitCaption',
      'launchSlot', 'launchBtn', 'oceanBg', 'blackout', 'scanner',
      'zones',
      'topbar', 'topbarText', 'target',
      'screenLanding', 'ship', 'shipCraft', 'shipDims', 'pads', 'splash',
      'landHud', 'landCaption', 'landTally', 'landTopbar', 'landTopbarText',
      'veil', 'gate', 'gateBtn', 'gateHint', 'gateLoad', 'gateFill',
      'gateStatus', 'gatePct', 'nav', 'navPrev', 'navNext'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  /* ---------------------------------------------------------- sequencing
     Runs `steps` in order, dropping out the moment the generation it
     started under is no longer the live one. */
  function sequence(steps) {
    var id = ++runId;
    var chain = Promise.resolve();

    steps.forEach(function (step) {
      chain = chain.then(function () {
        if (id !== runId) throw ABORT;
        return step(id);
      });
    });

    return chain.catch(function (e) {
      if (e !== ABORT) throw e;
    });
  }

  function live(id) { return id === runId; }

  /* ---------------------------------------------------------- caption + voice */
  function speak(target, key, keep) {
    if (target) {
      target.textContent = LINE[key] || '';
      target.classList.add('is-shown');
    }
    return A.say(key).then(function () {
      return M.wait(240);
    }).then(function () {
      /* `keep` lets a step that has already moved on (the player
         pressed LAUNCH mid-prompt) hold on to its own caption */
      if (target && (!keep || keep())) target.classList.remove('is-shown');
      return M.wait(180);
    });
  }

  function notLaunched() { return !launched; }

  /* ---------------------------------------------------------- narration bar
     Same contract as speak(), but the line is TYPED into the header
     bar instead of cross-fading in, and the typing is clocked off
     the voice clip itself rather than off a chars/second guess —
     GeoAudio hands the <audio> element over through `onPlay`, and
     GeoType reads currentTime off it. See js/typewriter.js. */
  function narrate(bar, key) {
    var text = LINE[key] || '';

    if (M.reduced()) {
      T.set(bar, text);
      return A.say(key).then(function () { return M.wait(260); });
    }

    return A.say(key, {
      onPlay: function (audio) {
        T.type(bar, text, { audio: audio, hold: 260 });
      }
    }).then(function () {
      return M.wait(300);
    });
  }

  /* ============================================================
     SCREEN 1 — COCKPIT
     ============================================================ */
  function resetCockpit() {
    launched = false;

    el.cockpitCaption.classList.remove('is-shown');
    el.cockpitCaption.textContent = '';

    el.launchSlot.classList.remove('is-armed', 'is-spent');
    el.launchBtn.classList.remove('is-shown', 'is-pressed');

    /* the climb is a Web Animation with fill:forwards — cancel it or
       the drone stays parked wherever it was left */
    [el.flyDrone, el.flyTrail].forEach(function (node) {
      if (node && node.getAnimations) {
        node.getAnimations().forEach(function (a) { a.cancel(); });
      }
    });

    el.dash.classList.add('is-live');
  }

  function runCockpit() {
    W.start();

    return sequence([
      function () { return M.wait(700); },
      function () { return speak(el.cockpitCaption, 'welcome'); },
      function () { return speak(el.cockpitCaption, 'safePlace'); },
      function () { return speak(el.cockpitCaption, 'sendDrone'); },
      function () { return M.wait(280); },
      function () {
        el.launchBtn.classList.add('is-shown');
        el.launchSlot.classList.add('is-armed');
        return M.wait(420);
      },
      /* the prompt plays over the button appearing — the player can
         press as soon as it is there, they do not have to wait */
      function () { return speak(el.cockpitCaption, 'clickLaunch', notLaunched); },
      function () {
        if (launched) return;
        el.cockpitCaption.textContent = 'Press LAUNCH when you are ready, Commander.';
        el.cockpitCaption.classList.add('is-shown');
      }
    ]);
  }

  /* ---------------------------------------------------------- launch */
  function onLaunch() {
    if (launched) return;
    launched = true;

    var id = runId;                       // the briefing's generation

    el.launchSlot.classList.remove('is-armed');
    el.launchBtn.classList.add('is-pressed');
    A.stopVoice();
    el.cockpitCaption.textContent = 'Launching survey drone…';
    el.cockpitCaption.classList.add('is-shown');

    A.duckAmbience(0.11, 700);
    A.sfx('launch', { volume: 0.9 });

    /* hold the plate down for a beat, then let it fade — it has done
       its job and should not sit there competing for attention */
    M.wait(420).then(function () {
      if (live(id)) el.launchSlot.classList.add('is-spent');
    });

    /* drone climbs out; the swap starts while it is still shrinking,
       so the two motions read as one continuous shot */
    M.flyDrone(el.flyDrone, el.flyTrail);

    M.wait(M.reduced() ? 500 : 2350).then(function () {
      if (!live(id)) return;              // player navigated away mid-flight
      el.cockpitCaption.classList.remove('is-shown');
      A.sfx('glitch', { volume: 0.34 });
      return goTo(1, { silent: true });
    });
  }

  /* ============================================================
     SCREEN 2 — DRONE FEED
     ============================================================ */
  function resetDroneFeed() {
    el.oceanBg.classList.remove('is-lit');
    el.blackout.classList.remove('is-clear');
    el.scanner.classList.remove('is-on');

    var bar = el.scanner.querySelector('.scanner__bar');
    if (bar && bar.getAnimations) {
      bar.getAnimations().forEach(function (a) { a.cancel(); });
    }

    Array.prototype.forEach.call(
      el.zones.querySelectorAll('.zone'),
      function (z) { z.classList.remove('is-up', 'is-picked', 'is-wrong', 'is-sunk'); }
    );

    endPicking();
    picked = 0;

    el.topbar.classList.remove('is-on');
    T.clear(el.topbarText);
    el.target.classList.remove('is-on');
  }

  function runDroneFeed() {
    W.stop();

    return sequence([
      /* the bar drops in empty and then carries every line on this
         screen — there is no caption over the water any more, so it
         has to be up before the first voice clip, not partway in */
      function () {
        el.topbar.classList.add('is-on');
        A.duckAmbience(0.18, 900);
        return M.wait(720);
      },

      /* --- the dark --- */
      function () { return narrate(el.topbarText, 'tooDark'); },
      function () { return M.wait(220); },

      /* --- call for the scanner --- */
      function () { return narrate(el.topbarText, 'startScan'); },

      /* --- red line sweeps the feed --- */
      function () {
        return M.sweep(el.scanner, { legs: 4, legMs: 1150 });
      },

      /* --- lights up: ocean 0 → 1 --- */
      function () {
        el.oceanBg.classList.add('is-lit');
        el.blackout.classList.add('is-clear');
        return M.wait(1700);
      },

      /* --- shapes breach the water --- */
      function () { return surface(); },
      function () { return M.wait(420); },

      /* --- payoff line --- */
      function () { return narrate(el.topbarText, 'foundZones'); },
      function () { return M.wait(420); },

      /* ═══════════════ shape hunt ═══════════════ */

      function () { return narrate(el.topbarText, 'lookShapes'); },

      /* the ship goes up BEFORE it is mentioned, so it is already
         there to be looked at when the line names it */
      function () {
        el.target.classList.add('is-on');
        return M.wait(560);
      },

      function () { return narrate(el.topbarText, 'pickTriangles'); },

      /* --- over to the player --- */
      function (id) { return startPicking(id); },

      /* --- the odd shapes go back under --- */
      function () { return M.wait(420); },
      function () { return sinkOthers(); },
      function () { return M.wait(360); },

      /* --- payoff --- */
      function () { return narrate(el.topbarText, 'shapeMatch'); }
    ]);
  }

  function surface() {
    var list = el.zones.querySelectorAll('.zone');

    return M.surfaceZones(list, function (zone, i) {
      /* a little pitch variation so five splashes do not sound
         like the same sample five times */
      A.sfx('rock', {
        volume: 0.55,
        rate: [1, 0.92, 1.08, 0.96, 1.12][i % 5]
      });
    }, { gap: 620 });
  }

  /* ============================================================
     SHAPE HUNT
     ============================================================ */

  function zoneList() {
    return Array.prototype.slice.call(el.zones.querySelectorAll('.zone'));
  }

  /* Hands the feed over to the player and resolves once every
     triangle has been found.

     The abort story: this step parks a promise that only the
     player can settle, so `sequence` cannot check the generation
     id while it is waiting. endPicking() is therefore called from
     resetDroneFeed() — which every jump runs — and it settles the
     promise by hand. The step after this one then sees a stale id
     and unwinds, exactly like every other step. */
  function startPicking(id) {
    var zones = zoneList();

    needed = zones.filter(function (z) {
      return z.dataset.shape === TARGET_SHAPE;
    }).length;
    picked = 0;

    picking = true;
    el.zones.classList.add('is-picking');
    zones.forEach(function (z) {
      var hit = z.querySelector('.zone__hit');
      if (hit) hit.tabIndex = 0;
    });

    return new Promise(function (resolve) {
      releasePick = resolve;
      if (!live(id)) endPicking();      // jumped while we were arming
    });
  }

  function endPicking() {
    picking = false;
    scolding = false;

    if (el.zones) {
      el.zones.classList.remove('is-picking');
      zoneList().forEach(function (z) {
        var hit = z.querySelector('.zone__hit');
        if (hit) hit.tabIndex = -1;
      });
    }

    var done = releasePick;
    releasePick = null;
    if (done) done();
  }

  function onZonePick(zone) {
    if (!picking || zone.classList.contains('is-picked')) return;

    /* --- the wrong shape --- */
    if (zone.dataset.shape !== TARGET_SHAPE) {
      A.sfx('wrong', { volume: 0.5 });

      zone.classList.remove('is-wrong');
      /* force a reflow so a second wrong tap on the same shape
         replays the shake instead of doing nothing */
      void zone.offsetWidth;
      zone.classList.add('is-wrong');
      M.wait(620).then(function () { zone.classList.remove('is-wrong'); });

      /* one nudge at a time — tapping four wrong shapes in a row
         must not stack four voice lines on top of each other */
      if (!scolding) {
        scolding = true;
        A.say('tryAgain').then(function () { scolding = false; });
      }
      return;
    }

    /* --- a match --- */
    zone.classList.add('is-picked');
    picked++;
    A.sfx('correct', { volume: 0.55 });

    if (picked >= needed) {
      /* let the last tick land before the flow moves on */
      M.wait(760).then(endPicking);
    }
  }

  /* The square and the trapezium go back where they came from. */
  function sinkOthers() {
    var others = zoneList().filter(function (z) {
      return z.dataset.shape !== TARGET_SHAPE;
    });

    /* nearest (largest) first, so the surface closes front to back */
    others.sort(function (a, b) {
      return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
    });

    return M.sinkZones(others, function (zone, i) {
      /* pitched down a little from the surfacing splashes — the
         same sample, but going the other way */
      A.sfx('rock', {
        volume: 0.6,
        rate: [0.88, 0.95][i % 2]
      });
    }, { gap: 620 });
  }


  /* ============================================================
     SCREEN 3 — THE LANDING

     The ship is a triangle with a base of 8 units and a height of
     5 units, so it needs 1/2 x 8 x 5 = 20 square units of land.
     Three pads are offered: 30, 12 and 20.

     The answer is never checked with a message. It is checked by
     flying the craft down and letting the geometry speak:

       12  the craft is wider than the land, hangs over both edges,
           judders, loses its footing and goes into the water
       30  the craft is standing on far more land than it needs with
           nothing holding it, rocks heel to heel and topples off
       20  it comes down, squares up and plants itself

     The craft is drawn at its TRUE size on every attempt (see
     padPlan in js/animation.js), so all three outcomes are the
     honest consequence of the numbers, not three canned cutscenes.
     ============================================================ */

  var SHIP_AREA = 20;            /* 1/2 x 8 x 5 */
  var choosing = false;
  var landing = false;           /* an attempt is playing out */
  var releaseLand = null;        /* resolves the "wait for the fit" step */
  var solved = false;

  function padList() {
    return Array.prototype.slice.call(el.pads.querySelectorAll('.pad'));
  }

  function correctPad() {
    return el.pads.querySelector('.pad[data-area="' + SHIP_AREA + '"]');
  }

  function resetLanding() {
    choosing = false;
    landing = false;
    solved = false;

    M.shipReset(el.ship, el.shipCraft);
    el.ship.classList.remove('is-in', 'is-committed', 'is-planted');
    el.ship.classList.remove('is-teeter', 'is-rock');
    el.shipDims.classList.remove('is-drawn');

    el.pads.classList.remove('is-choosing');
    padList().forEach(function (pad) {
      pad.classList.remove('is-up', 'is-fit', 'is-loose', 'is-tight');
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });

    el.splash.classList.remove('is-on');

    el.landHud.classList.remove('is-on');
    el.landCaption.classList.remove('is-shown');
    el.landCaption.textContent = '';
    el.landTally.classList.remove('is-shown');
    el.landTally.textContent = '';

    el.landTopbar.classList.remove('is-on');
    T.clear(el.landTopbarText);

    var done = releaseLand;
    releaseLand = null;
    if (done) done();
  }

  function runLanding() {
    W.stop();

    return sequence([
      function () {
        el.landHud.classList.add('is-on');
        A.duckAmbience(0.16, 900);
        return M.wait(520);
      },

      function () {
        el.landTopbar.classList.add('is-on');
        return M.wait(680);
      },

      /* the craft comes up while the line plays, and its
         measurements are drawn on as the line lands — the callouts
         ARE "how much space it needs" */
      function () {
        el.ship.classList.add('is-in');
        M.wait(900).then(function () { el.shipDims.classList.add('is-drawn'); });
        return narrate(el.landTopbarText, 'spaceNeeded');
      },

      /* the three candidates surface with their areas printed on */
      function () { return offerPads(); },

      function () { return narrate(el.landTopbarText, 'calcArea'); },

      /* --- over to the player, for as many attempts as it takes --- */
      function (id) { return startChoosing(id); },

      /* --- planted --- */
      function () {
        el.landCaption.textContent = 'PERFECT FIT — 20 SQ UNITS';
        el.landCaption.classList.add('is-shown');
        el.landTally.textContent = 'AREA = ½ × 8 × 5 = 20';
        el.landTally.classList.add('is-shown');
      }
    ]);
  }

  function offerPads() {
    var pads = padList();
    pads.forEach(function (pad, i) {
      M.wait(i * 320).then(function () {
        pad.classList.add('is-up');
        A.sfx('rock', { volume: 0.42, rate: [1.04, 0.96, 1.1][i % 3] });
      });
    });
    return M.wait((pads.length - 1) * 320 + 1250);
  }

  /* Same abort contract as the shape hunt: the step parks a promise
     only the player can settle, and resetLanding() — which every
     jump runs — settles it by hand so the next step unwinds on a
     stale generation id. */
  function startChoosing(id) {
    armChoice();

    el.landCaption.textContent = 'CHOOSE THE LANDING ZONE';
    el.landCaption.classList.add('is-shown');
    el.landTally.textContent = 'BASE 8 · HEIGHT 5';
    el.landTally.classList.add('is-shown');

    return new Promise(function (resolve) {
      releaseLand = resolve;
      if (!live(id)) resetLanding();
    });
  }

  function armChoice() {
    choosing = true;
    el.pads.classList.add('is-choosing');
    padList().forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = 0;
    });
  }

  function disarmChoice() {
    choosing = false;
    el.pads.classList.remove('is-choosing');
    padList().forEach(function (pad) {
      var hit = pad.querySelector('.pad__hit');
      if (hit) hit.tabIndex = -1;
    });
  }

  function onPadPick(pad) {
    if (!choosing || landing) return;

    var area = +pad.dataset.area;
    var ref = correctPad();
    if (!ref) return;

    landing = true;
    disarmChoice();
    A.sfx('click', { volume: 0.4 });

    /* the callouts and the idle bob come off: the craft is flying
       now, and a measurement drawing riding along with it through a
       crash would read as part of the wreck */
    el.ship.classList.add('is-committed');

    var plan = M.padPlan(el.ship, pad, ref);

    M.shipDescend(el.ship, plan).then(function () {
      if (area === SHIP_AREA) return plant(pad, plan);
      return fail(pad, plan, area < SHIP_AREA);
    });
  }

  /* ---------------------------------------------------------- it fits */
  function plant(pad, plan) {
    solved = true;
    el.ship.classList.add('is-planted');
    pad.classList.add('is-fit');

    el.landCaption.textContent = 'TOUCHDOWN';
    el.landCaption.classList.add('is-shown');

    A.sfx('correct', { volume: 0.6 });
    M.wait(260).then(function () { A.sfx('cheer', { volume: 0.5 }); });

    return M.wait(1500).then(function () {
      landing = false;
      var done = releaseLand;
      releaseLand = null;
      if (done) done();
    });
  }

  /* ---------------------------------------------------------- it does not
     `tight` true  → the pad was too small, the craft overhangs it
     `tight` false → the pad was too big, nothing holds the craft */
  function fail(pad, plan, tight) {
    pad.classList.add(tight ? 'is-tight' : 'is-loose');

    el.landCaption.textContent = tight
      ? 'TOO SMALL — THE CRAFT OVERHANGS'
      : 'TOO MUCH ROOM — THE CRAFT CANNOT SETTLE';
    el.landCaption.classList.add('is-shown');
    el.landTally.textContent = pad.dataset.area + ' SQ UNITS · NEEDED 20';

    A.sfx('wrong', { volume: 0.45 });
    el.ship.classList.add(tight ? 'is-teeter' : 'is-rock');

    return M.wait(tight ? 1150 : 1600)
      .then(function () {
        return M.shipTopple(el.ship, el.shipCraft, plan);
      })
      .then(function (impact) {
        /* the water is hit wherever it went over, not at a fixed
           spot, so the splash is parked on the returned point */
        el.splash.style.transform =
          'translate(' + impact.x.toFixed(1) + 'px,' + impact.y.toFixed(1) + 'px)';
        el.splash.classList.remove('is-on');
        void el.splash.offsetWidth;          /* replay it on a retry */
        el.splash.classList.add('is-on');
        A.sfx('rock', { volume: 0.72, rate: 0.9 });
        return M.shipSink(el.ship, plan);
      })
      .then(function () {
        el.landCaption.classList.remove('is-shown');
        return A.say('tryAgain');
      })
      .then(function () {
        return M.wait(320);
      })
      .then(function () {
        /* put it back on the pad rail and hand control over again */
        pad.classList.remove('is-tight', 'is-loose');
        el.ship.classList.remove('is-committed', 'is-teeter', 'is-rock');
        M.shipReset(el.ship, el.shipCraft);
        el.splash.classList.remove('is-on');
        el.shipDims.classList.add('is-drawn');
        return M.wait(700);
      })
      .then(function () {
        landing = false;
        if (!solved) armChoice();
        el.landCaption.textContent = 'CHOOSE THE LANDING ZONE';
        el.landCaption.classList.add('is-shown');
        el.landTally.textContent = 'BASE 8 · HEIGHT 5';
      });
  }

  /* ============================================================
     SCREENS + NAV
     ============================================================ */
  var SCREENS = [
    { node: function () { return el.screenCockpit; }, reset: resetCockpit,   run: runCockpit },
    { node: function () { return el.screenDrone; },   reset: resetDroneFeed, run: runDroneFeed },
    { node: function () { return el.screenLanding; }, reset: resetLanding,   run: runLanding }
  ];

  function syncNav() {
    el.navPrev.disabled = busy || current === 0;
    el.navNext.disabled = busy || current === SCREENS.length - 1;
  }

  /* Jump to a screen: abandon whatever was running, put the target
     back to its opening state, swap, then play its sequence.
     `silent` skips the audio cut, for the scripted launch hand-off
     that is already mid-cue and should not be clipped. */
  function goTo(index, opts) {
    opts = opts || {};
    if (busy || index === current || index < 0 || index >= SCREENS.length) {
      return Promise.resolve();
    }

    var from = SCREENS[current];
    var to = SCREENS[index];

    busy = true;
    syncNav();

    runId++;                               // strand the running sequence
    if (!opts.silent) A.stopAll();

    to.reset();

    return M.swapScreens(from.node(), to.node(), el.veil, 1300).then(function () {
      current = index;
      busy = false;
      syncNav();

      /* the screen left behind goes back to its opening state too, so
         stepping back into it starts from the top rather than from
         wherever it was abandoned */
      from.reset();

      return to.run();
    });
  }

  /* ============================================================
     START GATE

     The mission opens on a black cockpit and a voice line, so it
     cannot start until the artwork and the narration are actually
     in the browser — a half-loaded start means the commander talks
     over an empty screen. The gate therefore holds the mission
     until every asset has settled, and shows how far along it is
     rather than a spinner that says nothing.
     ============================================================ */

  /* Read off the document rather than kept in a second list here:
     the <link rel=preload> tags already name the backgrounds and
     the zone/ship artwork is in the markup as <img>, so this cannot
     drift out of step with the page. */
  function imageUrls() {
    var seen = {};
    var out = [];

    function add(u) {
      if (!u || seen[u]) return;
      seen[u] = true;
      out.push(u);
    }

    Array.prototype.forEach.call(
      document.querySelectorAll('link[rel="preload"][as="image"]'),
      function (l) { add(l.href); }
    );
    Array.prototype.forEach.call(
      document.images,
      function (i) { add(i.currentSrc || i.src); }
    );

    return out;
  }

  /* A texture that 404s still counts: the bar must reach the end
     even on a broken deploy, and a missing rock is survivable. */
  function loadImages(list, onEach) {
    return Promise.all(list.map(function (src) {
      return new Promise(function (resolve) {
        var img = new Image();
        var fired = false;

        function fire() {
          if (fired) return;
          fired = true;
          onEach();
          resolve();
        }

        img.onload = fire;
        img.onerror = fire;
        img.src = src;
        if (img.complete) fire();
      });
    }));
  }

  /* what the readout says, by how far along the load is */
  var STATUS = [
    [0.00, 'Booting mission systems'],
    [0.20, 'Charting the survey area'],
    [0.48, 'Loading terrain scans'],
    [0.76, 'Syncing commander briefing'],
    [1.00, 'All systems ready']
  ];

  function statusFor(p) {
    var label = STATUS[0][1];
    for (var i = 0; i < STATUS.length; i++) {
      if (p >= STATUS[i][0]) label = STATUS[i][1];
    }
    return label;
  }

  /* Two things are being waited on and they are not the same size,
     so progress is counted in assets rather than in halves. */
  var GATE_MIN_MS = 1150;       // a warm cache must still read as a load

  function runGate() {
    var imgs  = imageUrls();
    var total = imgs.length + A.assetCount();
    var done  = 0;
    var shown = 0;              // where the bar actually is
    var raf   = 0;
    var t0    = performance.now();
    var slow  = !M.reduced();

    function draw(p) {
      var pct = Math.round(p * 100);
      el.gateFill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
      el.gatePct.textContent = pct + '%';

      var label = statusFor(p);
      if (el.gateStatus.textContent !== label) el.gateStatus.textContent = label;
    }

    /* Eased rather than stepped: on a warm cache thirty files settle
       in the same frame, and a bar that teleports to 100% reads as a
       glitch. The easing also keeps the readout moving while a slow
       file is still in flight. */
    function tick() {
      var target = done / total;
      shown += (target - shown) * 0.10;
      if (target - shown < 0.0015) shown = target;
      draw(shown);
      raf = requestAnimationFrame(tick);
    }

    function count() { done++; if (!slow) draw(done / total); }

    if (slow) raf = requestAnimationFrame(tick);
    draw(0);

    return Promise.all([
      loadImages(imgs, count),
      A.preload(count)
    ]).then(function () {
      /* let the easing run the last stretch out before handing over */
      var rest = slow ? Math.max(0, GATE_MIN_MS - (performance.now() - t0)) + 520
                      : Math.max(0, 300 - (performance.now() - t0));
      return M.wait(rest);
    }).then(function () {
      if (raf) cancelAnimationFrame(raf);
      draw(1);
      return M.wait(slow ? 260 : 0);
    }).then(revealStart);
  }

  function revealStart() {
    el.gateLoad.classList.add('is-done');

    return M.wait(M.reduced() ? 0 : 360).then(function () {
      el.gateLoad.hidden = true;

      el.gateBtn.hidden = false;
      /* reflow, so the browser has an un-hidden starting frame to
         transition away from instead of snapping straight to the end */
      void el.gateBtn.offsetWidth;

      el.gateBtn.classList.add('is-in');
      el.gateHint.classList.add('is-in');

      try { el.gateBtn.focus({ preventScroll: true }); } catch (e) { /* older browsers */ }
    });
  }


  /* ============================================================
     BOOT
     ============================================================ */
  function begin() {
    el.gate.classList.add('is-gone');
    el.nav.classList.add('is-on');

    A.unlock();
    A.startAmbience(0.24);

    resetCockpit();
    syncNav();
    runCockpit();
  }

  function boot() {
    grab();

    /* first, so every timer armed below is already pausable */
    if (global.GeoLife) global.GeoLife.init();

    if (M.reduced()) document.body.classList.add('is-reduced');

    M.starfield(el.starfield, 150);
    W.init(el.waveCanvas);

    runGate();

    el.gateBtn.addEventListener('click', begin, { once: true });
    el.launchBtn.addEventListener('click', onLaunch);

    /* one listener on the container rather than five on the shapes,
       so the zones stay plain markup */
    el.zones.addEventListener('click', function (e) {
      var hit = e.target.closest('.zone__hit');
      if (!hit) return;
      var zone = hit.closest('.zone');
      if (zone) onZonePick(zone);
    });

    el.pads.addEventListener('click', function (e) {
      var hit = e.target.closest('.pad__hit');
      if (!hit) return;
      var pad = hit.closest('.pad');
      if (pad) onPadPick(pad);
    });

    el.navPrev.addEventListener('click', function () { goTo(current - 1); });
    el.navNext.addEventListener('click', function () { goTo(current + 1); });
    syncNav();

    document.body.classList.add('is-ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
