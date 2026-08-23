/* ==========================================================================
   FROGGER  ::  music.js
   --------------------------------------------------------------------------
   THE MUSIC. Two kinds of track share one radio:

     FILE tracks    whatever is in the music/ folder. They stream when you
                    pick them, so nothing is downloaded up front. The pack
                    that ships with this is "Three Red Hearts" by Abstraction
                    (abstractionmusic.com), released CC-0 through Tallbeard
                    Studios, plus one track from Phoenix 89.
     WRITTEN tracks chiptune generated live in the browser from the notes
                    typed out below. No file, no download, and you can edit
                    the tune itself.

   Press R while playing to change track. Press M to mute.

   Each track is written out as text, one note per beat. You can absolutely
   write your own: see WRITING YOUR OWN TUNE at the bottom of the file.

       lead:  'e5 g5 a5 -  g5 e5 d5 .'
                            ^  ^
                            |  '.' is a rest (silence)
                            '-' holds the note before it for another beat

   Note names are a letter, an optional sharp, and an octave number.
   'c4' is middle C. 'a4' is the A above it. 'f#3' is lower down.
   Bigger octave number, higher note.
   ========================================================================== */


/* --------------------------------------------------------------------------
   The tracks.

   The first two are genuinely from the arcade cabinet. Konami's soundtrack was
   a medley of existing tunes, and these two are out of copyright so they can
   live here: "Yankee Doodle" (traditional) and "Camptown Races" (Stephen
   Foster, 1850).

   The famous opening jingle is a Japanese children's song, "Inu no
   Omawarisan", written by Yoshimi Sato in 1960, and the main theme is the
   opening of the anime Araiguma Rascal. Both are still in copyright, along
   with the other anime themes the cabinet used, so they are not here. The
   home ports had to swap them out for exactly the same reason.

   The rest are written for this game in the same spirit. Add your own by
   copying a block: see WRITING YOUR OWN TUNE at the bottom of the file.
   -------------------------------------------------------------------------- */
const TRACKS = [

  /* ---------------------------------------------------------------------
     Music files from the music/ folder.

     This block is generated. Drop files into music/ and run:

         deno task music

     and it rewrites itself. Do not hand-edit between the markers.
     --------------------------------------------------------------------- */

  /* MUSIC-FILES:START -- rebuilt by `deno task music`, do not hand-edit */
  { name: 'Box Jump',                  file: 'music/Chiptune Music Loops/Three Red Hearts - Box Jump.m4a' },
  { name: 'Candy',                     file: 'music/Chiptune Music Loops/Three Red Hearts - Candy.m4a' },
  { name: 'Connected',                 file: 'music/Chiptune Music Loops/Three Red Hearts - Connected.m4a' },
  { name: 'Deep Blue',                 file: 'music/Chiptune Music Loops/Three Red Hearts - Deep Blue.m4a' },
  { name: 'Go',                        file: 'music/Chiptune Music Loops/Three Red Hearts - Go.m4a' },
  { name: 'Go (No Vocal)',             file: 'music/Chiptune Music Loops/Three Red Hearts - Go (No Vocal).m4a' },
  { name: 'Modern Bits',               file: 'music/Chiptune Music Loops/Three Red Hearts - Modern Bits.m4a' },
  { name: 'Mountain Climbing',         file: 'music/Mountain Climbing.mp3' },
  { name: 'Out of Time',               file: 'music/Chiptune Music Loops/Three Red Hearts - Out of Time.m4a' },
  { name: 'Penguin Town',              file: 'music/Chiptune Music Loops/Three Red Hearts - Penguin Town.m4a' },
  { name: 'Penguins vs Rabbits',       file: 'music/Chiptune Music Loops/Three Red Hearts - Penguins vs Rabbits.m4a' },
  { name: 'Penultimate',               file: 'music/Chiptune Music Loops/Three Red Hearts - Penultimate.m4a' },
  { name: 'Pixel War 1',               file: 'music/Chiptune Music Loops/Three Red Hearts - Pixel War 1.m4a' },
  { name: 'Pixel War 2',               file: 'music/Chiptune Music Loops/Three Red Hearts - Pixel War 2.m4a' },
  { name: 'Princess Quest',            file: 'music/Chiptune Music Loops/Three Red Hearts - Princess Quest.m4a' },
  { name: 'Princess Quest (No Boing)', file: 'music/Chiptune Music Loops/Three Red Hearts - Princess Quest (No Boing).m4a' },
  { name: 'Puzzle Pieces',             file: 'music/Chiptune Music Loops/Three Red Hearts - Puzzle Pieces.m4a' },
  { name: 'Rabbit Town',               file: 'music/Chiptune Music Loops/Three Red Hearts - Rabbit Town.m4a' },
  { name: 'Rumble at the Gates',       file: 'music/Chiptune Music Loops/Three Red Hearts - Rumble at the Gates.m4a' },
  { name: 'Sanctuary',                 file: 'music/Chiptune Music Loops/Three Red Hearts - Sanctuary.m4a' },
  { name: 'Save the City',             file: 'music/Chiptune Music Loops/Three Red Hearts - Save the City.m4a' },
  { name: 'Three Red Hearts',          file: 'music/Chiptune Music Loops/Three Red Hearts - Three Red Hearts.m4a' },
  /* MUSIC-FILES:END */

  /* ---------------------------------------------------------------------
     Written-out tunes. These need no files at all: the notes below are
     turned into sound in the browser.

     The first two are genuinely from the arcade cabinet. Konami's soundtrack
     was a medley of existing tunes, and these two are out of copyright:
     "Yankee Doodle" (traditional) and "Camptown Races" (Stephen Foster,
     1850). The famous opening jingle is a Japanese children's song, "Inu no
     Omawarisan" (Yoshimi Sato, 1960), and the main theme is the opening of
     the anime Araiguma Rascal. Both are still in copyright, so they are not
     here. The home ports had to swap them out for the same reason.
     --------------------------------------------------------------------- */
  {
    name: 'Yankee Doodle',
    bpm: 138,
    lead: 'c5 c5 d5 e5  c5 e5 d5 -   c5 c5 d5 e5  c5 -  b4 -  ' +
          'c5 c5 d5 e5  f5 e5 d5 c5  b4 g4 a4 b4  c5 -  -  -  ',
    bass: 'c3 -  -  -   g2 -  -  -   c3 -  -  -   g2 -  -  -  ' +
          'c3 -  -  -   f2 -  -  -   g2 -  -  -   c3 -  -  -  ',
    drum: 'x  .  h  .   x  .  h  h  ',
  },
  {
    name: 'Camptown Races',
    bpm: 150,
    lead: 'g5 g5 e5 g5  a5 g5 e5 -   d5 e5 d5 -   -  .  .  .  ' +
          'g5 g5 e5 g5  a5 g5 e5 -   d5 e5 c5 -   -  .  .  .  ' +
          'c6 -  c6 -   a5 -  g5 -   e5 -  g5 -   a5 -  g5 -  ' +
          'g5 g5 e5 g5  a5 g5 e5 -   d5 e5 c5 -   -  -  -  -  ',
    bass: 'c3 -  -  -   c3 -  -  -   g2 -  -  -   g2 -  -  -  ' +
          'c3 -  -  -   c3 -  -  -   g2 -  -  -   c3 -  -  -  ' +
          'c3 -  -  -   f2 -  -  -   c3 -  -  -   g2 -  -  -  ' +
          'c3 -  -  -   c3 -  -  -   g2 -  -  -   c3 -  -  -  ',
    drum: 'x  .  h  .   x  h  h  .  ',
  },
  {
    name: 'Hop To It',
    bpm: 132,
    lead: 'e5 .  g5 .  a5 -  g5 e5  d5 .  e5 .  c5 -  -  .  ' +
          'd5 .  f5 .  g5 -  f5 d5  c5 .  d5 .  a4 -  -  .  ',
    bass: 'a2 -  a3 -  a2 -  a3 -   f2 -  f3 -  f2 -  f3 -  ' +
          'g2 -  g3 -  g2 -  g3 -   a2 -  a3 -  e3 -  e3 -  ',
    drum: 'x  .  h  .  x  .  h  h  ',
  },
  {
    name: 'Rush Hour',
    bpm: 156,
    lead: 'c5 c5 .  d#5 .  g5 .  f5  d#5 .  c5 .  a#4 -  -  .  ' +
          'c5 c5 .  d#5 .  g5 .  a#5 g5  .  f5 .  d#5 -  -  .  ',
    bass: 'c2 -  c2 c2  g#1 -  g#1 -   a#1 -  a#1 a#1  c2 -  c2 -  ' +
          'c2 -  c2 c2  g#1 -  g#1 -   a#1 -  a#1 a#1  g1  -  g1  -  ',
    drum: 'x  .  h  s   x  .  h  .   x  .  h  s    x  h  h  h  ',
  },
  {
    name: 'Lily Pad Lullaby',
    bpm: 104,
    lead: 'g4 -  b4 -  d5 -  b4 -   e5 -  d5 -  b4 -  -  -  ' +
          'a4 -  c5 -  e5 -  c5 -   d5 -  b4 -  g4 -  -  -  ',
    bass: 'g2 -  -  -  d2 -  -  -   e2 -  -  -  b2 -  -  -  ' +
          'a2 -  -  -  e2 -  -  -   d2 -  -  -  g2 -  -  -  ',
    drum: 'x  .  .  h  .  .  h  .  ',
  },
];


/* ==========================================================================
   The player. You should not need to edit anything below here.
   ========================================================================== */

/* Turn a note name into a frequency in Hz. */
const SEMITONES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

function noteFreq(token) {
  const m = /^([a-g])(#|b)?(-?\d)$/.exec(token);
  if (!m) return null;
  let semi = SEMITONES[m[1]];
  if (m[2] === '#') semi += 1;
  if (m[2] === 'b') semi -= 1;
  const midi = (Number(m[3]) + 1) * 12 + semi;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* Turn a pattern string into a list of notes with start beats and lengths, so
   a run of '-' becomes one long note rather than several short ones. */
function compilePattern(pattern) {
  const toks = String(pattern || '').trim().split(/\s+/).filter(Boolean);
  const byBeat = new Map();
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok === '.' || tok === '-') continue;
    let len = 1;
    while (i + len < toks.length && toks[i + len] === '-') len++;
    byBeat.set(i, { tok, len });
  }
  return { byBeat, beats: toks.length || 1 };
}

const Music = {
  enabled: true,
  playing: false,
  index: 0,

  _ctx: null,
  _out: null,
  _noise: null,
  _beat: 0,
  _nextTime: 0,
  _compiled: null,
  _audio: null,          /* the <audio> element, for file tracks */

  /* --- setup ---------------------------------------------------------- */

  _prepare() {
    /* Share the sound effects' AudioContext so one user gesture unlocks both. */
    const ctx = Sound.context();
    if (!ctx) return null;

    if (this._ctx !== ctx) {
      this._ctx = ctx;
      this._out = ctx.createGain();
      this._out.gain.value = 0.22;
      this._out.connect(ctx.destination);

      /* One second of white noise, reused for every drum hit. */
      const frames = Math.floor(ctx.sampleRate);
      const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buf.getChannelData(0);
      let seed = 12345;
      for (let i = 0; i < frames; i++) {
        seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
        data[i] = (seed / 0x3fffffff) - 1;
      }
      this._noise = buf;
    }
    return this._ctx;
  },

  track() {
    return TRACKS[((this.index % TRACKS.length) + TRACKS.length) % TRACKS.length];
  },

  trackName() {
    return TRACKS.length ? this.track().name : '';
  },

  /* --- controls -------------------------------------------------------- */

  start() {
    if (!CONFIG.music || !this.enabled || this.playing || !TRACKS.length) return;

    const t = this.track();

    /* A file track: stream it through an <audio> element. Much simpler than
       decoding it ourselves, and it starts playing before it has finished
       downloading. */
    if (t.file) {
      const el = this._element();
      if (!el) return;
      if (el.src.indexOf(encodeURI(t.file)) === -1) el.src = t.file;
      el.loop = true;
      el.volume = t.volume == null ? 0.5 : t.volume;
      const p = el.play();
      if (p && p.catch) p.catch(() => { /* blocked until a real gesture */ });
      this.playing = true;
      return;
    }

    const ctx = this._prepare();
    if (!ctx) return;

    this._compiled = {
      bpm: t.bpm || 130,
      lead: compilePattern(t.lead),
      bass: compilePattern(t.bass),
      drum: compilePattern(t.drum),
    };
    this._beat = 0;
    this._nextTime = ctx.currentTime + 0.08;
    this.playing = true;
    this.pump();
  },

  stop() {
    this.playing = false;
    if (this._audio) { this._audio.pause(); }
  },

  /* The shared <audio> element for file tracks. */
  _element() {
    if (!this._audio) {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const el = document.createElement('audio');
      if (!el || !el.play) return null;
      el.preload = 'none';
      this._audio = el;
    }
    return this._audio;
  },

  /* Is the current track a file, or notes we generate? */
  isFileTrack() {
    const t = this.track();
    return !!(t && t.file);
  },

  /* R: next track. */
  next() {
    if (!TRACKS.length) return this.trackName();
    this.index = (this.index + 1) % TRACKS.length;
    localStorage.setItem('frogger.track', String(this.index));
    if (this.enabled && CONFIG.music) {
      this.stop();
      this.start();
    }
    return this.trackName();
  },

  /* M: mute or unmute. */
  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem('frogger.music', this.enabled ? '1' : '0');
    if (this.enabled) this.start();
    else this.stop();
    return this.enabled;
  },

  restorePreferences() {
    const saved = localStorage.getItem('frogger.music');
    if (saved !== null) this.enabled = saved === '1';
    const t = Number(localStorage.getItem('frogger.track'));
    if (Number.isFinite(t) && t >= 0) this.index = t % Math.max(1, TRACKS.length);
  },

  /* --- the scheduler ---------------------------------------------------
     Called once per animation frame from the game loop.

     This used to run on a setInterval, which looks reasonable and is what
     most WebAudio tutorials do, but browsers throttle timers hard in a
     background tab: the music would queue a fraction of a second of notes and
     then sit there until you came back. Riding the animation frame means the
     music keeps step with the game and stops when the game does.
     ------------------------------------------------------------------- */

  pump() {
    if (!this.playing || this.isFileTrack()) return;
    const ctx = this._ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();

    const c = this._compiled;
    const beatDur = 60 / c.bpm / 2;        /* patterns are in eighth notes */
    const horizon = ctx.currentTime + 0.25;

    while (this._nextTime < horizon) {
      const t = this._nextTime;
      const b = this._beat;

      const lead = c.lead.byBeat.get(b % c.lead.beats);
      if (lead) this._tone(lead.tok, t, lead.len * beatDur * 0.92, 'square', 0.30);

      const bass = c.bass.byBeat.get(b % c.bass.beats);
      if (bass) this._tone(bass.tok, t, bass.len * beatDur * 0.95, 'triangle', 0.45);

      const drum = c.drum.byBeat.get(b % c.drum.beats);
      if (drum) this._drum(drum.tok, t);

      this._beat++;
      this._nextTime += beatDur;
    }

    /* If the clock has run far ahead of us (a long pause, a hidden tab), do
       not try to catch up by playing hundreds of notes at once. */
    if (this._nextTime < ctx.currentTime - 0.5) {
      this._nextTime = ctx.currentTime + 0.05;
    }
  },

  _tone(token, when, dur, wave, level) {
    const freq = noteFreq(token);
    if (!freq) return;
    const ctx = this._ctx;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, when);

    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(level, when + 0.012);
    amp.gain.setValueAtTime(level, when + dur * 0.6);
    amp.gain.exponentialRampToValueAtTime(0.0005, when + dur);

    osc.connect(amp).connect(this._out);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  },

  _drum(kind, when) {
    const ctx = this._ctx;

    /* x = kick: a sine dropping fast. */
    if (kind === 'x') {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(160, when);
      osc.frequency.exponentialRampToValueAtTime(45, when + 0.11);
      amp.gain.setValueAtTime(0.6, when);
      amp.gain.exponentialRampToValueAtTime(0.001, when + 0.14);
      osc.connect(amp).connect(this._out);
      osc.start(when);
      osc.stop(when + 0.16);
      return;
    }

    /* h = hat, s = snare: both are bursts of noise, filtered differently. */
    const src = ctx.createBufferSource();
    src.buffer = this._noise;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    const amp = ctx.createGain();
    const dur = kind === 'h' ? 0.035 : 0.11;

    filter.type = 'highpass';
    filter.frequency.value = kind === 'h' ? 7000 : 1400;

    amp.gain.setValueAtTime(kind === 'h' ? 0.16 : 0.30, when);
    amp.gain.exponentialRampToValueAtTime(0.001, when + dur);

    src.connect(filter).connect(amp).connect(this._out);
    src.start(when);
    src.stop(when + dur + 0.02);
  },
};


/* ==========================================================================
   WRITING YOUR OWN TUNE
   --------------------------------------------------------------------------
   Copy one of the blocks at the top of the file and change the name, then:

     bpm    how fast. 100 is slow, 170 is frantic.

     lead   the melody. One token per eighth note.
     bass   the low part. Same idea, lower octaves (1, 2 and 3).
     drum   'x' is a kick drum, 'h' a hi-hat, 's' a snare, '.' silence.

   Tokens:
     c4     a note. letter + optional # + octave number.
     -      hold the note before it for one more beat
     .      silence for one beat

   Keep the three lines the same length as each other and it will line up.
   They loop independently, so a 16 beat drum line under a 32 beat melody
   just repeats twice. That is fine and often sounds good.

   A simple thing that always works: pick five notes and only use those.
     c d e g a   (in any octave) sounds cheerful, whatever order you use them.
     a c d e g   sounds a bit spooky.

   Press R in the game to hear the next track, so you can jump straight to
   the one you are working on.

   ADDING AN MP3 INSTEAD

   Drop the file in music/ and add one line. That is the whole thing:

     { name: 'My Tune', file: 'music/my tune.mp3' },

   Add `volume: 0.3` if it comes out louder than the rest.
   ========================================================================== */
