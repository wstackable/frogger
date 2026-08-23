/* ==========================================================================
   FROGGER  ::  game.js
   --------------------------------------------------------------------------
   The engine. It reads everything it needs from config.js and draws
   everything through render.js, so you can usually leave this file alone.

   Roughly in order, this file does:
     - work out the board size from CONFIG
     - build the obstacles for each lane from LANES
     - run the game loop: update, then draw
     - handle keyboard, swipe and button input
     - keep score, lives, level and the timer

   If you want to add a new rule (a power-up, a second frog, a boss lane),
   the two functions to look at are update() and checkLane().
   ========================================================================== */

(function () {
'use strict';

/* ==========================================================================
   Board geometry, derived from CONFIG. Nothing here is hardcoded.
   ========================================================================== */

const GRID   = CONFIG.grid;
const COLS   = CONFIG.cols;
const NLANES = LANES.length;

const WIDTH  = COLS * GRID;
const HEIGHT = (NLANES + 2) * GRID;      /* one HUD row top, one bottom */

const START_ROW = NLANES - 1;
const START_COL = Math.floor(COLS / 2);

/* Screen y of the top of a lane. Lane 0 sits below the top HUD row. */
const laneY = (row) => (row + 1) * GRID;

/* How much smaller than its square a hitbox is. Slightly generous, which
   feels fair rather than fussy. */
const HIT_INSET = 8;


/* ==========================================================================
   Canvas setup
   ========================================================================== */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

/* Draw at the device's real pixel density so emoji and text stay crisp on
   phones and retina screens, then let CSS scale the canvas to fit. */
function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width  = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  fitToScreen();
}

/* Pick the biggest whole-board size that fits the window. */
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
   For each lane in LANES we lay out obstacles left to right following its
   spacing pattern, continuing far enough past the right edge that the
   wrap-around at the end of update() is always seamless.
   ========================================================================== */

const lanes = LANES.map((def, row) => {
  const lane = {
    row,
    type: def.type,
    kind: def.kind,
    speed: def.speed || 0,
    spacing: def.spacing || [1],
    width: (def.length || 1) * GRID,
    diving: !!def.diving && CONFIG.difficulty.divingTurtles,
    /* Offset so two diving lanes are never in step with each other. */
    divePhase: row * 1.9,
    obstacles: [],
  };

  if (!def.kind || !def.spacing) return lane;   /* safe / home / start rows */

  /* One full cycle of the pattern, in pixels. */
  const patternWidth =
    lane.spacing.reduce((a, b) => a + b, 0) * GRID +
    lane.spacing.length * lane.width;

  /* Fill past the right edge by a whole extra pattern, so a very long log
     never pops into existence mid-screen. */
  let endX = patternWidth;
  while (endX < WIDTH) endX += patternWidth;
  endX += patternWidth;

  let x = 0;
  let index = 0;
  while (x < endX) {
    lane.obstacles.push({ x, index });
    x += lane.width + lane.spacing[index] * GRID;
    index = (index + 1) % lane.spacing.length;
  }

  return lane;
});


/* ==========================================================================
   Game state
   ========================================================================== */

const HIGH_SCORE_KEY = 'frogger.highScore';

const game = {
  state: 'title',        /* title | play | dying | levelClear | gameOver */
  stateTime: 0,          /* seconds spent in the current state */
  paused: false,
  time: 0,               /* seconds since load, for animations */

  score: 0,
  highScore: Number(localStorage.getItem(HIGH_SCORE_KEY) || 0),
  level: 1,
  lives: CONFIG.lives,
  nextExtraLife: CONFIG.score.extraLifeEvery,

  timeLeft: CONFIG.timeLimit,
  bays: CONFIG.homeCols.map(() => false),

  frog: null,
  deathReason: '',
};

function newFrog() {
  const x = START_COL * GRID;
  return {
    x,                       /* logical position, can drift while riding */
    row: START_ROW,
    bestRow: START_ROW,      /* furthest row reached, for hop scoring */
    dir: 0,                  /* which way it last moved, for mirroring art */
    hopFromX: x,
    hopFromY: laneY(START_ROW),
    hopT: 1e9,               /* big number = not mid-hop */
  };
}

/* Obstacle speeds scale up as the levels go by. */
const speedMultiplier = () => 1 + (game.level - 1) * CONFIG.speedRampPerLevel;


/* ==========================================================================
   Lifecycle
   ========================================================================== */

function startGame() {
  game.score = 0;
  game.level = 1;
  game.lives = CONFIG.lives;
  game.nextExtraLife = CONFIG.score.extraLifeEvery;
  game.bays = CONFIG.homeCols.map(() => false);
  respawn();
  setState('play');
}

function respawn() {
  game.frog = newFrog();
  game.timeLeft = CONFIG.timeLimit;
}

function setState(next) {
  game.state = next;
  game.stateTime = 0;
}

function addScore(points) {
  game.score += points;
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
  Sound.play('die');
  setState('dying');
}


/* ==========================================================================
   Diving turtles
   --------------------------------------------------------------------------
   A whole lane dives together, on a loop of up -> blinking -> submerged.
   Blinking is the warning: you can still stand on it. Submerged means the
   water is open and you will drown.
   ========================================================================== */

function diveState(lane) {
  if (!lane.diving) return { submerged: false, alpha: 1 };

  const d = CONFIG.difficulty;
  const cycle = d.diveUp + d.diveBlink + d.diveDown;
  const t = (game.time + lane.divePhase) % cycle;

  if (t < d.diveUp) {
    return { submerged: false, alpha: 1 };
  }
  if (t < d.diveUp + d.diveBlink) {
    /* Fade in and out a few times as a warning. */
    const p = (t - d.diveUp) / d.diveBlink;
    return { submerged: false, alpha: 0.45 + 0.55 * Math.abs(Math.cos(p * Math.PI * 3)) };
  }
  return { submerged: true, alpha: 0 };
}


/* ==========================================================================
   Update
   ========================================================================== */

function update(dt) {
  game.time += dt;
  game.stateTime += dt;

  /* Obstacles keep moving in every state, so the board never looks frozen
     behind the title screen or a death animation. */
  const step = (dt * 60) * speedMultiplier();
  for (const lane of lanes) {
    if (!lane.obstacles.length) continue;
    for (const ob of lane.obstacles) {
      ob.x += lane.speed * step;
    }
    wrapLane(lane);
  }

  /* Frog visual catch-up runs in every state too, so the death splat sits
     where the frog actually was. */
  if (game.frog) game.frog.hopT += dt * 1000;

  switch (game.state) {

    case 'play': {
      game.timeLeft -= dt;
      if (game.timeLeft <= 0) {
        game.timeLeft = 0;
        die('Out of time');
        break;
      }
      checkLane(dt);
      break;
    }

    case 'dying': {
      if (game.stateTime > 0.85) {
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
      if (game.stateTime > 1.8) {
        game.level++;
        game.bays = CONFIG.homeCols.map(() => false);
        respawn();
        setState('play');
      }
      break;
    }
  }
}

/* Move any obstacle that has left the screen round to the far end of the
   pattern, keeping the spacing rhythm intact. */
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
   checkLane: everything that can happen to the frog where it is standing.
   This is the heart of the rules. Add new lane types here.
   -------------------------------------------------------------------------- */
function checkLane(dt) {
  const frog = game.frog;
  const lane = lanes[frog.row];

  const frogL = frog.x + HIT_INSET;
  const frogR = frog.x + GRID - HIT_INSET;

  switch (lane.type) {

    /* ------------------------------------------------------------- the road */
    case 'road': {
      for (const ob of lane.obstacles) {
        if (frogL < ob.x + lane.width && frogR > ob.x) {
          die('Squashed');
          return;
        }
      }
      break;
    }

    /* ------------------------------------------------------------ the river */
    case 'river': {
      const dive = diveState(lane);
      const centre = frog.x + GRID / 2;

      /* You need something under your middle to stand on. */
      let riding = null;
      if (!dive.submerged) {
        for (const ob of lane.obstacles) {
          if (centre >= ob.x && centre <= ob.x + lane.width) { riding = ob; break; }
        }
      }

      if (!riding) {
        die(dive.submerged ? 'The turtles dived' : 'Drowned');
        return;
      }

      /* Ride along with it. */
      frog.x += lane.speed * (dt * 60) * speedMultiplier();
      frog.hopFromX += lane.speed * (dt * 60) * speedMultiplier();

      /* Carried off the edge of the screen. */
      const c = frog.x + GRID / 2;
      if (c < 0 || c > WIDTH) {
        die('Washed away');
        return;
      }
      break;
    }

    /* ------------------------------------------------------- the home bays */
    case 'home': {
      const bay = CONFIG.homeCols.findIndex(
        (col) => Math.abs(frog.x - col * GRID) < GRID * 0.5
      );

      if (bay === -1) {
        /* Landed on the bank between two bays. */
        if (CONFIG.difficulty.hitBankIsDeath) die('Hit the bank');
        return;
      }

      if (game.bays[bay]) {
        /* That bay already has a frog in it. */
        if (CONFIG.difficulty.hitBankIsDeath) die('Bay already taken');
        else frog.row = 1;   /* nudged back out onto the river */
        return;
      }

      /* Home safely. */
      game.bays[bay] = true;
      const bonus = Math.floor(game.timeLeft) * CONFIG.score.perSecondLeft;
      addScore(CONFIG.score.reachHome + bonus);
      Sound.play('home');

      if (game.bays.every(Boolean)) {
        addScore(CONFIG.score.clearLevel);
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

  /* Remember where the frog was, so the hop can be animated from there. */
  frog.hopFromX = frog.x;
  frog.hopFromY = laneY(frog.row);
  frog.hopT = 0;

  /* Hops always land on the column grid, even if the frog had drifted while
     riding a log. This is what the arcade did, and it makes aiming at the
     home bays predictable. */
  if (dx) {
    const col = Math.round(frog.x / GRID) + dx;
    frog.x = Math.max(0, Math.min(COLS - 1, col)) * GRID;
    frog.dir = dx;
  }

  if (dy) {
    frog.row = Math.max(0, Math.min(NLANES - 1, frog.row + dy));
    /* Points for genuinely new forward progress only, so you cannot farm
       points by hopping up and down on the median. */
    if (frog.row < frog.bestRow) {
      addScore(CONFIG.score.forwardHop * (frog.bestRow - frog.row));
      frog.bestRow = frog.row;
    }
  }

  Sound.play('hop');
  checkLane(0);   /* react immediately, do not wait a frame */
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

/* Pause when the tab or window loses focus, so nobody comes back to a
   frog that quietly died three minutes ago. */
window.addEventListener('blur', () => { if (game.state === 'play') game.paused = true; });

/* --- Swipe anywhere on the board. --------------------------------------- */
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

  const MIN_SWIPE = 24;
  if (Math.abs(dx) < MIN_SWIPE && Math.abs(dy) < MIN_SWIPE) {
    /* A tap, not a swipe. Use it to start or unpause. */
    if (game.state === 'title' || game.state === 'gameOver') startGame();
    else game.paused = !game.paused;
    return;
  }

  if (Math.abs(dx) > Math.abs(dy)) hop(dx > 0 ? 1 : -1, 0);
  else hop(0, dy > 0 ? 1 : -1);
}, { passive: true });

/* --- On-screen buttons. ------------------------------------------------- */
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
  drawBays();
  if (game.frog) drawFrog();
  drawHud();
  drawOverlay();
}

/* One flat colour band per lane, chosen by the lane's type. Add a case here
   if you invent a new lane type. */
function drawBackground() {
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  for (const lane of lanes) {
    let color;
    switch (lane.type) {
      case 'river': color = Art.color('water');  break;
      case 'road':  color = Art.color('road');   break;
      case 'safe':  color = Art.color('median'); break;
      case 'home':  color = Art.color('grass');  break;
      default:      color = Art.color('grass');
    }
    ctx.fillStyle = color;
    ctx.fillRect(0, laneY(lane.row), WIDTH, GRID);
  }
}

function drawObstacles() {
  for (const lane of lanes) {
    if (!lane.obstacles.length) continue;

    const art = Art.of(lane.kind);
    const dive = diveState(lane);
    if (dive.alpha <= 0) continue;

    const dir = Math.sign(lane.speed);
    const y = laneY(lane.row);

    for (const ob of lane.obstacles) {
      /* Skip anything fully off screen. */
      if (ob.x > WIDTH || ob.x + lane.width < 0) continue;
      drawArt(ctx, art, ob.x, y, lane.width, GRID, {
        dir,
        alpha: dive.alpha,
        time: game.time,
      });
    }
  }
}

/* The home bays: a hole in the bank for each one, with a house marker if
   it is empty and a frog if it has been filled. */
function drawBays() {
  const row = lanes.findIndex((l) => l.type === 'home');
  if (row === -1) return;
  const y = laneY(row);

  const homeArt = Art.of('home');
  const scoredArt = Art.of('scored');

  for (let i = 0; i < CONFIG.homeCols.length; i++) {
    const x = CONFIG.homeCols[i] * GRID;

    ctx.fillStyle = Art.color('water');
    ctx.fillRect(x + 2, y + 3, GRID - 4, GRID - 6);

    drawArt(ctx, game.bays[i] ? scoredArt : homeArt, x, y, GRID, GRID, { time: game.time });
  }

  /* A lip along the front edge of the bank, so it reads as solid ground. */
  ctx.fillStyle = Art.color('bankLine');
  ctx.fillRect(0, y + GRID - 4, WIDTH, 4);
}

function drawFrog() {
  const frog = game.frog;

  /* Ease from where the hop started to where it ended. */
  const dur = CONFIG.hopDuration;
  const p = dur > 0 ? Math.min(1, frog.hopT / dur) : 1;
  const ease = 1 - Math.pow(1 - p, 3);

  const targetY = laneY(frog.row);
  const x = p >= 1 ? frog.x    : frog.hopFromX + (frog.x - frog.hopFromX) * ease;
  const y = p >= 1 ? targetY   : frog.hopFromY + (targetY - frog.hopFromY) * ease;

  /* A little squash and stretch mid-hop. Pure decoration. */
  const pop = 1 + 0.22 * Math.sin(p * Math.PI);

  if (game.state === 'dying') {
    drawArt(ctx, Art.of('splat'), x, y, GRID, GRID, {
      time: game.time,
      /* Flash for the first part of the death, then fade out. */
      alpha: game.stateTime < 0.55 ? 1 : Math.max(0, 1 - (game.stateTime - 0.55) / 0.3),
      scale: 1 + game.stateTime * 0.6,
    });
    return;
  }

  drawArt(ctx, Art.of('frog'), x, y, GRID, GRID, {
    dir: frog.dir,
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

  /* --- Top row: score, high score, level. --- */
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, 0, WIDTH, GRID);

  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(GRID * 0.36)}px "Courier New", monospace`;

  ctx.textAlign = 'left';
  ctx.fillStyle = dim;
  ctx.fillText('SCORE', 10, GRID * 0.3);
  ctx.fillStyle = text;
  ctx.fillText(String(game.score).padStart(5, '0'), 10, GRID * 0.68);

  ctx.textAlign = 'center';
  ctx.fillStyle = dim;
  ctx.fillText('HI', WIDTH / 2, GRID * 0.3);
  ctx.fillStyle = text;
  ctx.fillText(String(game.highScore).padStart(5, '0'), WIDTH / 2, GRID * 0.68);

  ctx.textAlign = 'right';
  ctx.fillStyle = dim;
  ctx.fillText('LEVEL', WIDTH - 10, GRID * 0.3);
  ctx.fillStyle = text;
  ctx.fillText(String(game.level), WIDTH - 10, GRID * 0.68);

  /* --- Bottom row: lives on the left, timer bar on the right. --- */
  const y = HEIGHT - GRID;
  ctx.fillStyle = Art.color('hudBg');
  ctx.fillRect(0, y, WIDTH, GRID);

  const lifeArt = Art.of('life');
  const shown = Math.min(game.lives, 6);
  for (let i = 0; i < shown; i++) {
    drawArt(ctx, lifeArt, 6 + i * GRID * 0.6, y + GRID * 0.18, GRID * 0.6, GRID * 0.6, { time: game.time });
  }
  if (game.lives > 6) {
    ctx.textAlign = 'left';
    ctx.fillStyle = text;
    ctx.font = `bold ${Math.round(GRID * 0.3)}px "Courier New", monospace`;
    ctx.fillText(`x${game.lives}`, 6 + shown * GRID * 0.6 + 4, y + GRID * 0.48);
  }

  /* Reverse progress bar: it drains towards the right as time runs out. */
  const barW = WIDTH * 0.42;
  const barH = GRID * 0.34;
  const barX = WIDTH - barW - 10;
  const barY = y + (GRID - barH) / 2;
  const frac = Math.max(0, game.timeLeft / CONFIG.timeLimit);

  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();

  ctx.fillStyle = frac < 0.25 ? Art.color('timeLow') : Art.color('timeBar');
  roundRect(ctx, barX + barW * (1 - frac), barY, barW * frac, barH, barH / 2);
  ctx.fill();

  ctx.textAlign = 'right';
  ctx.fillStyle = dim;
  ctx.font = `bold ${Math.round(GRID * 0.26)}px "Courier New", monospace`;
  ctx.fillText('TIME', barX - 8, y + GRID * 0.5);
}


/* ==========================================================================
   Overlays: title, pause, level clear, game over
   ========================================================================== */

function drawOverlay() {
  if (game.state === 'play' && !game.paused) return;

  /* Dim the board, then float a panel on top so text never has to compete
     with a river full of logs behind it. */
  ctx.fillStyle = 'rgba(0,0,0,0.74)';
  ctx.fillRect(0, GRID, WIDTH, HEIGHT - GRID * 2);

  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;

  const panelH = game.state === 'title' ? GRID * 7.2
               : game.state === 'gameOver' ? GRID * 6
               : GRID * 3.4;
  const panelW = WIDTH - GRID * 0.6;

  ctx.fillStyle = 'rgba(10,10,16,0.9)';
  roundRect(ctx, cx - panelW / 2, cy - panelH / 2, panelW, panelH, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const big  = (s) => { ctx.font = `bold ${Math.round(GRID * 0.78)}px "Courier New", monospace`; return s; };
  const mid  = (s) => { ctx.font = `bold ${Math.round(GRID * 0.36)}px "Courier New", monospace`; return s; };
  const small= (s) => { ctx.font = `${Math.round(GRID * 0.28)}px "Courier New", monospace`; return s; };

  if (game.paused && game.state === 'play') {
    ctx.fillStyle = '#fff';
    ctx.fillText(big('PAUSED'), cx, cy - 12);
    ctx.fillStyle = Art.color('textDim');
    ctx.fillText(small('press SPACE or tap to carry on'), cx, cy + 34);
    return;
  }

  switch (game.state) {

    case 'title': {
      ctx.fillStyle = '#fff';
      ctx.fillText(big('FROGGER'), cx, cy - GRID * 2.3);

      /* An oversized frog, bobbing gently. */
      const bob = Math.sin(game.time * 2.2) * GRID * 0.06;
      const s = GRID * 1.7;
      drawArt(ctx, Art.of('frog'), cx - s / 2, cy - GRID * 1.4 + bob, s, s, { time: game.time });

      ctx.fillStyle = Art.color('text');
      ctx.fillText(mid(`Get ${CONFIG.homeCols.length} frogs home`), cx, cy + GRID * 0.85);

      ctx.fillStyle = Art.color('textDim');
      ctx.fillText(small('Arrow keys or WASD'), cx, cy + GRID * 1.5);
      ctx.fillText(small('swipe or tap the arrows on a touchscreen'), cx, cy + GRID * 1.95);
      ctx.fillText(small('P pauses  ::  R restarts'), cx, cy + GRID * 2.4);

      /* Blinking prompt. */
      if (Math.floor(game.time * 1.6) % 2 === 0) {
        ctx.fillStyle = '#fff';
        ctx.fillText(mid('PRESS SPACE OR TAP TO START'), cx, cy + GRID * 3.1);
      }
      break;
    }

    case 'levelClear': {
      ctx.fillStyle = '#fff';
      ctx.fillText(big('LEVEL ' + game.level), cx, cy - 20);
      ctx.fillStyle = Art.color('text');
      ctx.fillText(mid('CLEARED  +' + CONFIG.score.clearLevel), cx, cy + 30);
      ctx.fillStyle = Art.color('textDim');
      ctx.fillText(small('everything gets a bit faster now'), cx, cy + 72);
      break;
    }

    case 'gameOver': {
      ctx.fillStyle = '#fff';
      ctx.fillText(big('GAME OVER'), cx, cy - GRID * 1.1);

      ctx.fillStyle = Art.color('text');
      ctx.fillText(mid('SCORE  ' + game.score), cx, cy - GRID * 0.2);
      ctx.fillText(mid('BEST   ' + game.highScore), cx, cy + GRID * 0.3);

      ctx.fillStyle = Art.color('textDim');
      ctx.fillText(small(game.deathReason), cx, cy + GRID * 1.1);

      if (Math.floor(game.time * 1.6) % 2 === 0) {
        ctx.fillStyle = '#fff';
        ctx.fillText(mid('PRESS SPACE OR TAP'), cx, cy + GRID * 2);
      }
      break;
    }
  }
}


/* ==========================================================================
   The loop
   ========================================================================== */

let last = 0;

function loop(now) {
  requestAnimationFrame(loop);

  if (!last) last = now;
  /* Cap the step so switching tabs does not teleport every car across the
     screen the moment you come back. */
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;

  if (!game.paused) update(dt);
  else game.time += dt;   /* keep blinking prompts alive while paused */

  draw();
}

sizeCanvas();
window.addEventListener('resize', sizeCanvas);
requestAnimationFrame(loop);

/* Handy for poking at the game from the browser console. */
window.frogger = { game, lanes, CONFIG, startGame };

})();
