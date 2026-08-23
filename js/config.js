/* ==========================================================================
   FROGGER  ::  config.js
   --------------------------------------------------------------------------
   THIS IS THE FILE TO EDIT.

   Everything you can tune lives here. The engine (js/game.js) reads these
   values and hardcodes nothing, so you can change how the game plays and how
   it looks without touching the engine.

     1. SETTINGS     how the game plays
     2. PROGRESSION  how each level gets harder
     3. LANES        the board, row by row
     4. THEMES       how it all looks

   Save the file, refresh the browser. That's the whole loop.
   ========================================================================== */


/* ==========================================================================
   1. SETTINGS
   ========================================================================== */

const CONFIG = {

  /* Which theme from section 4. 'arcade' is the faithful 1981 pixel look.
     'emoji' is the friendly one. */
  theme: 'arcade',

  grid: 48,          /* pixels per square. everything scales off this. */
  cols: 13,          /* squares across. keep it odd so the frog starts centred. */
  tileGap: 8,        /* visual gap between rows */

  lives: 5,          /* the arcade cabinet was switchable between 3, 5 and 7 */
  timeLimit: 30,     /* seconds to get one frog home */
  hopDuration: 80,   /* ms of hop animation. 0 = instant snap. */

  sound: true,
  touchControls: 'auto',   /* true | false | 'auto' (show on touchscreens) */

  /* Which columns have a lilypad. Five bays across 13 columns. */
  homeCols: [0, 3, 6, 9, 12],

  /* --- The arcade rules. All true is faithful. Turn them off to be kind. --- */
  rules: {
    bankIsDeath: true,       /* landing on the bank between two lilypads kills */
    occupiedBayIsDeath: true,/* jumping into a filled lilypad kills */
    edgeIsDeath: true,       /* riding a log off the side of the screen kills */
    divingTurtles: true,     /* turtle groups that sink */
    gatorMouthIsDeath: true, /* the front of a crocodile kills */
  },

  /* --- Points, straight from the arcade. --- */
  score: {
    forwardHop: 10,          /* per row of new forward progress */
    reachHome: 50,           /* per frog delivered */
    perHalfSecondLeft: 10,   /* time bonus, so 20 a second */
    fly: 200,                /* eating a fly in a lilypad */
    ladyFrog: 200,           /* escorting the lady frog home */
    clearLevel: 1000,        /* all five lilypads filled */
    extraLifeEvery: 20000,   /* a free frog at each multiple */
  },

  /* --- Timings for the moving hazards, in seconds. --- */
  timing: {
    /* A turtle group's dive cycle: up, then tucking in as a warning, then
       under. Only alternate groups dive, so there is always somewhere to
       stand. Lengthen diveUp to be kinder. */
    diveUp: 4.5,
    diveTuck: 1.2,
    diveUnder: 1.6,

    /* How long a fly or a crocodile sits in a lilypad, and the gap between
       one appearing and the next. */
    baySpawnGap: 5.0,
    bayHazardLife: 6.0,

    /* The lady frog rides a log until she is picked up or drifts away. */
    ladySpawnGap: 9.0,

    /* A crocodile in a lilypad is safe while it is still surfacing, exactly
       like the arcade. This is how long that grace period lasts. */
    bayCrocSurfacing: 1.0,
  },
};


/* ==========================================================================
   2. PROGRESSION  ::  how each level gets harder
   --------------------------------------------------------------------------
   The arcade did two things as you went up the levels: it sped everything up,
   and it introduced new KINDS of hazard. Speed alone gets boring and then
   impossible, so the new hazards are what keep it interesting.

   It also eased off slightly every five levels before climbing again, which
   is what stops it feeling like a wall. That is `easeEvery` below.
   ========================================================================== */

const PROGRESSION = {

  speedStep: 0.10,     /* +10% obstacle speed per level */
  easeEvery: 5,        /* every 5 levels, back off a bit before climbing again */
  easeAmount: 0.25,    /* how much of the accumulated speed to give back */

  /* Which level each hazard shows up on. Set any of these to 99 to switch
     that hazard off, or to 1 to have it from the very start. */
  flyFromLevel:      1,   /* bonus fly in a lilypad, worth 200 */
  ladyFromLevel:     2,   /* the lady frog on a log, worth 200 */
  bayCrocFromLevel:  2,   /* a crocodile lurking in a lilypad */
  snakeFromLevel:    3,   /* snakes patrolling the median, per the arcade */
  gatorFromLevel:    3,   /* crocodiles replacing logs in the river */

  /* How many of a river row's logs turn into crocodiles once gators are in
     play. 3 means every third log. */
  gatorEveryNthLog: 3,
};


/* ==========================================================================
   3. LANES  ::  the board, row by row, top to bottom
   --------------------------------------------------------------------------
   This is the arcade layout. Row 0 is the lilypads. The last row is the
   start. In between, five river rows and five road rows either side of the
   median, exactly like the cabinet.

     type     'home'   the five lilypads
              'river'  you DROWN unless you are standing on something
              'road'   anything in this row KILLS you
              'safe'   nothing can hurt you
              'start'  where the frog spawns

     kind     which art to use from the theme in section 4

     length   how many squares long each obstacle is. A turtle group of 3 is
              length 3. A long log is length 6.

     spacing  the gaps between obstacles, in squares, repeating forever.
              [3] is always 3 apart. [3, 8] alternates, which makes convoys
              with a gap you can time your run through.

     speed    pixels per frame. NEGATIVE goes left, POSITIVE goes right.

     dive     'alternate' means every other group sinks, so there is always a
              dry one. 'all' means the whole row sinks, which is unfair and
              was never how the arcade did it.

     bounce   turns round at the edges instead of wrapping (snakes do this)

     fromLevel  this row stays empty until you reach that level

   Add rows, delete rows, reorder them. The board resizes itself.
   ========================================================================== */

const LANES = [

  /* --- The lilypads. Five frogs home clears the level. ------------------- */
  { type: 'home' },

  /* --- The river. Five rows. The top row of logs runs left to right, which
         is why the leftmost lilypad is the hardest to reach. ------------- */
  { type: 'river', kind: 'log',    length: 3, spacing: [3], speed:  0.80, gator: true },
  { type: 'river', kind: 'turtle', length: 3, spacing: [2], speed: -1.00, dive: 'alternate' },
  { type: 'river', kind: 'log',    length: 6, spacing: [3], speed:  1.40, gator: true },
  { type: 'river', kind: 'log',    length: 3, spacing: [3], speed:  0.60, lady: true },
  { type: 'river', kind: 'turtle', length: 2, spacing: [2], speed: -0.90, dive: 'alternate' },

  /* --- The median. Safe until level 3, when the snakes turn up. ---------- */
  { type: 'road',  kind: 'snake',  length: 2, spacing: [9], speed: -0.45,
    bounce: true, fromLevel: PROGRESSION.snakeFromLevel, background: 'median' },

  /* --- The road. Five rows, trucks nearest the median. ------------------- */
  { type: 'road',  kind: 'truck',  length: 2, spacing: [3,8],   speed: -0.70 },
  { type: 'road',  kind: 'racer',  length: 1, spacing: [12],    speed:  1.60 },
  { type: 'road',  kind: 'car',    length: 1, spacing: [3,3,7], speed: -0.90 },
  { type: 'road',  kind: 'dozer',  length: 1, spacing: [3,3,7], speed:  0.60 },
  { type: 'road',  kind: 'taxi',   length: 1, spacing: [4],     speed: -0.80 },

  /* --- The start. ------------------------------------------------------- */
  { type: 'start' },
];


/* ==========================================================================
   4. THEMES  ::  how it all looks
   --------------------------------------------------------------------------
   A theme has a `palette` (the flat background bands) and `art` (one entry
   per `kind` used in LANES, plus the frog and friends).

   An art entry says HOW to draw something. Five kinds of draw:

     { draw: 'pixels', sprite: 'frog' }
         Pixel art, from js/sprites.js. This is what makes the arcade theme
         look like the arcade. Open that file and edit the pictures directly:
         they are grids of letters, one letter per pixel.

     { draw: 'emoji', glyph: '🚗' }
         Any emoji. Change the character, change the game.

     { draw: 'image', src: 'assets/log.png' }
         Your own artwork. See assets/README.md.

     { draw: 'rect', color: '#c55843' }      a plain rectangle
     { draw: 'circle', color: '#de0004' }    a circle per square

   Options any entry can use:

     fit: 'center'   one copy, centred            (default, good for cars)
     fit: 'repeat'   tiled along the length       (good for turtle groups)
     fit: 'stretch'  one copy squashed to fill    (good for a long log PNG)

     faces: 'left'   the art points left, so mirror it when it moves right
     scale: 0.9      shrink or grow it inside its square
     capLeft/capRight  (pixels only) different sprites for the two ends,
                       which is how the logs get rounded ends

   To make a new theme, copy a block, rename it, and set CONFIG.theme.
   ========================================================================== */

const THEMES = {

  /* ------------------------------------------------------------------------
     ARCADE  ::  the 1981 cabinet. Pixel art from js/sprites.js.
     ---------------------------------------------------------------------- */
  arcade: {
    palette: {
      water:    '#000098',   /* the cabinet's deep blue river */
      road:     '#000000',   /* the road was pure black */
      grass:    '#00a800',
      median:   '#8000c0',   /* that unmistakable purple median */
      bankLine: '#00d800',
      bayInner: '#000048',
      hudBg:    '#000000',
      text:     '#ffffff',
      textDim:  '#00d8d8',
      accent:   '#ffd800',
      timeBar:  '#00d800',
      timeLow:  '#f83800',
    },
    art: {
      frog:    { draw: 'pixels', sprite: 'frog' },
      lady:    { draw: 'pixels', sprite: 'lady' },
      scored:  { draw: 'pixels', sprite: 'frogHome', scale: 0.8 },
      life:    { draw: 'pixels', sprite: 'frogHome', scale: 1.0 },
      home:    { draw: 'pixels', sprite: 'lilypad' },
      fly:     { draw: 'pixels', sprite: 'fly' },
      bayCroc: { draw: 'pixels', sprite: 'bayCroc' },
      splat:   { draw: 'pixels', sprite: 'splat' },

      log:     { draw: 'pixels', sprite: 'logMid', fit: 'repeat',
                 capLeft: 'logLeft', capRight: 'logRight' },
      gator:   { draw: 'pixels', sprite: 'gatorBody', fit: 'repeat',
                 capLeft: 'gatorTail', capRight: 'gatorHead', faces: 'right' },
      turtle:  { draw: 'pixels', sprite: 'turtle', fit: 'repeat', faces: 'left' },
      snake:   { draw: 'pixels', sprite: 'snakeBody', fit: 'repeat',
                 capLeft: 'snakeHead', capRight: 'snakeTail', faces: 'left' },

      truck:   { draw: 'pixels', sprite: 'truckBack', fit: 'repeat',
                 capRight: 'truckCab', faces: 'right' },
      racer:   { draw: 'pixels', sprite: 'racer', faces: 'right' },
      car:     { draw: 'pixels', sprite: 'car',   faces: 'right' },
      dozer:   { draw: 'pixels', sprite: 'dozer', faces: 'right' },
      taxi:    { draw: 'pixels', sprite: 'taxi',  faces: 'right' },
    },
  },

  /* ------------------------------------------------------------------------
     EMOJI  ::  same game, friendlier faces. Swap any glyph.
     ---------------------------------------------------------------------- */
  emoji: {
    palette: {
      water:    '#123f6d',
      road:     '#2b2b33',
      grass:    '#2f9e44',
      median:   '#6741d9',
      bankLine: '#51cf66',
      bayInner: '#0d2b4a',
      hudBg:    '#12121a',
      text:     '#ffffff',
      textDim:  '#b9bfca',
      accent:   '#ffd43b',
      timeBar:  '#51cf66',
      timeLow:  '#ff6b6b',
    },
    art: {
      frog:    { draw: 'emoji', glyph: '🐸', scale: 0.92 },
      lady:    { draw: 'emoji', glyph: '💗', scale: 0.85 },
      scored:  { draw: 'emoji', glyph: '🐸', scale: 0.7 },
      life:    { draw: 'emoji', glyph: '🐸', scale: 0.7 },
      home:    { draw: 'emoji', glyph: '🪷', scale: 0.8 },
      fly:     { draw: 'emoji', glyph: '🪰', scale: 0.7 },
      bayCroc: { draw: 'emoji', glyph: '🐊', scale: 0.8 },
      splat:   { draw: 'emoji', glyph: '💥' },

      log:     { draw: 'emoji', glyph: '🪵', fit: 'repeat' },
      gator:   { draw: 'emoji', glyph: '🐊', fit: 'repeat', faces: 'left' },
      turtle:  { draw: 'emoji', glyph: '🐢', fit: 'repeat', faces: 'left' },
      snake:   { draw: 'emoji', glyph: '🐍', fit: 'repeat', faces: 'left' },

      truck:   { draw: 'emoji', glyph: '🚚', fit: 'repeat', faces: 'left' },
      racer:   { draw: 'emoji', glyph: '🏎️', faces: 'left' },
      car:     { draw: 'emoji', glyph: '🚗', faces: 'left' },
      dozer:   { draw: 'emoji', glyph: '🚜', faces: 'left' },
      taxi:    { draw: 'emoji', glyph: '🚕', faces: 'left' },
    },
  },
};
