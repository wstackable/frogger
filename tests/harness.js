/* ==========================================================================
   FROGGER  ::  tests/harness.js
   --------------------------------------------------------------------------
   Stubs just enough of a browser (canvas, window, localStorage, timers) to
   run the real game files with no browser at all, then hands back a way to
   step the game forward one frame at a time.

   This exists so you can change the rules in config.js or game.js and find
   out in a second whether you broke anything.
   ========================================================================== */
import { dirname, fromFileUrl, join } from "jsr:@std/path@1";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");

export async function load() {
  const files = ["js/config.js", "js/sprites.js", "js/render.js", "js/audio.js",
                 "js/music.js", "js/game.js"];
  let src = "";
  for (const f of files) src += await Deno.readTextFile(`${ROOT}/${f}`) + "\n";

  // ---- stubs ----
  const noop = () => {};
  /* Gradients are objects with methods, not just a return value, so the
     catch-all noop is not enough: the night levels build a radial gradient
     and call addColorStop on it. */
  const gradient = () => ({ addColorStop() {} });

  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "createRadialGradient" || k === "createLinearGradient" ||
          k === "createPattern") return gradient;
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });

  const listeners = {};
  const addEL = (obj) => (type, fn) => {
    (listeners[type] ||= []).push({ obj, fn });
  };

  function makeCanvas() {
    return {
      _tag: "canvas", width: 0, height: 0, style: {},
      getContext: () => ctx,
      addEventListener: addEL("canvas"),
    };
  }
  const canvas = makeCanvas();
  /* A stand-in for the radio / palette / d-pad buttons. */
  function makeEl() {
    return {
      hidden: true,
      textContent: "",
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener: addEL("el"),
      style: {},
    };
  }
  const pad = makeEl();

  const rafQueue = [];
  const store = new Map();

  /* ------------------------------------------------------------------------
     A fake AudioContext.

     Real browsers will not advance an audio clock without an output device
     (headless Chrome reports state "running" but currentTime stays at 0
     forever), so music timing cannot be tested in a browser at all. Here the
     clock is ours to move, and every note that gets scheduled is written down,
     which makes the scheduler fully checkable.
     ---------------------------------------------------------------------- */
  const scheduled = [];

  function param(initial) {
    return {
      value: initial,
      setValueAtTime(v) { this.value = v; return this; },
      linearRampToValueAtTime(v) { this.value = v; return this; },
      exponentialRampToValueAtTime(v) { this.value = v; return this; },
      cancelScheduledValues() { return this; },
    };
  }
  const node = () => ({ connect(dest) { return dest; }, disconnect() {} });

  class FakeAudioContext {
    constructor() {
      this.state = "running";
      this.sampleRate = 48000;
      this.currentTime = 0;
      this.destination = node();
    }
    resume() { this.state = "running"; }
    createGain() { return { ...node(), gain: param(1) }; }
    createOscillator() {
      const osc = {
        ...node(),
        type: "sine",
        frequency: param(440),
        start(when) { scheduled.push({ kind: "osc", freq: osc.frequency.value, when, type: osc.type }); },
        stop() {},
      };
      /* Record the pitch whichever way it is set. */
      osc.frequency.setValueAtTime = (v) => { osc.frequency.value = v; return osc.frequency; };
      return osc;
    }
    createBuffer(ch, len) {
      return { length: len, getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      const src = {
        ...node(), buffer: null, loop: false,
        start(when) { scheduled.push({ kind: "noise", when }); },
        stop() {},
      };
      return src;
    }
    createBiquadFilter() {
      return { ...node(), type: "highpass", frequency: param(1000), Q: param(1) };
    }
  }


  const win = {
    devicePixelRatio: 1,
    innerWidth: 900, innerHeight: 1000,
    addEventListener: addEL("window"),
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    AudioContext: FakeAudioContext,
    webkitAudioContext: FakeAudioContext,
    console,
    Image: class { constructor() { this.complete = false; this.naturalWidth = 0; } addEventListener() {} },
    Math, Date, Number, String, Object, Array, JSON, Boolean, isNaN, parseInt, parseFloat,
  };
  win.window = win;

  const fn = new Function(
    "window", "document", "requestAnimationFrame", "localStorage",
    "Image", "console", "performance", "setInterval", "clearInterval",
    src + "\nreturn window.frogger;"
  );

  const api = fn(
    win,
    {
      getElementById: (id) => (id === "game" ? canvas : makeEl()),
      createElement: (tag) => (tag === "canvas" ? makeCanvas() : {}),
    },
    win.requestAnimationFrame,
    win.localStorage,
    win.Image,
    console,
    performance,
    () => 0,          /* setInterval: the music scheduler stays inert in tests */
    () => {},         /* clearInterval */
  );

  // Drive frames manually.
  let t = 0;
  function tick(ms = 16.6667) {
    t += ms;
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const f of batch) f(t);
  }
  function frames(n, ms = 16.6667) { for (let i = 0; i < n; i++) tick(ms); }

  /* A real keyboard sends keyup as well. Without it `held` never clears and a
     level that reads held keys (the truck, the rocket) ends up stuck steering
     into a wall it was told to steer into ten tests ago. */
  function key(k) {
    for (const l of listeners.keydown || []) l.fn({ key: k, preventDefault: noop });
    for (const l of listeners.keyup || []) l.fn({ key: k, preventDefault: noop });
  }

  /* For levels that need a key genuinely held down. */
  function holdKey(k, down) {
    const type = down ? "keydown" : "keyup";
    for (const l of listeners[type] || []) l.fn({ key: k, preventDefault: noop });
  }

  /* Move the fake audio clock forward. The engine reads it for its rev
     blips, so tests that care about timing can nudge it. */
  function advanceAudio(seconds) {
    const ctx = api.Engine && api.Engine._ctx;
    if (ctx) ctx.currentTime += seconds;
  }

  return {
    api, tick, frames, key, holdKey, listeners, canvas, store,
    audio: { scheduled, advanceAudio, reset: () => { scheduled.length = 0; } },
  };
}
