/* ==========================================================================
   FROGGER  ::  audio.js
   --------------------------------------------------------------------------
   Tiny beep synthesiser. No sound files to download, no assets to manage.
   Every sound is a short tone (or a few tones in a row) generated live.

   To change a sound, edit the SOUNDS table: each entry is a list of
   [frequency in Hz, duration in seconds] steps.
     440 is concert A. Double the number to go up an octave.
   ========================================================================== */

const SOUNDS = {
  hop:    { wave: 'square',   steps: [[520, 0.05], [700, 0.05]],                  gain: 0.10 },
  home:   { wave: 'triangle', steps: [[660, 0.08], [880, 0.08], [1180, 0.14]],    gain: 0.16 },
  die:    { wave: 'sawtooth', steps: [[300, 0.10], [200, 0.10], [110, 0.26]],     gain: 0.16 },
  level:  { wave: 'triangle', steps: [[520,0.09],[660,0.09],[780,0.09],[1040,0.22]], gain: 0.16 },
  life:   { wave: 'square',   steps: [[880, 0.07], [1320, 0.12]],                 gain: 0.13 },
  over:   { wave: 'sawtooth', steps: [[400,0.16],[320,0.16],[240,0.16],[150,0.40]], gain: 0.16 },
  pickup: { wave: 'triangle', steps: [[780, 0.06], [1040, 0.10]],                  gain: 0.14 },

  /* --- the bonus round --- */
  smash:    { wave: 'sawtooth', steps: [[190, 0.05], [95, 0.09]],                  gain: 0.20 },
  bigsmash: { wave: 'square',   steps: [[300,0.04],[170,0.05],[90,0.13]],           gain: 0.24 },
  bonus:    { wave: 'square',   steps: [[520,0.09],[660,0.09],[880,0.09],[1320,0.26]], gain: 0.18 },
  fanfare:  { wave: 'triangle', steps: [[660,0.10],[880,0.10],[1100,0.10],[1320,0.10],[1760,0.34]], gain: 0.18 },
};

const Sound = {
  _ctx: null,

  /* Browsers refuse to make noise until the user has interacted with the
     page, so the AudioContext is created lazily on the first real input. */
  _context() {
    if (!this._ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this._ctx = new Ctx();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  },

  /* The music player shares this, so one user gesture unlocks both. */
  context() {
    return this._context();
  },

  play(name) {
    if (!CONFIG.sound) return;
    const def = SOUNDS[name];
    if (!def) return;

    const ctx = this._context();
    if (!ctx) return;

    let t = ctx.currentTime;
    for (const [freq, dur] of def.steps) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();

      osc.type = def.wave;
      osc.frequency.setValueAtTime(freq, t);

      /* Quick attack, smooth decay, so it clicks instead of thudding. */
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(def.gain, t + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      osc.connect(amp).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);

      t += dur;
    }
  },
};


/* ==========================================================================
   THE MONSTER TRUCK ENGINE
   --------------------------------------------------------------------------
   Everything else in this file is a short beep. An engine is not: it has to
   run continuously and change as you drive, so it is built once and then
   nudged, rather than played.

   Four parts, which is roughly what a big engine sounds like:

     osc    a sawtooth down at the bottom of hearing, the main rumble
     sub    a square an octave below it, for weight
     lfo    a slow wobble on the volume. This is the chug: real engines fire
            one cylinder at a time, and without it you get a flat drone that
            sounds like a hairdryer.
     hiss   filtered noise, the exhaust, which only shows up under throttle

   Open the throttle and all four move together: the pitch climbs, the filter
   opens up, the chug speeds up and the exhaust gets louder.
   ========================================================================== */

const ENGINE = {
  idleHz:   46,      /* lumpy tickover */
  fullHz:  132,      /* flat out */
  idleCut: 320,      /* how muffled it is at rest, in Hz */
  fullCut: 2400,
  idleChug:  8,      /* wobbles a second at rest */
  fullChug: 27,
  idleVol: 0.10,
  fullVol: 0.24,
  hissVol: 0.055,
  glide:   0.14,     /* seconds to reach a new throttle setting */
};

const Engine = {
  running: false,
  _ctx: null,
  _nodes: null,
  _revUntil: 0,

  start() {
    if (!CONFIG.sound || this.running) return;
    const ctx = Sound.context();
    if (!ctx) return;

    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(ctx.destination);

    /* The rumble, through a lowpass so it is felt more than heard. */
    const cut = ctx.createBiquadFilter();
    cut.type = 'lowpass';
    cut.frequency.value = ENGINE.idleCut;
    cut.Q.value = 6;
    cut.connect(out);

    const amp = ctx.createGain();
    amp.gain.value = ENGINE.idleVol;
    amp.connect(cut);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = ENGINE.idleHz;
    osc.connect(amp);

    const sub = ctx.createOscillator();
    sub.type = 'square';
    sub.frequency.value = ENGINE.idleHz / 2;
    const subAmp = ctx.createGain();
    subAmp.gain.value = 0.5;
    sub.connect(subAmp).connect(amp);

    /* The chug. An oscillator wired into a gain's control, not its input. */
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = ENGINE.idleChug;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = ENGINE.idleVol * 0.7;
    lfo.connect(lfoDepth).connect(amp.gain);

    /* Exhaust. Reuses the noise buffer trick from the drums. */
    const hiss = ctx.createBufferSource();
    hiss.buffer = this._noiseBuffer(ctx);
    hiss.loop = true;
    const hissBand = ctx.createBiquadFilter();
    hissBand.type = 'bandpass';
    hissBand.frequency.value = 900;
    hissBand.Q.value = 0.8;
    const hissAmp = ctx.createGain();
    hissAmp.gain.value = 0;
    hiss.connect(hissBand).connect(hissAmp).connect(out);

    const now = ctx.currentTime;
    osc.start(now);
    sub.start(now);
    lfo.start(now);
    hiss.start(now);

    this._ctx = ctx;
    this._nodes = { out, cut, amp, osc, sub, lfo, lfoDepth, hiss, hissAmp };
    this.running = true;
    this._revUntil = 0;
  },

  stop() {
    const n = this._nodes;
    this.running = false;
    if (!n || !this._ctx) { this._nodes = null; return; }

    /* Ramp down before killing it, or it ends with a click. */
    const ctx = this._ctx;
    const now = ctx.currentTime;
    for (const g of [n.amp.gain, n.hissAmp.gain, n.out.gain]) {
      if (g.cancelScheduledValues) g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0.0001, now + 0.16);
    }
    for (const src of [n.osc, n.sub, n.lfo, n.hiss]) {
      if (src.stop) src.stop(now + 0.22);
    }
    this._nodes = null;
  },

  /* throttle is 0 (coasting) to 1 (flat out). Called every frame. */
  setThrottle(throttle) {
    const n = this._nodes;
    if (!this.running || !n) return;
    const ctx = this._ctx;
    const now = ctx.currentTime;

    let t = Math.max(0, Math.min(1, throttle));
    /* A kick of revs when you hit something, which fades on its own. */
    if (now < this._revUntil) t = Math.min(1.25, Math.max(t, 1.15));

    const to = (param, value, time) => {
      if (!param) return;
      if (param.cancelScheduledValues) param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(value, now + time);
    };
    const mix = (a, b) => a + (b - a) * t;

    to(n.osc.frequency,  mix(ENGINE.idleHz, ENGINE.fullHz), ENGINE.glide);
    to(n.sub.frequency,  mix(ENGINE.idleHz, ENGINE.fullHz) / 2, ENGINE.glide);
    to(n.cut.frequency,  mix(ENGINE.idleCut, ENGINE.fullCut), ENGINE.glide);
    to(n.lfo.frequency,  mix(ENGINE.idleChug, ENGINE.fullChug), ENGINE.glide);

    const vol = mix(ENGINE.idleVol, ENGINE.fullVol);
    to(n.amp.gain, vol, ENGINE.glide);
    to(n.lfoDepth.gain, vol * (0.7 - t * 0.45), ENGINE.glide);
    to(n.hissAmp.gain, ENGINE.hissVol * t * t, ENGINE.glide);
  },

  /* Blip the throttle. Used when the truck flattens something. */
  rev(seconds) {
    if (!this.running || !this._ctx) return;
    this._revUntil = this._ctx.currentTime + (seconds || 0.18);
  },

  _noiseBuffer(ctx) {
    if (this._noise && this._noiseCtx === ctx) return this._noise;
    const frames = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 987654321;
    for (let i = 0; i < frames; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff) - 1;
    }
    this._noise = buf;
    this._noiseCtx = ctx;
    return buf;
  },
};
