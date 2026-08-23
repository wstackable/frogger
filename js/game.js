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
  bonusTotal: 0,       /* what the last bonus round was worth */
  ghostTime: 0,        /* banked world time, for the boneyard level */
  pickedLevel: 1,      /* which level the title screen is pointing at */
  lastBonus: null,     /* a little "+200" that floats up */
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
    hopFromX: x,
    hopFromY: laneY(START_ROW),
    hopT: 1e9,
    slideDir: null,
    slideAt: 0,
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
  game.timeLeft = CONFIG.timeLimit;
  game.carrying = false;
}

/* The engine idles through the countdown and cuts when the level ends. */
const engineState = (st) => st === 'bonusIntro'  || st === 'bonus' ||
                            st === 'heliIntro'   || st === 'heli' ||
                            st === 'rocketIntro' || st === 'rocket';

function engineProfileFor(st) {
  if (st === 'heliIntro' || st === 'heli') return 'helicopter';
  if (st === 'rocketIntro' || st === 'rocket') return 'rocket';
  return 'truck';
}
const bonusState = (st) => engineState(st) || st === 'bonusResults' ||
                           st === 'heliResults' ||
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
  if (game.frog) game.frog.hopT += dt * 1000;

  switch (game.state) {

    case 'play': {
      game.timeLeft -= dt;
      if (game.timeLeft <= 0) {
        game.timeLeft = 0;
        die('Out of time');
        break;
      }
      updateBayHazard(dt);
      updateLady(dt);
      updateSlide();
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

    for (const ob of lane.obstacles) ob.x += ob.vx * step;

    if (lane.bounce) bounceLane(lane);
    else wrapLane(lane);
  }
}

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
        die(sankUnderUs ? 'The turtles dived' : 'Drowned');
        return;
      }

      /* Crocodile jaws. The body is a perfectly good boat. */
      if (riding.variant === 'gator' && rule('gatorMouthIsDeath') &&
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

function updateBonus(dt) {
  bonus.timeLeft -= dt;

  /* --- drive --- */
  let dx = 0, dy = 0;
  if (held.left)  dx -= 1;
  if (held.right) dx += 1;
  if (held.up)    dy -= 1;
  if (held.down)  dy += 1;
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }   /* no free speed diagonally */

  bonus.x += dx * BONUS.speed * dt;
  bonus.y += dy * BONUS.speed * dt;

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
    p.vy += 420 * dt;                                 /* debris falls */
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
  wind: 0,
  windPhase: 0,
  trail: [],
  outcome: '',
  outcomeAt: -99,
};

function startRocket() {
  rocket.attemptsLeft = ROCKET.attempts;
  rocket.landed = 0;
  rocket.points = 0;
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
  rocket.trail.length = 0;
}

function launchRocket() {
  if (rocket.flying || !rocket.attemptsLeft) return;
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

    if (held.up) launchRocket();

    if (!rocket.attemptsLeft && game.time - rocket.outcomeAt > 1.2) {
      finishRocket();
    }
    return;
  }

  /* Flying. You get some say, the wind gets the rest. */
  let steer = 0;
  if (held.left) steer -= 1;
  if (held.right) steer += 1;

  rocket.x += (steer * ROCKET.steer + rocket.wind) * dt;
  rocket.y -= ROCKET.climb * dt;
  rocket.x = Math.max(-GRID * 0.4, Math.min(WIDTH - GRID * 0.6, rocket.x));

  rocket.trail.push({ x: rocket.x + GRID / 2, y: rocket.y + GRID, at: game.time });
  if (rocket.trail.length > 90) rocket.trail.shift();

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

function finishRocket() {
  Sound.play(rocket.landed ? 'fanfare' : 'over');
  setState('rocketResults');
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
};

function startHeli() {
  heli.x = (WIDTH - TRUCK_SIZE) / 2;
  heli.y = laneY(START_ROW) - GRID * 0.5;
  heli.aim = [0, -1];
  heli.nextShot = 0;
  heli.bullets.length = 0;
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
    Sound.play('fanfare');
    setState('heliResults');
  }
}


/* ==========================================================================
   Input
   ========================================================================== */

function hop(dx, dy) {
  if (inBonus()) return;                 /* the truck drives, it does not hop */
  if (game.state === 'title' || game.state === 'gameOver') { startGame(); return; }
  if (game.state !== 'play' || game.paused) return;

  const frog = game.frog;

  frog.hopFromX = frog.x;
  frog.hopFromY = laneY(frog.row);
  frog.hopT = 0;

  /* Every hop winds the boneyard's clock forward a little. */
  if (twist('ghost')) game.ghostTime += TWISTS.ghostPerHop;

  /* Sideways hops land on the column grid even if the frog had drifted while
     riding a log, which is what makes aiming at a lilypad possible. */
  if (dx) {
    const col = Math.round(frog.x / GRID) + dx;
    frog.x = Math.max(0, Math.min(COLS - 1, col)) * GRID;
    frog.dir = dx;
  }

  if (dy) {
    frog.row = Math.max(0, Math.min(NLANES - 1, frog.row + dy));
    /* Points for genuinely new ground only, so you cannot farm the median. */
    if (frog.row < frog.bestRow) {
      addScore(CONFIG.score.forwardHop * (frog.bestRow - frog.row));
      frog.bestRow = frog.row;
    }
  }

  Sound.play('hop');
  checkLane(0);          /* react now, do not wait for the next frame */

  /* On ice you keep going SIDEWAYS. Only sideways: an early version slid you
     an extra row as well, which meant you could not stop on a road lane at
     all and the late ice level was unplayable. Sliding side to side is the
     recognisable thing anyway, and it makes the twist about aiming rather
     than about dying. The slide is a second, separate hop, so it gets checked
     for cars and water exactly like the first one. */
  if (dx !== 0 && twist('ice') && !sliding && game.state === 'play') {
    frog.slideDir = [dx, 0];
    frog.slideAt = game.time + TWISTS.slideDelay;
  }
}

/* Set while a slide is being performed, so a slide cannot cause a slide. */
let sliding = false;

function updateSlide() {
  const frog = game.frog;
  if (!frog || !frog.slideDir || game.time < frog.slideAt) return;
  const [dx, dy] = frog.slideDir;
  frog.slideDir = null;
  sliding = true;
  hop(dx, dy);
  sliding = false;
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
  const move = KEYS[e.key];
  if (move) {
    e.preventDefault();
    setHeld(e.key, true);

    /* On the title screen the arrows drive the pickers, not the frog. */
    if (game.state === 'title') {
      if (move[0] !== 0) { cycleMode(move[0]); Sound.play('hop'); }
      if (move[1] !== 0) {
        game.pickedLevel = (game.pickedLevel || 1) + move[1];
        clampPickedLevel();
        Art.setEnvironment(planFor(game.pickedLevel).env || 'pond');
        Sound.play('hop');
      }
      return;
    }

    hop(move[0], move[1]);
    return;
  }

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (game.state === 'title' || game.state === 'gameOver') startGame();
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
    if (game.state === 'title' || game.state === 'gameOver') startGame();
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

  drawBackground();
  drawStars();
  drawObstacles();

  const st = game.state;
  const truckLevel = st === 'bonusIntro' || st === 'bonus' || st === 'bonusResults';
  const heliLevel = st === 'heliIntro' || st === 'heli' || st === 'heliResults';
  const rocketLevel = st === 'rocketIntro' || st === 'rocket' || st === 'rocketResults';

  if (truckLevel) {
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

  if (truckLevel) {
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
  drawOverlay();
  drawBonusOverlay();
  drawNotice();
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
      const art = Art.of(kind);
      const dive = rampage ? { sink: 0 } : diveState(lane, ob);

      drawArt(ctx, art, ob.x, y, w, GRID, {
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

  const dur = CONFIG.hopDuration;
  const p = dur > 0 ? Math.min(1, frog.hopT / dur) : 1;
  const ease = 1 - Math.pow(1 - p, 3);

  const targetY = laneY(frog.row);
  const x = p >= 1 ? frog.x  : frog.hopFromX + (frog.x - frog.hopFromX) * ease;
  const y = p >= 1 ? targetY : frog.hopFromY + (targetY - frog.hopFromY) * ease;

  if (game.state === 'dying') {
    drawArt(ctx, Art.of('splat'), x, y, GRID, GRID, {
      cells: 1,
      time: game.time,
      alpha: game.stateTime < 0.6 ? 1 : Math.max(0, 1 - (game.stateTime - 0.6) / 0.3),
      scale: 1 + game.stateTime * 0.5,
    });
    return;
  }

  const pop = 1 + 0.2 * Math.sin(p * Math.PI);

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
  /* A slight bounce while driving, so it never looks like it is sliding. */
  const moving = held.left || held.right || held.up || held.down;
  const bob = moving ? Math.sin(game.time * 26) * GRID * 0.045 : 0;
  const dir = held.right ? 1 : held.left ? -1 : 0;

  drawArt(ctx, Art.of('monsterTruck'), bonus.x, bonus.y + bob,
          TRUCK_SIZE, TRUCK_SIZE, { cells: 1, dir, time: game.time });
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
    const tally = screen.kind === 'rocket' ? rocket.landed : bonus.smashed;
    const rows = screen.kind === 'rocket'
      ? [['LANDED',  `${Math.round(rocket.landed * reveal)} of ${ROCKET.attempts}`],
         ['BONUS',   '+' + Math.round(rocket.points * reveal)]]
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
  n.fillStyle = `rgba(0,0,6,${TWISTS.darkness})`;
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

  /* What the frog can see. */
  if (game.frog) {
    hole(game.frog.x + GRID / 2, laneY(game.frog.row) + GRID / 2,
         GRID * TWISTS.lampRadius, 1);
  }

  /* Headlights, thrown the way each vehicle is going. */
  for (const lane of lanes) {
    if (lane.type !== 'road' || !lane.active) continue;
    const y = laneY(lane.row) + GRID / 2;
    for (const ob of lane.obstacles) {
      if (ob.deadUntil > game.time) continue;
      if (ob.x > WIDTH + GRID || ob.x + ob.cells * GRID < -GRID) continue;
      const nose = ob.vx > 0 ? ob.x + ob.cells * GRID : ob.x;
      hole(nose + Math.sign(ob.vx) * GRID * TWISTS.headlampReach * 0.45, y,
           GRID * TWISTS.headlampReach * 0.75, 0.85);
    }
  }

  ctx.drawImage(nightLayer, 0, 0, WIDTH, HEIGHT);
}

/* --- ghosts drifting about the boneyard --------------------------------- */
const ghosts = [];

function updateGhosts(dt) {
  if (!twist('ghost')) { ghosts.length = 0; return; }
  while (ghosts.length < TWISTS.ghostCount) {
    ghosts.push({
      x: rng() * WIDTH,
      y: GRID + rng() * (HEIGHT - GRID * 2),
      vx: (rng() - 0.5) * 26,
      vy: (rng() - 0.5) * 18,
      phase: rng() * 6.28,
    });
  }
  for (const g of ghosts) {
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    if (g.x < -GRID) g.x = WIDTH;
    if (g.x > WIDTH) g.x = -GRID;
    if (g.y < GRID) g.y = HEIGHT - GRID * 2;
    if (g.y > HEIGHT - GRID) g.y = GRID;
  }
}

function drawGhosts() {
  if (!twist('ghost')) return;
  const art = Art.of('ghost');
  for (const g of ghosts) {
    const bob = Math.sin(game.time * 1.6 + g.phase) * GRID * 0.12;
    /* Faint, but they have to actually be noticeable or there is no point. */
    const fade = 0.22 + 0.12 * Math.abs(Math.sin(game.time * 0.9 + g.phase));
    drawArt(ctx, art, g.x, g.y + bob, GRID * 1.25, GRID * 1.25,
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

  ctx.textAlign = 'right';
  ctx.fillStyle = Art.color('textDim');
  ctx.font = font(GRID * 0.28);
  ctx.fillText('LANDED', WIDTH - 10, y + GRID * 0.3);
  ctx.fillStyle = Art.color('accent');
  ctx.font = font(GRID * 0.38);
  ctx.fillText(String(rocket.landed), WIDTH - 10, y + GRID * 0.7);

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
  drawArt(ctx, Art.of('helicopter'), heli.x, heli.y + bob, TRUCK_SIZE, TRUCK_SIZE,
          { cells: 1, dir: heli.aim[0], time: game.time });
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
  ctx.fillText('DESTROYED', WIDTH - 10, GRID * 0.28);
  ctx.fillStyle = '#fff';
  ctx.font = font(GRID * 0.42);
  ctx.fillText(String(bonus.smashed), WIDTH - 10, GRID * 0.72);

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
  const frac = Math.max(0, game.timeLeft / CONFIG.timeLimit);

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = frac < 0.25 ? Art.color('timeLow') : Art.color('timeBar');
  ctx.fillRect(barX + barW * (1 - frac), barY, barW * frac, barH);

  ctx.textAlign = 'right';
  ctx.fillStyle = dim;
  ctx.font = font(GRID * 0.26, true);
  ctx.fillText('TIME', barX - 6, y + GRID * 0.5);
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

  const panelH = showing === 'title' ? GRID * 11.2
               : showing === 'gameOver' ? GRID * 6
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
      const s = GRID * 1.05;
      drawArt(ctx, Art.of('frog'), cx - s / 2, cy - GRID * 3.05 + bob, s, s,
              { cells: 1, time: game.time });

      /* --- the mode picker --- */
      const m = mode();
      mid(); ctx.fillStyle = Art.color('accent');
      ctx.fillText(`\u25c0  ${m.label}  \u25b6`, cx, cy - GRID * 1.95);
      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText(m.blurb, cx, cy - GRID * 1.52);

      /* --- the level picker. It draws its own environment label. --- */
      drawLevelList(cx, cy + GRID * 0.45);

      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText('up / down pick a level  ::  left / right pick a mode',
                   cx, cy + GRID * 3.0);
      ctx.fillStyle = Art.color('accent');
      ctx.fillText('R music  ::  M mute  ::  C colours  ::  P pause',
                   cx, cy + GRID * 3.4);

      if (Math.floor(game.time * 1.6) % 2 === 0) {
        mid(); ctx.fillStyle = '#fff';
        ctx.fillText('PRESS SPACE TO START', cx, cy + GRID * 4.1);
      }
      break;
    }

    case 'levelClear': {
      big(); ctx.fillStyle = '#fff';
      ctx.fillText('LEVEL ' + game.level, cx, cy - GRID * 0.5);
      mid(); ctx.fillStyle = Art.color('accent');
      ctx.fillText('CLEARED  +' + CONFIG.score.clearLevel, cx, cy + GRID * 0.15);
      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText(isBonusLevel(game.level + 1)
        ? 'get ready: MONSTER TRUCK RAMPAGE'
        : nextLevelWarning(game.level + 1), cx, cy + GRID * 0.85);
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

function drawLevelList(cx, cy) {
  clampPickedLevel();
  /* Whatever they are pointing at, get its music ready. */
  const wanted = Music.trackForLevel(planFor(game.pickedLevel));
  if (wanted) Music.prefetch(wanted);
  const total = LEVELS.length;
  const rows = Math.min(5, total);
  const rowH = GRID * 0.62;

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
  const edge = (rows / 2) * rowH;
  if (top > 0) ctx.fillText('\u25b2', cx, cy - edge - GRID * 0.2);
  if (top + rows < total) ctx.fillText('\u25bc', cx, cy + edge + GRID * 0.2);

  /* Where you are about to play it. */
  const p = planFor(game.pickedLevel);
  const env = (ENVIRONMENTS[p.env] || {}).label || '';
  ctx.font = `bold ${Math.round(GRID * 0.26)}px "Courier New", monospace`;
  ctx.fillStyle = Art.color('accent');
  ctx.fillText(env, cx, cy + edge + GRID * 0.72);
}

/* Tell the player what is new about the level they are walking into. Half
   the fun of the arcade was the moment a new hazard showed up. */
function nextLevelWarning(level) {
  const p = PROGRESSION;
  if (level === p.snakeFromLevel && level === p.gatorFromLevel)
    return 'snakes on the median, crocodiles in the river';
  if (level === p.snakeFromLevel)   return 'watch out: snakes on the median';
  if (level === p.gatorFromLevel)   return 'watch out: crocodiles in the river';
  if (level === p.bayCrocFromLevel) return 'watch out: something in the lilypads';
  if (level === p.ladyFromLevel)    return 'a lady frog is waiting on a log';
  const eased = (level - 1) % p.easeEvery === 0;
  return eased ? 'a breather, then it climbs again' : 'everything moves faster now';
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
      if (game.state === 'bonus') pedal = moving ? 1 : 0;
      else if (game.state === 'heli') pedal = moving ? 1 : 0.45;  /* rotor never rests */
      else if (game.state === 'rocket') pedal = rocket.flying ? 1 : 0.12;
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
  rocket, heli, startRocket, startHeli, updateRocket, updateHeli, ROCKET, HELI,
  TWISTS, RIVER_PRESETS, LEVEL_LOOP, levelTag, clampPickedLevel, ghosts,
  ENGINE_PROFILES, SOUNDS, PALETTES, engineProfileFor,
  advanceLevel, startBonusRound, inBonus, held, smashableLanes,
  startGame, startLevel, hop, laneY, diveState, speedMultiplier,
  WIDTH, HEIGHT, GRID, COLS, NLANES,
};

})();
