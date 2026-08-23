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

const lanes = LANES.map((def, row) => {
  const lane = {
    row,
    type: def.type,
    kind: def.kind,
    speed: def.speed || 0,
    spacing: def.spacing || [1],
    cells: def.length || 1,
    width: (def.length || 1) * GRID,
    dive: def.dive || false,
    bounce: !!def.bounce,
    fromLevel: def.fromLevel || 1,
    hasGators: !!def.gator,
    hasLady: !!def.lady,
    background: def.background || null,
    /* Diving groups within one row sink together, which gives the row a
       rhythm you can learn. Different rows are offset so they are never all
       down at the same moment. */
    divePhase: row * 2.3,
    obstacles: [],
  };

  if (!def.kind || !def.spacing) return lane;   /* home / safe / start rows */

  const patternWidth =
    lane.spacing.reduce((a, b) => a + b, 0) * GRID +
    lane.spacing.length * lane.width;

  /* Overshoot the right edge by a whole pattern so even a six-square log
     never pops into existence halfway across. */
  let endX = patternWidth;
  while (endX < WIDTH) endX += patternWidth;
  endX += patternWidth;

  let x = 0;
  let index = 0;
  while (x < endX) {
    lane.obstacles.push({
      x,
      index,
      cells: lane.cells,
      vx: lane.speed,
      dives: false,
      variant: null,
    });
    x += lane.width + lane.spacing[index] * GRID;
    index = (index + 1) % lane.spacing.length;
  }

  /* Alternating dives only stay alternating as groups cycle round if there
     is an EVEN number of them, so top up by one if needed. The extra one
     just sits further off screen. */
  if (lane.dive === 'alternate' && lane.obstacles.length % 2 === 1) {
    const last = lane.obstacles[lane.obstacles.length - 1];
    lane.obstacles.push({
      x: last.x + lane.width + lane.spacing[last.index] * GRID,
      index: (last.index + 1) % lane.spacing.length,
      cells: lane.cells,
      vx: lane.speed,
      dives: false,
      variant: null,
    });
  }

  /* Decide which groups dive. */
  lane.obstacles.forEach((ob, i) => {
    if (lane.dive === 'all') ob.dives = true;
    else if (lane.dive === 'alternate') ob.dives = i % 2 === 0;
  });

  return lane;
});

const riverLanes = lanes.filter((l) => l.type === 'river');
const homeRow    = lanes.findIndex((l) => l.type === 'home');
const ladyLanes  = lanes.filter((l) => l.hasLady);

/* Is this row's traffic switched on at the current level? Snakes on the
   median, for instance, only turn up at level 3. */
function laneActive(lane) {
  return game.level >= lane.fromLevel;
}


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

/* Speed climbs with the level, but eases off every few levels before
   climbing again, which is what the cabinet did. */
function speedMultiplier() {
  const p = PROGRESSION;
  const step = setting('speedStep', p.speedStep);
  const n = game.level - 1;
  const cycles = Math.floor(n / p.easeEvery);
  const within = n % p.easeEvery;
  const retained = cycles * p.easeEvery * step * (1 - p.easeAmount);
  return 1 + retained + within * step;
}


/* ==========================================================================
   Lifecycle
   ========================================================================== */

function startGame() {
  game.score = 0;
  game.level = 1;
  game.lives = setting('lives', CONFIG.lives);
  game.nextExtraLife = CONFIG.score.extraLifeEvery;
  startLevel();
  setState('play');
}

function startLevel() {
  game.bays = CONFIG.homeCols.map(() => false);
  game.bayHazard = null;
  game.lady = null;
  game.carrying = false;
  game.lastBonus = null;
  game.nextBaySpawn = game.time + setting('baySpawnGap', CONFIG.timing.baySpawnGap);
  game.nextLadySpawn = game.time + CONFIG.timing.ladySpawnGap * 0.5;

  /* Same seed for the same level, so the bonus pattern is learnable. */
  seedRng(game.level * 7919 + 13);

  /* Decide which logs are crocodiles this level. */
  for (const lane of lanes) {
    if (!lane.hasGators) continue;
    const on = game.level >= PROGRESSION.gatorFromLevel;
    lane.obstacles.forEach((ob, i) => {
      ob.variant = (on && i % PROGRESSION.gatorEveryNthLog === 0) ? 'gator' : null;
    });
  }

  respawn();
}

function respawn() {
  game.frog = newFrog();
  game.timeLeft = CONFIG.timeLimit;
  game.carrying = false;
}

/* The engine idles through the countdown and cuts when the rampage ends. */
const engineState = (st) => st === 'bonusIntro' || st === 'bonus';
const bonusState = (st) => engineState(st) || st === 'bonusResults';

function setState(next) {
  const wasEngine = engineState(game.state);
  const wasBonus = bonusState(game.state);

  game.state = next;
  game.stateTime = 0;

  if (!wasEngine && engineState(next)) Engine.start();
  if (wasEngine && !engineState(next)) Engine.stop();

  /* The rampage borrows the radio and gives it back afterwards. */
  if (!wasBonus && bonusState(next)) Music.playNamed(BONUS.music);
  if (wasBonus && !bonusState(next)) Music.restorePrevious();
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
      if (game.stateTime > BONUS.resultsTime) {
        startLevel();
        setState('play');
      }
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

  if (isBonusLevel(game.level)) {
    startBonusRound();
    Sound.play('bonus');
    setState('bonusIntro');
    return;
  }

  startLevel();
  setState('play');
}

/* True for the whole bonus sequence, intro and tally included. */
function inBonus() {
  return game.state === 'bonusIntro' || game.state === 'bonus' ||
         game.state === 'bonusResults';
}

function moveObstacles(dt) {
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

  const crocOk = game.level >= PROGRESSION.bayCrocFromLevel;
  const flyOk  = game.level >= PROGRESSION.flyFromLevel;
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
  if (game.level < PROGRESSION.ladyFromLevel || !ladyLanes.length) return;

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

/* Does the run into this level get a bonus round first? */
function isBonusLevel(level) {
  if (!BONUS || !BONUS.firstLevel) return false;
  if (level < BONUS.firstLevel) return false;
  return (level - BONUS.firstLevel) % Math.max(1, BONUS.everyLevels) === 0;
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
}

/* What is this thing worth? */
function smashValue(lane) {
  if (lane.type === 'river') return BONUS.points.boat;
  if (lane.cells >= 2) return BONUS.points.truck;
  return BONUS.points.car;
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
  bonus.shake = Math.max(0, bonus.shake - dt * 40);
  bonus.flash = Math.max(0, bonus.flash - dt * 3.5);

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

function smash(lane, ob) {
  ob.deadUntil = game.time + BONUS.respawnDelay;

  /* Keep the run going and the multiplier climbs. */
  if (game.time - bonus.lastSmash <= BONUS.comboWindow) {
    bonus.combo = Math.min(BONUS.comboMax, bonus.combo + 1);
  } else {
    bonus.combo = 1;
  }
  bonus.lastSmash = game.time;
  bonus.bestCombo = Math.max(bonus.bestCombo, bonus.combo);
  bonus.smashed++;

  const gained = smashValue(lane) * bonus.combo;
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

  Sound.play(bonus.combo >= 5 ? 'bigsmash' : 'smash');
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

    /* On the title screen, left and right choose beginner or expert. */
    if (game.state === 'title' && move[0] !== 0) {
      cycleMode(move[0]);
      Sound.play('hop');
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

    if (game.state === 'title' && dx !== 0) { cycleMode(dx); Sound.play('hop'); return; }
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
  drawObstacles();

  if (inBonus()) {
    drawBays();              /* so the bank does not look unfinished */
    drawTruck();
    drawParticles();
  } else {
    drawLady();
    drawBays();
    if (game.frog) drawFrog();
  }

  ctx.restore();

  if (bonus.flash > 0.01) {
    ctx.fillStyle = `rgba(255,255,255,${bonus.flash})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  if (inBonus()) {
    drawFloats();
    drawComboMeter();
    drawBonusHud();
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
function drawBonusOverlay() {
  if (game.state !== 'bonusIntro' && game.state !== 'bonusResults') return;

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  const t = game.stateTime;

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

  if (game.state === 'bonusIntro') {
    /* Title thumping in time with itself. */
    const thump = 1 + Math.abs(Math.sin(t * 6)) * 0.09;
    ctx.font = font(GRID * 0.86 * thump, true);
    ctx.fillStyle = Math.floor(t * 8) % 2 ? '#fff' : Art.color('accent');
    ctx.fillText('BONUS ROUND', cx, cy - GRID * 2.1);

    ctx.font = font(GRID * 0.42, true);
    ctx.fillStyle = '#fff';
    ctx.fillText('MONSTER TRUCK RAMPAGE', cx, cy - GRID * 1.2);

    const s2 = GRID * 2.4;
    const bob = Math.sin(t * 4) * GRID * 0.12;
    drawArt(ctx, Art.of('monsterTruck'), cx - s2 / 2, cy - GRID * 0.6 + bob,
            s2, s2, { cells: 1, time: game.time });

    ctx.font = font(GRID * 0.34, true);
    ctx.fillStyle = Art.color('accent');
    ctx.fillText('SMASH EVERYTHING', cx, cy + GRID * 1.5);
    ctx.font = font(GRID * 0.27);
    ctx.fillStyle = '#dfe3ea';
    ctx.fillText('drive with the arrows  ::  nothing can hurt you', cx, cy + GRID * 2.0);
    ctx.fillText('keep hitting things to build the multiplier', cx, cy + GRID * 2.45);

    /* 3, 2, 1... */
    const left = Math.max(0, BONUS.introTime - t);
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
    ctx.fillText('RAMPAGE OVER', cx, cy - GRID * 2.0);

    /* The numbers count up rather than just appearing. */
    const reveal = Math.min(1, t / 1.2);
    const rows = [
      ['SMASHED',    String(Math.round(bonus.smashed * reveal))],
      ['BEST COMBO', 'x' + Math.round(bonus.bestCombo * reveal)],
      ['BONUS',      '+' + Math.round(bonus.points * reveal)],
    ];
    rows.forEach(([k, v], i) => {
      const yy = cy - GRID * 0.9 + i * GRID * 0.85;
      ctx.font = font(GRID * 0.36, true);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#dfe3ea';
      ctx.fillText(k, cx - GRID * 3.1, yy);
      ctx.textAlign = 'right';
      ctx.fillStyle = i === 2 ? Art.color('accent') : '#fff';
      ctx.font = font(GRID * (i === 2 ? 0.52 : 0.42), true);
      ctx.fillText(v, cx + GRID * 3.1, yy);
    });

    ctx.textAlign = 'center';
    if (t > 1.4) {
      const rank = bonus.smashed >= 30 ? 'DEMOLITION EXPERT'
                 : bonus.smashed >= 20 ? 'MENACE TO TRAFFIC'
                 : bonus.smashed >= 10 ? 'KEEN DRIVER'
                 : 'LEARNER PLATES';
      ctx.font = font(GRID * 0.42, true);
      ctx.fillStyle = Math.floor(t * 5) % 2 ? '#fff' : Art.color('timeBar');
      ctx.fillText(rank, cx, cy + GRID * 1.9);
    }

    if (t > 2.4) {
      ctx.font = font(GRID * 0.3);
      ctx.fillStyle = '#dfe3ea';
      ctx.fillText('back to level ' + game.level + '...', cx, cy + GRID * 2.7);
    }
  }

  ctx.restore();
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

  const panelH = showing === 'title' ? GRID * 9.4
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
      ctx.fillText('FROGGER', cx, cy - GRID * 2.4);

      const bob = Math.sin(game.time * 2.2) * GRID * 0.06;
      const s = GRID * 1.6;
      drawArt(ctx, Art.of('frog'), cx - s / 2, cy - GRID * 1.55 + bob, s, s,
              { cells: 1, time: game.time });

      const need = Math.max(1, Math.min(CONFIG.baysToClear, CONFIG.homeCols.length));
      mid(); ctx.fillStyle = Art.color('text');
      ctx.fillText(need === 1 ? 'GET A FROG HOME'
                              : `GET ${need} FROGS HOME`, cx, cy + GRID * 0.55);

      /* --- the mode picker --- */
      const m = mode();
      mid(); ctx.fillStyle = Art.color('accent');
      ctx.fillText(`\u25c0   ${m.label}   \u25b6`, cx, cy + GRID * 1.3);
      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText(m.blurb, cx, cy + GRID * 1.78);

      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText('cars squash you  ::  you must RIDE the logs and turtles',
                   cx, cy + GRID * 2.4);
      ctx.fillText('arrows or WASD  ::  P pause  ::  N new game', cx, cy + GRID * 2.82);
      ctx.fillStyle = Art.color('accent');
      ctx.fillText('R music  ::  M mute  ::  C colours', cx, cy + GRID * 3.24);

      if (Math.floor(game.time * 1.6) % 2 === 0) {
        mid(); ctx.fillStyle = '#fff';
        ctx.fillText('PRESS SPACE TO START', cx, cy + GRID * 3.95);
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

  Music.pump();

  /* Revs follow the pedal. Off the pedal it drops back to a lumpy idle. */
  if (Engine.running) {
    const canDrive = game.state === 'bonus' && !game.paused;
    const pedal = canDrive &&
      (held.left || held.right || held.up || held.down) ? 1 : 0;
    Engine.setThrottle(pedal);
  }

  draw();
}

sizeCanvas();
window.addEventListener('resize', sizeCanvas);
requestAnimationFrame(loop);

/* For poking at the game from the browser console, and for the tests. */
window.frogger = {
  game, lanes, CONFIG, PROGRESSION, SPRITES, PALETTE, THEMES, PALETTES,
  Music, Art, notify, TRACKS, DEATH_HINTS, overlayFor, noteFreq,
  MODES, BONUS, bonus, mode, setting, rule, cycleMode, isBonusLevel, Engine, ENGINE,
  advanceLevel, startBonusRound, inBonus, held, smashableLanes,
  startGame, startLevel, hop, laneY, diveState, speedMultiplier,
  WIDTH, HEIGHT, GRID, COLS, NLANES,
};

})();
