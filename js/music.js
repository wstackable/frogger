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

   Tracks stream through a single <audio> element, which is deliberately dull:
   it starts playing before the file has finished downloading, it loops
   seamlessly on its own, and it costs nothing when nobody is listening.
   ========================================================================== */

const Music = {
  enabled: true,
  playing: false,
  index: 0,

  _audio: null,
  _returnTo: null,      /* where to go back to after the bonus round */
  _forced: null,

  /* --- what is on -------------------------------------------------------- */

  track() {
    if (!TRACKS.length) return null;
    return TRACKS[((this.index % TRACKS.length) + TRACKS.length) % TRACKS.length];
  },

  trackName() {
    const t = this.track();
    return t ? t.name : '';
  },

  /* The one <audio> element every track goes through. */
  _element() {
    if (!this._audio) {
      if (typeof document === 'undefined' || !document.createElement) return null;
      const el = document.createElement('audio');
      if (!el || !el.play) return null;
      el.preload = 'none';
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

    if (String(el.src).indexOf(encodeURI(t.file)) === -1) el.src = t.file;
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

  /* R: next track. */
  next() {
    if (!TRACKS.length) return '';
    this.index = (this.index + 1) % TRACKS.length;
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

  restorePreferences() {
    const saved = localStorage.getItem('frogger.music');
    if (saved !== null) this.enabled = saved === '1';
    const t = Number(localStorage.getItem('frogger.track'));
    if (Number.isFinite(t) && t >= 0 && TRACKS.length) {
      this.index = t % TRACKS.length;
    }
  },
};
