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
  lastBonus: null,     /* a little "+200" that floats up */
};

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

/* Speed climbs with the level, but eases off every few levels before
   climbing again, which is what the cabinet did. */
function speedMultiplier() {
  const p = PROGRESSION;
  const n = game.level - 1;
  const cycles = Math.floor(n / p.easeEvery);
  const within = n % p.easeEvery;
  const retained = cycles * p.easeEvery * p.speedStep * (1 - p.easeAmount);
  return 1 + retained + within * p.speedStep;
}


/* ==========================================================================
   Lifecycle
   ========================================================================== */

function startGame() {
  game.score = 0;
  game.level = 1;
  game.lives = CONFIG.lives;
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
  game.nextBaySpawn = game.time + CONFIG.timing.baySpawnGap;
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

function setState(next) {
  game.state = next;
  game.stateTime = 0;
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
  if (!ob.dives || !CONFIG.rules.divingTurtles) {
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
      if (game.stateTime > 2.0) {
        game.level++;
        startLevel();
        setState('play');
      }
      break;
    }
  }
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
      game.nextBaySpawn = game.time + t.baySpawnGap;
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
  const rules = CONFIG.rules;

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
      if (riding.variant === 'gator' && rules.gatorMouthIsDeath &&
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

      if (rules.edgeIsDeath) {
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
        if (rules.bankIsDeath) die('Hit the bank');
        return;
      }

      if (game.bays[bay]) {
        if (rules.occupiedBayIsDeath) die('That lilypad is taken');
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
        game.nextBaySpawn = game.time + CONFIG.timing.baySpawnGap;
      }

      if (game.carrying) {
        points += CONFIG.score.ladyFrog;
        label = `LADY +${CONFIG.score.ladyFrog}`;
        game.carrying = false;
        game.nextLadySpawn = game.time + CONFIG.timing.ladySpawnGap;
      }

      addScore(points, label);
      Sound.play('home');

      if (game.bays.every(Boolean)) {
        addScore(CONFIG.score.clearLevel, `ALL FIVE +${CONFIG.score.clearLevel}`);
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
   Input
   ========================================================================== */

function hop(dx, dy) {
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

window.addEventListener('keydown', (e) => {
  const move = KEYS[e.key];
  if (move) {
    e.preventDefault();
    hop(move[0], move[1]);
    return;
  }

  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (game.state === 'title' || game.state === 'gameOver') startGame();
    else game.paused = !game.paused;
  }

  if (e.key === 'p' || e.key === 'P') game.paused = !game.paused;
  if (e.key === 'r' || e.key === 'R') startGame();
});

window.addEventListener('blur', () => { if (game.state === 'play') game.paused = true; });

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
  pad.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button[data-dx]');
    if (!btn) return;
    e.preventDefault();
    hop(Number(btn.dataset.dx), Number(btn.dataset.dy));
  });
}

window.addEventListener('resize', fitToScreen);
window.addEventListener('orientationchange', fitToScreen);


/* ==========================================================================
   Draw
   ========================================================================== */

function draw() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  drawBackground();
  drawObstacles();
  drawLady();
  drawBays();
  if (game.frog) drawFrog();
  drawHud();
  drawOverlay();
}

function drawBackground() {
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

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

    for (const ob of lane.obstacles) {
      const w = ob.cells * GRID;
      if (ob.x > WIDTH || ob.x + w < 0) continue;

      const art = Art.of(ob.variant || lane.kind);
      const dive = diveState(lane, ob);

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

function drawOverlay() {
  if (game.state === 'play' && !game.paused) return;

  ctx.fillStyle = 'rgba(0,0,0,0.76)';
  ctx.fillRect(0, GRID, WIDTH, HEIGHT - GRID * 2);

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  const panelH = game.state === 'title' ? GRID * 7.4
               : game.state === 'gameOver' ? GRID * 6
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

  if (game.paused && game.state === 'play') {
    big(); ctx.fillStyle = '#fff';
    ctx.fillText('PAUSED', cx, cy - 12);
    small(); ctx.fillStyle = Art.color('textDim');
    ctx.fillText('press SPACE or tap to carry on', cx, cy + 34);
    return;
  }

  switch (game.state) {

    case 'title': {
      big(); ctx.fillStyle = '#fff';
      ctx.fillText('FROGGER', cx, cy - GRID * 2.4);

      const bob = Math.sin(game.time * 2.2) * GRID * 0.06;
      const s = GRID * 1.6;
      drawArt(ctx, Art.of('frog'), cx - s / 2, cy - GRID * 1.55 + bob, s, s,
              { cells: 1, time: game.time });

      mid(); ctx.fillStyle = Art.color('text');
      ctx.fillText(`GET ${CONFIG.homeCols.length} FROGS HOME`, cx, cy + GRID * 0.6);

      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText('cars squash you  ::  water drowns you', cx, cy + GRID * 1.25);
      ctx.fillText('ride the logs and the turtles', cx, cy + GRID * 1.7);
      ctx.fillText('arrows or WASD  ::  P pause  ::  R restart', cx, cy + GRID * 2.15);

      if (Math.floor(game.time * 1.6) % 2 === 0) {
        mid(); ctx.fillStyle = '#fff';
        ctx.fillText('PRESS SPACE TO START', cx, cy + GRID * 2.9);
      }
      break;
    }

    case 'levelClear': {
      big(); ctx.fillStyle = '#fff';
      ctx.fillText('LEVEL ' + game.level, cx, cy - GRID * 0.5);
      mid(); ctx.fillStyle = Art.color('accent');
      ctx.fillText('CLEARED  +' + CONFIG.score.clearLevel, cx, cy + GRID * 0.15);
      small(); ctx.fillStyle = Art.color('textDim');
      ctx.fillText(nextLevelWarning(game.level + 1), cx, cy + GRID * 0.85);
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

  draw();
}

sizeCanvas();
window.addEventListener('resize', sizeCanvas);
requestAnimationFrame(loop);

/* For poking at the game from the browser console, and for the tests. */
window.frogger = {
  game, lanes, CONFIG, PROGRESSION, SPRITES, PALETTE, THEMES,
  startGame, startLevel, hop, laneY, diveState, speedMultiplier,
  WIDTH, HEIGHT, GRID, COLS, NLANES,
};

})();
