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
