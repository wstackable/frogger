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

  sound: true,             /* the beeps and boops */
  music: true,             /* the chiptune radio. R changes track, M mutes. */
  touchControls: 'auto',   /* true | false | 'auto' (show on touchscreens) */

  /* Which columns have a lilypad. Five bays across 13 columns. */
  homeCols: [0, 3, 6, 9, 12],

  /* How many lilypads you have to fill to finish a level. The arcade wanted
     all five. One keeps things moving, which is a lot more fun when you are
     playing in short bursts. Set it to homeCols.length for the arcade rule. */
  baysToClear: 1,

  /* Which mode to start on. See MODES below. */
  startMode: 'beginner',

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
   1b. MODES  ::  beginner and expert
   --------------------------------------------------------------------------
   Pick one on the title screen with the LEFT and RIGHT arrows. Anything a
   mode does not mention falls back to the settings above.

   The interesting difference is how you get lives. Beginner hands them all
   back every time you finish a level, so a bad patch never ends the run.
   Expert never does, but the bonus fly is worth a whole life, and it only
   turns up now and again, so spotting one is a genuine event.
   ========================================================================== */

const MODES = {

  beginner: {
    label: 'BEGINNER',
    blurb: 'lives refill every level',
    lives: 5,
    refillLivesOnLevel: true,    /* full tank at the start of each level */
    flyGivesLife: false,         /* the fly is just points here */
    baySpawnGap: 5,              /* so flies and lilypad crocs are common */
    speedScale: 0.92,            /* everything a touch slower than the plan says */
    rules: {
      /* The two deaths that feel unfair before you know they exist. */
      bankIsDeath: false,
      occupiedBayIsDeath: false,
    },
  },

  expert: {
    label: 'EXPERT',
    blurb: 'no refills, but a fly is worth a life',
    lives: 3,
    refillLivesOnLevel: false,
    flyGivesLife: true,          /* catch one and you get a frog back */
    baySpawnGap: 17,             /* rare, so it matters when you see one */
    speedScale: 1.10,            /* everything a touch faster than the plan says */
    rules: {
      bankIsDeath: true,
      occupiedBayIsDeath: true,
    },
  },
};


/* ==========================================================================
   1c. BONUS ROUND  ::  monster truck rampage
   --------------------------------------------------------------------------
   Every so often, instead of a normal level, the frog gets into a monster
   truck. No lives, no drowning, no rules: just drive around flattening
   traffic and ramming boats for as long as the clock lasts.
   ========================================================================== */

const BONUS = {
  firstLevel: 3,        /* the first one happens on the way to level 3 */
  everyLevels: 4,       /* and then every 4 levels after that */

  duration: 22,         /* seconds of rampage */
  introTime: 3.2,       /* the "BONUS ROUND" screen */
  resultsTime: 4.0,     /* the tally afterwards */

  speed: 250,           /* how fast the truck drives, pixels a second */

  /* The radio switches to this for the rampage, then goes back to whatever
     was playing before. Must match a name in js/music.js. */
  music: 'Box Jumping',

  /* What each thing is worth when you flatten it. */
  points: { car: 100, truck: 250, boat: 150 },

  /* Smash things within this many seconds of each other and the multiplier
     climbs. It is the multiplier that makes it exciting. */
  comboWindow: 1.6,
  comboMax: 10,

  /* How long a flattened thing stays gone before it comes back for more. */
  respawnDelay: 1.4,

  /* --- hitting the water ---
     Driving into the river should be the best moment in the rampage, not a
     change of background. The truck drops a propeller, throws a bow wave, and
     the engine note swaps to the speedboat, so it sounds like a different
     machine because for a moment it is one. */
  waterSpeed: 1.22,   /* it is quicker on the water than on the road */
  wakeEvery: 0.035,   /* seconds between blobs of wake thrown off the back */
  bowWave: 0.9,       /* how big the wave off the nose is, in truck widths */
};




/* ==========================================================================
   1d. LEVELS  ::  the run, level by level
   --------------------------------------------------------------------------
   THIS is what makes the game get harder, and change shape while it does.

   Every level, including the bonus and boss ones, is one line here. The level
   selector on the title screen is just this list with names on it.

     name      what it is called on the title screen
     kind      what sort of level it is:
                 'cross'  the normal Frogger crossing
                 'truck'  monster truck rampage
                 'rocket' line up and launch
                 'heli'   helicopter with a machine gun
                 'boat'   speedboat boss run
     env       which environment from ENVIRONMENTS below

   Only 'cross' levels use the rest:

     speed     multiplier on every obstacle. 0.65 is a stroll, 1.6 is nasty.
     roadLanes how many lanes of traffic are switched on, counting up from the
               start line. The rest of the road is empty, which is harmless.
     river     how generous the water is: 'wide', 'easy', 'normal', 'tight'.
               An empty RIVER row would drown you, so the river gets easier by
               having longer logs and smaller gaps, never by being empty.
     hazards   which extras exist: 'fly', 'lady', 'bayCroc', 'snake', 'gator',
               'diving'
     rules     one-off twists: { ice: true }, { dark: true }, { ghost: true }

   Add a level, delete one, reorder them. Run out of levels and the last few
   repeat with the speed still climbing.
   ========================================================================== */

const LEVELS = [
  { name: 'First Hop',
    blurb: 'two lanes, fat logs, nothing bites. a free win.',        kind: 'cross',  env: 'pond',
    speed: 0.62, roadLanes: 2, river: 'wide',   hazards: [] },

  { name: 'Getting Busy',
    blurb: 'a third lane opens up, and a fly worth catching.',     kind: 'cross',  env: 'dusk',
    speed: 0.74, roadLanes: 3, river: 'wide',   hazards: ['fly'] },

  { name: 'Monster Truck Rampage',
    blurb: 'no rules. drive around flattening everything.', kind: 'truck', env: 'city' },

  { name: 'Turtle Trouble',
    blurb: 'the turtles start diving. hop off before they sink.',   kind: 'cross',  env: 'jungle',
    speed: 0.86, roadLanes: 4, river: 'easy',   hazards: ['fly', 'diving'] },

  { name: 'Rocket Ride',
    blurb: 'straight up through the traffic. dodge, grab stars, land.',      kind: 'rocket', env: 'space' },

  { name: 'Slippery Bank',
    blurb: 'you cannot stop. steer the slide and hope.',    kind: 'cross',  env: 'arctic',
    speed: 0.90, roadLanes: 4, river: 'easy',   hazards: ['fly', 'diving'],
    rules: { ice: true } },

  { name: 'Night Crossing',
    blurb: 'lights out. all you get is headlights and your own lamp.',   kind: 'cross',  env: 'city',
    speed: 1.00, roadLanes: 5, river: 'normal', hazards: ['fly', 'lady', 'diving'],
    rules: { dark: true } },

  { name: 'Chopper Support',
    blurb: 'clear the road, and mind the aliens. they shoot back.',  kind: 'heli',   env: 'desert' },

  { name: 'Snake Pit',
    blurb: 'snakes on the median. the safe row is not safe.',        kind: 'cross',  env: 'jungle',
    speed: 1.08, roadLanes: 5, river: 'normal',
    hazards: ['fly', 'lady', 'bayCroc', 'snake', 'diving'] },

  { name: 'The Boneyard',
    blurb: 'the world only moves when you do. stand still and they come.',     kind: 'cross',  env: 'boneyard',
    speed: 1.05, roadLanes: 5, river: 'normal', hazards: ['fly', 'diving'],
    rules: { ghost: true } },

  { name: 'Croc Alley',
    blurb: 'half the logs are crocodiles. ride the back, not the jaws.',       kind: 'cross',  env: 'desert',
    speed: 1.16, roadLanes: 5, river: 'normal',
    hazards: ['fly', 'lady', 'bayCroc', 'snake', 'gator', 'diving'] },

  { name: 'Rampage II',
    blurb: 'the truck is back, and everything is quicker.',       kind: 'truck',  env: 'dusk' },

  { name: 'Deep Freeze',
    blurb: 'ice, crocodiles and snakes, all at once.',      kind: 'cross',  env: 'arctic',
    speed: 1.26, roadLanes: 5, river: 'tight',
    hazards: ['fly', 'bayCroc', 'snake', 'gator', 'diving'],
    /* The snakes patrol here rather than hunt. Ice already says "you cannot
       stop", and the median is the one place it lets you. A snake that
       punishes standing on the median takes the level's only breath away. */
    rules: { ice: true, snakesHunt: false } },

  { name: 'Orbital Traffic',
    blurb: 'no air. grab the pockets or you do not make it across.',  kind: 'cross',  env: 'space',
    speed: 1.34, roadLanes: 5, river: 'tight',
    hazards: ['fly', 'lady', 'bayCroc', 'snake', 'gator', 'diving'],
    rules: { airless: true } },

  { name: 'Blackout',
    blurb: 'dark, and everything is fast. good luck.',         kind: 'cross',  env: 'boneyard',
    speed: 1.40, roadLanes: 5, river: 'tight',
    hazards: ['fly', 'lady', 'bayCroc', 'snake', 'gator', 'diving'],
    rules: { dark: true } },

  { name: 'Rocket Ride II',
    blurb: 'same rocket, angrier sky.',   kind: 'rocket', env: 'space' },

  { name: 'Speedboat Boss Run',
    blurb: 'first person. flat out down the river.', kind: 'boat', env: 'city' },
];

/* ==========================================================================
   1f. MUSIC  ::  which track plays when
   --------------------------------------------------------------------------
   Tracks fall into two groups, and you never have to maintain the list of
   which is which: any track named by a level, an environment or a level KIND
   is automatically reserved, meaning R will not shuffle into it. It only plays
   on the level it belongs to.

   To give a level its own song, add `music: 'Track Name'` to its line in
   LEVELS above. That is all.
   ========================================================================== */

const MUSIC = {
  startWith: 'Ninja Boogie',   /* the first thing you hear */
  shuffle: true,               /* false plays the rest in filename order */

  /* Songs that belong to a whole kind of level rather than one level. */
  forKind: {
    truck: 'Box Jumping',
    boat:  'Speedboat Boss Run',
  },
};


/* ==========================================================================
   1g. ROCKET and HELICOPTER
   ========================================================================== */

const ROCKET = {
  attempts: 3,        /* how many rockets you get */
  climb: 235,         /* how fast it flies up, pixels a second */
  steer: 260,         /* how hard you can push it sideways in flight */
  wind: 80,           /* how hard the crosswind shoves, pixels a second */
  windTurns: 0.7,     /* how often the wind changes its mind, per second */
  introTime: 2.6,
  resultsTime: 3.0,
  points: 500,        /* per rocket landed */

  /* The first version was just aim-and-hope, which is dull. Now the rocket
     flies up through the traffic and the river, so it is a dodge the whole
     way, and there are stars on the route worth going out of your way for. */
  hitbox: 0.44,       /* how much of a square actually counts as a hit */
  starsPerFlight: 5,
  starPoints: 150,

  /* The climb used to be one fixed speed, so the only answer to a car in the
     way was to slide sideways. Holding UP now lights the booster, which hands
     back the other axis: not just where you are, but when you get there.
     Waiting under a row costs booster you might want higher up, and that
     trade is the level. */
  boost: 1.55,        /* climb multiplier with the booster lit */
  coast: 0.42,        /* and with it off */
  fuel: 2.3,          /* seconds of booster per rocket */

  /* How long you get to read SHOT DOWN before the next rocket will go. You
     also have to let go of UP first. Both matter now that UP is the throttle
     and people hold it down rather than tapping it. */
  relaunchPause: 0.9,
};

const HELI = {
  duration: 24,       /* seconds of air support */
  speed: 230,         /* how fast it flies */
  fireEvery: 0.11,    /* seconds between shots */
  bulletSpeed: 620,
  introTime: 3.0,
  resultsTime: 4.0,
  points: { car: 120, truck: 300, boat: 180 },
  comboWindow: 1.8,
  comboMax: 12,
  respawnDelay: 1.2,

  /* Aliens. The traffic cannot fight back, so these do: they fly in, chase you
     and shoot, which turns the level from a shooting gallery into a fight. */
  alienEvery: 2.2,      /* seconds between one arriving and the next */
  alienMax: 5,
  alienSpeed: 95,
  alienPoints: 400,
  alienHits: 2,         /* shots to bring one down */
  alienFireEvery: 1.9,  /* how often one takes a shot at you */
  enemyShotSpeed: 210,
  heliLives: 2,         /* alien hits you can take before the mission ends */
};

/* --------------------------------------------------------------------------
   AIR  ::  for the levels that do not have any

   Orbital Traffic said "no air, no mercy" and then played exactly like every
   other crossing, only faster. Turn `airless: true` on in a level's rules and
   the clock stops being a clock and becomes a tank: it drains much faster, and
   pockets of air drift across the board that top it back up.

   That gives the level a second question to answer on every hop. Not just
   "is that square safe", but "can I afford the detour", which is a decision
   the plain crossings never ask.
   -------------------------------------------------------------------------- */

const AIR = {
  /* The whole mechanic in one number. You start each frog with this much air
     instead of the usual thirty seconds, which is not quite enough to get
     across, so at least one pocket is part of the route rather than a bonus. */
  tank: 11,

  pocketEvery: 2.4,  /* seconds between one drifting on and the next */
  pocketMax: 3,      /* how many can be on the board at once */
  pocketGives: 6,    /* seconds of air each one is worth */
  pocketSpeed: 58,   /* pixels a second, sideways */
  points: 50,        /* and a few points, so grabbing one is never a waste */
};


/* --------------------------------------------------------------------------
   CROCODILES  ::  the jaws open and shut

   A crocodile whose mouth is permanently open is one square you learn to
   avoid once and then never think about again. In the arcade the jaws worked,
   and that is the difference between a rule and a rhythm: the head is a
   perfectly good ride most of the time, and the level is about noticing when
   it is not.

   Same three-phase shape as the diving turtles, for the same reason. The
   middle phase is your warning and it is still safe to be standing there.
   -------------------------------------------------------------------------- */

const GATOR = {
  shut:    2.6,   /* jaws closed. the head is just another square. */
  opening: 0.55,  /* jaws parting. STILL SAFE. this is the warning. */
  open:    1.5,   /* wide. now the head cell bites. */
};


/* --------------------------------------------------------------------------
   SNAKES  ::  the median stops being a rest stop

   A snake that only slides back and forth is just a car on a slower road, and
   the median was still somewhere you could sit and think. These ones hunt.
   Stand on the median near one and it coils, which is your warning, then it
   strikes at you fast. Step away during the wind-up and it gives up.

   The point is that the median becomes a place you pass through rather than a
   place you wait, which is what the level was always advertising.
   -------------------------------------------------------------------------- */

const SNAKE = {
  /* Whether snakes hunt at all. A level can say `snakesHunt: false` in its
     rules to keep the old patrolling snake, and Deep Freeze does, because on
     ice the median is the one square you are allowed to stop on. Taking that
     away as well leaves the level with no safe beat anywhere in it. */
  hunt: true,

  senseRange: 3.6,    /* squares away it notices you standing on the median */
  windUp: 0.55,       /* seconds coiled before it goes. this is your warning. */
  strikeTime: 0.42,   /* how long the lunge lasts */
  strikeSpeed: 4.2,   /* multiplier on its patrol speed while lunging */
  restTime: 0.85,     /* it is slow and harmless-looking afterwards */
  restSpeed: 0.35,    /* how slowly it slinks back off */
  cooldown: 1.3,      /* before the same snake can wind up again */
};


/* ==========================================================================
   1h. THE SPEEDBOAT BOSS  ::  first person, down the river

   The only level that does not sit on the top-down grid. You are behind the
   boat rather than above it, looking down a river that recedes to a horizon,
   and everything in the water rushes up at you as it gets closer.

   It is a chase. The boss boat is ahead of you and it does not want to be
   caught: it weaves, and it drops mines behind it. Ramming its stern is the
   only thing that hurts it, and the throttle is how you close the gap, which
   makes it the same verb the rocket teaches, asked a different way.

   World units: z is distance ahead of you, x is across the river, where 0 is
   the middle and the banks are at plus and minus riverHalf.
   ========================================================================== */

const BOAT = {
  /* --- the river --- */
  riverHalf: 1.0,     /* how wide the water is either side of the middle */
  depth:     22,      /* how far up the river you can see */
  horizon:   0.32,    /* where the skyline sits, down the playfield */
  camera:    2.2,     /* camera height. bigger makes things rush up slower. */
  spread:    1.5,     /* how wide the near bank is on screen, in screen halves */

  /* --- your boat --- */
  hull:      5,       /* hits you can take before the run is over */
  steer:     2.3,     /* how fast you swing across the river */
  cruise:    9.5,     /* world units a second at rest on the throttle */
  boost:     1.85,    /* multiplier with the throttle down */
  boostFuel: 3.4,     /* seconds of it */
  refill:    0.5,     /* seconds of throttle recovered per second off it */
  grace:     1.1,     /* seconds you cannot be hit again after being hit */

  /* --- the boss --- */
  bossHits:  6,       /* rams it takes */
  bossGap:   7.5,     /* how far ahead it starts, and retreats to after a ram */
  bossWeave: 0.7,     /* how fast it swings across the river */
  bossRange: 0.72,    /* and how far, as a fraction of the river */
  bossRun:   2.4,     /* how hard it pulls away when you are close */
  ramRange:  1.1,     /* how close counts as a ram */

  /* --- what it drops --- */
  mineEvery: 0.9,     /* seconds between mines */
  mineHalf:  0.30,    /* how wide a mine is, in world units */

  /* --- pacing --- */
  duration:   90,     /* seconds before the river runs out */
  introTime: 3.2,
  resultsTime: 4.2,

  points: { ram: 400, win: 3000 },
};


/* --------------------------------------------------------------------------
   The one-off twists a 'cross' level can turn on with `rules`.
   -------------------------------------------------------------------------- */

const TWISTS = {
  /* ice: you cannot stop.

     Two earlier goes at this were both too polite: an extra square after each
     hop, then only sideways. Neither felt like ice. What ice should feel like
     is committing. So: the moment you leave solid ground you keep sliding
     forward on your own, and all you get to do is steer left and right until
     you reach the median. Then you do it again across the river. */
  iceStep: 0.62,      /* seconds between one forced slide forward and the next */
  iceFirstStep: 0.24, /* a short breath before the first one, then you are going */

  /* On ice the frog glides rather than hops. The forward slide animates over
     the whole gap between slides, so it never stops moving, and steering is a
     long smooth lean rather than a jump onto the next column. Both are eased
     out of the usual hop curve into something closer to linear, because a hop
     lands and a glide does not. */
  iceGlide: 0.34,     /* seconds for a steer to carry across a column */
  iceEase: 0.18,      /* 0 is a dead-linear slide, 1 is the normal hop curve */

  /* dark: the frog carries a lantern, and that is very nearly all you get.

     The first go at this left the board readable, which meant the level was a
     normal crossing with a filter over it. It is properly dark now: everything
     outside the lantern and the headlights is gone, not dimmed. */
  darkness: 0.975,    /* how black the rest of the board goes */
  lampRadius: 1.9,    /* how far the lantern throws, in squares */
  lampWarmth: 0.20,   /* how much warm light it puts back on what it lights */
  lampSwing: 0.9,     /* how far the lantern swings behind you, in squares */
  headlampReach: 2.8, /* how far a car's headlights throw */

  /* ghost: the world only moves when you do, like a Mario ghost house.

     The first version left a slow trickle running and banked half a second a
     hop, which added up to something almost indistinguishable from a normal
     level. Now it stops dead, and the ghosts are the reason you cannot just
     stand there and think about it. */
  ghostPerHop: 0.34,  /* seconds of world time each hop buys you */
  ghostDrift: 0.0,    /* nothing moves at all in between */
  ghostCount: 4,

  /* The ghosts move when YOU move, and only then.

     The first version had it the other way round: they closed in while you
     stood still and backed off when you moved, so the level rewarded barging
     forward and punished thinking, which is the opposite of a ghost house.
     Worse, they never reset, so dying next to one meant dying next to it
     again, and again.

     Now they hold position while the world is frozen and surge towards you on
     every hop, and they never retreat. Standing still is safe from them and
     costs you the clock instead. Every hop is progress you pay for. */
  ghostSpeed: 108,    /* how fast a ghost closes while the world is running */
  ghostEdge: 2.2,     /* how far off the board they start, in squares */
  ghostReach: 0.58,   /* how close is caught, in squares */
};


/* Past the end of the list, the last few levels repeat with the speed still
   climbing, so a good player never runs out of game. */
const LEVEL_LOOP = {
  from: 8,            /* start repeating from this level number */
  speedPerLap: 0.18,  /* and add this much speed each time round */
};

/* How generous the water is. Longer logs and smaller gaps make it kinder. */
const RIVER_PRESETS = {
  wide:   { length: +2, gap: -1 },
  easy:   { length: +1, gap: -1 },
  normal: { length:  0, gap:  0 },
  tight:  { length:  0, gap: +1 },
};


/* ==========================================================================
   1e. ENVIRONMENTS  ::  where the level happens
   --------------------------------------------------------------------------
   An environment is the background colours, plus optional recolouring of the
   pixel art, plus optional swaps of individual pictures. It is chosen per
   level in LEVELS above.

   The C key still cycles PALETTES by hand if you want to override the look.
   ========================================================================== */

const ENVIRONMENTS = {

  pond: {
    label: 'POND',
    /* No overrides: this is the 1981 cabinet look from THEMES. */
  },

  city: {
    label: 'CITY AT NIGHT',
    bg: { water: '#0a1832', road: '#101014', grass: '#204030',
          median: '#3a2060', bankLine: '#40c0a0', bayInner: '#050a18',
          textDim: '#40e0d0', accent: '#ffd84a',
          timeBar: '#40e0d0', timeLow: '#ff4060' },
    pixels: { G: '#40ffb0', g: '#20a878', d: '#0d5040',
              B: '#6a5a7a', b: '#3a3048', n: '#8f7fa0' },
  },

  arctic: {
    label: 'ARCTIC',
    bg: { water: '#123a5a', road: '#2a3340', grass: '#e8f4ff',
          median: '#7fb0d8', bankLine: '#ffffff', bayInner: '#0b2038',
          text: '#ffffff', textDim: '#bfe4ff',
          timeBar: '#8fd8ff', timeLow: '#ff7a7a' },
    pixels: { G: '#8ff0ff', g: '#3fa8d0', d: '#1d5070',
              B: '#dff0ff', b: '#8fb8d8', n: '#ffffff',
              R: '#ff9a60', r: '#a04820' },
    art: { log: 'iceFloe' },
  },

  space: {
    label: 'DEEP SPACE',
    bg: { water: '#0a0620', road: '#050308', grass: '#2a1050',
          median: '#5a1878', bankLine: '#b060ff', bayInner: '#04020c',
          textDim: '#a080ff', accent: '#ffe040',
          timeBar: '#40ffd0', timeLow: '#ff3070' },
    pixels: { G: '#50ff90', g: '#20b060', d: '#0a5030',
              B: '#8878a8', b: '#443a58', n: '#b0a0c8',
              R: '#ff60c0', r: '#a02070' },
    art: { log: 'asteroid', car: 'ufo', taxi: 'ufo' },
    stars: true,
  },

  desert: {
    label: 'DESERT HIGHWAY',
    bg: { water: '#1f5f6f', road: '#2a2018', grass: '#d8a850',
          median: '#a86828', bankLine: '#f0d090', bayInner: '#0f3038',
          textDim: '#f0c880', accent: '#ffe870',
          timeBar: '#d8c060', timeLow: '#ff6030' },
    pixels: { G: '#a8d840', g: '#6f9820', d: '#3a5010',
              B: '#c08840', b: '#7a5020', n: '#e0b070' },
  },

  dusk: {
    label: 'SUNSET',
    bg: { water: '#2a1a5a', road: '#20141c', grass: '#c86828',
          median: '#e08a30', bankLine: '#f8c060', bayInner: '#140c2c',
          textDim: '#ffb870', accent: '#ffd860',
          timeBar: '#f8c060', timeLow: '#ff4040' },
    pixels: { G: '#ffd040', g: '#d08820', d: '#7a4410',
              B: '#9a5828', b: '#5a2f12', n: '#d09050',
              R: '#ff6030', r: '#a02810' },
  },

  jungle: {
    label: 'JUNGLE',
    bg: { water: '#0d3f36', road: '#12180f', grass: '#2f7a1f',
          median: '#6a8f18', bankLine: '#8fd83f', bayInner: '#062420',
          textDim: '#a8e070', accent: '#e8f060',
          timeBar: '#8fd83f', timeLow: '#ff5a3a' },
    pixels: { G: '#9fff50', g: '#5aa820', d: '#28500f',
              B: '#7a6030', b: '#3f3018', n: '#a88a4a',
              R: '#ff8020', r: '#a04008' },
  },

  boneyard: {
    label: 'THE BONEYARD',
    bg: { water: '#1b2230', road: '#08080a', grass: '#2a3028',
          median: '#3a3040', bankLine: '#7a8878', bayInner: '#05060a',
          text: '#e8f0e0', textDim: '#9fb09f', accent: '#c8f078',
          timeBar: '#8fc060', timeLow: '#c03040' },
    pixels: { G: '#c8f0a0', g: '#7a9860', d: '#3a4830',
              B: '#5a5048', b: '#302a26', n: '#7a6f64',
              R: '#a0a8a0', r: '#5a605a',
              W: '#e8f0e8', P: '#b0e070' },
    music: 'Boneyard',
    fog: true,
  },
};


/* ==========================================================================
   1h. CREDITS  ::  who made it
   --------------------------------------------------------------------------
   Shown on the victory screen, which rolls once you finish the last level in
   the plan. Same shape as the Phoenix 89 credits. Edit away.
   ========================================================================== */

const CREDITS = [
  { text: 'FROGGER',                    size: 0.80, gap: 0.50, color: 'accent' },
  { text: 'CONGRATULATIONS',            size: 0.38, gap: 0.22, color: 'text' },
  { text: 'you got them all home',      size: 0.28, gap: 0.70, color: 'textDim' },

  { text: 'CREATED BY',                 size: 0.24, gap: 0.20, color: 'textDim' },
  { text: 'Will Stackable',             size: 0.44, gap: 0.70, color: 'text' },

  { text: 'CREATIVE DIRECTORS',         size: 0.24, gap: 0.20, color: 'textDim' },
  { text: 'Kelli Stackable',            size: 0.36, gap: 0.20, color: 'accent', sprite: 'frog' },
  { text: 'Brady Stackable',            size: 0.36, gap: 0.70, color: 'accent', sprite: 'lady' },

  { text: 'INSPIRED BY',                size: 0.24, gap: 0.20, color: 'textDim' },
  { text: 'Frogger',                    size: 0.36, gap: 0.12, color: 'text' },
  { text: 'Konami, 1981',               size: 0.28, gap: 0.70, color: 'textDim' },

  { text: 'BUILT WITH',                 size: 0.24, gap: 0.20, color: 'textDim' },
  { text: 'Claude Code',                size: 0.36, gap: 0.70, color: 'text' },

  { text: 'Thanks for playing',         size: 0.40, gap: 0.30, color: 'accent' },
  { text: '', size: 0.28, gap: 1.60, color: 'textDim' },
];

const VICTORY = {
  celebrateTime: 5.0,   /* fireworks and a pulsing VICTORY before the credits */
  scrollSpeed: 34,      /* how fast the credits crawl, pixels a second */
  fireworkEvery: 0.34,
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

   Which rows are switched on, how fast they go and how generous the river is
   are all decided per level in LEVELS above. What is here are the defaults a
   level starts from.

   Add rows, delete rows, reorder them. The board resizes itself.
   ========================================================================== */

const LANES = [

  /* --- The lilypads. Five frogs home clears the level. ------------------- */
  { type: 'home' },

  /* --- The river. Five rows. The top row of logs runs left to right, which
         is why the leftmost lilypad is the hardest to reach. ------------- */
  { type: 'river', kind: 'log',    length: 4, spacing: [3], speed:  0.80, gator: true },
  { type: 'river', kind: 'turtle', length: 3, spacing: [2], speed: -1.00, dive: 'alternate' },
  { type: 'river', kind: 'log',    length: 6, spacing: [3], speed:  1.40, gator: true },
  { type: 'river', kind: 'log',    length: 3, spacing: [3], speed:  0.60, lady: true },
  { type: 'river', kind: 'turtle', length: 3, spacing: [2], speed: -0.90, dive: 'alternate' },

  /* --- The median. Safe until level 3, when the snakes turn up. ---------- */
  { type: 'road',  kind: 'snake',  length: 2, spacing: [9], speed: -0.45,
    bounce: true, background: 'median' },

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

      monsterTruck: { draw: 'pixels', sprite: 'monsterTruck' },
      helicopter:   { draw: 'pixels', sprite: 'helicopter' },
      rocket:       { draw: 'pixels', sprite: 'rocket' },
      bullet:       { draw: 'pixels', sprite: 'bullet' },
      ghost:        { draw: 'pixels', sprite: 'ghost' },
      gravestone:   { draw: 'pixels', sprite: 'gravestone' },
      star:         { draw: 'pixels', sprite: 'star' },
      alien:        { draw: 'pixels', sprite: 'alien' },
      enemyShot:    { draw: 'pixels', sprite: 'enemyShot' },
      boat:    { draw: 'pixels', sprite: 'boat', fit: 'repeat' },

      log:     { draw: 'pixels', sprite: 'logMid', fit: 'repeat',
                 capLeft: 'logLeft', capRight: 'logRight' },
      gator:   { draw: 'pixels', sprite: 'gatorBody', fit: 'repeat',
                 capLeft: 'gatorTail', capRight: 'gatorHead', faces: 'right' },
      gatorOpen: { draw: 'pixels', sprite: 'gatorBody', fit: 'repeat',
                 capLeft: 'gatorTail', capRight: 'gatorJaws', faces: 'right' },
      turtle:  { draw: 'pixels', sprite: 'turtle', fit: 'repeat', faces: 'left' },
      air:     { draw: 'pixels', sprite: 'airPocket' },
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

      monsterTruck: { draw: 'emoji', glyph: '🛻', scale: 0.95 },
      helicopter:   { draw: 'emoji', glyph: '🚁', scale: 0.95 },
      rocket:       { draw: 'emoji', glyph: '🚀', scale: 0.95 },
      bullet:       { draw: 'emoji', glyph: '✨', scale: 0.8 },
      ghost:        { draw: 'emoji', glyph: '👻' },
      gravestone:   { draw: 'emoji', glyph: '🪦' },
      star:         { draw: 'emoji', glyph: '⭐' },
      alien:        { draw: 'emoji', glyph: '👾' },
      enemyShot:    { draw: 'emoji', glyph: '🔴', scale: 0.6 },
      boat:    { draw: 'emoji', glyph: '⛵', fit: 'repeat' },

      log:     { draw: 'emoji', glyph: '🪵', fit: 'repeat' },
      gator:   { draw: 'emoji', glyph: '🐊', fit: 'repeat', faces: 'left' },
      gatorOpen: { draw: 'emoji', glyph: '🐊', fit: 'repeat', faces: 'left' },
      air:     { draw: 'emoji', glyph: '🫧' },
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


/* ==========================================================================
   5. PALETTES  ::  colour schemes you can flip through while playing
   --------------------------------------------------------------------------
   Press C in the game to cycle these. The first one is the real cabinet, so
   leave it alone if you want the authentic look to stay one keypress away.

   Each palette can change two things:

     bg      the flat background bands (water, road, grass, median)
     pixels  the colours the pixel art letters stand for, from sprites.js
             so { G: '#ff00ff' } turns everything drawn with G bright pink

   Leave either out and that half stays as it was. Copy a block, give it a
   name, and it joins the rotation.
   ========================================================================== */

const PALETTES = [

  /* No overrides, so each level's own environment shows through. Press C to
     leave this and force one look for the whole game. */
  { name: 'Auto (level)' },

  {
    name: 'Sunset Highway',
    bg: { water: '#3a1060', road: '#20101c', grass: '#c85018',
          median: '#f08030', bankLine: '#f8c060', bayInner: '#180828',
          textDim: '#ffb870', timeBar: '#f8c060', timeLow: '#ff4040' },
    pixels: { G: '#ffd040', g: '#e08820', d: '#804010',
              B: '#8a4a20', b: '#502810', n: '#c07840',
              R: '#ff5020', r: '#a02810',
              J: '#a06030', j: '#503018' },
  },

  {
    name: 'Game Boy',
    bg: { water: '#0f380f', road: '#081808', grass: '#8bac0f',
          median: '#306230', bankLine: '#9bbc0f', bayInner: '#081808',
          hudBg: '#081808', text: '#9bbc0f', textDim: '#8bac0f',
          accent: '#9bbc0f', timeBar: '#8bac0f', timeLow: '#306230' },
    pixels: { G: '#9bbc0f', g: '#8bac0f', d: '#306230',
              W: '#9bbc0f', w: '#8bac0f', s: '#306230', K: '#081808',
              C: '#306230', Y: '#9bbc0f', O: '#8bac0f',
              R: '#8bac0f', r: '#306230', P: '#9bbc0f', p: '#306230',
              B: '#8bac0f', b: '#306230', n: '#9bbc0f',
              y: '#9bbc0f', J: '#8bac0f', j: '#306230' },
  },

  {
    name: 'Neon Night',
    bg: { water: '#100038', road: '#08000c', grass: '#00c0a0',
          median: '#ff00a0', bankLine: '#00ffd0', bayInner: '#080020',
          textDim: '#00e0ff', accent: '#ffee00',
          timeBar: '#00ffd0', timeLow: '#ff0060' },
    pixels: { G: '#00ff90', g: '#00c070', d: '#006040',
              R: '#ff0060', r: '#a00040', O: '#ff40a0',
              Y: '#ffee00', C: '#00e0ff',
              B: '#8060ff', b: '#4030a0', n: '#a890ff',
              P: '#ff40ff', p: '#a000a0',
              y: '#c0ff00', J: '#00d0c0', j: '#00706a' },
  },

  {
    name: 'Ice World',
    bg: { water: '#183050', road: '#0c1420', grass: '#e8f4ff',
          median: '#6090d0', bankLine: '#ffffff', bayInner: '#0c2038',
          text: '#ffffff', textDim: '#a0d0f0',
          timeBar: '#80d0ff', timeLow: '#ff8080' },
    pixels: { G: '#80e8ff', g: '#40a8d0', d: '#205070',
              R: '#ff9060', r: '#a04020',
              B: '#90a8c0', b: '#506880', n: '#c0d8e8',
              J: '#70b0a0', j: '#305850',
              y: '#c8f0ff' },
  },

  {
    name: 'Candy',
    bg: { water: '#ff9ec7', road: '#4a2040', grass: '#8ce68c',
          median: '#ffe066', bankLine: '#ffffff', bayInner: '#c0508c',
          textDim: '#ffd0e8', accent: '#fff0a0',
          timeBar: '#8ce68c', timeLow: '#ff5088' },
    pixels: { G: '#66e0a0', g: '#40b878', d: '#207850',
              R: '#ff6090', r: '#c03060', O: '#ffb0c0',
              Y: '#ffe066', C: '#a0e8ff',
              B: '#d09060', b: '#906038', n: '#f0c090',
              P: '#ff80d0', p: '#c04090',
              J: '#a0d860', j: '#508020' },
  },
];
