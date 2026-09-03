/* ============================================================
   Geo Drone — typewriter

   Reveals a caption one character at a time, clocked off the
   NARRATION rather than off a timer, so the text lands with the
   voice on every machine.

   How the sync works
     · say() handles us the <audio> element it is about to play
     · progress = currentTime / (duration * LEAD)
     · LEAD < 1 so the sentence is finished a beat before the
       speaker stops talking — reading ahead of the voice feels
       natural, trailing behind it does not

   Why currentTime and not a rate in chars/second
     currentTime is the one clock that cannot drift from the
     audio: it stalls while the clip buffers, freezes when the
     tab is hidden (audio.js pauses the element) and resumes
     from the same instant. A chars/second timer does none of
     that and slides out of sync after the first stall.

   If the element never reports a duration (blocked autoplay,
   a missing file, file:// oddities) we fall back to a fixed
   reading rate so the line still appears.

   Layout: the untyped remainder stays in the DOM as a
   `visibility: hidden` span, so the bar is laid out for the
   whole sentence from the first frame and the text does not
   crawl sideways as it fills in.
   ============================================================ */

(function (global) {
  'use strict';

  var LEAD = 0.86;            // finish typing at 86% of the clip
  var FALLBACK_CPS = 32;      // chars/second when there is no duration
  var META_WAIT = 1200;       // how long to wait for loadedmetadata

  function wait(ms) {
    return global.GeoLife
      ? global.GeoLife.wait(ms)
      : new Promise(function (r) { setTimeout(r, ms); });
  }

  /* ---------------------------------------------------------- target
     One typewriter per host element. The three spans are built
     once and reused, so typing never thrashes the DOM. */
  function mount(host) {
    if (host.__tw) return host.__tw;

    host.textContent = '';

    var on = document.createElement('span');
    on.className = 'tw__on';

    var caret = document.createElement('span');
    caret.className = 'tw__caret';
    caret.setAttribute('aria-hidden', 'true');

    var off = document.createElement('span');
    off.className = 'tw__off';

    host.appendChild(on);
    host.appendChild(caret);
    host.appendChild(off);

    host.__tw = { host: host, on: on, caret: caret, off: off, token: 0 };
    return host.__tw;
  }

  /* ---------------------------------------------------------- helpers */
  function known(el) {
    return el && isFinite(el.duration) && el.duration > 0.05;
  }

  /* The element is usually handed over before its metadata has
     arrived; give it a moment before deciding we have no clock. */
  function settleDuration(el) {
    if (!el || known(el)) return Promise.resolve(el);

    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        el.removeEventListener('loadedmetadata', finish);
        el.removeEventListener('durationchange', finish);
        resolve(el);
      }
      el.addEventListener('loadedmetadata', finish);
      el.addEventListener('durationchange', finish);
      wait(META_WAIT).then(finish);
    });
  }

  /* ---------------------------------------------------------- typing */
  /* `opts.audio`  element to clock off (optional)
     `opts.hold`   ms to keep the caret up after the last char
     Resolves when the whole string is on screen. Starting a new
     line on the same host cancels whatever was still typing. */
  function type(host, text, opts) {
    opts = opts || {};
    if (!host) return Promise.resolve();

    var t = mount(host);
    var mine = ++t.token;
    var full = String(text == null ? '' : text);

    t.on.textContent = '';
    t.off.textContent = full;
    host.classList.add('is-typing');

    if (!full) {
      host.classList.remove('is-typing');
      return Promise.resolve();
    }

    return settleDuration(opts.audio).then(function (audio) {
      if (mine !== t.token) return;

      /* the clock: audio position when we have one, wall time
         otherwise. Both are read as "seconds since the line
         started", so the rest of the loop does not care which. */
      var span = known(audio) ? audio.duration * LEAD
                              : full.length / FALLBACK_CPS;
      var t0 = performance.now();
      var useAudio = known(audio);
      var shown = 0;

      return new Promise(function (resolve) {
        function frame() {
          if (mine !== t.token) return resolve();     // superseded

          var pos = useAudio
            ? audio.currentTime
            : (performance.now() - t0) / 1000;

          /* The voice ended early, or was cut off by a jump: dump
             the rest in rather than leaving half a sentence on
             screen waiting for a clock that will never move again.
             A tab-hidden pause is NOT a cut — lifecycle.js parked
             the element and will start it again — and the first
             couple of frames are ignored so a play() that is still
             settling does not read as a stall. */
          var parked = global.GeoLife && global.GeoLife.isPaused();
          var settling = performance.now() - t0 < 260;
          if (useAudio && !parked && !settling && (audio.ended || audio.paused)) {
            pos = span;
          }

          var want = Math.round(Math.min(1, pos / span) * full.length);

          if (want > shown) {
            shown = want;
            t.on.textContent = full.slice(0, shown);
            t.off.textContent = full.slice(shown);
          }

          if (shown >= full.length) {
            t.off.textContent = '';
            if (opts.hold) {
              wait(opts.hold).then(function () {
                if (mine === t.token) host.classList.remove('is-typing');
                resolve();
              });
            } else {
              host.classList.remove('is-typing');
              resolve();
            }
            return;
          }

          requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
      });
    });
  }

  /* Drop the line and the caret. */
  function clear(host) {
    if (!host) return;
    var t = mount(host);
    t.token++;
    t.on.textContent = '';
    t.off.textContent = '';
    host.classList.remove('is-typing');
  }

  /* Put the whole line up at once — used for static labels and
     under prefers-reduced-motion. */
  function set(host, text) {
    if (!host) return;
    var t = mount(host);
    t.token++;
    t.on.textContent = String(text == null ? '' : text);
    t.off.textContent = '';
    host.classList.remove('is-typing');
  }

  global.GeoType = { type: type, clear: clear, set: set };
})(window);
