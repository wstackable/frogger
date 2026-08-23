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
  const files = ["js/config.js", "js/render.js", "js/audio.js", "js/game.js"];
  let src = "";
  for (const f of files) src += await Deno.readTextFile(`${ROOT}/${f}`) + "\n";

  // ---- stubs ----
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "measureText") return () => ({ width: 10 });
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; },
  });

  const listeners = {};
  const addEL = (obj) => (type, fn) => {
    (listeners[type] ||= []).push({ obj, fn });
  };

  const canvas = {
    _tag: "canvas", width: 0, height: 0, style: {},
    getContext: () => ctx,
    addEventListener: addEL("canvas"),
  };
  const pad = { hidden: true, addEventListener: addEL("pad") };

  const rafQueue = [];
  const store = new Map();

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
    AudioContext: undefined,
    webkitAudioContext: undefined,
    console,
    Image: class { constructor() { this.complete = false; this.naturalWidth = 0; } addEventListener() {} },
    Math, Date, Number, String, Object, Array, JSON, Boolean, isNaN, parseInt, parseFloat,
  };
  win.window = win;

  const fn = new Function(
    "window", "document", "requestAnimationFrame", "localStorage",
    "Image", "console", "performance",
    src + "\nreturn window.frogger;"
  );

  const api = fn(
    win,
    { getElementById: (id) => (id === "game" ? canvas : pad) },
    win.requestAnimationFrame,
    win.localStorage,
    win.Image,
    console,
    performance,
  );

  // Drive frames manually.
  let t = 0;
  function tick(ms = 16.6667) {
    t += ms;
    const batch = rafQueue.splice(0, rafQueue.length);
    for (const f of batch) f(t);
  }
  function frames(n, ms = 16.6667) { for (let i = 0; i < n; i++) tick(ms); }

  function key(k) {
    for (const l of listeners.keydown || []) l.fn({ key: k, preventDefault: noop });
  }

  return { api, tick, frames, key, listeners, canvas, store };
}
