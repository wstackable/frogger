/* ==========================================================================
   FROGGER  ::  config.js
   --------------------------------------------------------------------------
   THIS IS THE FILE TO EDIT.

   Everything you can tune lives here. The game engine (js/game.js) reads
   these values and never hardcodes them, so you can change how the game
   plays and how it looks without touching the engine at all.

   Three sections:
     1. SETTINGS  - how the game plays (lives, speed, timer, scoring)
     2. LANES     - the layout of the board, row by row
     3. THEMES    - how everything looks (this is where the art lives)

   Save the file, refresh the browser. That's the whole loop.
   ========================================================================== */


/* ==========================================================================
   1. SETTINGS  ::  how the game plays
   ========================================================================== */

const CONFIG = {

  /* Which theme from section 3 to use. Try 'retro' for the 1981 arcade look. */
  theme: 'emoji',

  /* Size of one square on the board, in pixels. Everything scales off this. */
  grid: 48,

  /* How many squares wide the board is. Must be an odd number so the frog
     can start in the exact middle. */
  cols: 13,

  /* Visual gap between rows, in pixels. Makes the lanes read as separate. */
  tileGap: 10,

  /* How many frogs you get. */
  lives: 5,

  /* Seconds to get one frog home before it runs out of time. */
  timeLimit: 30,

  /* Milliseconds the hop animation takes. 0 = instant snap (very arcade).
     90 feels smooth. Above ~150 starts to feel laggy. */
  hopDuration: 90,

  /* How much faster everything moves each time you clear a level.
     0.12 = 12% faster per level. Set to 0 for no difficulty ramp. */
  speedRampPerLevel: 0.12,

  /* Beeps and boops, generated in code (no sound files needed). */
  sound: true,

  /* On-screen arrow buttons. true, false, or 'auto' (show on touchscreens). */
  touchControls: 'auto',

  /* Which columns have a home bay at the top. Default is 5 bays, evenly
     spaced across 13 columns. */
  homeCols: [0, 3, 6, 9, 12],

  /* --- Difficulty knobs. Turn these on to get closer to the real arcade. --- */
  difficulty: {
    /* In the arcade, jumping into the bank BETWEEN two home bays kills you.
       false is kinder for younger kids: you just stand there harmlessly. */
    hitBankIsDeath: false,

    /* Turtles that periodically dive underwater. They blink first as a
       warning. Set false if the kids find them too mean. */
    divingTurtles: true,

    /* Seconds in each phase of a turtle's dive cycle. */
    diveUp: 4.0,
    diveBlink: 1.5,
    diveDown: 1.5,
  },

  /* --- Points. --- */
  score: {
    forwardHop: 10,        /* per row of NEW forward progress */
    reachHome: 50,         /* getting one frog into a bay */
    perSecondLeft: 20,     /* bonus per whole second left on the timer */
    clearLevel: 1000,      /* filling all the bays */
    extraLifeEvery: 5000,  /* free frog at each multiple of this */
  },
};


/* ==========================================================================
   2. LANES  ::  the board, row by row, top to bottom
   --------------------------------------------------------------------------
   Row 0 is the top (the home bays). The last row is where the frog starts.

   Each lane is one object:

     type      'home'  the goal bays at the top
               'river' you DROWN here unless you are riding something
               'road'  you get SQUASHED here if something hits you
               'safe'  nothing spawns, nothing can hurt you

     kind      which art to use from the theme (section 3). Any name you like,
               as long as the theme has a matching entry.

     length    how many grid squares long each obstacle is (4 = a long log)

     spacing   the gap pattern between obstacles, in grid squares, repeated
               forever. [3] means "always 3 squares apart". [3, 8] means
               "3 apart, then 8 apart, then 3, then 8..." which is how you
               make convoys with big gaps to sneak through.
               A 0 means touching, so [0,0,1] makes groups of three.

     speed     pixels per frame. NEGATIVE moves left, POSITIVE moves right.
               Around 0.5 is slow, 1.5 is quite fast.

     diving    (turtles only) this group submerges now and then

   Add a row, delete a row, reorder them. The engine adapts and the canvas
   resizes itself to fit however many rows you leave here.
   ========================================================================== */

const LANES = [

  /* --- The goal. Get five frogs into the five bays to clear the level. --- */
  { type: 'home' },

  /* --- The river. Ride the logs and turtles or you drown. ---------------- */
  { type: 'river', kind: 'log',    length: 4, spacing: [2],                speed:  0.75 },
  { type: 'river', kind: 'turtle', length: 1, spacing: [0,2,0,2,0,2,0,4],  speed: -1.00, diving: true },
  { type: 'river', kind: 'log',    length: 7, spacing: [2],                speed:  1.50 },
  { type: 'river', kind: 'log',    length: 3, spacing: [3],                speed:  0.50 },
  { type: 'river', kind: 'turtle', length: 1, spacing: [0,0,1],            speed: -1.00, diving: true },

  /* --- The median. Catch your breath. ----------------------------------- */
  { type: 'safe' },

  /* --- The road. Five lanes of traffic. --------------------------------- */
  { type: 'road',  kind: 'truck',  length: 2, spacing: [3,8],              speed: -1.00 },
  { type: 'road',  kind: 'racer',  length: 1, spacing: [14],               speed:  0.75 },
  { type: 'road',  kind: 'car',    length: 1, spacing: [3,3,7],            speed: -0.75 },
  { type: 'road',  kind: 'dozer',  length: 1, spacing: [3,3,7],            speed:  0.50 },
  { type: 'road',  kind: 'taxi',   length: 1, spacing: [4],                speed: -0.50 },

  /* --- The start. --------------------------------------------------------*/
  { type: 'start' },
];


/* ==========================================================================
   3. THEMES  ::  how it all looks
   --------------------------------------------------------------------------
   This is the fun part. A theme has two halves:

     palette   the flat background colours (water, road, grass...)
     art       one entry per 'kind' used in LANES above, plus the frog

   An art entry says HOW to draw something. There are four kinds of draw:

     { draw: 'rect',   color: '#c55843' }
         A plain filled rectangle. Simplest thing there is.

     { draw: 'circle', color: '#de0004' }
         A filled circle per grid square. A length-3 obstacle becomes three
         circles in a row, which is how the arcade drew turtles.

     { draw: 'emoji',  glyph: '🚗' }
         Any emoji, drawn as text. Change the character, change the game.
         Paste any emoji you like straight in between the quotes.

     { draw: 'image',  src: 'assets/log.png' }
         Your own artwork. Draw something, save it as a PNG in the assets/
         folder, and point src at it. See assets/README.md.

   Extra options any entry can use:

     fit: 'center'   draw one copy, centred    (default, good for cars)
     fit: 'repeat'   tile it across the length (good for logs: 🪵🪵🪵🪵)
     fit: 'stretch'  squash one copy to fill   (good for a custom log PNG)

     faces: 'left'   this art points left, so mirror it when it moves right.
     faces: 'right'  the opposite. Leave it out if the art is symmetrical.

     scale: 0.9      shrink or grow it inside its square (1 = fill the square)

     frames: 4       for images only: your PNG is a strip of 4 frames laid
     fps: 8          out left to right, played as an animation at 8 fps.

   To make a whole new theme, copy one of these blocks, give it a new name,
   and set CONFIG.theme to that name at the top of this file.
   ========================================================================== */

const THEMES = {

  /* ------------------------------------------------------------------------
     RETRO  ::  faithful to the 1981 arcade cabinet. Rectangles and circles.
     ---------------------------------------------------------------------- */
  retro: {
    palette: {
      water:    '#000047',
      road:     '#000000',
      grass:    '#1ac300',
      median:   '#8500da',
      bankLine: '#1ac300',
      hudBg:    '#000000',
      text:     '#ffffff',
      textDim:  '#b9bfca',
      timeBar:  '#0bcb00',
      timeLow:  '#de0004',
    },
    art: {
      frog:   { draw: 'circle', color: 'greenyellow' },
      scored: { draw: 'circle', color: '#0bcb00' },
      life:   { draw: 'circle', color: 'greenyellow' },
      home:   { draw: 'rect',   color: '#00701f' },

      log:    { draw: 'rect',   color: '#c55843' },
      turtle: { draw: 'circle', color: '#de0004' },

      truck:  { draw: 'rect',   color: '#c2c4da' },
      racer:  { draw: 'rect',   color: '#c2c4da' },
      car:    { draw: 'rect',   color: '#de3cdd' },
      dozer:  { draw: 'rect',   color: '#0bcb00' },
      taxi:   { draw: 'rect',   color: '#e5e401' },

      splat:  { draw: 'circle', color: '#ffffff' },
    },
  },

  /* ------------------------------------------------------------------------
     EMOJI  ::  same game, friendlier faces. Swap any glyph below.
     ---------------------------------------------------------------------- */
  emoji: {
    palette: {
      water:    '#123f6d',
      road:     '#2b2b33',
      grass:    '#2f9e44',
      median:   '#6741d9',
      bankLine: '#51cf66',
      hudBg:    '#12121a',
      text:     '#ffffff',
      textDim:  '#b9bfca',
      timeBar:  '#51cf66',
      timeLow:  '#ff6b6b',
    },
    art: {
      frog:   { draw: 'emoji', glyph: '🐸', scale: 0.92 },
      scored: { draw: 'emoji', glyph: '🐸', scale: 0.7  },
      life:   { draw: 'emoji', glyph: '🐸', scale: 0.7  },
      home:   { draw: 'emoji', glyph: '🏠', scale: 0.75 },

      log:    { draw: 'emoji', glyph: '🪵', fit: 'repeat' },
      turtle: { draw: 'emoji', glyph: '🐢', faces: 'left' },

      truck:  { draw: 'emoji', glyph: '🚚', faces: 'left', fit: 'repeat' },
      racer:  { draw: 'emoji', glyph: '🏎️', faces: 'left' },
      car:    { draw: 'emoji', glyph: '🚗', faces: 'left' },
      dozer:  { draw: 'emoji', glyph: '🚜', faces: 'left' },
      taxi:   { draw: 'emoji', glyph: '🚕', faces: 'left' },

      splat:  { draw: 'emoji', glyph: '💥' },
    },
  },
};
