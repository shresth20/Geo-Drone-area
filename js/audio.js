/* ============================================================
   Geo Drone — audio engine

   · one AudioContext, one shared AnalyserNode
   · narration is routed THROUGH the analyser, so the cockpit
     readout is driven by the actual voice line that is playing
   · ambience/SFX go straight to the speakers so they do not
     pollute the readout
   · say() resolves when the line finishes, which is what the
     flow in script.js is sequenced on
   · if the analyser comes back silent (file:// pages taint the
     media element in most browsers) we transparently fall back
     to a procedural, speech-shaped envelope keyed to playback
     time — the readout still starts, moves and stops with the
     voice
   · everything playing is paused when the tab is hidden and
     picked up again on return (see js/lifecycle.js)
   ============================================================ */

(function (global) {
  'use strict';

  var DIR = 'assets/audio/';

  /* file:// taints media-element sources: the analyser reads zeroes
     AND the element's sound disappears into the graph. Only wire the
     analyser up when we are actually served over http(s).           */
  var CAN_ANALYSE =
    global.location.protocol === 'http:' ||
    global.location.protocol === 'https:';

  var VOICE = {
    welcome:  'Welcome, Space Commander! We have a new landing mission.mp3',
    safePlace:'We need to find a safe place for it to land.mp3',
    sendDrone:'Let’s send the survey drone to check the area.mp3',
    clickLaunch:'Click the launch button to launch the drone.mp3',
    tooDark:  'It is too dark to see the landing zones.mp3',
    startScan:'Start the scanner to search the area.mp3',
    foundZones:'Great! The scanner found several landing zones..mp3',
    lookShapes:'Look at the shapes of the landing zones.mp3',
    pickTriangles:'The spaceship is a triangle. Select all the triangular landing zones.mp3',
    shapeMatch:'Correct! These landing zones have the same shape as the spaceship.mp3',
    tryAgain: 'Try again.mp3',
    spaceNeeded:'Next, we need to find how much space the spaceship needs.mp3',
    calcArea: 'Calculate the area of spaceship, And select the land with required area.mp3',
    chooseExact:'Choose the landing zone with the exact area.mp3',
    tooSmall: 'This landing zone is too small. The spaceship cannot fit safely.mp3',
    tooLarge: 'This landing zone is too large. Try to find the exact match.mp3',
    perfectFit:'Perfect match! The spaceship fits exactly.mp3',
    landed:   'Landing successful! Great work, Space Commander.mp3'
  };

  var SFX = {
    launch:  'drone-launch.mp3',
    rock:    'rock in water.mp3',
    glitch:  'screen-glitch.mp3',
    correct: 'correct-answer.ogg',
    wrong:   'incorrect-answer.ogg',
    click:   'button-click.ogg',
    cheer:   'confetti-sound.ogg'
  };

  var AMBIENCE = 'theme-music.mp3';

  /* ---------------------------------------------------------- state */
  var ctx = null;
  var analyser = null;
  var voiceBus = null;          // gain node all narration passes through
  var freqBytes = null;

  var voices = {};              // key -> HTMLAudioElement
  var wired = {};               // key -> true once MediaElementSource exists
  var ambience = null;

  var active = null;            // element currently narrating
  var analyserAlive = null;     // null = untested, true/false once probed
  var probeUntil = 0;

  var oneShots = [];            // SFX still in flight
  var held = [];                // what we paused when the tab went away

  /* ---------------------------------------------------------- helpers */
  function url(file) { return encodeURI(DIR + file); }

  /* HTMLMediaElement.volume throws outside [0,1], and a ramp can
     land a hair past either end on the last frame */
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* Safety timers must not burn down while the tab is hidden, or a
     line paused mid-sentence would be declared dead and the flow
     would walk over it on return. */
  function later(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  /* Skip bins 0-1 (DC and rumble — always dead) and stop at 40% of
     the range: a voice track carries no energy above that, and
     mapping bands onto empty bins flattens the trace into a line. */
  var BIN_FIRST = 2;
  var BIN_TOP = 0.40;

  function binEdge(k, usable) {
    return BIN_FIRST + Math.floor(Math.pow(k, 1.45) * (usable - BIN_FIRST - 1));
  }

  /* a fixed per-band roughness table, so the procedural trace has
     the uneven silhouette of real speech instead of a tidy comb */
  var ROUGH = [];
  for (var r = 0; r < 128; r++) {
    ROUGH.push(0.30 + ((Math.sin(r * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.70);
  }

  function makeVoice(file) {
    var el = new Audio();
    el.src = url(file);
    el.preload = 'auto';
    el.volume = 1;
    return el;
  }

  /* ---------------------------------------------------------- graph */
  function ensureContext() {
    if (!CAN_ANALYSE) { analyserAlive = false; return null; }
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      analyser.minDecibels = -92;
      analyser.maxDecibels = -18;
      freqBytes = new Uint8Array(analyser.frequencyBinCount);

      voiceBus = ctx.createGain();
      voiceBus.gain.value = 1;
      voiceBus.connect(analyser);
      analyser.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      analyser = null;
    }
    return ctx;
  }

  function routeThroughAnalyser(key, el) {
    if (!ctx || !voiceBus || wired[key]) return;
    try {
      var src = ctx.createMediaElementSource(el);
      src.connect(voiceBus);
      wired[key] = true;
    } catch (e) {
      /* already wired elsewhere, or blocked — the fallback covers it */
      wired[key] = true;
    }
  }

  /* ---------------------------------------------------------- unlock */
  function unlock() {
    ensureContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  /* ---------------------------------------------------------- narration */
  function say(key, opts) {
    opts = opts || {};
    var file = VOICE[key];
    if (!file) return Promise.resolve();

    unlock();

    var el = voices[key] || (voices[key] = makeVoice(file));
    routeThroughAnalyser(key, el);

    try { el.currentTime = 0; } catch (e) {}
    el.volume = opts.volume == null ? 1 : opts.volume;

    active = el;
    if (analyserAlive === null) probeUntil = performance.now() + 700;

    return new Promise(function (resolve) {
      var done = false;

      function finish() {
        if (done) return;
        done = true;
        el.removeEventListener('ended', finish);
        el.removeEventListener('error', finish);
        if (active === el) active = null;
        resolve();
      }

      el.addEventListener('ended', finish);
      el.addEventListener('error', finish);

      /* Hand the element over before playback starts, so a caption
         can clock itself off currentTime instead of guessing at a
         typing speed. play() clears `paused` synchronously, so the
         typewriter's first frame already sees a live clock. */
      if (opts.onPlay) {
        try { opts.onPlay(el); } catch (e) { /* caption only — never stall the line */ }
      }

      var p = el.play();
      if (p && p.catch) {
        p.catch(function () {
          /* blocked or missing — do not stall the flow, give the
             readout a beat of life then move on */
          later(900).then(finish);
        });
      }

      /* hard safety net so a broken file can never freeze the mission */
      later(30000).then(finish);
    });
  }

  function isSpeaking() {
    return !!(active && !active.paused && !active.ended);
  }

  function stopVoice() {
    Object.keys(voices).forEach(function (k) {
      var el = voices[k];
      if (!el.paused) {
        el.pause();
        /* say() resolves on 'ended'; pausing never fires it, so
           settle the promise by hand instead of leaving the flow
           waiting on the safety timeout */
        el.dispatchEvent(new Event('ended'));
      }
    });
    active = null;
  }

  /* Silence everything at once — used when the player jumps to
     another screen and the sequence that owned these clips is
     abandoned. `held` is cleared too, so a later tab-return cannot
     revive a line that no longer belongs anywhere. */
  function stopAll() {
    Object.keys(voices).forEach(function (k) {
      var el = voices[k];
      if (!el.paused) {
        el.pause();
        el.dispatchEvent(new Event('ended'));
      }
    });

    oneShots.slice().forEach(function (el) {
      try {
        el.pause();
        el.dispatchEvent(new Event('ended'));
      } catch (e) { /* already gone */ }
    });

    active = null;
    held = [];
  }

  /* ---------------------------------------------------------- one-shots */
  function sfx(key, opts) {
    opts = opts || {};
    var file = SFX[key];
    if (!file) return Promise.resolve();

    unlock();

    var el = new Audio(url(file));
    el.volume = opts.volume == null ? 0.7 : opts.volume;
    if (opts.rate) el.playbackRate = opts.rate;

    oneShots.push(el);

    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        var i = oneShots.indexOf(el);
        if (i >= 0) oneShots.splice(i, 1);
        resolve();
      }
      el.addEventListener('ended', finish);
      el.addEventListener('error', finish);
      var p = el.play();
      if (p && p.catch) p.catch(finish);
      later(15000).then(finish);
    });
  }

  /* ---------------------------------------------------------- ambience */
  function startAmbience(volume) {
    if (ambience) return;
    ambience = new Audio(url(AMBIENCE));
    ambience.loop = true;
    ambience.volume = 0;
    var target = volume == null ? 0.24 : volume;
    var p = ambience.play();
    if (p && p.catch) p.catch(function () {});

    /* gentle fade-in so it slips under the briefing */
    var t0 = performance.now();
    (function ramp(now) {
      var k = Math.min(1, (now - t0) / 2600);
      ambience.volume = clamp01(target * k);
      if (k < 1) requestAnimationFrame(ramp);
    })(t0);
  }

  function duckAmbience(to, ms) {
    if (!ambience) return;
    var from = ambience.volume;
    var t0 = performance.now();
    (function ramp(now) {
      var k = Math.min(1, (now - t0) / (ms || 600));
      ambience.volume = clamp01(from + (to - from) * k);
      if (k < 1) requestAnimationFrame(ramp);
    })(t0);
  }

  /* ---------------------------------------------------------- spectrum
     Fills `out` (Float32Array, 0..1) with the current voice
     spectrum. Real analyser data when we have it, a procedural
     speech envelope when we do not.                            */
  function fillSpectrum(out) {
    var n = out.length;
    var speaking = isSpeaking();

    if (analyser && analyserAlive !== false) {
      analyser.getByteFrequencyData(freqBytes);

      if (analyserAlive === null && speaking) {
        var peak = 0;
        for (var p = 0; p < freqBytes.length; p++) {
          if (freqBytes[p] > peak) peak = freqBytes[p];
        }
        if (peak > 6) {
          analyserAlive = true;
        } else if (performance.now() > probeUntil) {
          analyserAlive = false;    // silent graph → go procedural
        }
      }

      if (analyserAlive === true) {
        if (!speaking) {
          proceduralFill(out, performance.now() / 1000, true);
          return false;
        }

        /* Voice energy lives low in the spectrum, so read a
           log-ish slice of the bins rather than the whole range. */
        var bins = freqBytes.length;
        var usable = Math.floor(bins * BIN_TOP);

        for (var i = 0; i < n; i++) {
          var lo = binEdge(i / (n - 1), usable);
          var hi = binEdge((i + 1) / (n - 1), usable);
          if (hi <= lo) hi = lo + 1;
          var max = 0;
          for (var b = lo; b < hi && b < bins; b++) {
            if (freqBytes[b] > max) max = freqBytes[b];
          }
          /* a small floor keeps the tail alive instead of ruler-flat */
          out[i] = Math.max(speaking ? 0.05 : 0.02,
                            Math.min(1, (max / 255) * 1.4));
        }
        return speaking;
      }
    }

    proceduralFill(out, active ? active.currentTime : performance.now() / 1000, !speaking);
    return speaking;
  }

  /* Speech-shaped envelope, used two ways: as the whole signal when
     the analyser is unavailable, and as the idle breath between
     lines so the readout never sits as a dead flat line.          */
  function proceduralFill(out, t, idle) {
    var n = out.length;

    /* syllable gate: opens and closes the way speech does */
    var syl = Math.abs(Math.sin(t * 8.7) * Math.sin(t * 2.9 + 1.1)) * 0.7 +
              Math.abs(Math.sin(t * 4.3 + 0.4)) * 0.3;
    var amp = idle ? 0.07 : (0.22 + 0.78 * syl);

    for (var j = 0; j < n; j++) {
      var g = j / (n - 1);
      var tilt = Math.pow(1 - g, 0.6) * 0.72 + 0.28;
      var rough = ROUGH[j % ROUGH.length];
      /* two detuned wobbles per band keep neighbours from marching
         in step, which is what made the comb look mechanical */
      var wob =
        0.5 + 0.34 * Math.sin(j * 2.31 + t * (7.1 + rough * 6.4)) +
              0.16 * Math.sin(j * 0.77 - t * (13.7 - rough * 4.1));
      /* 0.82 keeps the loud bands off the clamp, which is what
         was flattening the peaks into a even comb */
      out[j] = Math.max(0.015, Math.min(1, 0.82 * amp * tilt * rough * (0.34 + 0.9 * wob)));
    }
  }

  /* ---------------------------------------------------------- lifecycle
     Pause every player that is actually making sound and remember
     which ones they were, so returning to the tab picks each of
     them up exactly where it stopped. */
  function suspendAll() {
    if (held.length) return;

    var all = Object.keys(voices).map(function (k) { return voices[k]; })
      .concat(oneShots);
    if (ambience) all.push(ambience);

    all.forEach(function (a) {
      if (a && !a.paused && !a.ended) {
        a.pause();
        held.push(a);
      }
    });
  }

  function resumeAll() {
    var list = held;
    held = [];
    list.forEach(function (a) {
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* gone — let it go */ });
    });
  }

  /* ---------------------------------------------------------- preload

     Every clip is fetched up front and reports back exactly once,
     so the start gate can show real progress instead of running a
     guessed timer next to a spinner.

     A clip that errors counts as settled too: one missing file must
     not hold the mission behind a bar stuck at 94%. Same for a clip
     that simply never fires `canplaythrough` — some browsers will
     sit on a preloading element until it is actually played — which
     is what the deadline below is for. */
  function settle(el, done) {
    var fired = false;

    function fire() {
      if (fired) return;
      fired = true;
      el.removeEventListener('canplaythrough', fire);
      el.removeEventListener('error', fire);
      done();
    }

    /* HAVE_ENOUGH_DATA: already there, nothing to wait for */
    if (el.readyState >= 4) fire();
    else {
      el.addEventListener('canplaythrough', fire);
      el.addEventListener('error', fire);
      el.load();
    }

    return fire;
  }

  function assetCount() {
    return Object.keys(VOICE).length + Object.keys(SFX).length + 1;
  }

  /* Resolves once every clip has settled. `onEach` fires once per
     clip, which is all the gate needs to drive its bar. */
  function preload(onEach) {
    var els = [];

    Object.keys(VOICE).forEach(function (k) {
      if (!voices[k]) voices[k] = makeVoice(VOICE[k]);
      els.push(voices[k]);
    });

    /* sfx() builds a fresh element per hit, so these exist only to
       put the file in the HTTP cache before the first hit needs it */
    Object.keys(SFX).forEach(function (k) { els.push(makeVoice(SFX[k])); });
    els.push(makeVoice(AMBIENCE));

    return new Promise(function (resolve) {
      var left = els.length;
      var forces = [];

      function tick() {
        if (onEach) onEach();
        if (--left === 0) resolve();
      }

      els.forEach(function (el) { forces.push(settle(el, tick)); });

      later(12000).then(function () {
        forces.forEach(function (f) { f(); });
      });
    });
  }

  if (global.GeoLife) {
    global.GeoLife.on('suspend', suspendAll);
    global.GeoLife.on('resume', resumeAll);
  }

  global.GeoAudio = {
    preload: preload,
    assetCount: assetCount,
    suspendAll: suspendAll,
    resumeAll: resumeAll,
    unlock: unlock,
    say: say,
    sfx: sfx,
    stopVoice: stopVoice,
    stopAll: stopAll,
    isSpeaking: isSpeaking,
    startAmbience: startAmbience,
    duckAmbience: duckAmbience,
    fillSpectrum: fillSpectrum
  };
})(window);
