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
    tryAgain: 'Try again.'
  };

  function grab() {
    [
      'stage', 'screenCockpit', 'screenDrone', 'starfield',
      'flyDrone', 'flyTrail', 'dash', 'waveCanvas', 'cockpitCaption',
      'launchSlot', 'launchBtn', 'oceanBg', 'blackout', 'scanner',
      'zones', 'hud', 'hudCaption', 'hudTally',
      'topbar', 'topbarText', 'target',
      'veil', 'gate', 'gateBtn', 'nav', 'navPrev', 'navNext'
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
  function narrate(key) {
    var text = LINE[key] || '';

    if (M.reduced()) {
      T.set(el.topbarText, text);
      return A.say(key).then(function () { return M.wait(260); });
    }

    return A.say(key, {
      onPlay: function (audio) {
        T.type(el.topbarText, text, { audio: audio, hold: 260 });
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
    el.hud.classList.remove('is-on');
    el.hudCaption.classList.remove('is-shown');
    el.hudCaption.textContent = '';

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

    el.hudTally.classList.remove('is-shown');
    el.hudTally.textContent = '';

    el.topbar.classList.remove('is-on');
    T.clear(el.topbarText);
    el.target.classList.remove('is-on');
  }

  function runDroneFeed() {
    W.stop();

    return sequence([
      function () {
        el.hud.classList.add('is-on');
        A.duckAmbience(0.18, 900);
        return M.wait(520);
      },

      /* --- the dark --- */
      function () { return speak(el.hudCaption, 'tooDark'); },
      function () { return M.wait(220); },

      /* --- call for the scanner --- */
      function () { return speak(el.hudCaption, 'startScan'); },

      /* --- red line sweeps the feed --- */
      function () {
        el.hudCaption.textContent = 'SCANNING SURFACE…';
        el.hudCaption.classList.add('is-shown');
        return M.sweep(el.scanner, { legs: 4, legMs: 1150 });
      },

      /* --- lights up: ocean 0 → 1 --- */
      function () {
        el.hudCaption.classList.remove('is-shown');
        el.oceanBg.classList.add('is-lit');
        el.blackout.classList.add('is-clear');
        return M.wait(1700);
      },

      /* --- shapes breach the water --- */
      function () { return surface(); },
      function () { return M.wait(420); },

      /* --- payoff line --- */
      function () { return speak(el.hudCaption, 'foundZones'); },
      function () {
        el.hudCaption.textContent = 'FIVE LANDING ZONES IDENTIFIED';
        el.hudCaption.classList.add('is-shown');
        return M.wait(900);
      },

      /* ═══════════════ shape hunt ═══════════════ */

      /* the narration bar drops in empty, so the first typed line
         is not competing with the bar's own arrival */
      function () {
        el.hudCaption.classList.remove('is-shown');
        el.topbar.classList.add('is-on');
        return M.wait(720);
      },

      function () { return narrate('lookShapes'); },

      /* the ship goes up BEFORE it is mentioned, so it is already
         there to be looked at when the line names it */
      function () {
        el.target.classList.add('is-on');
        return M.wait(560);
      },

      function () { return narrate('pickTriangles'); },

      /* --- over to the player --- */
      function (id) { return startPicking(id); },

      /* --- the odd shapes go back under --- */
      function () {
        el.hudCaption.classList.remove('is-shown');
        el.hudTally.classList.remove('is-shown');
        return M.wait(420);
      },
      function () { return sinkOthers(); },
      function () { return M.wait(360); },

      /* --- payoff --- */
      function () { return narrate('shapeMatch'); },
      function () {
        el.hudCaption.textContent = 'THREE TRIANGULAR LANDING ZONES CONFIRMED';
        el.hudCaption.classList.add('is-shown');
      }
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

  function tally() {
    el.hudTally.textContent =
      'TRIANGLES SELECTED · ' + picked + ' / ' + needed;
    el.hudTally.classList.add('is-shown');
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

    el.hudCaption.textContent = 'TAP EVERY TRIANGLE';
    el.hudCaption.classList.add('is-shown');
    tally();

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
    tally();

    if (picked >= needed) {
      el.hudCaption.textContent = 'ALL TRIANGLES FOUND';
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
     SCREENS + NAV
     ============================================================ */
  var SCREENS = [
    { node: function () { return el.screenCockpit; }, reset: resetCockpit,   run: runCockpit },
    { node: function () { return el.screenDrone; },   reset: resetDroneFeed, run: runDroneFeed }
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
    A.preload();

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
