/* ==========================================================================
   FROGGER  ::  music.js
   --------------------------------------------------------------------------
   THE RADIO. It plays the audio files sitting in the music/ folder, and
   nothing else.

     R   next track
     M   mute

   The list below is generated. To change what is in it, put files into
   music/ and run:

       deno task music

   Only the top level of music/ is scanned, so you can park a whole pack in
   music/something/ and pick tracks out of it by moving them up a level.

   Use .m4a or .mp3. Safari and iOS cannot play .ogg at all, so an ogg track
   is silence on an iPad. The scanner warns you if it finds any, and this will
   convert one:

       ffmpeg -i "track.ogg" -c:a aac -b:a 128k "track.m4a"
   ========================================================================== */

const TRACKS = [

  /* MUSIC-FILES:START -- rebuilt by `deno task music`, do not hand-edit */
  { name: 'Archer Speedrun',    file: 'music/Archer Speedrun.mp3' },
  { name: 'Boneyard',           file: 'music/boneyard.mp3' },
  { name: 'Box Jumping',        file: 'music/Box Jumping.m4a' },
  { name: 'Chiptune Party',     file: 'music/Chiptune Party.mp3' },
  { name: 'Laser Knights',      file: 'music/Laser Knights.mp3' },
  { name: 'Mountain Climbing',  file: 'music/Mountain Climbing.mp3' },
  { name: 'Ninja Boogie',       file: 'music/Ninja Boogie.mp3' },
  { name: 'Speedboat Boss Run', file: 'music/Speedboat Boss Run.mp3' },
  /* MUSIC-FILES:END */

];


/* ==========================================================================
   The player.

   Tracks go through a single <audio> element, and the important part is what
   happens BEFORE that: each file is fetched into memory first and played from
   a blob URL.

   Why bother? Because browsers will not let a page play audio until the user
   has interacted with it, but fetch() is not held back that way. So while the
   player is still reading the title screen we can quietly pull the opening
   track down, and when they finally press a key it starts instantly instead of
   sitting there buffering. The rest of the tracks are fetched afterwards, in
   the background, one at a time so they do not fight for bandwidth.

   Lifted from Phoenix 89, which had already worked this out.
   ========================================================================== */

const Music = {
  enabled: true,
  playing: false,
  index: 0,

  _audio: null,
  _returnTo: null,      /* where to go back to after a level borrows the radio */
  _forced: null,
  _rotation: null,      /* the shuffled running order, reserved tracks left out */
  _blobs: {},           /* file path -> blob URL, once fetched */
  _fetching: {},        /* file path -> the in-flight promise */
  _warmed: false,

  /* --- the running order ------------------------------------------------- */

  /* Tracks that belong to a particular level, environment or level kind. These
     are kept out of the shuffle so that hearing one means something. Worked
     out from the config rather than listed by hand, so adding `music:` to a
     level is all it takes. */
  reservedNames() {
    const names = new Set();
    const add = (n) => { if (n) names.add(n); };

    if (typeof MUSIC !== 'undefined' && MUSIC.forKind) {
      Object.values(MUSIC.forKind).forEach(add);
    }
    if (typeof LEVELS !== 'undefined') LEVELS.forEach((l) => add(l.music));
    if (typeof ENVIRONMENTS !== 'undefined') {
      Object.values(ENVIRONMENTS).forEach((e) => add(e.music));
    }
    return names;
  },

  /* Which track a given level should play, or null to leave the radio be. */
  trackForLevel(plan) {
    if (!plan) return null;
    if (plan.music) return plan.music;
    const env = typeof ENVIRONMENTS !== 'undefined' && ENVIRONMENTS[plan.env];
    if (env && env.music) return env.music;
    const byKind = typeof MUSIC !== 'undefined' && MUSIC.forKind;
    if (byKind && byKind[plan.kind]) return byKind[plan.kind];
    return null;
  },

  rotation() {
    if (this._rotation) return this._rotation;

    const reserved = this.reservedNames();
    let pool = TRACKS.map((t, i) => i).filter((i) => !reserved.has(TRACKS[i].name));

    /* If every single track is spoken for, fall back to all of them rather
       than leaving the radio with nothing to play. */
    if (!pool.length) pool = TRACKS.map((t, i) => i);

    if (typeof MUSIC !== 'undefined' && MUSIC.shuffle) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }

    /* Whatever we are told to open with goes to the front. */
    const first = typeof MUSIC !== 'undefined' ? MUSIC.startWith : null;
    if (first) {
      const at = pool.findIndex((i) => TRACKS[i].name === first);
      if (at > 0) pool.unshift(pool.splice(at, 1)[0]);
    }

    this._rotation = pool;
    return pool;
  },

  /* Where in the running order the current track sits, or -1 if we are on a
     reserved one (during a boss level, say). */
  rotationSlot() {
    return this.rotation().indexOf(this.index);
  },

  /* --- what is on -------------------------------------------------------- */

  track() {
    if (!TRACKS.length) return null;
    return TRACKS[((this.index % TRACKS.length) + TRACKS.length) % TRACKS.length];
  },

  trackName() {
    const t = this.track();
    return t ? t.name : '';
  },

  /* --- getting the bytes here before they are needed ------------------- */

  /* Pull a file into memory and hand back a blob URL for it. Safe to call as
     often as you like: the second call gets the same promise. */
  fetchTrack(file) {
    if (!file) return Promise.resolve(null);
    if (this._blobs[file]) return Promise.resolve(this._blobs[file]);
    if (this._fetching[file]) return this._fetching[file];

    if (typeof fetch !== 'function' || typeof URL === 'undefined' ||
        !URL.createObjectURL) {
      return Promise.resolve(null);
    }

    const p = fetch(file)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        this._blobs[file] = url;
        return url;
      })
      .catch(() => null)          /* offline, or opened straight off the disk */
      .finally(() => { delete this._fetching[file]; });

    this._fetching[file] = p;
    return p;
  },

  /* Called as soon as the page loads. Fetches whatever we are about to play,
     then trickles the rest down behind it. */
  warmUp() {
    if (this._warmed || !TRACKS.length) return;
    this._warmed = true;

    const first = this.track();
    const rest = TRACKS.filter((t) => t !== first).map((t) => t.file);

    this.fetchTrack(first && first.file).then(() => {
      /* If the radio is already meant to be playing, swap the streaming
         source for the in-memory one now that we have it. */
      if (this.playing) { this.stop(); this.start(); }
      /* One at a time, so the opening track never has to share. */
      return rest.reduce(
        (chain, file) => chain.then(() => this.fetchTrack(file)),
        Promise.resolve()
      );
    });
  },

  /* Where to actually play a track from: memory if we have it, the network
     if we do not. */
  sourceFor(track) {
    if (!track || !track.file) return null;
    return this._blobs[track.file] || track.file;
  },

  /* The one <audio> element every track goes through. */
  _element() {
    if (!this._audio) {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const el = document.createElement('audio');
      if (!el || !el.play) return null;
      /* 'auto' rather than 'none': if the blob is not ready yet we would
         rather the browser got on with buffering than waited to be asked. */
      el.preload = 'auto';
      if (el.addEventListener) {
        el.addEventListener('error', () => {
          console.warn(
            `[frogger] Could not play "${el.src}". Check the file is in music/ ` +
            `and is not a .ogg, which Safari cannot play, then run ` +
            `\`deno task music\` to rebuild the list.`
          );
        });
      }
      this._audio = el;
    }
    return this._audio;
  },

  /* --- controls ---------------------------------------------------------- */

  start() {
    if (!CONFIG.music || !this.enabled || this.playing) return;

    const t = this.track();
    if (!t || !t.file) return;

    const el = this._element();
    if (!el) return;

    const src = this.sourceFor(t);
    if (el.src !== src) el.src = src;
    el.loop = true;
    el.volume = t.volume == null ? 0.5 : t.volume;

    const p = el.play();
    if (p && p.catch) p.catch(() => { /* blocked until a real gesture */ });
    this.playing = true;
  },

  stop() {
    this.playing = false;
    if (this._audio && this._audio.pause) this._audio.pause();
  },

  /* R: next track in the running order, skipping anything reserved. */
  next() {
    if (!TRACKS.length) return '';
    const order = this.rotation();
    if (!order.length) return this.trackName();

    const at = order.indexOf(this.index);
    this.index = order[(at + 1) % order.length];

    localStorage.setItem('frogger.track', String(this.index));
    if (this.enabled && CONFIG.music) { this.stop(); this.start(); }
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

  /* Jump to a track by name and remember where we were, so the bonus round
     can borrow the radio and hand it back. Deliberately does not save to
     localStorage: this is a detour, not the player's choice. */
  playNamed(name) {
    const i = TRACKS.findIndex((t) => t.name === name);
    if (i < 0) {
      console.warn(`[frogger] No track called "${name}".`);
      return false;
    }
    if (this._returnTo === null) this._returnTo = this.index;
    this._forced = i;
    this.index = i;
    if (this.enabled && CONFIG.music) { this.stop(); this.start(); }
    return true;
  },

  restorePrevious() {
    if (this._returnTo === null) return;
    const back = this._returnTo;
    const forced = this._forced;
    this._returnTo = null;
    this._forced = null;

    /* If the player hit R during the rampage, that was a real choice. Leave
       it alone rather than yanking them back. */
    if (forced !== null && this.index !== forced) return;

    this.index = back;
    if (this.enabled && CONFIG.music) { this.stop(); this.start(); }
  },

  /* Make sure a track we are about to need is already in memory. */
  prefetch(name) {
    const t = TRACKS.find((x) => x.name === name);
    if (t) this.fetchTrack(t.file);
  },

  restorePreferences() {
    const saved = localStorage.getItem('frogger.music');
    if (saved !== null) this.enabled = saved === '1';

    /* Open on the configured track. A remembered choice wins, but only if it
       is still something the shuffle is allowed to play. */
    const order = this.rotation();
    this.index = order.length ? order[0] : 0;

    /* Careful: Number(null) is 0, so a missing preference used to read as
       "the player chose track 0" and quietly overrode MUSIC.startWith for
       everyone who had never touched the radio. */
    const raw = localStorage.getItem('frogger.track');
    if (raw !== null && raw !== '') {
      const t = Number(raw);
      if (Number.isFinite(t) && t >= 0 && t < TRACKS.length && order.includes(t)) {
        this.index = t;
      }
    }
  },
};
