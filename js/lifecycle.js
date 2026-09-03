/* ============================================================
   Geo Drone — page lifecycle

   When the player switches tab or minimises the browser, the
   whole mission stops, not just the sound. Pausing audio alone
   is not enough: setTimeout keeps firing in a hidden tab (just
   throttled) and Web Animations keep advancing on the document
   timeline, so the flow would march on without its voice-over
   and come back out of sync.

   So this module owns three things and freezes all of them
   together:

     · wait()      — the clock the whole flow is sequenced on.
                     Its timers hold their remaining time while
                     hidden and re-arm on return.
     · animations  — every running CSS animation / transition /
                     scanner sweep, paused where it stands.
     · handlers    — audio.js registers here to pause and resume
                     its own players.

   Load order matters: this file must come before the modules
   that call into it.
   ============================================================ */

(function (global) {
  'use strict';

  var doc = global.document;

  var paused = false;
  var timers = [];                       // live wait() tickets
  var frozen = [];                       // animations we paused
  var handlers = { suspend: [], resume: [] };

  /* ---------------------------------------------------------- clock */
  function arm(ticket) {
    ticket.at = performance.now();
    ticket.id = setTimeout(function () {
      drop(ticket);
      ticket.done();
    }, ticket.left);
  }

  function drop(ticket) {
    var i = timers.indexOf(ticket);
    if (i >= 0) timers.splice(i, 1);
  }

  /* A pausable setTimeout. Same shape as a plain delay promise,
     except that time spent hidden does not count. */
  function wait(ms) {
    return new Promise(function (done) {
      var ticket = {
        left: Math.max(0, ms || 0),
        done: done,
        id: 0,
        at: 0
      };
      timers.push(ticket);
      if (!paused) arm(ticket);          // otherwise armed by resume()
    });
  }

  /* ---------------------------------------------------------- animations */
  function freezeAnimations() {
    if (!doc.getAnimations) return;
    frozen = doc.getAnimations().filter(function (a) {
      return a.playState === 'running';
    });
    frozen.forEach(function (a) {
      try { a.pause(); } catch (e) { /* detached — ignore */ }
    });
  }

  function thawAnimations() {
    frozen.forEach(function (a) {
      /* pause() kept currentTime, so play() carries on from there
         rather than restarting */
      try { a.play(); } catch (e) { /* detached — ignore */ }
    });
    frozen = [];
  }

  /* ---------------------------------------------------------- freeze / thaw */
  function suspend() {
    if (paused) return;
    paused = true;

    var now = performance.now();
    timers.forEach(function (ticket) {
      clearTimeout(ticket.id);
      ticket.id = 0;
      ticket.left = Math.max(0, ticket.left - (now - ticket.at));
    });

    freezeAnimations();
    fire('suspend');
  }

  function resume() {
    if (!paused) return;
    paused = false;

    timers.slice().forEach(arm);
    thawAnimations();
    fire('resume');
  }

  function fire(kind) {
    handlers[kind].slice().forEach(function (fn) {
      try { fn(); } catch (e) { /* one bad listener must not stall the rest */ }
    });
  }

  /* ---------------------------------------------------------- api */
  function on(kind, fn) {
    if (handlers[kind] && typeof fn === 'function') handlers[kind].push(fn);
  }

  function isPaused() { return paused; }

  function init() {
    /* visibilitychange covers both cases the player can create:
       switching to another tab, and minimising the window */
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) suspend(); else resume();
    });

    /* a tab restored from the back/forward cache comes back through
       pageshow without a visibilitychange */
    global.addEventListener('pageshow', function () {
      if (!doc.hidden) resume();
    });

    if (doc.hidden) suspend();
  }

  global.GeoLife = {
    init: init,
    wait: wait,
    on: on,
    suspend: suspend,
    resume: resume,
    isPaused: isPaused
  };
})(window);
