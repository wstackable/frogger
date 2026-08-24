/* ==========================================================================
   FROGGER  ::  game.js
   --------------------------------------------------------------------------
   The engine. It reads everything from config.js and draws everything through
   render.js, so you can usually leave this file alone.

   The two functions that matter if you want to change the RULES:
     checkLane()  what happens to the frog where it is standing
     update()     runs once a frame and moves the world

   Everything else is scaffolding around those two.
   ========================================================================== */

(function () {
'use strict';

/* ==========================================================================
   Board geometry, all derived from CONFIG
   ========================================================================== */

const GRID   = CONFIG.grid;
const COLS   = CONFIG.cols;
const NLANES = LANES.length;

const WIDTH  = COLS * GRID;
const HEIGHT = (NLANES + 2) * GRID;      /* a HUD row top and bottom */

const START_ROW = NLANES - 1;
const START_COL = Math.floor(COLS / 2);

const laneY = (row) => (row + 1) * GRID;

/* Hitboxes are a little smaller than a square, which feels fair rather than
   fussy when you are threading a gap. */
const HIT_INSET = 7;


/* ==========================================================================
   A small seeded random number generator
   --------------------------------------------------------------------------
   The arcade was almost entirely deterministic, and that is a big part of
   why it is fun: you learn the patterns and get better. So the flies, the
   crocodiles and the lady frog are driven by a seeded generator rather than
   Math.random, which means level 3 plays the same way every time and can
   actually be learned.
   ========================================================================== */

let rngState = 1;

function seedRng(n) {
  rngState = (Math.imul(n, 2654435761) >>> 0) || 1;
}

function rng() {
  rngState ^= rngState << 13; rngState >>>= 0;
  rngState ^= rngState >>> 17;
  rngState ^= rngState << 5;  rngState >>>= 0;
  return rngState / 4294967296;
}


/* ==========================================================================
   Canvas
   ========================================================================== */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  Art.setPixelRatio(dpr);
  fitToScreen();
}

function fitToScreen() {
  const pad = 8;
  const availW = window.innerWidth - pad * 2;
  const availH = window.innerHeight - pad * 2 - (touchVisible() ? 150 : 0);
  const scale = Math.min(availW / WIDTH, availH / HEIGHT);
  canvas.style.width  = Math.floor(WIDTH  * scale) + 'px';
  canvas.style.height = Math.floor(HEIGHT * scale) + 'px';
}


/* ==========================================================================
   Building the lanes
   --------------------------------------------------------------------------
   An obstacle is a whole GROUP: a three-turtle raft is one obstacle three
   squares wide, not three separate turtles. That matters, because it means a
   group keeps its identity as it wraps around the screen, which is what lets
   only SOME groups dive.
   ========================================================================== */

/* One lane, with its authored defaults. The obstacles themselves are filled in
   per level by buildObstacles(), because a level can make the river more
   generous or switch a lane of traffic off entirely. */
const lanes = LANES.map((def, row) => ({
  row,
  type: def.type,
  kind: def.kind,
  baseSpeed: def.speed || 0,
  speed: def.speed || 0,
  baseSpacing: def.spacing || [1],
  spacing: def.spacing || [1],
  baseCells: def.length || 1,
  cells: def.length || 1,
  width: (def.length || 1) * GRID,
  dive: def.dive || false,
  bounce: !!def.bounce,
  hasGators: !!def.gator,
  hasLady: !!def.lady,
  background: def.background || null,
  active: true,
  divePhase: row * 2.3,
  obstacles: [],
}));

/* Lay a lane out from scratch. Called whenever a level starts, since the
   spacing and log length can both change from one level to the next. */
function buildObstacles(lane) {
  lane.obstacles.length = 0;
  lane.width = lane.cells * GRID;
  if (!lane.kind || !lane.spacing.length) return;

  const patternWidth =
    lane.spacing.reduce((a, b) => a + b, 0) * GRID +
    lane.spacing.length * lane.width;

  /* Overshoot the right edge by a whole pattern so even a long log never pops
     into existence halfway across. */
  let endX = patternWidth;
  while (endX < WIDTH) endX += patternWidth;
  endX += patternWidth;

  let x = 0;
  let index = 0;
  while (x < endX) {
    lane.obstacles.push({
      x, index, cells: lane.cells, vx: lane.speed,
      dives: false, variant: null, deadUntil: 0,
    });
    x += lane.width + lane.spacing[index] * GRID;
    index = (index + 1) % lane.spacing.length;
  }

  /* Alternating dives only stay alternating as groups cycle round if there is
     an even number of them, so top up by one if needed. */
  const every = diveEvery(lane.dive);
  if (every >= 2) {
    while (lane.obstacles.length % every !== 0) {
      const last = lane.obstacles[lane.obstacles.length - 1];
      lane.obstacles.push({
        x: last.x + lane.width + lane.spacing[last.index] * GRID,
        index: (last.index + 1) % lane.spacing.length,
        cells: lane.cells, vx: lane.speed,
        dives: false, variant: null, deadUntil: 0,
      });
    }
  }

  lane.obstacles.forEach((ob, i) => {
    ob.dives = every > 0 && i % every === 0;
  });
}

/* dive: false | 'all' | 'alternate' | a number meaning every nth group. */
function diveEvery(dive) {
  if (!dive) return 0;
  if (dive === 'all') return 1;
  if (dive === 'alternate') return 2;
  const n = Number(dive);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

const riverLanes = lanes.filter((l) => l.type === 'river');
const homeRow    = lanes.findIndex((l) => l.type === 'home');
const ladyLanes  = lanes.filter((l) => l.hasLady);

/* Is this row's traffic switched on for the level we are playing? */
function laneActive(lane) {
  return lane.active;
}

/* The road rows that carry traffic, nearest the start line first, so a level
   that only wants two lanes switches on the two you meet first. */
const trafficRows = lanes
  .filter((l) => l.type === 'road' && l.kind !== 'snake')
  .map((l) => l.row)
  .sort((a, b) => b - a);

const snakeLane = lanes.find((l) => l.kind === 'snake') || null;


/* ==========================================================================
   Game state
   ========================================================================== */

const HIGH_SCORE_KEY = 'frogger.highScore';

const game = {
  state: 'title',      /* title | play | dying | levelClear | gameOver */
  stateTime: 0,
  paused: false,
  time: 0,

  mode: localStorage.getItem('frogger.mode') || CONFIG.startMode,

  score: 0,
  highScore: Number(localStorage.getItem(HIGH_SCORE_KEY) || 0),
  level: 1,
  lives: CONFIG.lives,
  nextExtraLife: CONFIG.score.extraLifeEvery,

  timeLeft: CONFIG.timeLimit,
  bays: CONFIG.homeCols.map(() => false),

  /* A fly (worth 200) or a crocodile (fatal) sitting in one of the bays. */
  bayHazard: null,
  nextBaySpawn: 0,

  /* The pink lady frog riding a log, and whether we are carrying her. */
  lady: null,
  nextLadySpawn: 0,
  carrying: false,

  frog: null,
  deathReason: '',
  menuOpen: false,     /* the Escape menu */
  menuPick: 0,
  bonusTotal: 0,       /* what the last bonus round was worth */
  ghostTime: 0,        /* banked world time, for the boneyard level */
  pickedLevel: 1,      /* which level the title screen is pointing at */
  titleView: 'main',   /* 'main' or 'levels'. the level list is behind a menu
                          entry now, rather than being the whole title screen. */
  mainPick: 0,         /* which row of the main menu is highlighted */
  lastBonus: null,     /* a little "+200" that floats up */
  fx: [],              /* short-lived puffs and rings on the crossing levels */
  riding: null,        /* the log or turtle group under the frog right now */
  air: [],             /* drifting pockets of air, on the airless levels */
  nextAir: 0,
  notice: null,        /* the R / M / C popup: { text, at } */
};

/* A short banner in the middle of the screen, for the radio and the palette
   switcher. Same idea as the popup in Phoenix 89. */
function notify(text) {
  game.notice = { text, at: game.time };
}

function newFrog() {
  const x = START_COL * GRID;
  return {
    x,
    row: START_ROW,
    bestRow: START_ROW,
    dir: 0,
    /* X and Y animate on their own timers. Steering sideways mid-slide must
       not restart the forward glide, or the frog snaps back onto its row
       every time you touch left or right. */
    hopFromX: x,
    hopFromY: laneY(START_ROW),
    hopXT: 1e9, hopYT: 1e9,
    hopXDur: CONFIG.hopDuration, hopYDur: CONFIG.hopDuration,
    glideX: false, glideY: false,
    iceNext: 0,
  };
}

/* ==========================================================================
   Modes
   --------------------------------------------------------------------------
   Everything a mode does not say falls back to CONFIG, so a mode only has to
   list what it changes.
   ========================================================================== */

function mode() {
  return MODES[game.mode] || MODES[CONFIG.startMode] || Object.values(MODES)[0];
}

/* A setting, from the mode if it has an opinion, otherwise from CONFIG. */
function setting(key, fallback) {
  const m = mode();
  if (m && m[key] !== undefined) return m[key];
  if (CONFIG[key] !== undefined) return CONFIG[key];
  return fallback;
}

/* One of the arcade rules, which a mode can soften. */
function rule(name) {
  const m = mode();
  if (m && m.rules && m.rules[name] !== undefined) return m.rules[name];
  return CONFIG.rules[name];
}

function modeNames() {
  return Object.keys(MODES);
}

function cycleMode(step) {
  const names = modeNames();
  const i = names.indexOf(game.mode);
  game.mode = names[((i + step) % names.length + names.length) % names.length];
  localStorage.setItem('frogger.mode', game.mode);
}

/* ==========================================================================
   The level plan
   --------------------------------------------------------------------------
   LEVELS in config.js says what each level is. Past the end of the list the
   last stretch repeats with the speed still climbing, so a good player never
   runs out of game.
   ========================================================================== */

function planFor(n) {
  if (!LEVELS.length) return { name: 'Level ' + n, kind: 'cross', env: 'pond' };
  if (n <= LEVELS.length) return LEVELS[n - 1];

  const from = Math.max(1, Math.min(LEVEL_LOOP.from, LEVELS.length));
  const span = LEVELS.length - from + 1;
  const into = (n - LEVELS.length - 1) % span;
  return LEVELS[from - 1 + into];
}

/* How many times we have been round the looping stretch. */
function lapsFor(n) {
  if (!LEVELS.length || n <= LEVELS.length) return 0;
  const from = Math.max(1, Math.min(LEVEL_LOOP.from, LEVELS.length));
  const span = LEVELS.length - from + 1;
  return 1 + Math.floor((n - LEVELS.length - 1) / span);
}

function plan() {
  return planFor(game.level);
}

function levelKind() {
  return plan().kind || 'cross';
}

function levelName(n) {
  const p = planFor(n);
  const laps = lapsFor(n);
  return laps > 0 ? `${p.name} +${laps}` : p.name;
}

/* Does this level have that hazard? */
function hazard(name) {
  const h = plan().hazards;
  return Array.isArray(h) && h.indexOf(name) !== -1;
}

/* A one-off twist on a normal crossing: ice, dark, ghost. */
function twist(name) {
  const r = plan().rules;
  return !!(r && r[name]);
}

/* Like twist, but for a rule a level can switch OFF as well as on, so an
   explicit false has to survive rather than read the same as "not set". */
function levelRule(name, fallback) {
  const r = plan().rules;
  if (!r || r[name] === undefined) return fallback;
  return r[name];
}

/* Everything moves at the level's speed, nudged by the mode and by how many
   laps of the looping stretch we have done. */
function speedMultiplier() {
  const p = plan();
  const base = typeof p.speed === 'number' ? p.speed : 1;
  const laps = lapsFor(game.level);
  return base * (1 + laps * LEVEL_LOOP.speedPerLap) * setting('speedScale', 1);
}

/* --------------------------------------------------------------------------
   Lay the board out for the level we are about to play.
   -------------------------------------------------------------------------- */
function applyPlan() {
  const p = plan();

  Art.setEnvironment(p.env || 'pond');

  const river = RIVER_PRESETS[p.river] || RIVER_PRESETS.normal;
  const wantedLanes = typeof p.roadLanes === 'number' ? p.roadLanes : trafficRows.length;
  const liveTraffic = new Set(trafficRows.slice(0, Math.max(0, wantedLanes)));

  for (const lane of lanes) {
    /* Start from what LANES authored, then let the level adjust it. */
    lane.speed = lane.baseSpeed;
    lane.spacing = lane.baseSpacing.slice();
    lane.cells = lane.baseCells;
    lane.dive = false;
    lane.active = true;

    if (lane.type === 'river') {
      lane.cells = Math.max(1, lane.baseCells + river.length);
      lane.spacing = lane.baseSpacing.map((g) => Math.max(0, g + river.gap));
      /* Turtles only dive if this level says so. */
      if (lane.kind === 'turtle') {
        lane.dive = hazard('diving') ? (LANES[lane.row].dive || 'alternate') : false;
      }
    }

    if (lane.type === 'road') {
      if (lane.kind === 'snake') lane.active = hazard('snake');
      else lane.active = liveTraffic.has(lane.row);
    }

    buildObstacles(lane);
  }

  /* Which logs are crocodiles. */
  for (const lane of lanes) {
    if (!lane.hasGators) continue;
    const on = hazard('gator');
    lane.obstacles.forEach((ob, i) => {
      ob.variant = (on && i % PROGRESSION.gatorEveryNthLog === 0) ? 'gator' : null;
    });
  }
}


/* ==========================================================================
   Lifecycle
   ========================================================================== */

function startGame(atLevel) {
  game.titleView = 'main';
  game.score = 0;
  game.level = Math.max(1, atLevel || game.pickedLevel || 1);
  game.lives = setting('lives', CONFIG.lives);
  game.nextExtraLife = CONFIG.score.extraLifeEvery;
  enterLevel();
}

function startLevel() {
  calmDown();
  game.bays = CONFIG.homeCols.map(() => false);
  game.bayHazard = null;
  game.lady = null;
  game.carrying = false;
  game.lastBonus = null;
  game.air.length = 0;
  /* A pocket almost straight away, so an airless level shows you what it wants
     from you before it has had a chance to punish you for not knowing. */
  game.nextAir = game.time + 0.6;
  game.nextBaySpawn = game.time + setting('baySpawnGap', CONFIG.timing.baySpawnGap);
  game.nextLadySpawn = game.time + CONFIG.timing.ladySpawnGap * 0.5;
  game.ghostTime = 0;

  /* Same seed for the same level, so the pattern is learnable. */
  seedRng(game.level * 7919 + 13);

  applyPlan();
  respawn();
}

function respawn() {
  game.frog = newFrog();
  game.timeLeft = timeCapacity();
  game.carrying = false;
  game.ghostTime = 0;
  resetGhosts();
}

/* The engine idles through the countdown and cuts when the level ends. */
const engineState = (st) => st === 'bonusIntro'  || st === 'bonus' ||
                            st === 'heliIntro'   || st === 'heli' ||
                            st === 'rocketIntro' || st === 'rocket' ||
                            st === 'boatIntro'   || st === 'boat';

function engineProfileFor(st) {
  if (st === 'heliIntro' || st === 'heli') return 'helicopter';
  if (st === 'rocketIntro' || st === 'rocket') return 'rocket';
  if (st === 'boatIntro' || st === 'boat') return 'boat';
  return 'truck';
}
const bonusState = (st) => engineState(st) || st === 'bonusResults' ||
                           st === 'heliResults' || st === 'boatResults' ||
                           st === 'rocketIntro' || st === 'rocket' ||
                           st === 'rocketResults';

function setState(next) {
  const wasEngine = engineState(game.state);
  const wasBonus = bonusState(game.state);

  game.state = next;
  game.stateTime = 0;

  /* Two special levels back to back share an engine state, so simply asking
     it to start again would be a no-op and you would drive a monster truck
     that sounds like a helicopter. Swap the profile properly. */
  const wantProfile = engineState(next) ? engineProfileFor(next) : null;
  if (!wantProfile) {
    if (Engine.running) Engine.stop();
  } else if (!Engine.running) {
    Engine.start(wantProfile);
  } else if (Engine.profile !== wantProfile) {
    Engine.stop();
    Engine.start(wantProfile);
  }
}

function addScore(points, label) {
  game.score += points;
  if (label) game.lastBonus = { text: label, at: game.time };

  while (game.score >= game.nextExtraLife) {
    game.lives++;
    game.nextExtraLife += CONFIG.score.extraLifeEvery;
    Sound.play('life');
  }
  if (game.score > game.highScore) {
    game.highScore = game.score;
    localStorage.setItem(HIGH_SCORE_KEY, String(game.highScore));
  }
}

function die(reason) {
  if (game.state !== 'play') return;
  game.deathReason = reason;
  game.carrying = false;
  Sound.play('die');
  setState('dying');
}


/* ==========================================================================
   Effects
   --------------------------------------------------------------------------
   A tiny particle layer for the crossing levels. The bonus round has its own
   heavier debris system; this one is for small tells, the sort of thing that
   tells you what the board is about to do a moment before it does it.

   Two shapes only. A puff is a dot that rises and fades, good for bubbles.
   A ring is a circle that grows and fades, good for a splash or a surfacing.
   ========================================================================== */

function spawnPuff(x, y, color, count, opts) {
  const o = opts || {};
  for (let i = 0; i < count; i++) {
    game.fx.push({
      shape: 'puff',
      x: x + (Math.random() - 0.5) * (o.spread || GRID * 0.5),
      y: y + (Math.random() - 0.5) * 6,
      vy: -(o.rise || 26) * (0.6 + Math.random() * 0.8),
      vx: (Math.random() - 0.5) * 14,
      life: o.life || 0.5 + Math.random() * 0.3,
      age: 0,
      size: o.size || 2 + Math.random() * 2.5,
      color: color,
    });
  }
}

function spawnRing(x, y, color, opts) {
  const o = opts || {};
  game.fx.push({
    shape: 'ring',
    x, y,
    from: o.from || 3,
    to: o.to || GRID * 0.62,
    life: o.life || 0.45,
    age: 0,
    width: o.width || 2,
    color: color,
  });
}

function updateFx(dt) {
  for (let i = game.fx.length - 1; i >= 0; i--) {
    const f = game.fx[i];
    f.age += dt;
    if (f.age >= f.life) { game.fx.splice(i, 1); continue; }
    if (f.shape === 'puff') {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.vy *= 0.96;
    }
  }
}

function drawFx() {
  for (const f of game.fx) {
    const t = f.age / f.life;
    ctx.globalAlpha = 1 - t * t;

    if (f.shape === 'ring') {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = f.width;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.from + (f.to - f.from) * t, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = f.color;
      const s = f.size * (1 - t * 0.4);
      ctx.fillRect(f.x - s / 2, f.y - s / 2, s, s);
    }
  }
  ctx.globalAlpha = 1;
}


/* ==========================================================================
   Diving turtles
   --------------------------------------------------------------------------
   Three phases, on a loop:

     up      dry, safe to stand on
     tuck    settling into the water. STILL SAFE. this is your warning.
     under   gone. standing here drowns you.

   Only alternating groups dive, so however unlucky the timing, there is
   always a dry raft somewhere in the row. That is how the arcade did it, and
   it is the difference between "tense" and "impossible".
   ========================================================================== */

const TUCK_SINK = 0.28;   /* how far it has settled by the end of the warning */

function diveState(lane, ob) {
  if (!ob.dives || !rule('divingTurtles')) {
    return { sink: 0, submerged: false };
  }

  const t = CONFIG.timing;
  const cycle = t.diveUp + t.diveTuck + t.diveUnder;
  const at = (game.time + lane.divePhase) % cycle;

  if (at < t.diveUp) {
    return { sink: 0, submerged: false };
  }
  if (at < t.diveUp + t.diveTuck) {
    const p = (at - t.diveUp) / t.diveTuck;
    return { sink: p * TUCK_SINK, submerged: false };
  }
  const p = (at - t.diveUp - t.diveTuck) / t.diveUnder;
  return { sink: TUCK_SINK + p * (1 - TUCK_SINK), submerged: true };
}

/* The same cycle as diveState, but as a name, so we can spot the frame it
   changes on. */
function divePhaseName(lane, ob) {
  if (!ob.dives || !rule('divingTurtles')) return 'up';

  const t = CONFIG.timing;
  const cycle = t.diveUp + t.diveTuck + t.diveUnder;
  const at = (game.time + lane.divePhase) % cycle;

  if (at < t.diveUp) return 'up';
  if (at < t.diveUp + t.diveTuck) return 'tuck';
  return 'under';
}

/* The colour of everything the water throws up. Deliberately not a theme
   colour: bubbles read as bubbles on every environment, and a pale blue sits
   on top of all seven water colours without disappearing into any of them. */
const BUBBLE = '#bfe4ff';

/* Turtles used to sink in silence. The tuck phase was already a fair warning
   in the rules, but nothing on screen said so, which made the row feel like a
   coin flip rather than a read. Now every group bubbles before it goes, and
   the one you are actually standing on tells you out loud. */
function updateDives() {
  if (!rule('divingTurtles')) return;

  for (const lane of riverLanes) {
    if (!laneActive(lane)) continue;
    const y = laneY(lane.row);

    for (const ob of lane.obstacles) {
      if (!ob.dives) continue;

      const phase = divePhaseName(lane, ob);
      if (phase === ob.divePhaseWas) continue;

      const first = ob.divePhaseWas === undefined;
      ob.divePhaseWas = phase;
      if (first) continue;                 /* nothing to announce on frame one */

      const w = ob.cells * GRID;
      if (ob.x > WIDTH || ob.x + w < 0) continue;

      const mid = ob.x + w / 2;
      const underUs = game.riding === ob && game.state === 'play';

      if (phase === 'tuck') {
        /* Bubbles from every square, so a long raft warns along its length. */
        for (let c = 0; c < ob.cells; c++) {
          spawnPuff(ob.x + c * GRID + GRID / 2, y + GRID * 0.6, BUBBLE, 3,
                    { rise: 30, spread: GRID * 0.45 });
        }
        if (underUs) Sound.play('tuck');
      } else if (phase === 'under') {
        spawnRing(mid, y + GRID / 2, BUBBLE, { to: GRID * 0.85 });
        if (underUs) Sound.play('sink');
      } else {
        /* Back up. Worth showing, because it is where you are going next. */
        spawnRing(mid, y + GRID / 2, BUBBLE, { to: GRID * 0.5, life: 0.35 });
        spawnPuff(mid, y + GRID * 0.5, BUBBLE, 2, { rise: 18 });
      }
    }
  }
}


/* ==========================================================================
   Crocodile jaws
   --------------------------------------------------------------------------
   Three phases on a loop, deliberately the same shape as the diving turtles:

     shut      the head is a ride like any other square
     opening   parting. STILL SAFE. this is the warning.
     open      the head cell bites

   Every crocodile runs its own offset so a row never snaps shut in unison,
   which would turn a rhythm into a single gate.
   ========================================================================== */

function gatorPhase(lane, ob) {
  if (ob.variant !== 'gator' || !rule('gatorMouthIsDeath')) return 'shut';

  const cycle = GATOR.shut + GATOR.opening + GATOR.open;
  const offset = lane.row * 1.7 + (ob.index + 1) * 0.9;
  const at = (game.time + offset) % cycle;

  if (at < GATOR.shut) return 'shut';
  if (at < GATOR.shut + GATOR.opening) return 'opening';
  return 'open';
}

/* Only the wide-open mouth bites. */
function gatorBites(lane, ob) {
  return gatorPhase(lane, ob) === 'open';
}

/* The crocodile you are riding tells you what its mouth is doing. Only that
   one, for the same reason as the turtles: a row of them all creaking at once
   is noise, and the only jaws that can reach you are the ones under your feet. */
function updateGators() {
  if (!hazard('gator')) return;

  for (const lane of riverLanes) {
    if (!laneActive(lane)) continue;
    const y = laneY(lane.row);

    for (const ob of lane.obstacles) {
      if (ob.variant !== 'gator') continue;

      const phase = gatorPhase(lane, ob);
      if (phase === ob.gatorPhaseWas) continue;

      const first = ob.gatorPhaseWas === undefined;
      ob.gatorPhaseWas = phase;
      if (first) continue;

      const w = ob.cells * GRID;
      if (ob.x > WIDTH || ob.x + w < 0) continue;

      const head = ob.x + (ob.vx > 0 ? w - GRID / 2 : GRID / 2);
      const underUs = game.riding === ob && game.state === 'play';

      if (phase === 'opening') {
        spawnPuff(head, y + GRID * 0.5, TOOTH, 3, { rise: 20, spread: GRID * 0.5 });
        if (underUs) Sound.play('creak');
      } else if (phase === 'shut') {
        spawnRing(head, y + GRID / 2, TOOTH, { to: GRID * 0.45, life: 0.3 });
        if (underUs) Sound.play('chomp');
      }
    }
  }
}

/* Teeth colour, fixed for the same reason as the bubbles. */
const TOOTH = '#fff2cc';


/* Which square of a multi-square obstacle is the frog standing on? */
function cellUnder(ob, frogCentre) {
  const i = Math.floor((frogCentre - ob.x) / GRID);
  return Math.max(0, Math.min(ob.cells - 1, i));
}

/* A crocodile's jaws are at the front, whichever way it is swimming. */
function gatorHeadCell(ob) {
  return ob.vx > 0 ? ob.cells - 1 : 0;
}


/* ==========================================================================
   Update
   ========================================================================== */

function update(dt) {
  game.time += dt;
  game.stateTime += dt;

  moveObstacles(dt);
  updateFx(dt);
  if (game.frog) {
    game.frog.hopXT += dt * 1000;
    game.frog.hopYT += dt * 1000;
  }

  switch (game.state) {

    case 'play': {
      game.timeLeft -= dt;
      if (game.timeLeft <= 0) {
        game.timeLeft = 0;
        die(airless() ? 'Out of air' : 'Out of time');
        break;
      }
      updateAir(dt);
      updateBayHazard(dt);
      updateDives();
      updateGators();
      updateSnakes(dt);
      updateLady(dt);
      updateSlide(dt);
      checkLane(dt);
      break;
    }

    case 'dying': {
      if (game.stateTime > 0.9) {
        game.lives--;
        if (game.lives <= 0) {
          Sound.play('over');
          setState('gameOver');
        } else {
          respawn();
          setState('play');
        }
      }
      break;
    }

    case 'levelClear': {
      if (game.stateTime > 2.0) advanceLevel();
      break;
    }

    case 'victory': {
      updateVictory(dt);
      break;
    }

    /* --- the bonus round: a flashy intro, the rampage, then the tally --- */
    case 'bonusIntro': {
      if (game.stateTime > BONUS.introTime) setState('bonus');
      break;
    }

    case 'bonus': {
      updateBonus(dt);
      break;
    }

    case 'bonusResults': {
      if (game.stateTime > BONUS.resultsTime) advanceLevel();
      break;
    }

    /* --- the rocket --- */
    case 'rocketIntro': {
      if (game.stateTime > ROCKET.introTime) setState('rocket');
      break;
    }
    case 'rocket': {
      updateRocket(dt);
      if (game.lives <= 0) { Sound.play('over'); setState('gameOver'); }
      break;
    }
    case 'rocketResults': {
      if (game.stateTime > ROCKET.resultsTime) advanceLevel();
      break;
    }

    /* --- the speedboat boss --- */
    case 'boatIntro': {
      if (game.stateTime > BOAT.introTime) setState('boat');
      break;
    }
    case 'boat': {
      updateBoat(dt);
      break;
    }
    case 'boatResults': {
      if (game.stateTime > BOAT.resultsTime) {
        /* Losing the boss run costs a frog, the same as any other death. */
        if (!boat.won) {
          game.lives--;
          if (game.lives <= 0) { Sound.play('over'); setState('gameOver'); break; }
        }
        advanceLevel();
      }
      break;
    }

    /* --- the helicopter --- */
    case 'heliIntro': {
      if (game.stateTime > HELI.introTime) setState('heli');
      break;
    }
    case 'heli': {
      updateHeli(dt);
      break;
    }
    case 'heliResults': {
      if (game.stateTime > HELI.resultsTime) advanceLevel();
      break;
    }
  }
}

function advanceLevel() {
  /* Finishing the last level in the plan earns the celebration. After that it
     loops, so this only happens once a run. */
  if (game.level === LEVELS.length) {
    game.level++;
    startVictory();
    return;
  }

  game.level++;

  /* Beginner mode hands every frog back, so a rough level never ends the run.
     Expert mode does not: there the bonus fly is the only way back. */
  if (setting('refillLivesOnLevel', false)) {
    game.lives = Math.max(game.lives, setting('lives', CONFIG.lives));
  }

  enterLevel();
}

/* Set the board up and hand over to whichever kind of level this is. */
function enterLevel() {
  startLevel();

  /* A level, its environment or its kind can claim a particular track. Levels
     that claim nothing get the shuffle back. */
  const track = Music.trackForLevel(plan());
  if (track) Music.playNamed(track);
  else Music.restorePrevious();

  switch (levelKind()) {
    case 'truck':
      startBonusRound();
      Sound.play('bonus');
      setState('bonusIntro');
      return;

    case 'rocket':
      startRocket();
      Sound.play('bonus');
      setState('rocketIntro');
      return;

    case 'heli':
      startHeli();
      Sound.play('bonus');
      setState('heliIntro');
      return;

    case 'boat':
      startBoat();
      Sound.play('bonus');
      setState('boatIntro');
      return;

    default:
      setState('play');
  }
}

/* True for the whole bonus sequence, intro and tally included. */
function inBonus() {
  return game.state === 'bonusIntro' || game.state === 'bonus' ||
         game.state === 'bonusResults';
}

function moveObstacles(dt) {
  /* In the boneyard the world is watching you, not the other way round: it
     only advances when the frog moves, in a burst after each hop, plus a slow
     trickle so it is never completely still. Straight out of a Mario ghost
     house, and it turns the level into a puzzle. */
  if (twist('ghost') && game.state === 'play') {
    const spend = Math.min(game.ghostTime, dt);
    game.ghostTime -= spend;
    dt = spend + dt * TWISTS.ghostDrift;
  }

  const step = dt * 60 * speedMultiplier();

  for (const lane of lanes) {
    if (!lane.obstacles.length || !laneActive(lane)) continue;

    /* `|| 1` would be wrong here: a coiling snake sets speedScale to 0, and 0
       is falsy, so it would slide along at full speed while pretending to be
       frozen. Same trap as Number(null) being 0. */
    for (const ob of lane.obstacles) {
      const scale = ob.speedScale === undefined ? 1 : ob.speedScale;
      ob.x += ob.vx * step * scale;
    }

    if (lane.bounce) bounceLane(lane);
    else wrapLane(lane);
  }
}

/* ==========================================================================
   Air
   --------------------------------------------------------------------------
   On an airless level the clock is a tank. It empties much faster than the
   normal thirty seconds, and pockets of air drift across the board to top it
   back up.

   The point is a second question on every hop. A plain crossing only ever
   asks "is that square safe". This one also asks "can I afford to go and get
   that", which is a different and better kind of decision, and it is the one
   the level's own blurb was promising all along.
   ========================================================================== */

function airless() {
  return twist('airless');
}

/* A full tank. On an airless level that is deliberately less than the usual
   thirty seconds, which is what makes the pockets part of the route. */
function timeCapacity() {
  return airless() ? AIR.tank : CONFIG.timeLimit;
}

/* The rows a pocket can appear on: the ones you actually stand in. Putting one
   on the lilypad row would be a pocket you can never take, because landing
   there ends the crossing. */
function airRows() {
  return lanes
    .filter((l) => l.type === 'road' || l.type === 'river' || l.type === 'safe')
    .map((l) => l.row);
}

function spawnAirPocket() {
  const rows = airRows();
  if (!rows.length) return;

  const row = rows[Math.floor(rng() * rows.length)];
  const fromLeft = rng() < 0.5;

  game.air.push({
    row,
    x: fromLeft ? -GRID : WIDTH,
    vx: (fromLeft ? 1 : -1) * AIR.pocketSpeed,
    bob: rng() * Math.PI * 2,
  });
}

function updateAir(dt) {
  if (!airless()) {
    if (game.air.length) game.air.length = 0;
    return;
  }

  if (game.time >= game.nextAir && game.air.length < AIR.pocketMax) {
    spawnAirPocket();
    game.nextAir = game.time + AIR.pocketEvery;
  }

  const frog = game.frog;

  for (let i = game.air.length - 1; i >= 0; i--) {
    const a = game.air[i];
    a.x += a.vx * dt;

    if (a.x < -GRID * 2 || a.x > WIDTH + GRID * 2) { game.air.splice(i, 1); continue; }
    if (!frog || game.state !== 'play') continue;

    /* Reaching one is generous on purpose. The cost of a pocket is the detour
       you took to get near it, not a pixel-perfect landing. */
    const near = Math.abs((a.x + GRID / 2) - (frog.x + GRID / 2)) < GRID * 0.8 &&
                 a.row === frog.row;
    if (!near) continue;

    game.air.splice(i, 1);
    game.timeLeft = Math.min(timeCapacity(), game.timeLeft + AIR.pocketGives);
    addScore(AIR.points, '+' + AIR.points);
    Sound.play('breath');
    spawnRing(frog.x + GRID / 2, laneY(frog.row) + GRID / 2, AIRCOL, { to: GRID });
    spawnPuff(frog.x + GRID / 2, laneY(frog.row) + GRID / 2, AIRCOL, 6, { rise: 40 });
  }
}

function drawAir() {
  if (!game.air.length) return;
  const art = Art.of('air');
  for (const a of game.air) {
    const bob = Math.sin(game.time * 2.6 + a.bob) * GRID * 0.12;
    drawArt(ctx, art, a.x, laneY(a.row) + bob, GRID, GRID,
            { cells: 1, time: game.time });
  }
}

/* The colour of air, for the puff when you take a breath. */
const AIRCOL = '#8fe8ff';


/* ==========================================================================
   Snakes
   --------------------------------------------------------------------------
   A snake sliding back and forth is a car on a slower road, and it left the
   median as somewhere you could stop and plan. These hunt instead.

     patrol   sliding along as before
     coil     it has seen you. frozen, shaking, hissing. this is the warning.
     strike   the lunge, several times patrol speed, aimed where you were
     rest     slinking back, slow, while it gets its nerve back

   Stepping off the median during the wind-up calls it off, so the level asks
   one question over and over: is it worth another half second up here?
   ========================================================================== */

/* How fast each mood moves, as a multiple of the snake's patrol speed. The
   mood and its speed are set together, deliberately: setting the speed inside
   the case that follows leaves one frame where the snake is coiled and still
   sliding, or lunging and still stopped. One frame is enough to see. */
const SNAKE_SPEED = {
  patrol: 1,
  coil:   0,
  strike: SNAKE.strikeSpeed,
  rest:   SNAKE.restSpeed,
};

function snakeMood(ob, mood, time) {
  ob.mood = mood;
  ob.moodUntil = game.time + time;
  ob.speedScale = SNAKE_SPEED[mood];
}

function updateSnakes(dt) {
  if (!snakeLane || !laneActive(snakeLane)) return;
  if (!levelRule('snakesHunt', SNAKE.hunt)) return;

  const frog = game.frog;
  const onMedian = !!frog && frog.row === snakeLane.row && game.state === 'play';
  const centre = frog ? frog.x + GRID / 2 : 0;
  const y = laneY(snakeLane.row);

  for (const ob of snakeLane.obstacles) {
    if (ob.patrolSpeed === undefined) ob.patrolSpeed = Math.abs(ob.vx);
    if (!ob.mood) snakeMood(ob, 'patrol', 0);

    const mid = ob.x + (ob.cells * GRID) / 2;
    const gap = Math.abs(centre - mid) / GRID;

    switch (ob.mood) {

      case 'patrol': {
        if (!onMedian) break;
        if (game.time < (ob.readyAt || 0)) break;
        if (gap > SNAKE.senseRange) break;
        snakeMood(ob, 'coil', SNAKE.windUp);
        Sound.play('hiss');
        break;
      }

      case 'coil': {
        /* Called off the moment you leave. The snake is guarding the median,
           not chasing you across the board. */
        if (!onMedian) {
          snakeMood(ob, 'rest', SNAKE.restTime);
          ob.readyAt = game.time + SNAKE.cooldown;
          break;
        }
        /* Flecks coming off it while it winds up. */
        if (Math.random() < dt * 40) {
          spawnPuff(mid, y + GRID * 0.3, VENOM, 1, { rise: 34, spread: GRID });
        }
        if (game.time >= ob.moodUntil) {
          ob.vx = Math.sign(centre - mid || 1) * ob.patrolSpeed;
          snakeMood(ob, 'strike', SNAKE.strikeTime);
          Sound.play('strike');
        }
        break;
      }

      case 'strike': {
        if (game.time >= ob.moodUntil) {
          snakeMood(ob, 'rest', SNAKE.restTime);
          ob.readyAt = game.time + SNAKE.cooldown;
        }
        break;
      }

      default: {                                  /* rest */
        if (game.time >= ob.moodUntil) snakeMood(ob, 'patrol', 0);
        break;
      }
    }
  }
}

/* What comes off a snake while it winds up. Same reasoning as the bubbles:
   a fixed colour reads on every environment. */
const VENOM = '#b6ff5a';


/* Snakes turn round at the edges instead of wrapping. */
function bounceLane(lane) {
  for (const ob of lane.obstacles) {
    if (ob.x < 0)                    { ob.x = 0;                    ob.vx = Math.abs(ob.vx); }
    if (ob.x + ob.cells * GRID > WIDTH) { ob.x = WIDTH - ob.cells * GRID; ob.vx = -Math.abs(ob.vx); }
  }
}

/* Everything else loops round, keeping the spacing rhythm intact. */
function wrapLane(lane) {
  const row = lane.obstacles;

  for (const ob of row) {
    if (lane.speed < 0 && ob.x < -lane.width) {
      let rightmost = row[0];
      for (const o of row) if (o.x > rightmost.x) rightmost = o;
      ob.x = rightmost.x + lane.width + lane.spacing[rightmost.index] * GRID;
      ob.index = (rightmost.index + 1) % lane.spacing.length;
    }

    if (lane.speed > 0 && ob.x > WIDTH) {
      let leftmost = row[0];
      for (const o of row) if (o.x < leftmost.x) leftmost = o;
      let index = leftmost.index - 1;
      if (index < 0) index = lane.spacing.length - 1;
      ob.x = leftmost.x - lane.spacing[index] * GRID - lane.width;
      ob.index = index;
    }
  }
}


/* --------------------------------------------------------------------------
   Flies and crocodiles in the lilypads
   --------------------------------------------------------------------------
   One at a time, in an empty bay. A fly is 200 points. A crocodile kills you,
   except while it is still surfacing, exactly like the arcade.
   -------------------------------------------------------------------------- */
function updateBayHazard(dt) {
  const t = CONFIG.timing;

  if (game.bayHazard) {
    if (game.time - game.bayHazard.bornAt > t.bayHazardLife) {
      game.bayHazard = null;
      game.nextBaySpawn = game.time + setting('baySpawnGap', t.baySpawnGap);
    }
    return;
  }

  if (game.time < game.nextBaySpawn) return;

  const empty = game.bays.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  if (!empty.length) return;

  const bay = empty[Math.floor(rng() * empty.length)];

  const crocOk = hazard('bayCroc');
  const flyOk  = hazard('fly');
  let kind = null;
  if (crocOk && flyOk)      kind = rng() < 0.5 ? 'fly' : 'croc';
  else if (flyOk)           kind = 'fly';
  else if (crocOk)          kind = 'croc';
  if (!kind) return;

  game.bayHazard = { bay, kind, bornAt: game.time };
}

/* --------------------------------------------------------------------------
   The lady frog
   --------------------------------------------------------------------------
   Rides a log. Hop onto her square to pick her up, then get home for 200.
   -------------------------------------------------------------------------- */
function updateLady(dt) {
  if (!hazard('lady') || !ladyLanes.length) return;

  if (game.lady) {
    /* She goes with her log. Once it leaves the screen she is gone. */
    const { lane, ob } = game.lady;
    if (ob.x + ob.cells * GRID < 0 || ob.x > WIDTH || ob.variant === 'gator') {
      game.lady = null;
      game.nextLadySpawn = game.time + CONFIG.timing.ladySpawnGap;
    }
    return;
  }

  if (game.carrying || game.time < game.nextLadySpawn) return;

  /* Put her on a log that is fully on screen, so she is actually reachable. */
  const candidates = [];
  for (const lane of ladyLanes) {
    for (const ob of lane.obstacles) {
      if (ob.variant === 'gator') continue;
      if (ob.x >= 0 && ob.x + ob.cells * GRID <= WIDTH) candidates.push({ lane, ob });
    }
  }
  if (!candidates.length) return;

  const pick = candidates[Math.floor(rng() * candidates.length)];
  game.lady = {
    lane: pick.lane,
    ob: pick.ob,
    cell: Math.floor(rng() * pick.ob.cells),
  };
}

function ladyX() {
  if (!game.lady) return null;
  return game.lady.ob.x + game.lady.cell * GRID;
}


/* --------------------------------------------------------------------------
   checkLane: everything that can happen where the frog is standing.
   This is the heart of the rules.
   -------------------------------------------------------------------------- */
function checkLane(dt) {
  const frog = game.frog;
  const lane = lanes[frog.row];

  const frogL = frog.x + HIT_INSET;
  const frogR = frog.x + GRID - HIT_INSET;
  const centre = frog.x + GRID / 2;

  switch (lane.type) {

    /* ------------------------------------------- the road, and the median */
    case 'road': {
      if (!laneActive(lane)) break;         /* no snakes before level 3 */
      for (const ob of lane.obstacles) {
        const obR = ob.x + ob.cells * GRID;
        if (frogL < obR - HIT_INSET && frogR > ob.x + HIT_INSET) {
          die(lane.kind === 'snake' ? 'Bitten by a snake' : 'Squashed');
          return;
        }
      }
      break;
    }

    /* ------------------------------------------------------------ the river */
    case 'river': {
      let riding = null;
      let sankUnderUs = false;

      for (const ob of lane.obstacles) {
        if (centre < ob.x || centre > ob.x + ob.cells * GRID) continue;
        if (diveState(lane, ob).submerged) { sankUnderUs = true; continue; }
        riding = ob;
        break;
      }

      if (!riding) {
        game.riding = null;
        die(sankUnderUs ? 'The turtles dived' : 'Drowned');
        return;
      }
      game.riding = riding;

      /* Crocodile jaws. The body is a perfectly good boat. */
      if (riding.variant === 'gator' && gatorBites(lane, riding) &&
          cellUnder(riding, centre) === gatorHeadCell(riding)) {
        die('Eaten by a crocodile');
        return;
      }

      /* Pick up the lady frog if we have landed on her square. */
      if (game.lady && game.lady.lane === lane) {
        const lx = ladyX();
        if (centre >= lx && centre <= lx + GRID) {
          game.lady = null;
          game.carrying = true;
          Sound.play('pickup');
        }
      }

      /* Ride along. */
      const drift = riding.vx * dt * 60 * speedMultiplier();
      frog.x += drift;
      frog.hopFromX += drift;

      if (rule('edgeIsDeath')) {
        const c = frog.x + GRID / 2;
        if (c < 0 || c > WIDTH) { die('Washed away'); return; }
      } else {
        frog.x = Math.max(0, Math.min(WIDTH - GRID, frog.x));
      }
      break;
    }

    /* ------------------------------------------------------- the lilypads */
    case 'home': {
      const bay = CONFIG.homeCols.findIndex(
        (col) => Math.abs(frog.x - col * GRID) < GRID * 0.5
      );

      /* The bank between two bays is solid ground you cannot land on. */
      if (bay === -1) {
        if (rule('bankIsDeath')) die('Hit the bank');
        return;
      }

      if (game.bays[bay]) {
        if (rule('occupiedBayIsDeath')) die('That lilypad is taken');
        return;
      }

      /* A crocodile in the bay. Safe only while it is still surfacing. */
      const hz = game.bayHazard;
      if (hz && hz.bay === bay && hz.kind === 'croc') {
        const surfacing = game.time - hz.bornAt < CONFIG.timing.bayCrocSurfacing;
        if (!surfacing) { die('A crocodile was waiting'); return; }
      }

      /* Home. */
      game.bays[bay] = true;

      let points = CONFIG.score.reachHome;
      let label = null;

      const halves = Math.floor(game.timeLeft * 2);
      points += halves * CONFIG.score.perHalfSecondLeft;

      if (hz && hz.bay === bay && hz.kind === 'fly') {
        points += CONFIG.score.fly;
        label = `FLY +${CONFIG.score.fly}`;
        game.bayHazard = null;
        game.nextBaySpawn = game.time + setting('baySpawnGap', CONFIG.timing.baySpawnGap);

        /* In expert mode a fly is worth a whole frog, which is the only way
           to get one back. Well worth going out of your way for. */
        if (setting('flyGivesLife', false)) {
          game.lives++;
          label = 'FLY  +1 FROG!';
          Sound.play('life');
        }
      }

      if (game.carrying) {
        points += CONFIG.score.ladyFrog;
        label = `LADY +${CONFIG.score.ladyFrog}`;
        game.carrying = false;
        game.nextLadySpawn = game.time + CONFIG.timing.ladySpawnGap;
      }

      addScore(points, label);
      Sound.play('home');

      const filled = game.bays.filter(Boolean).length;
      const needed = Math.max(1, Math.min(CONFIG.baysToClear, CONFIG.homeCols.length));

      if (filled >= needed) {
        addScore(CONFIG.score.clearLevel, `LEVEL CLEAR +${CONFIG.score.clearLevel}`);
        Sound.play('level');
        setState('levelClear');
      } else {
        respawn();
      }
      break;
    }
  }
}




/* ==========================================================================
   THE BONUS ROUND  ::  monster truck rampage
   --------------------------------------------------------------------------
   Every few levels the frog climbs into a monster truck and the rules go out
   of the window. Nothing can kill you. The traffic and the boats are there to
   be flattened, the truck drives freely instead of hopping, and a multiplier
   climbs as long as you keep hitting things.

   The whole point is that it feels like a reward, so it is deliberately loud:
   the screen shakes, debris flies, the numbers pop, and the multiplier is
   right in the middle of the screen where you cannot miss it.
   ========================================================================== */

const TRUCK_SIZE = GRID * 1.4;

const bonus = {
  x: 0, y: 0,
  smashed: 0,
  combo: 0,
  bestCombo: 0,
  lastSmash: -99,
  points: 0,
  timeLeft: 0,
  particles: [],
  floats: [],
  shake: 0,
  flash: 0,
  wet: false,          /* the truck is on the water */
  nextWake: 0,
};

/* Is that level a monster truck rampage? */
function isBonusLevel(level) {
  return planFor(level).kind === 'truck';
}

/* Anything in a road or river row is fair game. */
function smashableLanes() {
  return lanes.filter((l) => (l.type === 'road' || l.type === 'river') &&
                             l.obstacles.length);
}

function startBonusRound() {
  bonus.x = (WIDTH - TRUCK_SIZE) / 2;
  bonus.y = laneY(START_ROW) + (GRID - TRUCK_SIZE) / 2;
  bonus.smashed = 0;
  bonus.combo = 0;
  bonus.bestCombo = 0;
  bonus.lastSmash = -99;
  bonus.points = 0;
  bonus.timeLeft = BONUS.duration;
  bonus.wet = false;
  bonus.nextWake = 0;
  bonus.particles.length = 0;
  bonus.floats.length = 0;
  bonus.shake = 0;
  bonus.flash = 0;

  /* Everything is back on the board and un-smashed. */
  for (const lane of lanes) for (const ob of lane.obstacles) ob.deadUntil = 0;
}

function endBonusRound() {
  for (const lane of lanes) for (const ob of lane.obstacles) ob.deadUntil = 0;
  game.bonusTotal = bonus.points;
  addScore(bonus.points);
  calmDown();
}

/* Put the screen back how we found it. Called when the rampage ends and again
   whenever a level starts, because a shake left running is very obvious and
   there is no reason to risk it. */
function calmDown() {
  bonus.shake = 0;
  bonus.flash = 0;
  bonus.particles.length = 0;
  bonus.floats.length = 0;
}

/* What is this thing worth? */
function smashValue(lane, rules) {
  const pts = (rules || BONUS).points;
  if (lane.type === 'river') return pts.boat;
  if (lane.cells >= 2) return pts.truck;
  return pts.car;
}

/* Which row the truck is sitting on, and whether that row is water. */
function truckLane() {
  const cy = bonus.y + TRUCK_SIZE / 2;
  return lanes.find((l) => cy >= laneY(l.row) && cy < laneY(l.row) + GRID) || null;
}

function truckAfloat() {
  const lane = truckLane();
  return !!lane && lane.type === 'river';
}

/* The engine is a different machine on the water. Swapping profiles has to go
   through a stop first: start() is a no-op while it is already running, which
   is how you end up driving a monster truck that sounds like a helicopter. */
function setEngineProfile(name) {
  if (!Engine.running || Engine.profile === name) return;
  Engine.stop();
  Engine.start(name);
}

function updateBonus(dt) {
  bonus.timeLeft -= dt;

  /* --- in and out of the water --- */
  const wet = truckAfloat();
  if (wet !== bonus.wet) {
    bonus.wet = wet;
    Sound.play('splash');
    spawnDebris(bonus.x + TRUCK_SIZE / 2, bonus.y + TRUCK_SIZE * 0.8,
                '#bfe4ff', 18);
    bonus.shake = Math.max(bonus.shake, 7);
    setEngineProfile(wet ? 'boat' : 'truck');
  }

  /* --- drive --- */
  let dx = 0, dy = 0;
  if (held.left)  dx -= 1;
  if (held.right) dx += 1;
  if (held.up)    dy -= 1;
  if (held.down)  dy += 1;
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }   /* no free speed diagonally */

  const drive = BONUS.speed * (bonus.wet ? BONUS.waterSpeed : 1);
  bonus.x += dx * drive * dt;
  bonus.y += dy * drive * dt;

  /* Wake off the back, thrown the opposite way to travel. */
  if (bonus.wet && (dx || dy) && game.time >= bonus.nextWake) {
    bonus.nextWake = game.time + BONUS.wakeEvery;
    const bx = bonus.x + TRUCK_SIZE / 2 - dx * TRUCK_SIZE * 0.42;
    const by = bonus.y + TRUCK_SIZE / 2 - dy * TRUCK_SIZE * 0.42;
    for (let i = 0; i < 2; i++) {
      bonus.particles.push({
        x: bx + (Math.random() - 0.5) * TRUCK_SIZE * 0.5,
        y: by + (Math.random() - 0.5) * TRUCK_SIZE * 0.5,
        vx: -dx * 60 + (Math.random() - 0.5) * 70,
        vy: -dy * 60 + (Math.random() - 0.5) * 70,
        life: 0.3 + Math.random() * 0.3,
        size: 2 + Math.random() * 4,
        color: Math.random() < 0.5 ? '#ffffff' : '#bfe4ff',
        foam: true,
      });
    }
  }

  /* Stay on the board, HUD rows included as walls. */
  bonus.x = Math.max(0, Math.min(WIDTH - TRUCK_SIZE, bonus.x));
  bonus.y = Math.max(GRID, Math.min(HEIGHT - GRID - TRUCK_SIZE, bonus.y));

  /* --- smash --- */
  const pad = TRUCK_SIZE * 0.16;
  const tl = bonus.x + pad, tr = bonus.x + TRUCK_SIZE - pad;
  const tt = bonus.y + pad, tb = bonus.y + TRUCK_SIZE - pad;

  for (const lane of smashableLanes()) {
    if (!laneActive(lane)) continue;
    const ly = laneY(lane.row);
    if (tb < ly || tt > ly + GRID) continue;         /* wrong row entirely */

    for (const ob of lane.obstacles) {
      if (ob.deadUntil > game.time) continue;
      const ol = ob.x, or_ = ob.x + ob.cells * GRID;
      if (tl < or_ && tr > ol) smash(lane, ob);
    }
  }

  /* --- the combo cools off --- */
  if (bonus.combo && game.time - bonus.lastSmash > BONUS.comboWindow) {
    bonus.combo = 0;
  }

  /* --- effects --- */
  for (let i = bonus.particles.length - 1; i >= 0; i--) {
    const p = bonus.particles[i];
    p.life -= dt;
    if (p.life <= 0) { bonus.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    /* Debris falls. Foam does not, it spreads and dies. */
    if (p.foam) { p.vx *= 0.92; p.vy *= 0.92; }
    else p.vy += 420 * dt;
  }
  for (let i = bonus.floats.length - 1; i >= 0; i--) {
    if (game.time - bonus.floats[i].at > 1.1) bonus.floats.splice(i, 1);
  }

  if (bonus.timeLeft <= 0) {
    bonus.timeLeft = 0;
    endBonusRound();
    Sound.play('fanfare');
    setState('bonusResults');
  }
}

function smash(lane, ob, rules, sfx) {
  const R = rules || BONUS;
  ob.deadUntil = game.time + R.respawnDelay;

  /* Keep the run going and the multiplier climbs. */
  if (game.time - bonus.lastSmash <= R.comboWindow) {
    bonus.combo = Math.min(R.comboMax, bonus.combo + 1);
  } else {
    bonus.combo = 1;
  }
  bonus.lastSmash = game.time;
  bonus.bestCombo = Math.max(bonus.bestCombo, bonus.combo);
  bonus.smashed++;

  const gained = smashValue(lane, R) * bonus.combo;
  bonus.points += gained;

  const cx = ob.x + ob.cells * GRID / 2;
  const cy = laneY(lane.row) + GRID / 2;

  bonus.floats.push({
    text: `+${gained}`, x: Math.max(30, Math.min(WIDTH - 30, cx)), y: cy,
    at: game.time, big: bonus.combo >= 4,
  });

  /* Debris, in the colours of the thing that just stopped existing. */
  const art = Art.of(lane.type === 'river' ? 'boat' : (ob.variant || lane.kind));
  const tint = (art && art.color) ||
               (art && art.sprite && Art.pixel(pickLetter(art.sprite))) ||
               '#ffffff';
  spawnDebris(cx, cy, tint, 8 + bonus.combo);

  bonus.shake = Math.min(11, 5 + bonus.combo * 0.7);
  bonus.flash = Math.min(0.55, 0.22 + bonus.combo * 0.04);

  Sound.play(sfx || (bonus.combo >= 5 ? 'bigsmash' : 'smash'));
  Engine.rev(0.14 + bonus.combo * 0.02);   /* the engine bites as it hits */
}

/* Grab a representative colour out of a sprite, for the debris. */
function pickLetter(spriteName) {
  const rows = SPRITES[spriteName];
  if (!rows) return 'W';
  const mid = rows[Math.floor(rows.length / 2)] || '';
  for (const ch of mid) if (ch !== '.' && PALETTE[ch]) return ch;
  return 'W';
}

function spawnDebris(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 70 + Math.random() * 220;
    bonus.particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 90,
      life: 0.45 + Math.random() * 0.5,
      size: 2 + Math.random() * 4,
      color: Math.random() < 0.3 ? '#ffffff' : color,
    });
  }
}




/* ==========================================================================
   ROCKET LEVEL
   --------------------------------------------------------------------------
   No hopping. Slide along the bottom, pick your moment, launch. The rocket
   climbs on its own and a crosswind shoves it about, so the whole level is one
   question asked three times: can you line up with a lilypad from down here?
   ========================================================================== */

const rocket = {
  x: 0, y: 0,
  flying: false,
  attemptsLeft: 0,
  landed: 0,
  points: 0,
  grabbed: 0,
  wind: 0,
  windPhase: 0,
  trail: [],
  stars: [],
  fuel: 0,
  burning: false,
  armed: false,
  hovering: false,
  outcome: '',
  outcomeAt: -99,
};

/* The median row, as a band of screen y. There is only one, and it is the row
   the whole board is built around resting on. */
function medianLane() {
  return lanes.find((l) => l.type === 'safe' || l.background === 'median') || null;
}

function overMedian(y) {
  const lane = medianLane();
  if (!lane) return false;
  const top = laneY(lane.row);
  return y + GRID * 0.5 > top && y + GRID * 0.5 < top + GRID;
}

function startRocket() {
  rocket.attemptsLeft = ROCKET.attempts;
  rocket.outcomeAt = -99;
  rocket.landed = 0;
  rocket.points = 0;
  rocket.grabbed = 0;
  rocket.trail.length = 0;
  rocket.outcome = '';
  rocket.outcomeAt = -99;
  rocket.windPhase = rng() * 6.28;
  resetRocket();
}

function resetRocket() {
  rocket.x = START_COL * GRID;
  rocket.y = laneY(START_ROW);
  rocket.flying = false;
  rocket.wind = 0;
  rocket.fuel = ROCKET.fuel;
  rocket.burning = false;
  rocket.armed = false;      /* let go of UP before the next one goes */
  rocket.trail.length = 0;
  scatterStars();
}

/* Stars sit between the rows on the way up. They are worth going out of your
   way for, which is the whole reason to steer rather than just hold still and
   hope the wind is kind. */
function scatterStars() {
  rocket.stars.length = 0;
  const rows = NLANES - 2;
  for (let i = 0; i < ROCKET.starsPerFlight; i++) {
    const row = 1 + Math.floor(((i + 0.5) / ROCKET.starsPerFlight) * rows);
    rocket.stars.push({
      x: GRID * 0.6 + rng() * (WIDTH - GRID * 2.2),
      y: laneY(row) + GRID * 0.5,
      taken: false,
    });
  }
}

function launchRocket() {
  if (rocket.flying || !rocket.attemptsLeft || !rocket.armed) return;
  rocket.armed = false;
  rocket.flying = true;
  rocket.attemptsLeft--;
  Sound.play('launch');
  Engine.rev(1.2);          /* holds the roar wide open off the pad */
  bonus.shake = 8;
  spawnDebris(rocket.x + GRID / 2, rocket.y + GRID, '#ffb020', 22);
}

function rocketOutcome(text) {
  rocket.outcome = text;
  rocket.outcomeAt = game.time;
}

function updateRocket(dt) {
  /* The wind wanders rather than flipping, so you can read it before you go. */
  rocket.windPhase += dt * ROCKET.windTurns * 6.28;
  rocket.wind = Math.sin(rocket.windPhase) * ROCKET.wind;

  if (!rocket.flying) {
    /* Lining up. Side to side only. */
    let dx = 0;
    if (held.left) dx -= 1;
    if (held.right) dx += 1;
    rocket.x += dx * BONUS.speed * dt;
    rocket.x = Math.max(0, Math.min(WIDTH - GRID, rocket.x));

    /* UP is the throttle now, so people hold it rather than tap it. Without
       this, being shot down put you straight back on the pad with the key
       still down, which fired the next rocket on the same frame, and the one
       after that, and the level was over before you saw what happened. So the
       pad needs the key released, and a moment to show you the outcome. */
    if (!rocket.armed) {
      const waited = game.time - rocket.outcomeAt > ROCKET.relaunchPause;
      if (!held.up && waited) rocket.armed = true;
    } else if (held.up) {
      launchRocket();
    }

    if (!rocket.attemptsLeft && game.time - rocket.outcomeAt > 1.2) {
      finishRocket();
    }
    return;
  }

  /* Flying. You get some say, the wind gets the rest. */
  let steer = 0;
  if (held.left) steer -= 1;
  if (held.right) steer += 1;

  /* The booster. Holding UP burns it and climbs hard, letting go drops you to
     a crawl, and either way the traffic keeps moving, so hanging back to wait
     for a gap is paid for in booster you will not have further up. */
  rocket.burning = held.up && rocket.fuel > 0;
  if (rocket.burning) rocket.fuel = Math.max(0, rocket.fuel - dt);

  /* The median is the one place you can stop. Coast into it and the rocket
     holds there, so the climb splits into two decisions instead of one long
     commit. Same rule the ice level teaches, asked from below. */
  /* Only while you still have throttle to leave with. Hovering on an empty
     tank would be a rest stop you can never get off, which is a softlock, not
     a mechanic. */
  rocket.hovering = ROCKET.hoverOnMedian && !rocket.burning &&
                    rocket.fuel > 0 && overMedian(rocket.y);

  const climb = rocket.hovering ? 0
              : ROCKET.climb * (rocket.burning ? ROCKET.boost : ROCKET.coast);

  rocket.x += (steer * ROCKET.steer + rocket.wind) * dt;
  rocket.y -= climb * dt;

  /* A little bob while it sits there, so it reads as holding station rather
     than as the game having frozen. */
  if (rocket.hovering) rocket.y += Math.sin(game.time * 5) * 0.35;
  rocket.x = Math.max(-GRID * 0.4, Math.min(WIDTH - GRID * 0.6, rocket.x));

  rocket.trail.push({ x: rocket.x + GRID / 2, y: rocket.y + GRID, at: game.time });
  if (rocket.trail.length > 90) rocket.trail.shift();

  const cx = rocket.x + GRID / 2;
  const cy = rocket.y + GRID / 2;
  const r = GRID * ROCKET.hitbox * 0.5;

  /* Stars. */
  for (const st of rocket.stars) {
    if (st.taken) continue;
    if (Math.abs(st.x + GRID / 2 - cx) < GRID * 0.6 &&
        Math.abs(st.y - cy) < GRID * 0.6) {
      st.taken = true;
      rocket.grabbed++;
      rocket.points += ROCKET.starPoints;
      addScore(ROCKET.starPoints);
      Sound.play('star');
      spawnDebris(st.x + GRID / 2, st.y, '#ffe070', 8);
      bonus.floats.push({ text: `+${ROCKET.starPoints}`, x: st.x + GRID / 2,
                          y: st.y, at: game.time, big: false });
    }
  }

  /* The traffic and the river are in the way. This is the level. */
  for (const lane of smashableLanes()) {
    if (!laneActive(lane)) continue;
    const ly = laneY(lane.row);
    if (cy + r < ly || cy - r > ly + GRID) continue;
    for (const ob of lane.obstacles) {
      if (ob.deadUntil > game.time) continue;
      if (cx + r > ob.x + HIT_INSET && cx - r < ob.x + ob.cells * GRID - HIT_INSET) {
        crashRocket();
        return;
      }
    }
  }

  /* Reached the bank. Did we line it up? */
  if (rocket.y <= laneY(0)) {
    const bay = CONFIG.homeCols.findIndex(
      (c) => Math.abs(rocket.x - c * GRID) < GRID * 0.55
    );
    const good = bay >= 0 && !game.bays[bay];

    if (good) {
      game.bays[bay] = true;
      rocket.landed++;
      rocket.points += ROCKET.points;
      addScore(ROCKET.points, `LANDED +${ROCKET.points}`);
      Sound.play('home');
      spawnDebris(rocket.x + GRID / 2, laneY(0) + GRID / 2, '#ffd84a', 18);
      bonus.flash = 0.35;
      rocketOutcome('PERFECT LANDING');

      const needed = Math.max(1, Math.min(CONFIG.baysToClear, CONFIG.homeCols.length));
      if (game.bays.filter(Boolean).length >= needed) {
        finishRocket();
        return;
      }
    } else {
      Sound.play('splash');
      spawnDebris(rocket.x + GRID / 2, laneY(0) + GRID / 2, '#ff4040', 20);
      bonus.shake = 9;
      bonus.flash = 0.3;
      rocketOutcome(bay >= 0 ? 'THAT PAD IS TAKEN' : 'MISSED THE PAD');
    }

    resetRocket();
    if (!rocket.attemptsLeft && game.bays.filter(Boolean).length === 0) {
      /* Out of rockets with nothing to show for it: that costs a frog. */
      game.lives--;
    }
  }
}

function crashRocket() {
  Sound.play('crash');
  spawnDebris(rocket.x + GRID / 2, rocket.y + GRID / 2, '#ff7020', 24);
  bonus.shake = 11;
  bonus.flash = 0.4;
  rocketOutcome('SHOT DOWN');
  resetRocket();
  if (!rocket.attemptsLeft && rocket.landed === 0) game.lives--;
}

function finishRocket() {
  /* Landing the last one returns straight from updateRocket without going
     through resetRocket, which used to leave `flying` stuck true all the way
     into the next level. Nothing read it there, so nothing broke, but the
     rocket claiming to be airborne during a crossing is a lie waiting to be
     believed by the next thing that asks. */
  rocket.flying = false;
  rocket.burning = false;
  Sound.play(rocket.landed ? 'fanfare' : 'over');
  setState('rocketResults');
}


/* ==========================================================================
   SPEEDBOAT BOSS RUN
   --------------------------------------------------------------------------
   The final level, and the only one that does not sit on the top-down grid.

   It is built the way every pseudo-3D racer since Pole Position has been
   built. The river is a list of segments, each carrying a curve and a hill.
   The renderer walks them from your bow out to the horizon, accumulating both
   as it goes, and draws the water and the banks as a ribbon of quads between
   consecutive segments. That accumulated drift is the whole trick: it is what
   makes a flat list of numbers look like a river bending away over a rise.

   Everything else hangs off the same walk. A log, a buoy, the boss, all of it
   is "which segment am I on and how far across", projected with that
   segment's own scale and drift, so it sits in the world rather than on top
   of it.

   Why it works as a game rather than a demo:

     - the bends throw you at the outside bank, so speed has a price and the
       racing line is a real thing you can be good or bad at
     - the throttle is a throttle, not a resource. UP winds it up, DOWN scrubs
       it off, and carrying speed through a bend is the skill
     - the furniture is Frogger's own: logs across the channel, turtle rafts
       that surface and dive so a gap opens and closes, crocodiles drifting
       down at you, buoys marking the line you should be taking
     - checkpoint gates put time back on the clock, which is the oldest
       arcade tension there is
     - the boss is out in front the whole way, and you catch it by driving
       better than it does
   ========================================================================== */

const boat = {
  /* --- the course --- */
  segs: [],
  gates: [],
  props: [],

  /* --- you --- */
  pos: 0,             /* distance along the course, in segments */
  x: 0,               /* across the river, -1 to 1 */
  speed: 0,
  spinUntil: 0,
  spins: 0,
  hurtAt: -99,

  /* --- the boss --- */
  bossPos: 0,
  bossX: 0,
  bossHits: 0,
  bossPhase: 0,
  phase: 0,
  nextDrop: 0,
  nextShot: 0,
  sinkAt: -99,

  /* --- everything floating --- */
  things: [],
  shots: [],
  spray: [],

  /* --- the run --- */
  timeLeft: 0,
  gateAt: 0,
  gatesMade: 0,
  rams: 0,
  points: 0,
  outcome: '',
  outcomeAt: -99,
  won: false,
};

/* A local generator, so laying out the course cannot disturb the seeded rng
   the crossing levels rely on for their own layouts. Same course every time,
   which is the point: a racer you cannot learn is not a racer. */
function courseRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* --- building the river -------------------------------------------------- */

function buildCourse() {
  const rnd = courseRng(1987654321);
  boat.segs.length = 0;

  /* Stretches of straight, bend and crest, eased in and out so nothing
     changes on a single segment boundary and snaps. */
  while (boat.segs.length < BOAT.segments) {
    const len = 26 + Math.floor(rnd() * 46);
    const bend = rnd() < 0.32 ? 0 : (rnd() * 2 - 1) * BOAT.bendMax;
    const rise = rnd() < 0.38 ? 0 : (rnd() * 2 - 1) * BOAT.hillMax;

    for (let n = 0; n < len && boat.segs.length < BOAT.segments; n++) {
      const ease = Math.sin((n / len) * Math.PI);
      boat.segs.push({
        curve: bend * ease,
        hill:  rise * ease,
        /* filled in by the render walk each frame */
        vx: 0, vy: 0, scale: 0, drift: 0, lift: 0,
      });
    }
  }

  buildGates();
  buildFurniture();
  buildBanks();
}

function segAt(i) {
  const n = boat.segs.length;
  return boat.segs[((i % n) + n) % n];
}

function buildGates() {
  boat.gates.length = 0;
  for (let i = BOAT.gateEvery; i < BOAT.segments; i += BOAT.gateEvery) {
    boat.gates.push({ seg: i, taken: false });
  }
}

/* Logs, turtle rafts, crocodiles and buoys, laid out down the course.

   Placed as one ordered run with a minimum gap, rather than three independent
   sequences. Three sequences was the first attempt and it can put a log, a
   raft and a crocodile within a few segments of each other, which walls the
   river off completely: there is no line through it, however well you drive.
   One list with a spacing rule means a way through always exists. */
function buildFurniture() {
  boat.things.length = 0;
  const rnd = courseRng(99991);

  /* Buoys are scenery and can go anywhere, so they are laid separately. */
  for (let i = 6; i < BOAT.segments; i += BOAT.buoyEvery) {
    boat.things.push({
      seg: i, kind: 'buoy', half: 0, dead: false, phase: rnd() * 6.28,
      x: (i % (BOAT.buoyEvery * 2) === 0 ? -1 : 1) * 0.88,
    });
  }

  const KINDS = [
    { kind: 'log',    half: 0.32, weight: 5 },
    { kind: 'turtle', half: 0.26, weight: 3 },
    { kind: 'croc',   half: 0.28, weight: 2 },
  ];
  const bag = KINDS.flatMap((k) => Array(k.weight).fill(k));

  let at = BOAT.clearStart;
  let lastX = 0;

  while (at < BOAT.segments - 8) {
    const k = bag[Math.floor(rnd() * bag.length)];

    /* Put it somewhere you are not already, so the course keeps asking you to
       move rather than letting you hold one line the whole way down. */
    let x = (rnd() * 2 - 1) * 0.66;
    if (Math.abs(x - lastX) < 0.5) x = -Math.sign(lastX || 1) * (0.28 + rnd() * 0.38);
    lastX = x;

    boat.things.push({
      seg: at, kind: k.kind, half: k.half, x,
      dead: false, phase: rnd() * 6.28,
    });

    at += BOAT.hazardGap + Math.floor(rnd() * BOAT.hazardVary);
  }

  boat.things.sort((p, q) => p.seg - q.seg);
}

/* Rocks and posts up on the banks. They do nothing but stream past, which is
   the only honest report of how fast you are actually going. */
function buildBanks() {
  boat.props.length = 0;
  const rnd = courseRng(4242);
  for (let i = 0; i < BOAT.segments; i += 3) {
    boat.props.push({
      seg: i,
      side: rnd() < 0.5 ? -1 : 1,
      out: 0.1 + rnd() * 0.55,
      tall: 0.4 + rnd() * 1.5,
      kind: Math.floor(rnd() * 3),
    });
  }
}

/* Where a raft is in its cycle. Same three-phase shape the crossing rows use,
   so the warning means the same thing here as it does there. */
function turtleState(t) {
  const cycle = BOAT.turtleDown + BOAT.turtleRising + BOAT.turtleUp;
  const at = (game.time + t.phase * 2) % cycle;
  if (at < BOAT.turtleDown) return 'down';
  if (at < BOAT.turtleDown + BOAT.turtleRising) return 'rising';
  return 'up';
}

function turtleUp(t) {
  return turtleState(t) === 'up';
}

function thingSolid(t) {
  if (t.dead) return false;
  if (t.kind === 'buoy') return false;
  if (t.kind === 'turtle') return turtleUp(t);
  return true;
}

/* --- the projection ------------------------------------------------------ */

function boatHorizonY() {
  return GRID + (HEIGHT - GRID * 2) * BOAT.horizon;
}

function boatBottomY() {
  return HEIGHT - GRID;
}

/* Distance ahead to a screen row and a scale. Scale is 1 at the bow and falls
   away to nothing at the horizon, which is what narrows the far bank. */
function boatProject(z) {
  const scale = BOAT.camera / (Math.max(0, z) + BOAT.camera);
  const hy = boatHorizonY();
  return { scale, y: hy + (boatBottomY() - hy) * scale };
}

/* Where a point across the river lands, given that segment's scale and how
   far the river has drifted sideways by the time it gets out there. */
function boatScreenX(x, scale, drift) {
  return WIDTH / 2 + (x - boat.x + (drift || 0)) * scale * (WIDTH / 2) * BOAT.spread;
}

/* The walk. Once a frame, work out where every visible segment lands, and
   stash it on the segment so everything else can just look it up. */
function walkCourse() {
  const base = Math.floor(boat.pos);
  const pct = boat.pos - base;

  let drift = 0, dDrift = 0;
  let lift = 0, dLift = 0;

  for (let n = 0; n < BOAT.draw; n++) {
    const seg = segAt(base + n);
    const z = (n - pct) * BOAT.segLen;
    const p = boatProject(z);

    seg.scale = p.scale;
    seg.drift = drift;
    seg.lift  = lift;
    seg.vx = WIDTH / 2 + (drift - boat.x) * p.scale * (WIDTH / 2) * BOAT.spread;
    seg.vy = p.y - lift * p.scale;
    seg.z = z;

    dDrift += seg.curve;
    drift  += dDrift;
    dLift  += seg.hill * 0.02;
    lift   += dLift;
  }
}

/* Where something at a given course position lands, interpolated between the
   two segments it sits between. */
function thingView(segPos) {
  const base = Math.floor(boat.pos);
  const n = segPos - base;
  if (n < -1 || n >= BOAT.draw - 1) return null;

  const i = Math.max(0, Math.floor(n));
  const a = segAt(base + i);
  if (!a.scale) return null;
  return { scale: a.scale, y: a.vy, drift: a.drift, z: a.z };
}

/* --- running it ---------------------------------------------------------- */

function startBoat() {
  buildCourse();

  boat.pos = 0;
  boat.x = 0;
  boat.speed = BOAT.idle;
  boat.spinUntil = 0;
  boat.spins = 0;
  boat.hurtAt = -99;

  boat.bossPos = BOAT.bossGap;
  boat.bossX = 0;
  boat.bossHits = 0;
  boat.bossPhase = 0;
  boat.phase = 0;
  /* A beat before it starts dumping things behind it. Dropping a log on the
     first frame puts one dead ahead of you at the exact lateral you both
     start on, which is not a mechanic, it is an ambush. */
  boat.nextDrop = game.time + BOAT.dropEvery;
  boat.nextShot = game.time + BOAT.dropEvery;
  boat.sinkAt = -99;

  boat.shots.length = 0;
  boat.spray.length = 0;

  boat.timeLeft = BOAT.duration;
  boat.gateAt = 0;
  boat.gatesMade = 0;
  boat.rams = 0;
  boat.points = 0;
  boat.won = false;
  boat.outcome = '';
  boat.outcomeAt = -99;
}

function boatOutcome(text) {
  boat.outcome = text;
  boat.outcomeAt = game.time;
}

function finishBoat() {
  Sound.play(boat.won ? 'fanfare' : 'over');
  setState('boatResults');
}

function boatPhase() {
  let out = BOAT.phases[0];
  for (const ph of BOAT.phases) if (boat.bossHits >= ph.at) out = ph;
  return out;
}

/* How fast you are going, as a fraction of flat out. Used by half the feel:
   the wash, the shake, the speedo, the field of view. */
function boatPace() {
  return Math.max(0, Math.min(1, (boat.speed - BOAT.idle) / (BOAT.top - BOAT.idle)));
}

/* Spin out. Costs you your speed and a second of control, which on a clock
   that only a checkpoint can refill is the most expensive thing there is.
   Nothing here can end the run. Only the clock can do that. */
function spinOut(reason) {
  if (game.time - boat.hurtAt < BOAT.grace) return false;

  boat.hurtAt = game.time;
  boat.spins++;
  boat.speed = Math.min(boat.speed, BOAT.crashTo);
  boat.spinUntil = game.time + BOAT.spinTime;

  bonus.shake = 14;
  bonus.flash = 0.28;
  Sound.play('mine');
  boatOutcome(reason);
  return true;
}

function updateBoat(dt) {
  /* Once it is going down, everything stops except the wreck and the water.
     Cutting straight to a tally made six rams feel like a spreadsheet entry. */
  if (boat.sinkAt > 0) {
    boat.pos += BOAT.idle * 0.4 * dt;
    updateBoatSpray(dt);
    walkCourse();
    if (game.time - boat.sinkAt > 2.4) finishBoat();
    return;
  }

  boat.timeLeft -= dt;

  const spinning = game.time < boat.spinUntil;
  const ph = boatPhase();

  /* --- temper --- */
  const phIdx = BOAT.phases.indexOf(ph);
  if (phIdx !== boat.phase) {
    boat.phase = phIdx;
    if (ph.label) {
      boatOutcome(ph.label);
      bonus.flash = 0.35;
      Sound.play('bonus');
    }
  }

  /* --- throttle and brake --- */
  if (!spinning) {
    if (held.up)        boat.speed += BOAT.accel * dt;
    else if (held.down) boat.speed -= BOAT.brake * dt;
    else                boat.speed -= BOAT.drag * dt;
  } else {
    boat.speed -= BOAT.brake * 0.6 * dt;
  }
  boat.speed = Math.max(BOAT.idle * 0.35, Math.min(BOAT.top, boat.speed));

  boat.pos += boat.speed * dt;

  /* --- steering, and the bend trying to put you in the bank ---
     This is the level. The faster you take a bend the harder it throws you at
     the outside, so speed has a price and the line you take is a real skill. */
  const here = segAt(Math.floor(boat.pos));
  const pace = boatPace();

  if (!spinning) {
    let dx = 0;
    if (held.left)  dx -= 1;
    if (held.right) dx += 1;
    boat.x += dx * BOAT.steer * dt;
  } else {
    /* Spun out: you are a passenger for a moment. */
    boat.x += Math.sin((boat.spinUntil - game.time) * 18) * 1.4 * dt;
  }

  /* The bend pushes you at the outside bank, harder the faster you are going.
     It has to stay well under the steering authority or the river simply pins
     you to the bank and there is nothing you can do about it, which is not a
     racing line, it is a cutscene. At full curve and flat out this is about
     six tenths of what the steering can hold. */
  boat.x -= here.curve * (0.4 + pace) * BOAT.centrifugal * dt;

  /* --- the banks --- */
  const wall = BOAT.riverHalf * 0.95;
  if (boat.x < -wall || boat.x > wall) {
    boat.x = Math.max(-wall, Math.min(wall, boat.x));
    boat.speed *= (1 - BOAT.bankPush * dt * 6);
    if (pace > 0.25) {
      if (spinOut('INTO THE BANK')) spawnBoatSpray(boat.x, 0.4, 14);
    } else {
      spawnBoatSpray(boat.x, 0.2, 2);
      Sound.play('wake');
    }
  }

  /* --- checkpoint gates --- */
  for (const g of boat.gates) {
    if (g.taken || boat.pos < g.seg) continue;
    g.taken = true;
    boat.gatesMade++;
    boat.timeLeft = BOAT.duration;
    boat.points += BOAT.points.gate;
    addScore(BOAT.points.gate, 'CHECKPOINT');
    Sound.play('star');
    bonus.flash = 0.2;
    boatOutcome('CHECKPOINT');
  }

  /* --- the boss --- */
  boat.bossPhase += dt * BOAT.bossWeave * ph.weave;
  boat.bossX = Math.sin(boat.bossPhase) * BOAT.riverHalf * BOAT.bossRange;

  /* The boss runs at your pace, a shade under it, plus a kick when you are
     right on its transom.

     Flat speed was wrong twice over. Drive badly and it vanished up the river
     and there was no level. Drive well and you overtook it, at which point it
     was behind you, the ram check could never fire again, and the level was
     also over. It now tracks you, so the chase is always a chase, and you
     close on it by driving well rather than by holding one key. */
  const gap = boat.bossPos - boat.pos;
  const fleeing = gap < BOAT.bossGap ? (1 - gap / BOAT.bossGap) * BOAT.bossRun : 0;
  const bossSpeed = Math.max(BOAT.idle * 1.2, boat.speed * BOAT.bossPace) + fleeing;

  boat.bossPos += bossSpeed * dt;

  /* And you cannot get past it. It is the thing in front. */
  boat.bossPos = Math.max(boat.bossPos, boat.pos + BOAT.bossMin);
  boat.bossPos = Math.min(boat.bossPos, boat.pos + BOAT.draw * 0.55);

  if (boat.bossPos - boat.pos <= BOAT.ramRange &&
      Math.abs(boat.bossX - boat.x) < BOAT.ramWidth) {
    ramBoss();
    if (boat.sinkAt > 0) return;
  }

  /* --- what it drops, and what it fires --- */
  if (game.time >= boat.nextDrop) {
    boat.nextDrop = game.time + BOAT.dropEvery * ph.drop;
    /* Dropped where the boss is, not behind it. Behind it sounds right and
       plays terribly: at flat out you get a fifth of a second to react, which
       is not a dodge, it is a coin toss. Dropping it at the boss gives you the
       whole gap between you to see it and move. */
    const alive = boat.things.filter((t) => t.dropped && !t.dead).length;
    if (alive < BOAT.maxDropped) {
      boat.things.push({
        seg: boat.bossPos, kind: 'log', x: boat.bossX,
        half: 0.30, dead: false, phase: 0, dropped: true,
      });
    }
    spawnBoatSpray(boat.bossX, boat.bossPos - boat.pos, 6);
    Sound.play('wake');
  }

  if (ph.shootEvery > 0 && game.time >= boat.nextShot) {
    boat.nextShot = game.time + ph.shootEvery;
    boat.shots.push({ pos: boat.bossPos, x: boat.bossX, hit: false });
    Sound.play('shot');
  }

  for (let i = boat.shots.length - 1; i >= 0; i--) {
    const sh = boat.shots[i];
    sh.pos -= BOAT.shotSpeed * dt;
    if (sh.pos < boat.pos - 2) { boat.shots.splice(i, 1); continue; }
    if (sh.hit) continue;

    if (Math.abs(sh.pos - boat.pos) < 0.6 && Math.abs(sh.x - boat.x) < 0.28) {
      sh.hit = true;
      if (spinOut('HIT')) spawnBoatSpray(sh.x, 0.25, 12);
    }
  }

  /* --- clear out what is behind us ---
     The boss drops a log every couple of seconds and they were never cleaned
     up, so over a minute the river quietly filled with two dozen of them, at
     every lateral the boss had weaved through, until there was no line left
     anywhere. The course's own furniture stays (it is the course), but
     anything dropped is gone once it is behind you. */
  if (boat.things.length > BOAT.maxThings) {
    boat.things = boat.things.filter(
      (t) => !t.dropped || t.seg > boat.pos - 3
    );
  }
  for (let i = boat.things.length - 1; i >= 0; i--) {
    const t = boat.things[i];
    if (t.dropped && t.seg < boat.pos - 6) boat.things.splice(i, 1);
  }

  /* --- hitting the furniture --- */
  for (const t of boat.things) {
    if (!thingSolid(t)) continue;
    const d = t.seg - boat.pos;
    if (d > 0.7 || d < -0.7) continue;
    if (Math.abs(t.x - boat.x) > t.half + 0.16) continue;

    t.dead = true;
    const what = t.kind === 'croc' ? 'CROCODILE' : t.kind === 'turtle' ? 'TURTLES' : 'LOG';
    if (spinOut(what)) spawnBoatSpray(t.x, 0.3, 16);
  }

  /* --- the wash --- */
  if (pace > 0.15 && Math.random() < pace * 0.9) {
    spawnBoatSpray(boat.x + (Math.random() - 0.5) * 0.35, 0.05, 1);
  }

  updateBoatSpray(dt);
  walkCourse();

  if (boat.timeLeft <= 0) {
    boat.timeLeft = 0;
    boat.won = false;
    boatOutcome('THE RIVER RAN OUT');
    finishBoat();
  }
}

function ramBoss() {
  boat.bossHits++;
  boat.rams++;
  boat.points += BOAT.points.ram;
  addScore(BOAT.points.ram, 'RAM +' + BOAT.points.ram);
  Sound.play('ram');
  bonus.shake = 18;
  bonus.flash = 0.4;
  spawnBoatSpray(boat.bossX, 0.6, 18);
  boat.bossPos = boat.pos + BOAT.bossGap;

  if (boat.bossHits >= BOAT.bossHits) {
    boat.won = true;
    boat.points += BOAT.points.win;
    addScore(BOAT.points.win, 'BOSS DOWN');
    boat.sinkAt = game.time;
    boat.shots.length = 0;
    bonus.shake = 28;
    bonus.flash = 0.85;
    Sound.play('explode');
    spawnBoatSpray(boat.bossX, 0.8, 44);
    return;
  }
  boatOutcome('DIRECT HIT');
}

/* Water thrown up, in course coordinates so it shrinks with distance. */
function spawnBoatSpray(x, ahead, count) {
  for (let i = 0; i < count; i++) {
    boat.spray.push({
      x, pos: boat.pos + ahead,
      vx: (Math.random() - 0.5) * 1.3,
      vp: (Math.random() - 0.2) * 1.1,
      rise: 8 + Math.random() * 26,
      up: 0,
      life: 0.35 + Math.random() * 0.4,
      age: 0,
    });
  }
}

function updateBoatSpray(dt) {
  for (let i = boat.spray.length - 1; i >= 0; i--) {
    const p = boat.spray[i];
    p.age += dt;
    if (p.age >= p.life) { boat.spray.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.pos += p.vp * dt;
    p.up += (p.rise - p.up * 6) * dt;
  }
}

/* --- drawing ------------------------------------------------------------- */

function drawBoat() {
  if (!boat.segs.length) buildCourse();
  if (!segAt(Math.floor(boat.pos)).scale) walkCourse();

  const hy = boatHorizonY();
  const by = boatBottomY();
  const base = Math.floor(boat.pos);

  /* Sky. A band of sunset above the rim, because the gorge deserves one. */
  const sky = ctx.createLinearGradient(0, GRID, 0, hy);
  sky.addColorStop(0, Art.color('bayInner'));
  sky.addColorStop(0.72, '#5a2a4e');
  sky.addColorStop(1, '#c8583a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, GRID, WIDTH, hy - GRID);

  /* Everything below the skyline starts as bank, and the water is laid on
     top of it. That way the banks are whatever is left, however the river
     bends, with no second polygon to keep in step. */
  ctx.fillStyle = Art.color('grass');
  ctx.fillRect(0, hy, WIDTH, by - hy);

  /* --- the ribbon --- */
  for (let n = BOAT.draw - 2; n >= 0; n--) {
    const a = segAt(base + n);
    const b = segAt(base + n + 1);
    if (!a.scale || !b.scale) continue;
    if (a.vy <= b.vy) continue;                 /* over a crest, nothing to draw */

    /* Alternating shade, keyed to the segment's own index so the bands travel
       towards you instead of crawling. This is what tells you your speed. */
    const dark = (Math.floor((base + n) / 3) % 2) === 0;

    const aL = boatScreenX(-BOAT.riverHalf, a.scale, a.drift);
    const aR = boatScreenX( BOAT.riverHalf, a.scale, a.drift);
    const bL = boatScreenX(-BOAT.riverHalf, b.scale, b.drift);
    const bR = boatScreenX( BOAT.riverHalf, b.scale, b.drift);

    /* The bank, a little wider than the water, so there is a lip to it. */
    const lip = GRID * 0.5;
    ctx.fillStyle = dark ? '#4a2f22' : '#573828';
    quad(ctx, aL - lip * a.scale, a.vy, aR + lip * a.scale, a.vy,
              bR + lip * b.scale, b.vy, bL - lip * b.scale, b.vy);

    ctx.fillStyle = dark ? Art.color('water') : shade(Art.color('water'), 1.16);
    quad(ctx, aL, a.vy, aR, a.vy, bR, b.vy, bL, b.vy);

    /* Rumble strip along the waterline, which is the oldest speed cue there
       is and reads even when the water bands get small. */
    if (dark) {
      const w = Math.max(1, 4 * a.scale);
      ctx.fillStyle = '#ffb060';
      quad(ctx, aL - w, a.vy, aL, a.vy, bL, b.vy, bL - w, b.vy);
      quad(ctx, aR, a.vy, aR + w, a.vy, bR + w, b.vy, bR, b.vy);
    }
  }

  /* --- everything in and beside the river, furthest first --- */
  const drawables = [];

  for (const pr of boat.props) {
    const near = pr.seg - base;
    const wrapped = near < -2 ? pr.seg + BOAT.segments : pr.seg;
    if (wrapped - base > BOAT.draw - 2 || wrapped - base < -1) continue;
    drawables.push({ at: wrapped, go: () => drawBankProp(pr, wrapped) });
  }

  for (const g of boat.gates) {
    const w = g.seg - base < -2 ? g.seg + BOAT.segments : g.seg;
    if (w - base > BOAT.draw - 2 || w - base < -1) continue;
    drawables.push({ at: w, go: () => drawGate(g, w) });
  }

  for (const t of boat.things) {
    const w = t.seg - base < -2 ? t.seg + BOAT.segments : t.seg;
    if (w - base > BOAT.draw - 2 || w - base < -1) continue;
    drawables.push({ at: w, go: () => drawThing(t, w) });
  }

  for (const sh of boat.shots) {
    if (sh.hit) continue;
    drawables.push({ at: sh.pos, go: () => drawBossShot(sh) });
  }

  drawables.push({
    at: boat.bossPos,
    go: boat.sinkAt > 0 ? drawSinkingBoss : drawBossBoat,
  });

  drawables.sort((p, q) => q.at - p.at);
  for (const d of drawables) d.go();

  drawBoatSpray();
  drawOwnBoat();
}

/* A flat quad. Four points, one fill, used for every piece of the ribbon. */
function quad(c, x1, y1, x2, y2, x3, y3, x4, y4) {
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.lineTo(x3, y3);
  c.lineTo(x4, y4);
  c.closePath();
  c.fill();
}

/* Lighten or darken a hex colour, for the alternating water bands. */
function shade(hex, by) {
  const n = parseInt((hex || '#000000').slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * by)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function drawBankProp(pr, at) {
  const v = thingView(at);
  if (!v || v.scale <= 0.014) return;

  const x = boatScreenX(pr.side * (BOAT.riverHalf + 0.25 + pr.out), v.scale, v.drift);
  const w = Math.max(1.5, v.scale * GRID * (pr.kind === 1 ? 0.45 : 0.95));
  const h = Math.max(2, v.scale * GRID * pr.tall * (pr.kind === 1 ? 2.4 : 1.0));

  if (pr.kind === 1) {
    ctx.fillStyle = '#3a2a1e';
    ctx.fillRect(x - w / 2, v.y - h, w, h);
    ctx.fillStyle = '#5a4230';
    ctx.fillRect(x - w / 2, v.y - h, w * 0.4, h);
  } else {
    ctx.fillStyle = pr.kind === 0 ? '#5a4234' : '#3e3128';
    ctx.beginPath();
    ctx.moveTo(x - w / 2, v.y);
    ctx.lineTo(x - w * 0.26, v.y - h);
    ctx.lineTo(x + w * 0.24, v.y - h * 0.8);
    ctx.lineTo(x + w / 2, v.y);
    ctx.closePath();
    ctx.fill();
  }
}

/* A checkpoint: two posts and a banner across the river. */
function drawGate(g, at) {
  const v = thingView(at);
  if (!v || v.scale <= 0.012) return;

  const l = boatScreenX(-BOAT.riverHalf * 1.02, v.scale, v.drift);
  const r = boatScreenX( BOAT.riverHalf * 1.02, v.scale, v.drift);
  const h = Math.max(6, v.scale * GRID * 2.6);
  const w = Math.max(2, v.scale * GRID * 0.24);

  const lit = !g.taken;
  ctx.fillStyle = lit ? '#ffd84a' : '#4a4a52';
  ctx.fillRect(l - w / 2, v.y - h, w, h);
  ctx.fillRect(r - w / 2, v.y - h, w, h);

  ctx.fillStyle = lit
    ? (Math.floor(game.time * 6) % 2 ? '#ffd84a' : '#ff8a3c')
    : '#3a3a42';
  ctx.fillRect(l, v.y - h, r - l, Math.max(2, h * 0.16));
}

function drawThing(t, at) {
  const v = thingView(at);
  if (!v || v.scale <= 0.012) return;
  if (t.dead && t.kind !== 'buoy') return;

  const x = boatScreenX(t.x, v.scale, v.drift);
  const unit = v.scale * (WIDTH / 2) * BOAT.spread;

  if (t.kind === 'buoy') {
    const r = Math.max(1.5, 0.06 * unit);
    const bob = Math.sin(game.time * 2.4 + t.phase) * r * 0.5;
    ctx.fillStyle = t.x < 0 ? '#ff4a4a' : '#4aff8a';
    ctx.beginPath();
    ctx.moveTo(x, v.y - r * 2.6 + bob);
    ctx.lineTo(x + r, v.y + bob);
    ctx.lineTo(x - r, v.y + bob);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - r, v.y + bob - r * 0.3, r * 2, Math.max(1, r * 0.4));
    return;
  }

  if (t.kind === 'turtle') {
    const st = turtleState(t);
    if (st === 'down') {
      /* Bubbles where it went under, so the gap closing is something you can
         read rather than something that happens to you. */
      const r = Math.max(1, 0.05 * unit);
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#bfe4ff';
      for (let i = 0; i < 3; i++) {
        const a = game.time * 2 + i * 2;
        ctx.beginPath();
        ctx.arc(x + Math.sin(a) * r * 2, v.y - (a % 1) * r * 3, r * 0.6, 0, 6.3);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    }
    /* Surfacing: half out of the water, and not yet solid. */
    if (st === 'rising') ctx.globalAlpha = 0.55;
  }

  const w = Math.max(3, t.half * 2 * unit);
  const h = Math.max(2, w * (t.kind === 'log' ? 0.30 : 0.42));
  const art = t.kind === 'croc' ? 'gator' : t.kind === 'turtle' ? 'turtle' : 'log';

  /* A shadow on the water first, so it is floating on the river rather than
     stuck to the screen. */
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.ellipse(x, v.y + h * 0.32, w * 0.55, h * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  drawArt(ctx, Art.of(art), x - w / 2, v.y - h * 0.7, w, h,
          { cells: Math.max(1, Math.round(w / Math.max(1, h))), time: game.time, dir: 1 });
  ctx.globalAlpha = 1;
}

function drawBossShot(sh) {
  const v = thingView(sh.pos);
  if (!v || v.scale <= 0.01) return;

  const x = boatScreenX(sh.x, v.scale, v.drift);
  const r = Math.max(1.5, 0.09 * v.scale * (WIDTH / 2) * BOAT.spread);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, v.y, 0, x, v.y, r * 2.6);
  g.addColorStop(0, 'rgba(255,225,140,0.95)');
  g.addColorStop(0.4, 'rgba(255,120,40,0.55)');
  g.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, v.y, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#fff6d0';
  ctx.beginPath();
  ctx.arc(x, v.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawBossBoat() {
  const v = thingView(boat.bossPos);
  if (!v || v.scale <= 0.01) return;

  const w = Math.max(5, v.scale * GRID * 3.8);
  const x = boatScreenX(boat.bossX, v.scale, v.drift);

  ctx.fillStyle = 'rgba(255,255,255,0.24)';
  ctx.fillRect(x - w * 0.4, v.y + w * 0.16, w * 0.8, Math.max(1, w * 0.09));

  drawArt(ctx, Art.of('boat'), x - w / 2, v.y - w * 0.34, w, w * 0.68,
          { cells: 1, time: game.time, dir: 1 });

  const left = 1 - boat.bossHits / BOAT.bossHits;
  const bw = w * 1.05, bh = Math.max(2, w * 0.1);
  const bx = x - bw / 2, by = v.y - w * 0.55;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  ctx.fillStyle = left > 0.35 ? '#ff5a3c' : '#ffd84a';
  ctx.fillRect(bx, by, bw * Math.max(0, left), bh);
}

function drawSinkingBoss() {
  const t = Math.min(1, (game.time - boat.sinkAt) / 2.4);
  const v = thingView(boat.bossPos);
  if (!v || v.scale <= 0.01) return;

  const w = Math.max(5, v.scale * GRID * 3.8);
  const x = boatScreenX(boat.bossX, v.scale, v.drift);

  ctx.save();
  ctx.translate(x, v.y + t * w * 0.4);
  ctx.rotate(t * 1.1);
  ctx.globalAlpha = 1 - t * 0.85;
  drawArt(ctx, Art.of('boat'), -w / 2, -w * 0.34, w, w * 0.68,
          { cells: 1, time: game.time, dir: 1 });
  ctx.restore();

  if (t < 0.7) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = w * (0.7 + t * 2.2);
    const g = ctx.createRadialGradient(x, v.y, 0, x, v.y, r);
    const fade = 1 - t / 0.7;
    g.addColorStop(0, `rgba(255,240,180,${0.9 * fade})`);
    g.addColorStop(0.4, `rgba(255,140,40,${0.6 * fade})`);
    g.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, v.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawBoatSpray() {
  for (const p of boat.spray) {
    const v = thingView(p.pos);
    if (!v || v.scale <= 0.01) continue;
    const t = p.age / p.life;
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = '#dff4ff';
    const s = Math.max(1, v.scale * 8 * (1 - t * 0.4));
    ctx.fillRect(boatScreenX(p.x, v.scale, v.drift) - s / 2, v.y - p.up - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
}

/* Your own boat, with froggy driving it. Drawn rather than sprited because it
   is the one thing on screen that never changes size. */
function drawOwnBoat() {
  const by = boatBottomY();
  const pace = boatPace();
  const spinning = game.time < boat.spinUntil;

  const x = WIDTH / 2;
  const w = GRID * 2.3;
  const h = GRID * 0.95;

  /* It leans into the steering and against the bend, which is most of what
     sells the cornering. */
  const here = segAt(Math.floor(boat.pos));
  let lean = (held.left ? -0.10 : 0) + (held.right ? 0.10 : 0) - here.curve * 3.2;
  if (spinning) lean = Math.sin(game.time * 22) * 0.5;

  /* The wash. Grows with speed, which is the cheapest and best speed cue. */
  ctx.globalAlpha = 0.35 + pace * 0.4;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 8; i++) {
    const t = (game.time * (2.5 + pace * 7) + i * 0.42) % 1;
    const ww = w * (0.3 + t * (1 + pace));
    ctx.fillRect(x - ww / 2, by - h * 0.05 + t * GRID * 0.6,
                 ww, Math.max(1, 3.5 * (1 - t)));
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(x, by);
  ctx.rotate(lean);

  ctx.fillStyle = '#e8ecf4';
  ctx.beginPath();
  ctx.moveTo(-w / 2, h * 0.5);
  ctx.lineTo(-w * 0.33, -h * 0.5);
  ctx.lineTo(w * 0.33, -h * 0.5);
  ctx.lineTo(w / 2, h * 0.5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#2a3550';
  ctx.fillRect(-w * 0.24, -h * 0.44, w * 0.48, h * 0.34);

  const fs = GRID * 0.86;
  drawArt(ctx, Art.of('frog'), -fs / 2, -h * 0.52 - fs * 0.44, fs, fs,
          { cells: 1, time: game.time });

  if (game.time - boat.hurtAt < BOAT.grace && Math.floor(game.time * 12) % 2) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ff4040';
    ctx.fillRect(-w / 2, -h * 0.5, w, h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawBoatHud() {
  const font = (px) => `bold ${Math.round(px)}px "Courier New", monospace`;
  const y = HEIGHT - GRID;
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, y, WIDTH, GRID);
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.28);
  ctx.fillText('GATE', 10, y + GRID * 0.3);
  ctx.fillStyle = '#fff';
  ctx.font = font(GRID * 0.38);
  ctx.fillText(String(boat.gatesMade), 10, y + GRID * 0.7);

  ctx.textAlign = 'center';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.28);
  ctx.fillText('BOSS', WIDTH / 2, y + GRID * 0.3);
  ctx.fillStyle = Art.color('accent');
  ctx.font = font(GRID * 0.38);
  ctx.fillText(`${boat.bossHits}/${BOAT.bossHits}`, WIDTH / 2, y + GRID * 0.7);

  ctx.textAlign = 'right';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.28);
  ctx.fillText('TIME', WIDTH - 10, y + GRID * 0.3);
  ctx.fillStyle = boat.timeLeft < 8 ? '#ff5a5a' : '#fff';
  ctx.font = font(GRID * 0.38);
  ctx.fillText(String(Math.ceil(boat.timeLeft)), WIDTH - 10, y + GRID * 0.7);

  /* Speedo. Every racer has one and it is half of why they feel fast. */
  const gw = GRID * 3.0, gh = GRID * 0.18;
  const gx = WIDTH / 2 - gw / 2, gy = y - GRID * 0.36;
  const pace = boatPace();

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(gx - 2, gy - 2, gw + 4, gh + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(gx, gy, gw, gh);
  ctx.fillStyle = pace > 0.85 ? '#ff5a3c' : pace > 0.5 ? '#ffd84a' : '#4ad2ff';
  ctx.fillRect(gx, gy, gw * pace, gh);

  ctx.textAlign = 'left';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.24);
  ctx.fillText('KN ' + Math.round(boat.speed * 2), gx + gw + 6, gy + gh / 2);

  const ph = boatPhase();
  if (ph.label && boat.sinkAt < 0) {
    ctx.textAlign = 'center';
    ctx.globalAlpha = 0.5 + 0.3 * Math.abs(Math.sin(game.time * 3));
    ctx.fillStyle = '#ff7a4a';
    ctx.font = font(GRID * 0.3);
    ctx.fillText(ph.label, WIDTH / 2, boatHorizonY() - GRID * 0.45);
    ctx.globalAlpha = 1;
  }

  if (boat.outcome && game.time - boat.outcomeAt < 1.3) {
    const age = game.time - boat.outcomeAt;
    ctx.textAlign = 'center';
    ctx.globalAlpha = Math.max(0, 1 - age / 1.3);
    ctx.fillStyle = '#fff';
    ctx.font = font(GRID * 0.62);
    ctx.fillText(boat.outcome, WIDTH / 2, boatHorizonY() + GRID * 1.5 - age * 20);
    ctx.globalAlpha = 1;
  }
}


/* ==========================================================================
   HELICOPTER LEVEL
   --------------------------------------------------------------------------
   Free flight with a machine gun. Built on the rampage's guts: same free
   movement, same combo, same debris, same shake. What is new is that you hit
   things at a distance instead of by driving into them.
   ========================================================================== */

const heli = {
  x: 0, y: 0,
  aim: [0, -1],
  nextShot: 0,
  bullets: [],
  timeLeft: 0,
  aliens: [],
  enemyShots: [],
  nextAlien: 0,
  hits: 0,
  hurtAt: -99,
};

function startHeli() {
  heli.x = (WIDTH - TRUCK_SIZE) / 2;
  heli.y = laneY(START_ROW) - GRID * 0.5;
  heli.aim = [0, -1];
  heli.nextShot = 0;
  heli.bullets.length = 0;
  heli.aliens.length = 0;
  heli.enemyShots.length = 0;
  heli.nextAlien = HELI.alienEvery * 0.6;
  heli.hits = 0;
  heli.hurtAt = -99;
  heli.timeLeft = HELI.duration;

  bonus.smashed = 0;
  bonus.combo = 0;
  bonus.bestCombo = 0;
  bonus.lastSmash = -99;
  bonus.points = 0;
  calmDown();
  for (const lane of lanes) for (const ob of lane.obstacles) ob.deadUntil = 0;
}

function updateHeli(dt) {
  heli.timeLeft -= dt;

  let dx = 0, dy = 0;
  if (held.left)  dx -= 1;
  if (held.right) dx += 1;
  if (held.up)    dy -= 1;
  if (held.down)  dy += 1;
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }

  heli.x += dx * HELI.speed * dt;
  heli.y += dy * HELI.speed * dt;
  heli.x = Math.max(0, Math.min(WIDTH - TRUCK_SIZE, heli.x));
  heli.y = Math.max(GRID, Math.min(HEIGHT - GRID - TRUCK_SIZE, heli.y));

  /* The gun points where you are going. Stand still and it keeps pointing
     wherever you were last headed, so you can hover and hose a lane. */
  if (dx || dy) heli.aim = [dx, dy];

  /* Fire, always. There is no trigger: it is more fun without one. */
  heli.nextShot -= dt;
  if (heli.nextShot <= 0) {
    heli.nextShot = HELI.fireEvery;
    const [ax, ay] = heli.aim;
    heli.bullets.push({
      x: heli.x + TRUCK_SIZE / 2,
      y: heli.y + TRUCK_SIZE / 2,
      vx: ax * HELI.bulletSpeed,
      vy: ay * HELI.bulletSpeed,
    });
    Sound.play('shot');
  }

  /* Move the bullets and see what they hit. */
  for (let i = heli.bullets.length - 1; i >= 0; i--) {
    const b = heli.bullets[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.x < -20 || b.x > WIDTH + 20 || b.y < GRID - 20 || b.y > HEIGHT) {
      heli.bullets.splice(i, 1);
      continue;
    }

    let hit = false;
    for (const lane of smashableLanes()) {
      if (!laneActive(lane)) continue;
      const ly = laneY(lane.row);
      if (b.y < ly || b.y > ly + GRID) continue;
      for (const ob of lane.obstacles) {
        if (ob.deadUntil > game.time) continue;
        if (b.x >= ob.x && b.x <= ob.x + ob.cells * GRID) {
          smash(lane, ob, HELI, 'explode');
          hit = true;
          break;
        }
      }
      if (hit) break;
    }
    if (hit) heli.bullets.splice(i, 1);
  }

  updateAliens(dt);

  if (bonus.combo && game.time - bonus.lastSmash > HELI.comboWindow) bonus.combo = 0;

  for (let i = bonus.particles.length - 1; i >= 0; i--) {
    const p = bonus.particles[i];
    p.life -= dt;
    if (p.life <= 0) { bonus.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 420 * dt;
  }
  for (let i = bonus.floats.length - 1; i >= 0; i--) {
    if (game.time - bonus.floats[i].at > 1.1) bonus.floats.splice(i, 1);
  }

  if (heli.timeLeft <= 0) {
    heli.timeLeft = 0;
    game.bonusTotal = bonus.points;
    addScore(bonus.points);
    calmDown();
    heli.bullets.length = 0;
    heli.aliens.length = 0;
    heli.enemyShots.length = 0;
    Sound.play('fanfare');
    setState('heliResults');
  }
}




/* ==========================================================================
   THE PAUSE MENU
   --------------------------------------------------------------------------
   Escape opens it from anywhere, including the middle of a bonus round. It is
   the only way back to the main menu without reloading the page.
   ========================================================================== */

const PAUSE_ITEMS = [
  { label: 'RESUME',        act: 'resume' },
  { label: 'RESTART LEVEL', act: 'restart' },
  { label: 'MAIN MENU',     act: 'menu' },
];

function openPauseMenu() {
  if (game.state === 'title' || game.state === 'gameOver') return;
  game.paused = true;
  game.menuOpen = true;
  game.menuPick = 0;
  clearHeld();
}

function closePauseMenu() {
  game.menuOpen = false;
  game.paused = false;
}

function pauseMenuMove(step) {
  const n = PAUSE_ITEMS.length;
  game.menuPick = ((game.menuPick + step) % n + n) % n;
  Sound.play('hop');
}

function pauseMenuChoose() {
  const act = PAUSE_ITEMS[game.menuPick].act;
  game.menuOpen = false;

  if (act === 'resume') { game.paused = false; return; }

  if (act === 'restart') {
    game.paused = false;
    enterLevel();                 /* same level, from the top */
    return;
  }

  /* Back to the title screen. Leave the level you were on selected. */
  game.paused = false;
  game.pickedLevel = Math.min(game.level, LEVELS.length);
  Engine.stop();
  calmDown();
  setState('title');
  Music.restorePrevious();
}


/* ==========================================================================
   THE VICTORY SCREEN
   --------------------------------------------------------------------------
   Fireworks, then a credits roll, once the last level in the plan is done.
   Modelled on the Phoenix 89 one.
   ========================================================================== */

const victory = { fireworks: [], nextFirework: 0, scroll: 0 };

function startVictory() {
  victory.fireworks.length = 0;
  victory.nextFirework = 0;
  victory.scroll = 0;
  Sound.play('fanfare');
  setState('victory');
}

function updateVictory(dt) {
  const t = game.stateTime;

  /* Fireworks throughout. */
  victory.nextFirework -= dt;
  if (victory.nextFirework <= 0) {
    victory.nextFirework = VICTORY.fireworkEvery;
    const x = GRID + rng() * (WIDTH - GRID * 2);
    const y = GRID * 2 + rng() * (HEIGHT * 0.45);
    const hues = ['#ffd84a', '#ff4d6d', '#4dd2ff', '#7dff6b', '#ff9c3d', '#e08bff'];
    spawnDebris(x, y, hues[Math.floor(rng() * hues.length)], 26);
    Sound.play(rng() < 0.5 ? 'home' : 'life');
  }

  for (let i = bonus.particles.length - 1; i >= 0; i--) {
    const p = bonus.particles[i];
    p.life -= dt;
    if (p.life <= 0) { bonus.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 130 * dt;               /* drifting, not falling like debris */
  }

  if (t > VICTORY.celebrateTime) victory.scroll += VICTORY.scrollSpeed * dt;
}

function creditsHeight() {
  return CREDITS.reduce((h, l) => h + (l.size + l.gap) * GRID, 0);
}

function drawVictory() {
  const cx = WIDTH / 2;
  const t = game.stateTime;

  ctx.fillStyle = 'rgba(0,0,10,0.86)';
  ctx.fillRect(0, GRID, WIDTH, HEIGHT - GRID * 2);

  for (const p of bonus.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (t <= VICTORY.celebrateTime) {
    const pulse = 1 + Math.abs(Math.sin(t * 3.4)) * 0.16;
    ctx.font = `bold ${Math.round(GRID * 1.05 * pulse)}px "Courier New", monospace`;
    ctx.fillStyle = Math.floor(t * 6) % 2 ? '#fff' : Art.color('accent');
    ctx.fillText('VICTORY', cx, HEIGHT * 0.38);

    ctx.font = `bold ${Math.round(GRID * 0.36)}px "Courier New", monospace`;
    ctx.fillStyle = '#fff';
    ctx.fillText('every level cleared', cx, HEIGHT * 0.38 + GRID * 0.95);
    ctx.font = `${Math.round(GRID * 0.3)}px "Courier New", monospace`;
    ctx.fillStyle = Art.color('textDim');
    ctx.fillText(`final score  ${game.score}`, cx, HEIGHT * 0.38 + GRID * 1.5);
    return;
  }

  /* The credits crawl, looping forever. */
  const total = creditsHeight();
  let y = HEIGHT - (victory.scroll % (total + HEIGHT)) + GRID;

  for (const line of CREDITS) {
    const size = line.size * GRID;
    if (y > GRID * 0.5 && y < HEIGHT - GRID * 0.5 && line.text) {
      ctx.font = `bold ${Math.round(size)}px "Courier New", monospace`;
      ctx.fillStyle = Art.color(line.color) || '#fff';
      ctx.fillText(line.text, cx, y);

      if (line.sprite) {
        const s = size * 1.15;
        const w = ctx.measureText(line.text).width;
        drawArt(ctx, Art.of(line.sprite), cx - w / 2 - s * 1.5, y - s / 2, s, s,
                { cells: 1, time: game.time });
      }
    }
    y += size + line.gap * GRID;
  }

  if (Math.floor(game.time * 1.4) % 2 === 0) {
    ctx.font = `bold ${Math.round(GRID * 0.3)}px "Courier New", monospace`;
    ctx.fillStyle = '#fff';
    ctx.fillText('SPACE to keep playing', cx, HEIGHT - GRID * 1.4);
  }
}

function drawPauseMenu() {
  if (!game.menuOpen) return;

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  ctx.fillRect(0, GRID, WIDTH, HEIGHT - GRID * 2);

  const panelW = WIDTH * 0.72;
  const panelH = GRID * 4.6;
  ctx.fillStyle = 'rgba(8,8,14,0.95)';
  roundRect(ctx, cx - panelW / 2, cy - panelH / 2, panelW, panelH, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(GRID * 0.5)}px "Courier New", monospace`;
  ctx.fillStyle = '#fff';
  ctx.fillText('PAUSED', cx, cy - GRID * 1.5);

  PAUSE_ITEMS.forEach((item, i) => {
    const y = cy - GRID * 0.35 + i * GRID * 0.68;
    const on = i === game.menuPick;
    if (on) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      roundRect(ctx, cx - panelW * 0.4, y - GRID * 0.26, panelW * 0.8, GRID * 0.52, 6);
      ctx.fill();
    }
    ctx.font = `bold ${Math.round(GRID * 0.34)}px "Courier New", monospace`;
    ctx.fillStyle = on ? Art.color('accent') : Art.color('textDim');
    ctx.fillText((on ? '▸ ' : '  ') + item.label, cx, y);
  });

  ctx.font = `${Math.round(GRID * 0.24)}px "Courier New", monospace`;
  ctx.fillStyle = Art.color('textDim');
  ctx.fillText('up / down then SPACE  ::  ESC closes', cx, cy + GRID * 1.75);
}




/* --------------------------------------------------------------------------
   The aliens.

   Traffic cannot fight back, which made the helicopter level a shooting
   gallery. These fly in from the top, drift towards you and take shots, so
   there is a reason to keep moving.
   -------------------------------------------------------------------------- */
function updateAliens(dt) {
  heli.nextAlien -= dt;
  if (heli.nextAlien <= 0 && heli.aliens.length < HELI.alienMax) {
    heli.nextAlien = HELI.alienEvery;
    heli.aliens.push({
      x: GRID + rng() * (WIDTH - GRID * 2),
      y: GRID * 1.2,
      hp: HELI.alienHits,
      nextFire: HELI.alienFireEvery * (0.5 + rng()),
      wobble: rng() * 6.28,
      hurt: -99,
    });
    Sound.play('bonus');
  }

  const hx = heli.x + TRUCK_SIZE / 2;
  const hy = heli.y + TRUCK_SIZE / 2;

  for (let i = heli.aliens.length - 1; i >= 0; i--) {
    const a = heli.aliens[i];

    /* Drift towards the helicopter, weaving as they come. */
    const dx = hx - (a.x + GRID / 2);
    const dy = hy - (a.y + GRID / 2);
    const d = Math.hypot(dx, dy) || 1;
    a.wobble += dt * 3;
    a.x += (dx / d) * HELI.alienSpeed * dt + Math.cos(a.wobble) * 40 * dt;
    a.y += (dy / d) * HELI.alienSpeed * dt * 0.7;
    a.x = Math.max(0, Math.min(WIDTH - GRID, a.x));
    a.y = Math.max(GRID, Math.min(HEIGHT - GRID * 2, a.y));

    a.nextFire -= dt;
    if (a.nextFire <= 0) {
      a.nextFire = HELI.alienFireEvery * (0.7 + rng() * 0.6);
      const sx = a.x + GRID / 2, sy = a.y + GRID / 2;
      const tx = hx - sx, ty = hy - sy;
      const td = Math.hypot(tx, ty) || 1;
      heli.enemyShots.push({
        x: sx, y: sy,
        vx: (tx / td) * HELI.enemyShotSpeed,
        vy: (ty / td) * HELI.enemyShotSpeed,
      });
      Sound.play('shot');
    }

    for (let b = heli.bullets.length - 1; b >= 0; b--) {
      const bl = heli.bullets[b];
      if (Math.abs(bl.x - (a.x + GRID / 2)) < GRID * 0.5 &&
          Math.abs(bl.y - (a.y + GRID / 2)) < GRID * 0.5) {
        heli.bullets.splice(b, 1);
        a.hp--;
        a.hurt = game.time;
        spawnDebris(bl.x, bl.y, '#ff70e0', 6);
        Sound.play('smash');

        if (a.hp <= 0) {
          heli.aliens.splice(i, 1);
          bonus.combo = Math.min(HELI.comboMax, bonus.combo + 1);
          bonus.lastSmash = game.time;
          bonus.bestCombo = Math.max(bonus.bestCombo, bonus.combo);
          bonus.smashed++;
          const gained = HELI.alienPoints * bonus.combo;
          bonus.points += gained;
          bonus.floats.push({ text: '+' + gained, x: a.x + GRID / 2,
                              y: a.y, at: game.time, big: true });
          spawnDebris(a.x + GRID / 2, a.y + GRID / 2, '#ff40c0', 20);
          bonus.shake = 10;
          bonus.flash = 0.4;
          Sound.play('explode');
          Engine.rev(0.3);
        }
        break;
      }
    }
  }

  for (let i = heli.enemyShots.length - 1; i >= 0; i--) {
    const sh = heli.enemyShots[i];
    sh.x += sh.vx * dt;
    sh.y += sh.vy * dt;

    if (sh.x < -20 || sh.x > WIDTH + 20 || sh.y < 0 || sh.y > HEIGHT) {
      heli.enemyShots.splice(i, 1);
      continue;
    }

    if (Math.abs(sh.x - hx) < TRUCK_SIZE * 0.3 &&
        Math.abs(sh.y - hy) < TRUCK_SIZE * 0.3) {
      heli.enemyShots.splice(i, 1);
      takeHeliHit();
    }
  }
}

/* Getting shot does not kill you outright: it costs armour and ends the
   mission early if that runs out. Losing a frog on a bonus level would sting. */
function takeHeliHit() {
  if (game.time - heli.hurtAt < 0.8) return;
  heli.hits++;
  heli.hurtAt = game.time;
  bonus.shake = 12;
  bonus.flash = 0.5;
  bonus.combo = 0;
  spawnDebris(heli.x + TRUCK_SIZE / 2, heli.y + TRUCK_SIZE / 2, '#ffaa30', 18);
  Sound.play('crash');
  if (heli.hits >= HELI.heliLives) heli.timeLeft = 0.01;
}


/* ==========================================================================
   Input
   ========================================================================== */

function hop(dx, dy) {
  if (inBonus()) return;                 /* the truck drives, it does not hop */
  if (game.state === 'title') { titleMove(dx, dy); return; }
  if (game.state === 'gameOver') { startGame(1); return; }
  if (game.state !== 'play' || game.paused) return;

  const frog = game.frog;

  /* On ice, a forced slide animates over the whole gap to the next one, so the
     frog is always in motion, and a steer leans across rather than jumping. */
  const onIce = twist('ice');
  const glide = onIce && !onSolidGround();

  /* Every hop winds the boneyard's clock forward a little. */
  if (twist('ghost')) game.ghostTime += TWISTS.ghostPerHop;

  /* Sideways hops land on the column grid even if the frog had drifted while
     riding a log, which is what makes aiming at a lilypad possible. */
  if (dx) {
    frog.hopFromX = frog.x;
    frog.hopXT = 0;
    /* The steer has to fit inside a slide, or on the fast ice you would still
       be leaning across when the next shove arrives. */
    frog.hopXDur = glide
      ? Math.min(TWISTS.iceGlide, iceStep() * 0.8) * 1000
      : CONFIG.hopDuration;
    frog.glideX = glide;

    const col = Math.round(frog.x / GRID) + dx;
    frog.x = Math.max(0, Math.min(COLS - 1, col)) * GRID;
    frog.dir = dx;
  }

  if (dy) {
    frog.hopFromY = laneY(frog.row);
    frog.hopYT = 0;
    /* A forced slide takes exactly as long as the gap to the next one, which
       is what turns a row of hops into one continuous glide. */
    frog.hopYDur = (glide && sliding)
      ? iceStep() * 1000
      : (glide ? TWISTS.iceGlide * 1000 : CONFIG.hopDuration);
    frog.glideY = glide;

    frog.row = Math.max(0, Math.min(NLANES - 1, frog.row + dy));
    /* Points for genuinely new ground only, so you cannot farm the median. */
    if (frog.row < frog.bestRow) {
      addScore(CONFIG.score.forwardHop * (frog.bestRow - frog.row));
      frog.bestRow = frog.row;
    }
  }

  Sound.play(glide ? 'skid' : 'hop');
  checkLane(0);          /* react now, do not wait for the next frame */

  /* On ice, moving at all commits you. Once you are off solid ground the
     slide takes over and keeps carrying you forward. */
  if (twist('ice') && !sliding && game.state === 'play' && !onSolidGround()) {
    if (!frog.iceNext) frog.iceNext = game.time + TWISTS.iceFirstStep;
  }
}

/* Set while a slide is being performed, so a slide cannot cause a slide. */
let sliding = false;

/* The rows you can actually stand still on: the start line, the median, and
   the bank at the top. Everything in between is ice. */
function onSolidGround() {
  const frog = game.frog;
  if (!frog) return true;
  const lane = lanes[frog.row];
  if (!lane) return true;
  return lane.type === 'start' || lane.type === 'safe' ||
         lane.type === 'home' || lane.background === 'median';
}

/* --------------------------------------------------------------------------
   ICE: the slide.

   Reaching the median cancels it, which is what makes the median matter and
   splits the level into two committed runs, the road then the river.
   -------------------------------------------------------------------------- */
/* How fast this level's ice is. Deep Freeze runs about twice the speed of
   Slippery Bank, which is the difference between the two ice levels. */
function iceStep() {
  return levelRule('iceStep', TWISTS.iceStep);
}

function updateSlide(dt) {
  const frog = game.frog;
  if (!frog || game.state !== 'play') return;

  if (!twist('ice')) { frog.iceNext = 0; return; }

  if (onSolidGround()) {
    frog.iceNext = 0;              /* solid ground. breathe. */
    return;
  }

  if (!frog.iceNext) {
    frog.iceNext = game.time + TWISTS.iceFirstStep;
    return;
  }

  if (game.time >= frog.iceNext) {
    frog.iceNext = game.time + iceStep();
    sliding = true;
    hop(0, -1);                    /* carried forward whether you like it or not */
    sliding = false;
  }
}

/* How far through the current slide we are, for the skid marks. */
function slideProgress() {
  const frog = game.frog;
  if (!frog || !frog.iceNext) return 0;
  const left = frog.iceNext - game.time;
  return Math.max(0, Math.min(1, 1 - left / iceStep()));
}

const KEYS = {
  ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
  ArrowRight: [1, 0], d: [1, 0],  D: [1, 0],
  ArrowUp: [0, -1],   w: [0, -1], W: [0, -1],
  ArrowDown: [0, 1],  s: [0, 1],  S: [0, 1],
};

/* Which directions are being held down. The frog hops one square at a time,
   but the monster truck drives, so the bonus round needs to know what is
   still pressed rather than just what was tapped. */
const held = { left: false, right: false, up: false, down: false };

const HELD_NAME = {
  ArrowLeft: 'left', a: 'left', A: 'left',
  ArrowRight: 'right', d: 'right', D: 'right',
  ArrowUp: 'up', w: 'up', W: 'up',
  ArrowDown: 'down', s: 'down', S: 'down',
};

function setHeld(key, down) {
  const name = HELD_NAME[key];
  if (name) held[name] = down;
}

function clearHeld() {
  held.left = held.right = held.up = held.down = false;
}

window.addEventListener('keyup', (e) => setHeld(e.key, false));
window.addEventListener('blur', clearHeld);

window.addEventListener('keydown', (e) => {
  /* Escape opens and closes the menu from anywhere. */
  if (e.key === 'Escape') {
    e.preventDefault();
    /* On the title screen Escape means "back", not "pause". There is nothing
       to pause. */
    if (game.state === 'title') {
      if (game.titleView === 'levels') backToMainMenu();
      return;
    }
    if (game.menuOpen) closePauseMenu();
    else openPauseMenu();
    return;
  }

  /* While the menu is up it owns the keyboard. */
  if (game.menuOpen) {
    e.preventDefault();
    const m = KEYS[e.key];
    if (m && m[1] !== 0) pauseMenuMove(m[1]);
    if (e.key === ' ' || e.key === 'Enter') pauseMenuChoose();
    return;
  }

  const move = KEYS[e.key];
  if (move) {
    e.preventDefault();
    setHeld(e.key, true);

    /* On the title screen the arrows drive the menu, not the frog. */
    if (game.state === 'title') {
      titleMove(move[0], move[1]);
      return;
    }

    hop(move[0], move[1]);
    return;
  }

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (game.state === 'title') titleChoose();
    else if (game.state === 'gameOver') startGame(1);
    else if (game.state === 'victory') { game.level++; enterLevel(); }
    else game.paused = !game.paused;
  }

  const k = e.key.toLowerCase();

  if (k === 'p') game.paused = !game.paused;

  /* R cycles the radio, M mutes it, C cycles the colour palette. Same keys as
     Phoenix 89 so there is only one set to remember. */
  if (k === 'r') {
    const name = Music.next();
    notify(Music.enabled && CONFIG.music ? `\u266a  ${name}` : `\u266a  ${name}  (muted)`);
  }
  if (k === 'm') {
    const on = Music.toggle();
    refreshMuteBtn();
    notify(on ? '\u266a  MUSIC ON' : '\u266a  MUSIC OFF');
  }
  if (k === 'c') {
    notify(`PALETTE:  ${Art.nextPalette()}`);
  }

  /* N starts a fresh game, since R is the radio now. */
  if (k === 'n') startGame();
});

/* Browsers will not make a sound until the player has interacted with the
   page, so the music starts on the first key press or tap. */
let audioStarted = false;
function startAudioOnce() {
  if (audioStarted) return;
  audioStarted = true;
  Music.restorePreferences();
  refreshMuteBtn();
  Music.start();
}
window.addEventListener('keydown', startAudioOnce);
window.addEventListener('pointerdown', startAudioOnce);
window.addEventListener('touchstart', startAudioOnce, { passive: true });

window.addEventListener('blur', () => {
  if (game.state === 'play' || game.state === 'bonus') game.paused = true;
});

/* --- Swipe --------------------------------------------------------------- */
let touchStart = null;

canvas.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });

canvas.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;

  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) {
    if (game.state === 'title') titleChoose();
    else if (game.state === 'gameOver') startGame(1);
    else game.paused = !game.paused;
    return;
  }
  if (Math.abs(dx) > Math.abs(dy)) hop(dx > 0 ? 1 : -1, 0);
  else hop(0, dy > 0 ? 1 : -1);
}, { passive: true });

/* --- On-screen buttons --------------------------------------------------- */
function touchVisible() {
  if (CONFIG.touchControls === true) return true;
  if (CONFIG.touchControls === false) return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

const pad = document.getElementById('touchpad');
if (touchVisible()) {
  pad.hidden = false;

  const dirOf = (btn) => {
    const dx = Number(btn.dataset.dx), dy = Number(btn.dataset.dy);
    return dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
  };

  pad.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button[data-dx]');
    if (!btn) return;
    e.preventDefault();
    const dx = Number(btn.dataset.dx), dy = Number(btn.dataset.dy);

    /* The truck needs the button held, the frog just needs a tap. */
    if (inBonus()) { held[dirOf(btn)] = true; return; }

    if (game.state === 'title') {
      if (dx !== 0) { cycleMode(dx); Sound.play('hop'); }
      if (dy !== 0) {
        game.pickedLevel = (game.pickedLevel || 1) + dy;
        clampPickedLevel();
        Art.setEnvironment(planFor(game.pickedLevel).env || 'pond');
        Sound.play('hop');
      }
      return;
    }
    hop(dx, dy);
  });

  const release = (e) => {
    const btn = e.target && e.target.closest && e.target.closest('button[data-dx]');
    if (btn) held[dirOf(btn)] = false;
    else clearHeld();
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);
  pad.addEventListener('pointerleave', release);
}

/* --- Radio and colour buttons, mirroring the R, M and C keys ------------- */
const radioBtn   = document.getElementById('radioBtn');
const muteBtn    = document.getElementById('muteBtn');
const paletteBtn = document.getElementById('paletteBtn');

function refreshMuteBtn() {
  if (!muteBtn) return;
  const on = Music.enabled && CONFIG.music;
  muteBtn.textContent = on ? '\u{1F50A}' : '\u{1F507}';
  muteBtn.classList.toggle('off', !on);
}

if (radioBtn) radioBtn.addEventListener('click', () => {
  const name = Music.next();
  notify(`\u266a  ${name}`);
});
if (muteBtn) muteBtn.addEventListener('click', () => {
  const on = Music.toggle();
  refreshMuteBtn();
  notify(on ? '\u266a  MUSIC ON' : '\u266a  MUSIC OFF');
});
if (paletteBtn) paletteBtn.addEventListener('click', () => {
  notify(`PALETTE:  ${Art.nextPalette()}`);
});

window.addEventListener('resize', fitToScreen);
window.addEventListener('orientationchange', fitToScreen);


/* ==========================================================================
   Draw
   ========================================================================== */

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  /* Everything on the board shakes when the truck hits something. The text
     on top of it deliberately does not, so it stays readable. */
  ctx.save();
  if (bonus.shake > 0.1) {
    ctx.translate((Math.random() - 0.5) * bonus.shake,
                  (Math.random() - 0.5) * bonus.shake);
  }

  const onTheRiver = game.state === 'boatIntro' || game.state === 'boat' ||
                     game.state === 'boatResults';

  if (!onTheRiver) {
    drawBackground();
    drawStars();
    drawObstacles();
  }

  const st = game.state;
  const truckLevel = st === 'bonusIntro' || st === 'bonus' || st === 'bonusResults';
  const heliLevel = st === 'heliIntro' || st === 'heli' || st === 'heliResults';
  const rocketLevel = st === 'rocketIntro' || st === 'rocket' || st === 'rocketResults';
  const boatLevel = st === 'boatIntro' || st === 'boat' || st === 'boatResults';

  if (boatLevel) {
    /* Nothing from the top-down board belongs on screen here. */
    drawBoat();
  } else if (truckLevel) {
    drawBays();              /* so the bank does not look unfinished */
    drawTruck();
    drawParticles();
  } else if (heliLevel) {
    drawBays();
    drawHeli();
    drawParticles();
  } else if (rocketLevel) {
    drawBays();
    drawRocket();
    drawParticles();
  } else {
    drawAir();
    drawFx();
    drawGhosts();
    drawLady();
    drawBays();
    if (game.frog) drawFrog();
    drawDarkness();
  }

  ctx.restore();

  if (bonus.flash > 0.01) {
    ctx.fillStyle = `rgba(255,255,255,${bonus.flash})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  if (boatLevel) {
    drawBoatHud();
  } else if (truckLevel) {
    drawFloats();
    drawComboMeter();
    drawBonusHud();
  } else if (heliLevel) {
    drawFloats();
    drawComboMeter();
    drawHeliHud();
  } else if (rocketLevel) {
    drawHud();
    drawRocketHud();
  } else {
    drawHud();
  }

  drawDeathBanner();
  drawLevelBanner();
  drawOverlay();
  drawBonusOverlay();
  if (game.state === 'victory') drawVictory();
  drawPauseMenu();
  drawNotice();
}

/* --------------------------------------------------------------------------
   What this level is, and what is different about it. Shown for a moment as
   the level starts, because a name on its own tells you nothing.
   -------------------------------------------------------------------------- */
function drawLevelBanner() {
  if (game.state !== 'play' || game.menuOpen) return;
  const age = game.stateTime;
  if (age > 3.2) return;

  const p = plan();
  if (!p.blurb) return;

  const alpha = Math.min(1, age / 0.25) * Math.max(0, Math.min(1, (3.2 - age) / 0.6));
  const cx = WIDTH / 2;
  const y = HEIGHT * 0.30;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const w = WIDTH - GRID * 0.8;
  ctx.fillStyle = 'rgba(6,6,12,0.82)';
  roundRect(ctx, cx - w / 2, y - GRID * 0.72, w, GRID * 1.44, 10);
  ctx.fill();

  ctx.font = `bold ${Math.round(GRID * 0.3)}px "Courier New", monospace`;
  ctx.fillStyle = Art.color('textDim');
  ctx.fillText(`LEVEL ${game.level}`, cx, y - GRID * 0.42);

  ctx.font = `bold ${Math.round(GRID * 0.42)}px "Courier New", monospace`;
  ctx.fillStyle = '#fff';
  ctx.fillText(levelName(game.level).toUpperCase(), cx, y);

  ctx.font = `${Math.round(GRID * 0.26)}px "Courier New", monospace`;
  ctx.fillStyle = Art.color('accent');
  ctx.fillText(p.blurb, cx, y + GRID * 0.44);
  ctx.restore();
}

/* The R / M / C popup. Drawn last so it sits on top of everything, including
   the title screen, because you can change track from anywhere. */
function drawNotice() {
  if (!game.notice) return;
  const age = game.time - game.notice.at;
  if (age > 1.9) { game.notice = null; return; }

  const alpha = Math.min(1, age / 0.1) * Math.max(0, Math.min(1, (1.9 - age) / 0.4));
  const cx = WIDTH / 2;
  const y = HEIGHT - GRID * 2.1;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `bold ${Math.round(GRID * 0.3)}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const w = ctx.measureText(game.notice.text).width + GRID * 0.8;
  const h = GRID * 0.62;

  ctx.fillStyle = 'rgba(6,6,12,0.92)';
  roundRect(ctx, cx - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = Art.color('accent');
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = Art.color('accent');
  ctx.fillText(game.notice.text, cx, y + 1);
  ctx.restore();
}

function drawBackground() {
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(-14, -14, WIDTH + 28, HEIGHT + 28);

  for (const lane of lanes) {
    let color;
    if (lane.background) {
      color = Art.color(lane.background);
    } else {
      switch (lane.type) {
        case 'river': color = Art.color('water');  break;
        case 'road':  color = Art.color('road');   break;
        case 'safe':  color = Art.color('median'); break;
        default:      color = Art.color('grass');
      }
    }
    ctx.fillStyle = color;
    ctx.fillRect(0, laneY(lane.row), WIDTH, GRID);
  }

  drawGraves();
}

/* Gravestones along the start line and the median, in the boneyard.

   The sprite existed and was drawn nowhere. It was only listed in the themes
   at all to stop the test that fails on unused art, which is the sort of thing
   that quietly turns a guard into a lie. It is scenery now, and it is where
   the ghosts come from, which the level was short of. */
function drawGraves() {
  if (!Art.environment().graves) return;

  const art = Art.of('gravestone');

  for (const lane of lanes) {
    if (lane.type !== 'start' && lane.type !== 'safe') continue;

    /* Fixed positions off the lane's own row, so they never wander and never
       sit under the frog's starting square. */
    for (let c = 1; c < COLS; c += 3) {
      const col = (c + lane.row) % COLS;
      if (col === START_COL) continue;

      /* A graveyard of identical stones looks like wallpaper. Vary the height
         off the column, deterministically, so it is the same every time. */
      const size = GRID * (0.62 + ((col * 7 + lane.row * 3) % 4) * 0.055);
      const y = laneY(lane.row) + GRID - size * 0.94;

      /* Ground shadow, so they are standing in the earth rather than pasted
         on top of it. */
      ctx.globalAlpha = 0.30;
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.ellipse(col * GRID + GRID / 2, laneY(lane.row) + GRID * 0.93,
                  size * 0.42, size * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.82;
      drawArt(ctx, art, col * GRID + (GRID - size) / 2, y, size, size,
              { cells: 1, time: game.time });
    }
  }
  ctx.globalAlpha = 1;
}

function drawObstacles() {
  for (const lane of lanes) {
    if (!lane.obstacles.length || !laneActive(lane)) continue;

    const y = laneY(lane.row);

    const rampage = inBonus();

    for (const ob of lane.obstacles) {
      const w = ob.cells * GRID;
      if (ob.x > WIDTH || ob.x + w < 0) continue;
      if (ob.deadUntil > game.time) continue;      /* flattened, back shortly */

      /* During the rampage the river is full of boats to ram, and nothing
         sinks, because nothing is trying to drown you. */
      const kind = rampage && lane.type === 'river' ? 'boat' : (ob.variant || lane.kind);
      /* A literal, so the test that reads this file for every picture the
         engine asks for finds it and holds the themes to it. */
      const jawsOpen = !rampage && ob.variant === 'gator' &&
                       gatorPhase(lane, ob) !== 'shut';
      const art = jawsOpen ? Art.of('gatorOpen') : Art.of(kind);
      const dive = rampage ? { sink: 0 } : diveState(lane, ob);

      /* A coiling snake shakes on the spot. It is the only tell that reads at
         a glance while you are busy watching the road. */
      const shake = ob.mood === 'coil' ? (Math.random() - 0.5) * 5 : 0;

      drawArt(ctx, art, ob.x + shake, y, w, GRID, {
        dir: Math.sign(ob.vx),
        cells: ob.cells,
        sink: dive.sink,
        time: game.time,
      });
    }
  }
}

function drawLady() {
  if (!game.lady) return;
  const y = laneY(game.lady.lane.row);
  drawArt(ctx, Art.of('lady'), ladyX(), y, GRID, GRID, { cells: 1, time: game.time });
}

function drawBays() {
  if (homeRow === -1) return;
  const y = laneY(homeRow);

  for (let i = 0; i < CONFIG.homeCols.length; i++) {
    const x = CONFIG.homeCols[i] * GRID;

    /* A dark opening in the bank. */
    ctx.fillStyle = Art.color('bayInner');
    ctx.fillRect(x + 2, y + 2, GRID - 4, GRID - 4);

    if (game.bays[i]) {
      drawArt(ctx, Art.of('scored'), x, y, GRID, GRID, { cells: 1, time: game.time });
      continue;
    }

    drawArt(ctx, Art.of('home'), x, y, GRID, GRID, { cells: 1, time: game.time });

    const hz = game.bayHazard;
    if (hz && hz.bay === i) {
      const age = game.time - hz.bornAt;
      if (hz.kind === 'fly') {
        drawArt(ctx, Art.of('fly'), x, y, GRID, GRID, { cells: 1, time: game.time });
      } else {
        /* The crocodile rises out of the bay. While it is still coming up it
           is harmless, and you can see that it is not all the way out yet. */
        const up = Math.min(1, age / CONFIG.timing.bayCrocSurfacing);
        drawArt(ctx, Art.of('bayCroc'), x, y, GRID, GRID,
                { cells: 1, sink: 1 - up, time: game.time });
      }
    }
  }

  ctx.fillStyle = Art.color('bankLine');
  ctx.fillRect(0, y + GRID - 3, WIDTH, 3);
}

function drawFrog() {
  const frog = game.frog;

  /* A hop lands, so it eases out hard. A glide does not, so it runs nearly
     linear. TWISTS.iceEase is how much of the hop curve is left in it. */
  const curve = (t, gliding) => {
    const out = 1 - Math.pow(1 - t, 3);
    return gliding ? t + (out - t) * TWISTS.iceEase : out;
  };

  const px = frog.hopXDur > 0 ? Math.min(1, frog.hopXT / frog.hopXDur) : 1;
  const py = frog.hopYDur > 0 ? Math.min(1, frog.hopYT / frog.hopYDur) : 1;
  const p = Math.min(px, py);

  const targetY = laneY(frog.row);
  const x = px >= 1 ? frog.x
          : frog.hopFromX + (frog.x - frog.hopFromX) * curve(px, frog.glideX);
  const y = py >= 1 ? targetY
          : frog.hopFromY + (targetY - frog.hopFromY) * curve(py, frog.glideY);

  if (game.state === 'dying') {
    drawArt(ctx, Art.of('splat'), x, y, GRID, GRID, {
      cells: 1,
      time: game.time,
      alpha: game.stateTime < 0.6 ? 1 : Math.max(0, 1 - (game.stateTime - 0.6) / 0.3),
      scale: 1 + game.stateTime * 0.5,
    });
    return;
  }

  /* The squash is the hop landing. A frog on ice is not landing. */
  const bouncing = !(frog.glideX || frog.glideY);
  const pop = bouncing ? 1 + 0.2 * Math.sin(p * Math.PI) : 1;

  /* Carrying the lady frog: she rides on your back. */
  if (game.carrying) {
    drawArt(ctx, Art.of('lady'), x, y - GRID * 0.18, GRID, GRID,
            { cells: 1, time: game.time, scale: pop * 0.8 });
  }

  drawArt(ctx, Art.of('frog'), x, y, GRID, GRID, {
    dir: frog.dir,
    cells: 1,
    time: game.time,
    scale: pop,
  });
}




/* ==========================================================================
   Drawing the bonus round
   ========================================================================== */

function drawTruck() {
  /* A slight bounce while driving, so it never looks like it is sliding.
     On the water it rides deeper and rocks slower, like something with a hull
     rather than something with wheels. */
  const moving = held.left || held.right || held.up || held.down;
  const wet = bonus.wet;
  const bob = moving
    ? Math.sin(game.time * (wet ? 9 : 26)) * GRID * (wet ? 0.075 : 0.045)
    : (wet ? Math.sin(game.time * 4) * GRID * 0.035 : 0);
  const dir = held.right ? 1 : held.left ? -1 : 0;

  const cx = bonus.x + TRUCK_SIZE / 2;
  const cy = bonus.y + TRUCK_SIZE / 2 + bob;

  if (wet) {
    let dx = 0, dy = 0;
    if (held.left)  dx -= 1;
    if (held.right) dx += 1;
    if (held.up)    dy -= 1;
    if (held.down)  dy += 1;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;

    drawPropeller(cx - dx * TRUCK_SIZE * 0.5, cy - dy * TRUCK_SIZE * 0.5, moving);
    drawBowWave(cx, cy, dx, dy, moving);
  }

  drawArt(ctx, Art.of('monsterTruck'), bonus.x, bonus.y + bob,
          TRUCK_SIZE, TRUCK_SIZE, { cells: 1, dir, time: game.time });

  if (wet) {
    /* A waterline across the wheels, so it is sitting IN the river rather than
       hovering over it. */
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = Art.color('water');
    ctx.fillRect(bonus.x, bonus.y + bob + TRUCK_SIZE * 0.72,
                 TRUCK_SIZE, TRUCK_SIZE * 0.28);
    ctx.restore();
  }
}

/* The outboard, bolted on the back the moment it hits the water. */
function drawPropeller(x, y, spinning) {
  const r = TRUCK_SIZE * 0.2;
  const spin = spinning ? game.time * 34 : game.time * 5;

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = '#2a2f3a';
  ctx.fillRect(-r * 0.22, -r * 0.9, r * 0.44, r * 1.5);

  ctx.rotate(spin);
  ctx.fillStyle = '#c8d4e4';
  for (let i = 0; i < 3; i++) {
    ctx.rotate((Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.ellipse(0, r * 0.55, r * 0.24, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/* The wave pushed up by the nose. Two arcs peeling off either side, which is
   the shape your eye reads as ploughing rather than floating. */
function drawBowWave(cx, cy, dx, dy, moving) {
  const ang = Math.atan2(dy, dx);
  const r = TRUCK_SIZE * BONUS.bowWave * (moving ? 1 : 0.55);

  ctx.save();
  ctx.translate(cx + dx * TRUCK_SIZE * 0.34, cy + dy * TRUCK_SIZE * 0.34);
  ctx.rotate(ang);

  for (const side of [-1, 1]) {
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(game.time * 12 + side));
    ctx.globalAlpha = (moving ? 0.7 : 0.35) * pulse;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, TRUCK_SIZE * 0.07);
    ctx.beginPath();
    ctx.moveTo(0, side * TRUCK_SIZE * 0.1);
    ctx.quadraticCurveTo(r * 0.5, side * r * 0.42, -r * 0.25, side * r * 0.72);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawParticles() {
  for (const p of bonus.particles) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2.2));
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawFloats() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of bonus.floats) {
    const age = game.time - f.at;
    ctx.globalAlpha = Math.max(0, 1 - age / 1.1);
    ctx.font = `bold ${Math.round(GRID * (f.big ? 0.46 : 0.34))}px "Courier New", monospace`;
    ctx.fillStyle = f.big ? Art.color('accent') : '#ffffff';
    ctx.fillText(f.text, f.x, f.y - age * 52);
  }
  ctx.globalAlpha = 1;
}

/* The multiplier, right in the middle where you cannot miss it. */
function drawComboMeter() {
  if (bonus.combo < 2 || game.state !== 'bonus') return;

  const since = game.time - bonus.lastSmash;
  const left = Math.max(0, 1 - since / BONUS.comboWindow);
  const pop = 1 + Math.max(0, 0.5 - since) * 0.7;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const cx = WIDTH / 2;
  const cy = HEIGHT * 0.30;

  ctx.globalAlpha = 0.55 + left * 0.45;
  ctx.font = `bold ${Math.round(GRID * 1.15 * pop)}px "Courier New", monospace`;
  ctx.fillStyle = bonus.combo >= 6 ? '#ff3860'
                : bonus.combo >= 4 ? Art.color('accent') : '#ffffff';
  ctx.fillText(`x${bonus.combo}`, cx, cy);

  ctx.font = `bold ${Math.round(GRID * 0.3)}px "Courier New", monospace`;
  ctx.fillText('COMBO', cx, cy + GRID * 0.78);

  /* A little bar draining away: keep hitting things and it refills. */
  const bw = GRID * 3.2, bh = GRID * 0.13;
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(cx - bw / 2, cy + GRID * 1.05, bw, bh);
  ctx.fillStyle = Art.color('accent');
  ctx.fillRect(cx - bw / 2, cy + GRID * 1.05, bw * left, bh);
  ctx.restore();
}

function drawBonusHud() {
  const font = (px) => `bold ${Math.round(px)}px "Courier New", monospace`;

  /* Top row: score and what the rampage is worth so far. */
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, 0, WIDTH, GRID);
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.3);
  ctx.fillText('1-UP', 10, GRID * 0.28);
  ctx.fillStyle = '#fff';
  ctx.font = font(GRID * 0.38);
  ctx.fillText(String(game.score).padStart(5, '0'), 10, GRID * 0.7);

  ctx.textAlign = 'center';
  ctx.fillStyle = Art.color('accent');
  ctx.font = font(GRID * 0.3);
  ctx.fillText('RAMPAGE', WIDTH / 2, GRID * 0.28);
  ctx.font = font(GRID * 0.42);
  ctx.fillText('+' + bonus.points, WIDTH / 2, GRID * 0.72);

  ctx.textAlign = 'right';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.3);
  ctx.fillText('SMASHED', WIDTH - 10, GRID * 0.28);
  ctx.fillStyle = '#fff';
  ctx.font = font(GRID * 0.42);
  ctx.fillText(String(bonus.smashed), WIDTH - 10, GRID * 0.72);

  /* Bottom row: the clock, and it flashes when it is nearly up. */
  const y = HEIGHT - GRID;
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, y, WIDTH, GRID);

  const frac = Math.max(0, bonus.timeLeft / BONUS.duration);
  const barW = WIDTH - GRID * 2.6;
  const barH = GRID * 0.34;
  const barX = GRID * 1.3;
  const barY = y + (GRID - barH) / 2;
  const panic = bonus.timeLeft < 5 && Math.floor(game.time * 6) % 2 === 0;

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = panic ? '#ffffff'
                : frac < 0.25 ? Art.color('timeLow') : Art.color('accent');
  ctx.fillRect(barX, barY, barW * frac, barH);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  ctx.font = font(GRID * 0.26);
  ctx.fillText(Math.ceil(bonus.timeLeft) + 's', WIDTH / 2, barY + barH / 2 + 1);
}

/* --------------------------------------------------------------------------
   The two big screens. These are pure showmanship and that is the point: the
   bonus round should feel like the game stopping to hand you a present.
   -------------------------------------------------------------------------- */
const SPECIAL_SCREENS = {
  bonusIntro:   { kind: 'truck',  phase: 'intro' },
  bonusResults: { kind: 'truck',  phase: 'results' },
  heliIntro:    { kind: 'heli',   phase: 'intro' },
  heliResults:  { kind: 'heli',   phase: 'results' },
  rocketIntro:  { kind: 'rocket', phase: 'intro' },
  rocketResults:{ kind: 'rocket', phase: 'results' },
  boatIntro:    { kind: 'boat',   phase: 'intro' },
  boatResults:  { kind: 'boat',   phase: 'results' },
};

const SPECIAL_COPY = {
  truck: {
    title: 'BONUS ROUND', sub: 'MONSTER TRUCK RAMPAGE', sprite: 'monsterTruck',
    call: 'SMASH EVERYTHING',
    how: ['drive with the arrows  ::  nothing can hurt you',
          'keep hitting things to build the multiplier'],
    over: 'RAMPAGE OVER',
    ranks: [[30, 'DEMOLITION EXPERT'], [20, 'MENACE TO TRAFFIC'],
            [10, 'KEEN DRIVER'], [0, 'LEARNER PLATES']],
  },
  heli: {
    title: 'AIR SUPPORT', sub: 'ATTACK HELICOPTER', sprite: 'helicopter',
    call: 'CLEAR THE ROAD',
    how: ['fly with the arrows  ::  the gun fires by itself',
          'it shoots the way you are flying'],
    over: 'MISSION COMPLETE',
    ranks: [[40, 'TOP GUN'], [25, 'GUNSHIP'], [12, 'ROOKIE PILOT'],
            [0, 'TRAINEE']],
  },
  boat: {
    title: 'BOSS RUN', sub: 'SPEEDBOAT CHASE', sprite: 'boat',
    call: 'RAM IT FOUR TIMES',
    how: ['left and right to steer  ::  up for the throttle',
          'it drops mines, and it runs when you get close'],
    over: 'BOSS RUN OVER',
    ranks: [[6, 'SANK THE BOSS'], [4, 'NEARLY HAD IT'], [2, 'GOT A FEW IN'],
            [0, 'ALL WASH, NO WAKE']],
  },
  rocket: {
    title: 'ROCKET RIDE', sub: 'ONE WAY, STRAIGHT UP', sprite: 'rocket',
    call: 'LINE IT UP',
    how: ['left and right to aim  ::  up to launch',
          'the wind will push you, so allow for it'],
    over: 'SPLASHDOWN',
    ranks: [[3, 'PERFECT FLIGHT'], [2, 'STEADY HANDS'], [1, 'GOT THERE'],
            [0, 'BACK TO THE DRAWING BOARD']],
  },
};

function drawBonusOverlay() {
  const screen = SPECIAL_SCREENS[game.state];
  if (!screen) return;

  const copy = SPECIAL_COPY[screen.kind];
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const t = game.stateTime;

  const introTime = screen.kind === 'heli' ? HELI.introTime
                  : screen.kind === 'rocket' ? ROCKET.introTime
                  : screen.kind === 'boat' ? BOAT.introTime
                  : BONUS.introTime;

  /* Bands of colour sweeping across, which is about as loud as a canvas
     gets without a shader. */
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(0, GRID, WIDTH, HEIGHT - GRID * 2);

  const bands = ['#ff2d6f', '#ffb400', '#2ee6a8', '#4aa8ff'];
  for (let i = 0; i < 22; i++) {
    const h = GRID * 0.36;
    const yy = GRID + ((i * h * 1.8 + t * 150) % (HEIGHT - GRID * 2));
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = bands[i % bands.length];
    ctx.fillRect(0, yy, WIDTH, h);
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = (px, bold) =>
    `${bold ? 'bold ' : ''}${Math.round(px)}px "Courier New", monospace`;

  if (screen.phase === 'intro') {
    /* Title thumping in time with itself. */
    const thump = 1 + Math.abs(Math.sin(t * 6)) * 0.09;
    ctx.font = font(GRID * 0.86 * thump, true);
    ctx.fillStyle = Math.floor(t * 8) % 2 ? '#fff' : Art.color('accent');
    ctx.fillText(copy.title, cx, cy - GRID * 2.1);

    ctx.font = font(GRID * 0.42, true);
    ctx.fillStyle = '#fff';
    ctx.fillText(copy.sub, cx, cy - GRID * 1.2);

    const s2 = GRID * 2.4;
    const bob = Math.sin(t * 4) * GRID * 0.12;
    drawArt(ctx, Art.of(copy.sprite), cx - s2 / 2, cy - GRID * 0.6 + bob,
            s2, s2, { cells: 1, time: game.time });

    ctx.font = font(GRID * 0.34, true);
    ctx.fillStyle = Art.color('accent');
    ctx.fillText(copy.call, cx, cy + GRID * 1.5);
    ctx.font = font(GRID * 0.27);
    ctx.fillStyle = '#dfe3ea';
    ctx.fillText(copy.how[0], cx, cy + GRID * 2.0);
    ctx.fillText(copy.how[1], cx, cy + GRID * 2.45);

    /* 3, 2, 1... */
    const left = Math.max(0, introTime - t);
    const count = Math.ceil(left);
    if (count <= 3 && count >= 1) {
      const grow = 1 + (1 - (left % 1)) * 0.5;
      ctx.font = font(GRID * 1.5 * grow, true);
      ctx.globalAlpha = 0.35 + (left % 1) * 0.5;
      ctx.fillStyle = '#fff';
      ctx.fillText(String(count), cx, cy + GRID * 3.3);
      ctx.globalAlpha = 1;
    }
  } else {
    ctx.font = font(GRID * 0.8, true);
    ctx.fillStyle = Art.color('accent');
    ctx.fillText(copy.over, cx, cy - GRID * 2.0);

    /* The numbers count up rather than just appearing. */
    const reveal = Math.min(1, t / 1.2);
    const tally = screen.kind === 'rocket' ? rocket.landed
                : screen.kind === 'boat' ? boat.rams
                : bonus.smashed;
    const rows = screen.kind === 'rocket'
      ? [['LANDED',  `${Math.round(rocket.landed * reveal)} of ${ROCKET.attempts}`],
         ['STARS',   String(Math.round(rocket.grabbed * reveal))],
         ['BONUS',   '+' + Math.round(rocket.points * reveal)]]
      : screen.kind === 'boat'
      ? [['RAMS',        `${Math.round(boat.rams * reveal)} of ${BOAT.bossHits}`],
         ['CHECKPOINTS', String(Math.round(boat.gatesMade * reveal))],
         ['BONUS',       '+' + Math.round(boat.points * reveal)]]
      : [['DESTROYED',  String(Math.round(bonus.smashed * reveal))],
         ['BEST COMBO', 'x' + Math.round(bonus.bestCombo * reveal)],
         ['BONUS',      '+' + Math.round(bonus.points * reveal)]];
    const last = rows.length - 1;
    rows.forEach(([k, v], i) => {
      const yy = cy - GRID * 0.9 + i * GRID * 0.85;
      ctx.font = font(GRID * 0.36, true);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#dfe3ea';
      ctx.fillText(k, cx - GRID * 3.1, yy);
      ctx.textAlign = 'right';
      ctx.fillStyle = i === last ? Art.color('accent') : '#fff';
      ctx.font = font(GRID * (i === last ? 0.52 : 0.42), true);
      ctx.fillText(v, cx + GRID * 3.1, yy);
    });

    ctx.textAlign = 'center';
    if (t > 1.4) {
      const rank = (copy.ranks.find(([n]) => tally >= n) || [0, ''])[1];
      ctx.font = font(GRID * 0.42, true);
      ctx.fillStyle = Math.floor(t * 5) % 2 ? '#fff' : Art.color('timeBar');
      ctx.fillText(rank, cx, cy + GRID * 1.9);
    }

    if (t > 2.4) {
      ctx.font = font(GRID * 0.3);
      ctx.fillStyle = '#dfe3ea';
      ctx.fillText('next: ' + levelName(game.level + 1), cx, cy + GRID * 2.7);
    }
  }

  ctx.restore();
}




/* ==========================================================================
   Drawing the new level kinds, and the twists
   ========================================================================== */

/* --- darkness, for the night levels ------------------------------------- */
let nightLayer = null;

function drawDarkness() {
  if (!twist('dark')) return;

  /* Built on its own canvas so the holes can be punched out of the darkness
     without erasing the game underneath it. */
  if (!nightLayer) {
    nightLayer = document.createElement('canvas');
  }
  if (nightLayer.width !== WIDTH || nightLayer.height !== HEIGHT) {
    nightLayer.width = WIDTH;
    nightLayer.height = HEIGHT;
  }
  const n = nightLayer.getContext('2d');

  n.setTransform(1, 0, 0, 1, 0, 0);
  n.globalCompositeOperation = 'source-over';
  n.clearRect(0, 0, WIDTH, HEIGHT);
  n.fillStyle = `rgba(0,0,6,${levelRule('darkness', TWISTS.darkness)})`;
  n.fillRect(0, GRID, WIDTH, HEIGHT - GRID * 2);

  /* Now cut the light out of it. */
  n.globalCompositeOperation = 'destination-out';

  const hole = (cx, cy, r, strength) => {
    if (r <= 0) return;
    const g = n.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.65})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    n.fillStyle = g;
    n.beginPath();
    n.arc(cx, cy, r, 0, Math.PI * 2);
    n.fill();
  };

  /* The lantern. It hangs off the frog and swings, so the pool of light lags
     behind and sways, which is most of what makes it read as a carried lamp
     rather than a hole cut in a filter. */
  const lamp = lanternAt();
  if (lamp) hole(lamp.x, lamp.y, GRID * TWISTS.lampRadius, 1);

  /* Headlights, thrown AHEAD of each vehicle rather than around it.

     The old version put a big round hole on top of the car, so every car on
     the board lit itself and a 97% black level still showed you everything.
     This is a cone in front of the nose, built out of a few overlapping holes
     that get wider and weaker with distance, so what you see is a beam
     sweeping the road, and the car itself stays in the dark until it is
     nearly on top of you. */
  if (levelRule('headlights', TWISTS.headlights)) {
    for (const lane of lanes) {
      if (lane.type !== 'road' || !lane.active) continue;
      const y = laneY(lane.row) + GRID / 2;

      for (const ob of lane.obstacles) {
        if (ob.deadUntil > game.time) continue;
        if (ob.x > WIDTH + GRID * 4 || ob.x + ob.cells * GRID < -GRID * 4) continue;

        const dir = Math.sign(ob.vx) || 1;
        const nose = dir > 0 ? ob.x + ob.cells * GRID : ob.x;

        const steps = 5;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          const along = GRID * TWISTS.headlampReach * t;
          const wide = GRID * TWISTS.headlampWidth * (0.35 + t);
          /* Falls off fast, so the far end of the beam is a suggestion. */
          hole(nose + dir * along, y, wide, 0.5 * (1 - t * 0.75));
        }
      }
    }
  }

  ctx.drawImage(nightLayer, 0, 0, WIDTH, HEIGHT);

  /* Warm light thrown back onto whatever the lantern is lighting. Additive, so
     it tints rather than washes, and it is the difference between a hole in
     the dark and a lamp. */
  if (lamp) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(lamp.x, lamp.y, 0,
                                       lamp.x, lamp.y, GRID * TWISTS.lampRadius);
    g.addColorStop(0, `rgba(255,196,96,${TWISTS.lampWarmth})`);
    g.addColorStop(0.6, `rgba(255,150,60,${TWISTS.lampWarmth * 0.35})`);
    g.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y, GRID * TWISTS.lampRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawLantern(lamp);
  }
}

/* Where the lantern is hanging right now. It trails the frog and swings, and
   it keeps swinging for a moment after a hop, like something on a string. */
function lanternAt() {
  const frog = game.frog;
  if (!frog || game.state === 'dying') return null;

  const cx = frog.x + GRID / 2;
  const cy = laneY(frog.row) + GRID / 2;

  /* Swing is driven by how recently it moved, so it settles when you stand
     still and lurches when you hop. */
  const since = Math.min(frog.hopXT, frog.hopYT) / 1000;
  const energy = Math.max(0, 1 - since / 0.9);
  const swing = Math.sin(since * 9) * energy * GRID * TWISTS.lampSwing * 0.5;

  return {
    x: cx + swing - (frog.dir || 0) * GRID * 0.1,
    y: cy + GRID * 0.16 + Math.abs(swing) * 0.12,
    swing,
  };
}

/* The lamp itself, so there is a thing making the light. */
function drawLantern(lamp) {
  const w = GRID * 0.26;
  const h = GRID * 0.32;
  const x = lamp.x - w / 2;
  const y = lamp.y - h / 2;

  /* The wire it hangs from, back to the frog. */
  const frog = game.frog;
  if (frog) {
    ctx.strokeStyle = 'rgba(255,220,150,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(frog.x + GRID / 2, laneY(frog.row) + GRID * 0.45);
    ctx.lineTo(lamp.x, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#2a2118';
  ctx.fillRect(x - 1, y - h * 0.2, w + 2, h * 0.22);
  ctx.fillRect(x - 1, y + h * 0.92, w + 2, h * 0.2);

  const flicker = 0.82 + Math.sin(game.time * 17) * 0.06 +
                  Math.sin(game.time * 7.3) * 0.05;
  ctx.fillStyle = `rgba(255,214,120,${flicker})`;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = `rgba(255,255,220,${flicker})`;
  ctx.fillRect(x + w * 0.3, y + h * 0.22, w * 0.4, h * 0.5);
}

/* --- ghosts drifting about the boneyard --------------------------------- */
const ghosts = [];

/* Put them back where they came from: spread across the top of the board and
   off both sides, well clear of the start line.

   This is called on every respawn, and it is the fix for the thing that made
   the level unplayable. Ghosts used to stay exactly where they were when you
   died, which meant respawning underneath one, dying to it, and doing that
   until the run was over. */
function resetGhosts() {
  ghosts.length = 0;
  const n = TWISTS.ghostCount;
  const edge = GRID * TWISTS.ghostEdge;

  for (let i = 0; i < n; i++) {
    /* Alternate sides so they close in from both, and stagger them up the
       board so they are not one wall coming down at you. */
    const left = i % 2 === 0;
    const along = (i + 0.5) / n;
    ghosts.push({
      x: left ? -edge - along * GRID : WIDTH + edge * 0.4 + along * GRID,
      y: GRID * 1.4 + along * (HEIGHT - GRID * 4.5),
      phase: i * 1.7,
      surge: 0,
    });
  }
}

function updateGhosts(dt) {
  if (!twist('ghost')) { ghosts.length = 0; return; }
  if (ghosts.length !== TWISTS.ghostCount) resetGhosts();

  /* The world only runs while you are moving, and the ghosts run with it.
     Stand still and they stand still too, which makes standing still safe and
     costs you the clock instead. Every hop is progress you pay for. */
  const running = game.state === 'play' && game.ghostTime > 0.001;
  const frog = game.frog;

  for (const g of ghosts) {
    g.surge = Math.max(0, g.surge - dt * 2.4);
    if (!frog || game.state !== 'play') continue;

    const fx = frog.x + GRID / 2;
    const fy = laneY(frog.row) + GRID / 2;
    const dx = fx - (g.x + GRID / 2);
    const dy = fy - (g.y + GRID / 2);
    const d = Math.hypot(dx, dy) || 1;

    if (running) {
      const mx = (dx / d) * TWISTS.ghostSpeed * dt;
      const my = (dy / d) * TWISTS.ghostSpeed * dt;
      g.x += mx;
      g.y += my;
      /* Where it came from, exaggerated, for the smear behind it. */
      g.trailX = mx * 9;
      g.trailY = my * 9;
      g.surge = 1;
    }

    /* Touching one is fatal whether it is moving or not. They do not chase
       you when you are still, but they are still ghosts. */
    if (d < GRID * TWISTS.ghostReach) {
      die('A ghost got you');
      return;
    }
  }
}

function drawGhosts() {
  if (!twist('ghost')) return;
  const art = Art.of('ghost');

  for (const g of ghosts) {
    const bob = Math.sin(game.time * 1.6 + g.phase) * GRID * 0.12;

    /* Solid while they are coming for you, faint while they are holding, so
       one glance tells you whether the last thing you did cost you ground. */
    const fade = 0.22 + g.surge * 0.7;
    const size = GRID * (1.25 + g.surge * 0.12);

    /* A smear behind a surging one, so the lunge reads even though it only
       lasts as long as the hop that caused it. */
    if (g.surge > 0.05) {
      drawArt(ctx, art, g.x - (g.trailX || 0), g.y + bob - (g.trailY || 0),
              size, size,
              { cells: 1, alpha: fade * 0.3, time: game.time });
    }

    drawArt(ctx, art, g.x, g.y + bob, size, size,
            { cells: 1, alpha: fade, time: game.time });
  }
}

/* --- a starfield, for the space environment ----------------------------- */
const stars = [];

function drawStars() {
  if (!Art.environment().stars) return;
  if (!stars.length) {
    for (let i = 0; i < 70; i++) {
      stars.push({ x: rng() * WIDTH, y: GRID + rng() * (HEIGHT - GRID * 2),
                   s: 1 + rng() * 2, tw: rng() * 6.28 });
    }
  }
  for (const st of stars) {
    ctx.globalAlpha = 0.35 + 0.4 * Math.abs(Math.sin(game.time * 1.5 + st.tw));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(st.x, st.y, st.s, st.s);
  }
  ctx.globalAlpha = 1;
}

/* --- the rocket -------------------------------------------------------- */
function drawRocket() {
  /* Exhaust. */
  for (const t of rocket.trail) {
    const age = game.time - t.at;
    if (age > 0.5) continue;
    ctx.globalAlpha = Math.max(0, 1 - age / 0.5) * 0.8;
    ctx.fillStyle = age < 0.14 ? '#ffe070' : age < 0.3 ? '#ff8a30' : '#8a8a8a';
    const sz = 3 + age * 26;
    ctx.fillRect(t.x - sz / 2, t.y - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;

  /* The stars, spinning gently so they read as collectable. */
  for (const st of rocket.stars) {
    if (st.taken) continue;
    const pulse = 0.82 + 0.18 * Math.sin(game.time * 4 + st.x);
    drawArt(ctx, Art.of('star'), st.x, st.y - GRID * 0.5, GRID, GRID,
            { cells: 1, scale: pulse, time: game.time });
  }

  drawArt(ctx, Art.of('rocket'), rocket.x, rocket.y, GRID, GRID,
          { cells: 1, time: game.time });

  /* A wind gauge, because guessing would just be annoying. */
  if (!rocket.flying) {
    const cx = WIDTH / 2;
    const y = laneY(START_ROW) - GRID * 0.75;
    const w = GRID * 3;
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(cx - w / 2, y, w, GRID * 0.16);
    const f = rocket.wind / ROCKET.wind;
    ctx.fillStyle = Art.color('accent');
    ctx.fillRect(cx, y, (w / 2) * f, GRID * 0.16);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = Art.color('textDim');
    ctx.font = `bold ${Math.round(GRID * 0.24)}px "Courier New", monospace`;
    ctx.fillText('WIND', cx, y - GRID * 0.22);

    /* And a dotted line up from where you are standing. */
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(rocket.x + GRID / 2, rocket.y);
    ctx.lineTo(rocket.x + GRID / 2, laneY(0) + GRID);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawRocketHud() {
  const font = (px) => `bold ${Math.round(px)}px "Courier New", monospace`;
  const y = HEIGHT - GRID;
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, y, WIDTH, GRID);
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.28);
  ctx.fillText('ROCKETS', 10, y + GRID * 0.3);
  ctx.fillStyle = '#fff';
  ctx.font = font(GRID * 0.38);
  ctx.fillText('x' + rocket.attemptsLeft, 10, y + GRID * 0.7);

  ctx.textAlign = 'center';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.28);
  ctx.fillText('STARS', WIDTH / 2, y + GRID * 0.3);
  ctx.fillStyle = Art.color('accent');
  ctx.font = font(GRID * 0.38);
  ctx.fillText(`${rocket.grabbed}`, WIDTH / 2, y + GRID * 0.7);

  ctx.textAlign = 'right';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.28);
  ctx.fillText('LANDED', WIDTH - 10, y + GRID * 0.3);
  ctx.fillStyle = Art.color('accent');
  ctx.font = font(GRID * 0.38);
  ctx.fillText(String(rocket.landed), WIDTH - 10, y + GRID * 0.7);

  /* The booster gauge. Sits above the bar so it is in the corner of your eye
     while you are looking up the screen, not down here where you never are. */
  const gw = GRID * 2.6;
  const gh = GRID * 0.16;
  const gx = WIDTH / 2 - gw / 2;
  const gy = y - GRID * 0.34;
  const frac = Math.max(0, Math.min(1, rocket.fuel / ROCKET.fuel));

  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(gx - 2, gy - 2, gw + 4, gh + 4);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fillRect(gx, gy, gw, gh);
  ctx.fillStyle = rocket.burning ? '#ffd84a' : (frac < 0.25 ? '#ff6060' : '#ff9a3c');
  ctx.fillRect(gx, gy, gw * frac, gh);

  if (game.time - rocket.outcomeAt < 1.4) {
    ctx.globalAlpha = Math.max(0, 1 - (game.time - rocket.outcomeAt) / 1.4);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = font(GRID * 0.44);
    ctx.fillText(rocket.outcome, WIDTH / 2, HEIGHT / 2);
    ctx.globalAlpha = 1;
  }
}

/* --- the helicopter ---------------------------------------------------- */
function drawHeli() {
  for (const a of heli.aliens) {
    const hurt = game.time - a.hurt < 0.09;
    drawArt(ctx, Art.of('alien'), a.x, a.y, GRID, GRID,
            { cells: 1, time: game.time, scale: hurt ? 1.2 : 1 });
  }

  for (const sh of heli.enemyShots) {
    drawArt(ctx, Art.of('enemyShot'), sh.x - GRID * 0.28, sh.y - GRID * 0.28,
            GRID * 0.56, GRID * 0.56, { cells: 1, time: game.time });
  }

  for (const b of heli.bullets) {
    drawArt(ctx, Art.of('bullet'), b.x - GRID * 0.25, b.y - GRID * 0.25,
            GRID * 0.5, GRID * 0.5, { cells: 1, time: game.time });
  }

  /* A shadow on the ground, so it reads as flying rather than driving. */
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(heli.x + TRUCK_SIZE / 2, heli.y + TRUCK_SIZE * 0.92,
              TRUCK_SIZE * 0.34, TRUCK_SIZE * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const bob = Math.sin(game.time * 7) * GRID * 0.06;
  const justHit = game.time - heli.hurtAt < 0.5;
  const blink = justHit && Math.floor(game.time * 14) % 2 === 0;
  drawArt(ctx, Art.of('helicopter'), heli.x, heli.y + bob, TRUCK_SIZE, TRUCK_SIZE,
          { cells: 1, dir: heli.aim[0], time: game.time,
            alpha: blink ? 0.35 : 1 });
}

function drawHeliHud() {
  const font = (px) => `bold ${Math.round(px)}px "Courier New", monospace`;
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, 0, WIDTH, GRID);
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.3);
  ctx.fillText('1-UP', 10, GRID * 0.28);
  ctx.fillStyle = '#fff';
  ctx.font = font(GRID * 0.38);
  ctx.fillText(String(game.score).padStart(5, '0'), 10, GRID * 0.7);

  ctx.textAlign = 'center';
  ctx.fillStyle = Art.color('accent');
  ctx.font = font(GRID * 0.3);
  ctx.fillText('AIR SUPPORT', WIDTH / 2, GRID * 0.28);
  ctx.font = font(GRID * 0.42);
  ctx.fillText('+' + bonus.points, WIDTH / 2, GRID * 0.72);

  ctx.textAlign = 'right';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.3);
  ctx.fillText('ARMOUR', WIDTH - 10, GRID * 0.28);
  const armour = Math.max(0, HELI.heliLives - heli.hits);
  ctx.fillStyle = armour <= 1 ? Art.color('timeLow') : Art.color('timeBar');
  ctx.font = font(GRID * 0.38);
  ctx.fillText('#'.repeat(armour) || '--', WIDTH - 10, GRID * 0.72);

  const y = HEIGHT - GRID;
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, y, WIDTH, GRID);
  const frac = Math.max(0, heli.timeLeft / HELI.duration);
  const barW = WIDTH - GRID * 2.6, barH = GRID * 0.34;
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(GRID * 1.3, y + (GRID - barH) / 2, barW, barH);
  ctx.fillStyle = frac < 0.25 ? Art.color('timeLow') : Art.color('accent');
  ctx.fillRect(GRID * 1.3, y + (GRID - barH) / 2, barW * frac, barH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  ctx.font = font(GRID * 0.26);
  ctx.fillText(Math.ceil(heli.timeLeft) + 's', WIDTH / 2, y + GRID * 0.5);
}


/* ==========================================================================
   HUD
   ========================================================================== */

function drawHud() {
  const text = Art.color('text');
  const dim  = Art.color('textDim');
  const font = (px, bold) =>
    `${bold ? 'bold ' : ''}${Math.round(px)}px "Courier New", monospace`;

  /* --- Top: score and high score, like the cabinet. --- */
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, 0, WIDTH, GRID);
  ctx.textBaseline = 'middle';
  ctx.font = font(GRID * 0.3, true);

  ctx.textAlign = 'left';
  ctx.fillStyle = dim;
  ctx.fillText('1-UP', 10, GRID * 0.28);
  ctx.fillStyle = text;
  ctx.font = font(GRID * 0.38, true);
  ctx.fillText(String(game.score).padStart(5, '0'), 10, GRID * 0.7);

  ctx.textAlign = 'center';
  ctx.font = font(GRID * 0.3, true);
  ctx.fillStyle = dim;
  ctx.fillText('HI-SCORE', WIDTH / 2, GRID * 0.28);
  ctx.fillStyle = text;
  ctx.font = font(GRID * 0.38, true);
  ctx.fillText(String(game.highScore).padStart(5, '0'), WIDTH / 2, GRID * 0.7);

  ctx.textAlign = 'right';
  ctx.font = font(GRID * 0.3, true);
  ctx.fillStyle = dim;
  ctx.fillText('LEVEL', WIDTH - 10, GRID * 0.28);
  ctx.fillStyle = text;
  ctx.font = font(GRID * 0.38, true);
  ctx.fillText(String(game.level), WIDTH - 10, GRID * 0.7);

  /* A floating "+200" when you eat a fly or bring the lady home. */
  if (game.lastBonus && game.time - game.lastBonus.at < 1.6) {
    const age = game.time - game.lastBonus.at;
    ctx.globalAlpha = Math.max(0, 1 - age / 1.6);
    ctx.textAlign = 'center';
    ctx.fillStyle = Art.color('accent');
    ctx.font = font(GRID * 0.34, true);
    ctx.fillText(game.lastBonus.text, WIDTH / 2, laneY(1) + GRID * 0.5 - age * 30);
    ctx.globalAlpha = 1;
  }

  /* --- Bottom: lives, then the time bar. --- */
  const y = HEIGHT - GRID;
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, y, WIDTH, GRID);

  const lifeArt = Art.of('life');
  const shown = Math.min(game.lives, 5);
  for (let i = 0; i < shown; i++) {
    drawArt(ctx, lifeArt, 4 + i * GRID * 0.56, y + GRID * 0.2,
            GRID * 0.56, GRID * 0.56, { cells: 1, time: game.time });
  }
  if (game.lives > 5) {
    ctx.textAlign = 'left';
    ctx.fillStyle = text;
    ctx.font = font(GRID * 0.28, true);
    ctx.fillText(`x${game.lives}`, 4 + shown * GRID * 0.56 + 2, y + GRID * 0.5);
  }

  const barW = WIDTH * 0.4;
  const barH = GRID * 0.3;
  const barX = WIDTH - barW - 8;
  const barY = y + (GRID - barH) / 2;
  const frac = Math.max(0, game.timeLeft / timeCapacity());

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = frac < 0.25 ? Art.color('timeLow') : Art.color('timeBar');
  ctx.fillRect(barX + barW * (1 - frac), barY, barW * frac, barH);

  ctx.textAlign = 'right';
  ctx.fillStyle = dim;
  ctx.font = font(GRID * 0.26, true);
  ctx.fillText(airless() ? 'AIR' : 'TIME', barX - 6, y + GRID * 0.5);
}


/* ==========================================================================
   Overlays
   ========================================================================== */

/* Which full-screen overlay, if any, should be showing right now.
   Returning null for 'dying' matters: an earlier version fell through to the
   panel with no text in it, so every death flashed an empty black box. */
function overlayFor() {
  if (game.paused && game.state === 'play') return 'paused';
  if (game.state === 'title' || game.state === 'levelClear' ||
      game.state === 'gameOver') return game.state;
  return null;
}

/* --------------------------------------------------------------------------
   Why you just died, and what to do about it next time.

   The arcade never explained itself, but the arcade also had a cabinet full
   of people watching over your shoulder. A single line is enough to teach the
   one rule that catches everybody: on the river you have to be standing on
   something.
   -------------------------------------------------------------------------- */
const DEATH_HINTS = {
  'Squashed':                'wait for a gap in the traffic',
  'Drowned':                 'you have to land ON a log or a turtle',
  'The turtles dived':       'hop off as soon as they start to sink',
  'Washed away':             'do not let a log carry you off the edge',
  'Hit the bank':            'aim for a lilypad, not the green bank',
  'That lilypad is taken':   'pick one you have not filled yet',
  'A crocodile was waiting': 'not every lilypad is what it looks like',
  'Eaten by a crocodile':    'ride the back, never the jaws',
  'Bitten by a snake':       'the median stops being safe at level 3',
  'Out of air':              'the pockets drifting past are worth the detour',
  'Out of time':             'keep an eye on the TIME bar',
};

function drawDeathBanner() {
  if (game.state !== 'dying') return;

  /* Fade in fast, hold, fade out with the splat. */
  const age = game.stateTime;
  const alpha = Math.min(1, age / 0.12) * Math.max(0, Math.min(1, (0.9 - age) / 0.2));
  if (alpha <= 0) return;

  const reason = game.deathReason || '';
  const hint = DEATH_HINTS[reason] || '';

  const cx = WIDTH / 2;
  const y = HEIGHT / 2 - GRID * 0.4;
  const h = hint ? GRID * 1.5 : GRID * 0.95;
  const w = WIDTH - GRID * 1.2;

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.fillStyle = 'rgba(6,6,12,0.9)';
  roundRect(ctx, cx - w / 2, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = Art.color('timeLow');
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(GRID * 0.36)}px "Courier New", monospace`;
  ctx.fillText(reason.toUpperCase(), cx, y + (hint ? GRID * 0.48 : h / 2));

  if (hint) {
    ctx.fillStyle = Art.color('textDim');
    ctx.font = `${Math.round(GRID * 0.28)}px "Courier New", monospace`;
    ctx.fillText(hint, cx, y + GRID * 1.02);
  }

  ctx.restore();
}

function drawOverlay() {
  const showing = overlayFor();
  if (!showing) return;

  ctx.fillStyle = 'rgba(0,0,0,0.76)';
  ctx.fillRect(0, GRID, WIDTH, HEIGHT - GRID * 2);

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  const panelH = showing === 'title'
                 ? (game.titleView === 'levels' ? TITLE_PANEL_H : MAIN_PANEL_H)
               : showing === 'gameOver' ? GRID * 6
               : showing === 'levelClear' ? CLEAR_PANEL_H
               : GRID * 3.6;
  const panelW = WIDTH - GRID * 0.6;

  ctx.fillStyle = 'rgba(6,6,12,0.93)';
  roundRect(ctx, cx - panelW / 2, cy - panelH / 2, panelW, panelH, 12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const big   = () => { ctx.font = `bold ${Math.round(GRID * 0.76)}px "Courier New", monospace`; };
  const mid   = () => { ctx.font = `bold ${Math.round(GRID * 0.34)}px "Courier New", monospace`; };
  const small = () => { ctx.font = `${Math.round(GRID * 0.27)}px "Courier New", monospace`; };

  if (showing === 'paused') {
    big(); ctx.fillStyle = '#fff';
    ctx.fillText('PAUSED', cx, cy - 12);
    small(); ctx.fillStyle = Art.color('textDim');
    ctx.fillText('press SPACE or tap to carry on', cx, cy + 34);
    return;
  }

  switch (showing) {

    case 'title': {
      big(); ctx.fillStyle = '#fff';
      ctx.fillText('FROGGER', cx, cy - GRID * 3.6);

      const bob = Math.sin(game.time * 2.2) * GRID * 0.06;
      if (game.titleView !== 'levels') { drawMainMenu(cx, cy); break; }

      const L = titleLayout(cy);

      const s = GRID * 1.05;
      drawArt(ctx, Art.of('frog'), cx - s / 2, L.frog + bob, s, s,
              { cells: 1, time: game.time });

      /* --- the mode picker --- */
      const m = mode();
      mid(); ctx.fillStyle = Art.color('accent');
      ctx.fillText(`\u25c0  ${m.label}  \u25b6`, cx, L.mode);
      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText(m.blurb, cx, L.modeBlurb);

      /* --- the level picker, which draws its own environment label and the
             blurb for whatever is highlighted --- */
      drawLevelList(cx, L.listCy, L);

      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText('up / down pick a level  ::  SPACE to play it',
                   cx, L.controls);
      ctx.fillStyle = Art.color('accent');
      ctx.fillText('ESC to go back  ::  R music  ::  M mute  ::  C colours',
                   cx, L.keys);

      if (Math.floor(game.time * 1.6) % 2 === 0) {
        mid(); ctx.fillStyle = '#fff';
        ctx.fillText('PRESS SPACE TO PLAY', cx, L.start);
      }
      break;
    }

    case 'levelClear': {
      const C = clearLayout(cy);
      const nx = nextUp(game.level);

      big(); ctx.fillStyle = '#fff';
      ctx.fillText('LEVEL ' + game.level, cx, C.level);
      mid(); ctx.fillStyle = Art.color('accent');
      ctx.fillText('CLEARED  +' + CONFIG.score.clearLevel, cx, C.cleared);

      /* A rule across the card, so what you just did and what is coming next
         read as two separate things. */
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx - GRID * 3.4, C.rule);
      ctx.lineTo(cx + GRID * 3.4, C.rule);
      ctx.stroke();
      ctx.restore();

      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText(nx.victory ? 'AND THAT IS THE LAST ONE' : 'NEXT UP', cx, C.label);

      if (!nx.victory) {
        mid(); ctx.fillStyle = '#fff';
        ctx.fillText(nx.name.toUpperCase(), cx, C.name);

        if (nx.tag) {
          small(); ctx.fillStyle = Art.color('accent');
          ctx.fillText(nx.tag, cx, C.tag);
        }

        small(); ctx.fillStyle = '#dfe3ea';
        ctx.fillText(nx.blurb, cx, C.blurb);

        if (nx.env) {
          small(); ctx.fillStyle = Art.color('textDim');
          ctx.fillText(nx.env, cx, C.env);
        }

        /* The old "what is new" line, but only when something genuinely is. */
        if (nx.warning) {
          small(); ctx.fillStyle = Art.color('timeBar');
          ctx.fillText(nx.warning, cx, C.warning);
        }
      }
      break;
    }

    case 'gameOver': {
      big(); ctx.fillStyle = '#fff';
      ctx.fillText('GAME OVER', cx, cy - GRID * 1.2);

      mid(); ctx.fillStyle = Art.color('text');
      ctx.fillText('SCORE  ' + game.score, cx, cy - GRID * 0.3);
      ctx.fillText('BEST   ' + game.highScore, cx, cy + GRID * 0.2);

      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText(game.deathReason, cx, cy + GRID * 1.0);

      if (Math.floor(game.time * 1.6) % 2 === 0) {
        mid(); ctx.fillStyle = '#fff';
        ctx.fillText('PRESS SPACE', cx, cy + GRID * 1.9);
      }
      break;
    }
  }
}

/* --------------------------------------------------------------------------
   The level list on the title screen.

   Everything is unlocked. The point of it is being able to jump straight to
   any level to play or test it, and locking things would defeat that.
   -------------------------------------------------------------------------- */

const KIND_TAG = {
  cross:  '',
  truck:  'BONUS',
  heli:   'BONUS',
  rocket: 'BONUS',
  boat:   'BOSS',
};

const TWIST_TAG = { ice: 'ICE', dark: 'DARK', ghost: 'GHOST' };

function levelTag(p) {
  const tags = [];
  if (KIND_TAG[p.kind]) tags.push(KIND_TAG[p.kind]);
  if (p.rules) {
    for (const k of Object.keys(p.rules)) {
      if (p.rules[k] && TWIST_TAG[k]) tags.push(TWIST_TAG[k]);
    }
  }
  return tags.join(' ');
}

function clampPickedLevel() {
  const n = LEVELS.length || 1;
  game.pickedLevel = Math.max(1, Math.min(n, game.pickedLevel || 1));
}

/* ==========================================================================
   The main menu
   --------------------------------------------------------------------------
   The title screen used to BE the level list, which meant the first thing the
   game asked a new player was "which of seventeen levels would you like",
   before they knew what any of them were. Now it opens on three choices, and
   the list is behind one of them for when you want it.
   ========================================================================== */

const MAIN_MENU = [
  { key: 'start',  label: 'START GAME' },
  { key: 'mode',   label: 'DIFFICULTY' },
  { key: 'levels', label: 'LEVEL SELECT' },
];

/* A direction on the title screen, from the keyboard or a swipe. Both routes
   used to end up calling startGame, which meant a swipe on the title started
   the game rather than driving the menu that is now there. */
function titleMove(dx, dy) {
  if (game.titleView === 'levels') {
    if (dy) {
      game.pickedLevel = (game.pickedLevel || 1) + dy;
      clampPickedLevel();
      Art.setEnvironment(planFor(game.pickedLevel).env || 'pond');
      Sound.play('hop');
    }
    if (dx) { cycleMode(dx); Sound.play('hop'); }
    return;
  }
  if (dy) mainMenuMove(dy);
  if (dx) mainMenuSide(dx);
}

/* And the one place that handles "yes, that one". */
function titleChoose() {
  if (game.titleView === 'levels') startGame(game.pickedLevel);
  else mainMenuChoose();
}

function mainMenuMove(dy) {
  game.mainPick = (game.mainPick + dy + MAIN_MENU.length) % MAIN_MENU.length;
  Sound.play('hop');
}

function mainMenuChoose() {
  const row = MAIN_MENU[game.mainPick];

  if (row.key === 'start') {
    /* Straight in at the beginning, whatever the level list is pointing at.
       Picking a level is what LEVEL SELECT is for. */
    startGame(1);
    return;
  }
  if (row.key === 'mode') {
    cycleMode(1);
    Sound.play('hop');
    return;
  }
  game.titleView = 'levels';
  Sound.play('pickup');
}

/* Left and right on the main menu only mean anything on the difficulty row. */
function mainMenuSide(dx) {
  if (MAIN_MENU[game.mainPick].key !== 'mode') return;
  cycleMode(dx);
  Sound.play('hop');
}

function backToMainMenu() {
  game.titleView = 'main';
  Sound.play('hop');
}

/* How tall the level list is. It grows and shrinks with the number of levels,
   which is why nothing below it can be positioned by a hardcoded offset. */
function levelListMetrics() {
  const total = LEVELS.length;
  const rows  = Math.min(5, total);
  const rowH  = GRID * 0.62;
  return { total, rows, rowH, edge: (rows / 2) * rowH };
}

const TITLE_PANEL_H = GRID * 11.2;
const MAIN_PANEL_H  = GRID * 8.4;

/* The main menu's y positions, in one place, same as the other two screens. */
function mainLayout(cy) {
  const rows = MAIN_MENU.map((r, i) => cy - GRID * 0.55 + i * GRID * 0.95);
  return {
    frog:  cy - GRID * 2.75,
    title: cy - GRID * 1.75,
    rows,
    hint:  rows[rows.length - 1] + GRID * 1.05,
    keys:  rows[rows.length - 1] + GRID * 1.45,
    panelTop:    cy - MAIN_PANEL_H / 2,
    panelBottom: cy + MAIN_PANEL_H / 2,
  };
}

/* Every y on the title screen, worked out in one place. The drawing code and
   the test that checks these lines do not land on each other read the same
   numbers, which is the only thing that makes that test worth having.

   This exists because the level blurb and the controls line were being drawn
   at exactly the same y, one on top of the other, and both were right on
   their own terms: one measured down from the bottom of the list, the other
   from the middle of the screen, and the list had grown into it. */
function titleLayout(cy) {
  const { edge } = levelListMetrics();
  const listCy = cy + GRID * 0.45;
  const env    = listCy + edge + GRID * 0.6;
  const blurb  = planFor(game.pickedLevel).blurb
    ? listCy + edge + GRID * 1.0
    : null;
  const end = blurb === null ? env : blurb;

  return {
    frog:      cy - GRID * 3.05,
    mode:      cy - GRID * 1.95,
    modeBlurb: cy - GRID * 1.52,
    listCy, env, blurb,
    controls:  end + GRID * 0.55,
    keys:      end + GRID * 0.95,
    start:     end + GRID * 1.65,
    panelTop:    cy - TITLE_PANEL_H / 2,
    panelBottom: cy + TITLE_PANEL_H / 2,
  };
}

/* The main menu itself. Three rows, the middle one showing which difficulty
   you are on, and the level list tucked behind the third. */
function drawMainMenu(cx, cy) {
  const L = mainLayout(cy);
  const font = (px, bold) =>
    `${bold ? 'bold ' : ''}${Math.round(px)}px "Courier New", monospace`;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const bob = Math.sin(game.time * 2) * GRID * 0.06;
  const s = GRID * 1.05;
  drawArt(ctx, Art.of('frog'), cx - s / 2, L.frog + bob, s, s,
          { cells: 1, time: game.time });

  ctx.font = font(GRID * 0.62, true);
  ctx.fillStyle = Art.color('accent');
  ctx.fillText('FROGGER', cx, L.title);

  MAIN_MENU.forEach((row, i) => {
    const picked = i === game.mainPick;
    const y = L.rows[i];

    if (picked) {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      roundRect(ctx, cx - WIDTH * 0.34, y - GRID * 0.32,
                WIDTH * 0.68, GRID * 0.64, 6);
      ctx.fill();
    }

    ctx.font = font(GRID * 0.42, true);
    ctx.fillStyle = picked ? '#ffffff' : Art.color('textDim');

    if (row.key === 'mode') {
      const m = mode();
      /* Arrows on the row that has something to change, so it is obvious
         which one left and right belong to. */
      ctx.textAlign = 'left';
      ctx.fillText(row.label, cx - WIDTH * 0.30, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = Art.color('accent');
      ctx.fillText(picked ? `\u25c0  ${m.label}  \u25b6` : m.label,
                   cx + WIDTH * 0.30, y);

      ctx.textAlign = 'center';
      ctx.font = font(GRID * 0.24);
      ctx.fillStyle = Art.color('textDim');
      ctx.fillText(m.blurb, cx, y + GRID * 0.31);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(row.label, cx - WIDTH * 0.30, y);
      if (row.key === 'levels') {
        ctx.textAlign = 'right';
        ctx.fillStyle = Art.color('textDim');
        ctx.font = font(GRID * 0.3, true);
        ctx.fillText(`${LEVELS.length} levels  \u25b6`, cx + WIDTH * 0.30, y);
      }
      ctx.textAlign = 'center';
    }
  });

  ctx.textAlign = 'center';
  ctx.font = font(GRID * 0.26);
  ctx.fillStyle = Math.floor(game.time * 1.6) % 2 === 0 ? '#ffffff' : Art.color('textDim');
  ctx.fillText('up / down to choose  ::  SPACE to pick', cx, L.hint);

  ctx.fillStyle = Art.color('accent');
  ctx.fillText('R music  ::  M mute  ::  C colours  ::  ESC pause in game', cx, L.keys);
}

function drawLevelList(cx, cy, L) {
  clampPickedLevel();
  /* Whatever they are pointing at, get its music ready. */
  const wanted = Music.trackForLevel(planFor(game.pickedLevel));
  if (wanted) Music.prefetch(wanted);
  const { total, rows, rowH, edge } = levelListMetrics();

  /* Keep the choice roughly in the middle of the window. */
  let top = game.pickedLevel - 1 - Math.floor(rows / 2);
  top = Math.max(0, Math.min(total - rows, top));

  ctx.textBaseline = 'middle';

  for (let i = 0; i < rows; i++) {
    const n = top + i + 1;
    const p = planFor(n);
    const y = cy - ((rows - 1) / 2) * rowH + i * rowH;
    const picked = n === game.pickedLevel;

    if (picked) {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, cx - WIDTH * 0.42, y - rowH * 0.46,
                WIDTH * 0.84, rowH * 0.92, 5);
      ctx.fill();
    }

    ctx.font = `bold ${Math.round(GRID * 0.3)}px "Courier New", monospace`;
    ctx.textAlign = 'left';
    ctx.fillStyle = picked ? '#fff' : Art.color('textDim');
    ctx.fillText(String(n).padStart(2, ' '), cx - WIDTH * 0.39, y);
    ctx.fillText(p.name, cx - WIDTH * 0.31, y);

    const tag = levelTag(p);
    if (tag) {
      ctx.textAlign = 'right';
      ctx.font = `bold ${Math.round(GRID * 0.24)}px "Courier New", monospace`;
      ctx.fillStyle = picked ? Art.color('accent') : Art.color('textDim');
      ctx.fillText(tag, cx + WIDTH * 0.39, y);
    }
  }

  /* Little arrows so it is obvious the list scrolls. */
  ctx.textAlign = 'center';
  ctx.font = `${Math.round(GRID * 0.26)}px "Courier New", monospace`;
  ctx.fillStyle = Art.color('textDim');
  if (top > 0) ctx.fillText('\u25b2', cx, cy - edge - GRID * 0.2);
  if (top + rows < total) ctx.fillText('\u25bc', cx, cy + edge + GRID * 0.2);

  /* Where you are about to play it. */
  const p = planFor(game.pickedLevel);
  const env = (ENVIRONMENTS[p.env] || {}).label || '';
  ctx.font = `bold ${Math.round(GRID * 0.24)}px "Courier New", monospace`;
  ctx.fillStyle = Art.color('accent');

  ctx.fillText(env, cx, L.env);

  if (p.blurb && L.blurb !== null) {
    ctx.font = `${Math.round(GRID * 0.25)}px "Courier New", monospace`;
    ctx.fillStyle = Art.color('textDim');
    ctx.fillText(p.blurb, cx, L.blurb);
  }
}

/* Tell the player what is new about the level they are walking into. Half
   the fun of the arcade was the moment a new hazard showed up. */
/* Only fires on a hazard's first appearance. It used to fall through to
   "everything moves faster now" on every other level, which told you nothing
   and was the only thing the between-levels screen said. Now the screen names
   and describes the level you are about to play, and this is the extra line
   on top when something genuinely new is turning up. */
function nextLevelWarning(level) {
  const p = PROGRESSION;
  if (level === p.snakeFromLevel && level === p.gatorFromLevel)
    return 'new: snakes on the median, crocodiles in the river';
  if (level === p.snakeFromLevel)   return 'new: snakes on the median';
  if (level === p.gatorFromLevel)   return 'new: crocodiles in the river';
  if (level === p.bayCrocFromLevel) return 'new: something hiding in the lilypads';
  if (level === p.ladyFromLevel)    return 'new: a lady frog is waiting on a log';
  return '';
}

const CLEAR_PANEL_H = GRID * 7.4;

/* Where each line of the between-levels card goes. Same reasoning as the
   title screen: one place, so a test can check they do not collide. */
function clearLayout(cy) {
  return {
    level:   cy - GRID * 2.5,
    cleared: cy - GRID * 1.85,
    rule:    cy - GRID * 1.35,
    label:   cy - GRID * 0.95,
    name:    cy - GRID * 0.35,
    tag:     cy + GRID * 0.15,
    blurb:   cy + GRID * 0.75,
    env:     cy + GRID * 1.25,
    warning: cy + GRID * 1.9,
    panelTop:    cy - CLEAR_PANEL_H / 2,
    panelBottom: cy + CLEAR_PANEL_H / 2,
  };
}

/* Everything the card needs to know about what is coming. */
function nextUp(clearedLevel) {
  const n = clearedLevel + 1;
  if (clearedLevel >= LEVELS.length) return { victory: true };

  const p = planFor(n);
  return {
    victory: false,
    name:    levelName(n),
    blurb:   p.blurb || '',
    tag:     levelTag(p),
    env:     (ENVIRONMENTS[p.env] || {}).label || '',
    warning: nextLevelWarning(n),
  };
}


/* ==========================================================================
   The loop
   ========================================================================== */

let last = 0;

function loop(now) {
  requestAnimationFrame(loop);

  if (!last) last = now;
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;

  if (!game.paused) update(dt);
  else game.time += dt;

  updateGhosts(dt);

  /* Shake and flash are drawn in every state, so they have to fade in every
     state too. */
  bonus.shake = Math.max(0, bonus.shake - dt * 40);
  bonus.flash = Math.max(0, bonus.flash - dt * 3.5);

  /* Revs follow whatever the player is doing, which differs per machine:
     the truck and the helicopter answer to the controls, the rocket is either
     sitting on the pad or going flat out. */
  if (Engine.running) {
    const moving = held.left || held.right || held.up || held.down;
    let pedal = 0;
    if (!game.paused) {
      if (game.state === 'bonus') pedal = moving ? 1 : (bonus.wet ? 0.35 : 0);
      else if (game.state === 'heli') pedal = moving ? 1 : 0.45;  /* rotor never rests */
      else if (game.state === 'rocket') {
        /* Follows the booster now rather than being flat out the whole way,
           so the engine says what the rocket is doing. */
        pedal = !rocket.flying ? 0.12 : (rocket.burning ? 1 : 0.35);
      }
      else if (game.state === 'boat') pedal = boat.burning ? 1 : 0.5;
      else if (game.state === 'boatIntro') pedal = 0.2;
      else if (game.state === 'heliIntro') pedal = 0.3;
    }
    Engine.setThrottle(pedal);
  }

  draw();
}

sizeCanvas();
window.addEventListener('resize', sizeCanvas);

/* Lay out level one so the title screen has a real board behind it. */
game.pickedLevel = 1;
applyPlan();

/* Start pulling the music down straight away. fetch() is not blocked by the
   autoplay rules, so by the time the player presses a key the opening track is
   already in memory and starts instantly. */
Music.restorePreferences();
Music.warmUp();

requestAnimationFrame(loop);

/* For poking at the game from the browser console, and for the tests. */
window.frogger = {
  game, lanes, CONFIG, PROGRESSION, SPRITES, PALETTE, THEMES, PALETTES,
  Music, Art, notify, TRACKS, DEATH_HINTS, overlayFor,
  MODES, BONUS, bonus, mode, setting, rule, cycleMode, isBonusLevel, Engine, ENGINE,
  LEVELS, ENVIRONMENTS, MUSIC, planFor, lapsFor, plan, levelKind, levelName,
  hazard, twist, applyPlan, enterLevel, buildObstacles, trafficRows,
  onSolidGround, updateSlide, slideProgress, iceStep,
  rocket, heli, startRocket, startHeli, updateRocket, updateHeli, ROCKET, HELI,
  boat, BOAT, startBoat, updateBoat, boatProject, boatScreenX, spinOut,
  boatHorizonY, boatBottomY, finishBoat, boatPhase, boatPace,
  buildCourse, walkCourse, segAt, thingView, turtleUp, turtleState, thingSolid, ramBoss,
  scatterStars, crashRocket, updateAliens, takeHeliHit, overMedian, medianLane,
  TWISTS, RIVER_PRESETS, LEVEL_LOOP, levelTag, clampPickedLevel, ghosts,
  ENGINE_PROFILES, SOUNDS, PALETTES, engineProfileFor,
  advanceLevel, startBonusRound, inBonus, held, smashableLanes,
  startGame, startLevel, hop, laneY, diveState, divePhaseName, speedMultiplier,
  updateDives, spawnPuff, spawnRing, updateFx,
  updateSnakes, SNAKE, snakeLane, levelRule,
  truckLane, truckAfloat, setEngineProfile,
  updateAir, airless, timeCapacity, AIR, spawnAirPocket, airRows,
  lanternAt, resetGhosts, updateGhosts, drawGraves,
  titleLayout, levelListMetrics, TITLE_PANEL_H,
  MAIN_MENU, mainMenuMove, mainMenuChoose, mainMenuSide, backToMainMenu,
  titleMove, titleChoose,
  mainLayout, MAIN_PANEL_H,
  clearLayout, nextUp, CLEAR_PANEL_H, nextLevelWarning,
  updateGators, gatorPhase, gatorBites, GATOR, gatorHeadCell, cellUnder,
  WIDTH, HEIGHT, GRID, COLS, NLANES,
};

})();
