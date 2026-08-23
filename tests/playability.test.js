/* ==========================================================================
   FROGGER  ::  tests/playability.test.js
   --------------------------------------------------------------------------
   The most useful test in the project.

   It plays the game. A small bot reads the board exactly as a player would
   (where the cars are, which turtles are sinking, which lilypads are free)
   and sends real arrow key presses. Then it reports how far it got.

   The point is that "is this game fair?" is not something you can answer by
   reading the code. If a bot that plays sensibly cannot get across, the game
   is broken no matter how nice the code looks. It caught a real one: a whole
   row of turtles diving at once, which left nothing to stand on.

   Run it with:  deno task test:play
   ========================================================================== */

import { load } from "./harness.js";

const { api, frames, key, holdKey } = await load();
const { game, lanes, CONFIG, PROGRESSION, GRID, COLS, WIDTH, NLANES } = api;

/* The bot plays the ordinary crossing levels. The special ones (monster truck,
   rocket, helicopter) are not a crossing at all and are covered by the
   mechanics suite instead, so the bot sits them out. */
const CROSS_LEVELS = api.LEVELS
  .map((l, i) => (l.kind === "cross" ? i + 1 : 0))
  .filter(Boolean);

const SPECIAL_STATES = ["bonusIntro", "bonus", "bonusResults",
                        "heliIntro", "heli", "heliResults",
                        "rocketIntro", "rocket", "rocketResults",
                        "boatIntro", "boat", "boatResults"];

const DT = 1 / 60;

/* ==========================================================================
   Reading the board, the way a player would
   ========================================================================== */

/* How far something in this lane travels in `n` frames. */
function travel(lane, n) {
  return lane.speed * n * api.speedMultiplier();
}

/* Where a diving group is in its cycle, now or a moment from now. */
function divePhaseAt(lane, ob, ahead = 0) {
  if (!ob.dives || !CONFIG.rules.divingTurtles) return "up";
  const t = CONFIG.timing;
  const cycle = t.diveUp + t.diveTuck + t.diveUnder;
  const at = (game.time + ahead + lane.divePhase) % cycle;
  if (at < t.diveUp) return "up";
  if (at < t.diveUp + t.diveTuck) return "tuck";
  return "under";
}

/* How far a snake covers in one lunge. Used to work out how much of the
   median a coiling snake has effectively claimed. */
function strikeReach(ob) {
  const patrol = ob.patrolSpeed === undefined ? Math.abs(ob.vx) : ob.patrolSpeed;
  return patrol * api.SNAKE.strikeSpeed * api.SNAKE.strikeTime * 60 *
         api.speedMultiplier();
}

/* Would standing at x in this road lane be safe for the next `n` frames? */
function roadSafeFor(lane, x, n) {
  /* A lane the level has switched off still has obstacles sitting in it, they
     just do not move and cannot hurt you. Treating it as dangerous would make
     the bot refuse to cross an empty road. */
  if (!lane.active) return true;
  const frogL = x + 7, frogR = x + GRID - 7;
  for (const ob of lane.obstacles) {
    /* Snakes stopped being constant-speed traffic. One that is coiled or
       already lunging will cover a lunge's worth of median in a moment, so
       treat that whole stretch as taken. Projecting it like a car puts the
       bot in the one place it should not be, which is how it went from five
       frogs home on Deep Freeze to none. */
    if (ob.mood === "coil" || ob.mood === "strike") {
      const reach = strikeReach(ob);
      if (frogL < ob.x + ob.cells * GRID + reach && frogR > ob.x - reach) return false;
      continue;
    }

    const scale = ob.speedScale === undefined ? 1 : ob.speedScale;
    for (let f = 0; f <= n; f += 2) {
      const ox = ob.x + travel(lane, f) * scale * (ob.vx / lane.speed || 1);
      if (frogL < ox + ob.cells * GRID - 7 && frogR > ox + 7) return false;
    }
  }
  return true;
}

/* Something dry and safe under this point, now and for a moment after? */
function riverLanding(lane, centre, holdFrames = 24) {
  for (const ob of lane.obstacles) {
    if (centre < ob.x || centre > ob.x + ob.cells * GRID) continue;

    /* Never step onto one that has already started to sink, and never onto
       one that will go under while we are still standing on it. */
    if (divePhaseAt(lane, ob) !== "up") return null;
    if (divePhaseAt(lane, ob, holdFrames * DT) === "under") return null;

    /* The jaws open and shut now, so the head is only fatal some of the time.
       The bot still avoids it outright. That is a legitimate way to play the
       row and it keeps this a test of whether the level can be crossed, not
       of how well the bot reads a rhythm. */
    if (ob.variant === "gator") {
      const cell = Math.floor((centre - ob.x) / GRID);
      const head = ob.vx > 0 ? ob.cells - 1 : 0;
      if (cell === head) return null;
    }
    return ob;
  }
  return null;
}

function bayIndexAt(x) {
  return CONFIG.homeCols.findIndex((c) => Math.abs(x - c * GRID) < GRID * 0.5);
}

function bayIsGood(i) {
  if (i < 0 || game.bays[i]) return false;
  const hz = game.bayHazard;
  if (hz && hz.bay === i && hz.kind === "croc") {
    /* Safe only while it is still surfacing. */
    return game.time - hz.bornAt < CONFIG.timing.bayCrocSurfacing * 0.6;
  }
  return true;
}

/* --------------------------------------------------------------------------
   Which lilypad to aim for, and why it matters.

   The log gaps on the river are wider than a single hop, and the top log row
   only travels one way. So once you are up there you can drift downstream but
   never back up it: a lilypad behind you is gone for good.

   That means the order you fill them in decides whether the last one is easy
   or impossible. Fill from the UPSTREAM end and the survivor is always the
   one the current carries you into. This is the whole reason the arcade
   strategy guides say "go left to right".
   -------------------------------------------------------------------------- */
const topRiver = lanes.find((l) => l.type === "river");
const fillFromLeft = topRiver.speed > 0;

function targetBay() {
  const free = [];
  for (let b = 0; b < CONFIG.homeCols.length; b++) if (!game.bays[b]) free.push(b);
  if (!free.length) return null;
  return fillFromLeft ? free[0] : free[free.length - 1];
}

function targetBayX() {
  const b = targetBay();
  return b === null ? null : CONFIG.homeCols[b] * GRID;
}


/* ==========================================================================
   The bot
   --------------------------------------------------------------------------
   One rule above all others: never hop anywhere without checking that the
   destination is somewhere you can survive. Every candidate move goes through
   survivable() first. An earlier version of this bot hopped blindly when it
   was drifting towards the screen edge, which made the game look unfair when
   in fact the bot was just throwing itself in the river.
   ========================================================================== */

const MAX_X = (COLS - 1) * GRID;

/* Could the frog be at (row, x) and live? `hold` is how many frames it needs
   to stay alive there. */
function survivable(row, x, hold) {
  const lane = lanes[row];
  if (!lane) return false;
  if (x < 0 || x > MAX_X) return false;

  switch (lane.type) {
    case "home":  return bayIsGood(bayIndexAt(x));
    case "river": return !!riverLanding(lane, x + GRID / 2, hold);
    case "road":  return roadSafeFor(lane, x, hold);
    default:      return true;                 /* median, start */
  }
}

/* On an ice level the frog is going to be shoved forward whether it likes it
   or not, so "should I go up?" is the wrong question. The only question is
   whether the square it is about to be shoved into is safe, and if not, which
   way to step to fix that. Without this the bot cannot play an ice level at
   all, and cannot tell a hard one from an impossible one. */
function decideOnIce() {
  const frog = game.frog;
  const row = frog.row;
  const col = Math.round(frog.x / GRID);
  const target = row - 1;

  /* Roughly how long until the ice moves us, in frames. */
  const untilShove = Math.max(0, (frog.iceNext || 0) - game.time) * 60;
  const hold = Math.max(6, Math.round(untilShove) + 10);

  if (survivable(target, frog.x, hold)) return [0, 0];   /* lined up already */

  for (const dx of [-1, 1, -2, 2]) {
    const nx = (col + dx) * GRID;
    if (nx < 0 || nx > MAX_X) continue;
    /* The step across has to be survivable too, not just the destination. */
    if (survivable(row, nx, 6) && survivable(target, nx, hold)) {
      return [Math.sign(dx), 0];
    }
  }

  /* Nothing above works. Take any sideways move that at least keeps us alive. */
  for (const dx of [-1, 1]) {
    const nx = (col + dx) * GRID;
    if (nx >= 0 && nx <= MAX_X && survivable(row, nx, 10)) return [dx, 0];
  }
  return [0, 0];
}

/* On an airless level the tank is the real clock, and a pocket drifting past
   is worth a detour once it is getting low. Without this the bot plays the
   level as if the mechanic were not there, which makes it useless for judging
   whether the drain rate is fair. */
function airPull(mv) {
  if (!api.airless() || !game.air.length) return 0;

  const urgency = 1 - game.timeLeft / api.timeCapacity();
  if (urgency < 0.4) return 0;               /* plenty in the tank, press on */

  let pull = 0;
  for (const a of game.air) {
    if (a.row !== mv.row) continue;
    const gap = Math.abs((a.x + GRID / 2) - (mv.x + GRID / 2));
    if (gap > GRID * 4) continue;
    pull = Math.max(pull, (GRID * 4 - gap) * urgency * 1.6);
  }
  return pull;
}

function decide() {
  const frog = game.frog;
  const row = frog.row;
  const col = Math.round(frog.x / GRID);
  const rushing = game.timeLeft < 8;

  /* Ice takes the forward decision away, so it needs its own policy. */
  if (api.twist("ice") && !api.onSolidGround()) return decideOnIce();

  /* How long we insist a square stays safe. When the clock is nearly out,
     take more risk, exactly like a real player. */
  const hold = rushing ? 8 : 18;

  /* ---------------------------------------------------------------------
     The endgame, on the row just below the lilypads.

     This row flows one way and its gaps are wider than a hop, so if the pad
     we want ends up behind us it is gone. But the row BELOW flows the other
     way. So the move is to drop back down, let that row carry us back
     upstream, and come at the pad again. Getting this right is the whole
     difference between clearing a level and drowning five times over.
     --------------------------------------------------------------------- */
  const tx = targetBayX();
  if (row === 1 && tx !== null) {
    if (bayIsGood(bayIndexAt(frog.x))) return [0, -1];

    /* Edge along this row towards the pad if there is footing that way. */
    const dx = frog.x < tx ? 1 : -1;
    if (survivable(1, (col + dx) * GRID, hold)) return [dx, 0];

    /* No footing that way. Are we being carried further from the pad? */
    const driftingAway = (topRiver.speed > 0) === (frog.x > tx);
    if (driftingAway && survivable(2, frog.x, hold)) return [0, 1];

    if (survivable(1, frog.x, 6)) return [0, 0];
  }

  const moves = [
    { m: [0, -1], row: row - 1, x: frog.x,            gain: 3 },
    { m: [-1, 0], row: row,     x: (col - 1) * GRID,  gain: 0 },
    { m: [1, 0],  row: row,     x: (col + 1) * GRID,  gain: 0 },
    { m: [0, 1],  row: row + 1, x: frog.x,            gain: -4 },
    { m: [0, 0],  row: row,     x: frog.x,            gain: 1 },
  ];

  /* Staying put is only an option if here is still safe for a moment. */
  const stayOk = survivable(row, frog.x, 6);

  let best = null;
  for (const mv of moves) {
    if (mv.m[0] === 0 && mv.m[1] === 0 && !stayOk) continue;
    if (!survivable(mv.row, mv.x, hold)) continue;

    let score = mv.gain * 100;

    /* Line up with the lilypad we are aiming for, and start doing it early:
       from the median onwards, so we enter the river already in the right
       part of the screen rather than fighting the current later. */
    if (tx !== null && mv.row <= 6) {
      /* Aim slightly upstream of the pad, because the current will carry us
         the rest of the way while we climb. */
      const lead = mv.row * GRID * (fillFromLeft ? -0.35 : 0.35);
      score -= Math.abs(tx + lead - mv.x) * 0.5;
    }

    score += airPull(mv);

    if (!best || score > best.score) best = { ...mv, score };
  }

  /* Nothing at all is safe. Pick the least bad thing rather than freezing. */
  if (!best) {
    for (const mv of moves) {
      if (survivable(mv.row, mv.x, 1)) return mv.m;
    }
    return [0, 0];
  }

  return best.m;
}

const KEY_FOR = {
  "-1,0": "ArrowLeft", "1,0": "ArrowRight",
  "0,-1": "ArrowUp",   "0,1": "ArrowDown",
};

/* Play for a while and report what happened. */
/* Air pressure, reported for the airless levels so the tank size can be judged
   against a player rather than guessed at. */
const REPORT = { lowTank: Infinity, grabbed: 0 };

/* `hold` pins the run to one level, restarting it rather than letting the bot
   walk on into the next. Without it a sample of "the hardest level" is really
   a sample of that level plus everything after it, which stopped being true
   the moment the last level became a boss run the bot sits out. */
function play(maxFrames, hold) {
  const stats = { homes: 0, deaths: 0, levels: 0, byReason: {}, byRow: {} };
  REPORT.lowTank = Infinity;
  REPORT.grabbed = 0;
  let airWas = game.air.length;

  let prevHomes = game.bays.filter(Boolean).length;
  let prevLevel = game.level;
  let cooldown = 0;
  let wasDying = false;

  for (let f = 0; f < maxFrames; f++) {
    if (game.state === "title" || game.state === "gameOver") {
      key(" ");
      frames(1);
      prevHomes = 0;
      continue;
    }

    if (api.airless() && game.state === "play") {
      REPORT.lowTank = Math.min(REPORT.lowTank, game.timeLeft);
      if (game.air.length < airWas) REPORT.grabbed++;
    }
    airWas = game.air.length;

    /* Sit out anything that is not a crossing. */
    if (SPECIAL_STATES.includes(game.state)) {
      if (game.state === "bonus") api.bonus.timeLeft = 0.02;
      if (game.state === "heli") api.heli.timeLeft = 0.02;
      if (game.state === "rocket") api.rocket.attemptsLeft = 0;
      /* The boss run is not a crossing, so skip it the same way. Losing it
         costs a frog, so hand it the win rather than quietly draining lives
         out of the run this suite is trying to measure. */
      if (game.state === "boat") { api.boat.won = true; api.finishBoat(); }
      game.stateTime = 99;
      frames(1);
      continue;
    }

    if (game.state === "play" && cooldown <= 0) {
      const [dx, dy] = decide();
      if (dx || dy) {
        key(KEY_FOR[`${dx},${dy}`]);
        cooldown = 3;            /* no human hops 60 times a second */
      }
    }
    cooldown--;

    /* A hop can kill instantly, inside the key press, so read the row the
       frog is actually standing on rather than the one it came from. */
    const rowNow = game.frog ? game.frog.row : null;
    const dyingAfterHop = game.state === "dying";

    frames(1);

    /* Count a death once, on the frame it happens. */
    const dying = game.state === "dying";
    if (dying && !wasDying) {
      stats.deaths++;
      stats.byReason[game.deathReason] = (stats.byReason[game.deathReason] || 0) + 1;
      if (rowNow !== null) stats.byRow[rowNow] = (stats.byRow[rowNow] || 0) + 1;
    }
    wasDying = dying;

    if (hold && game.level !== hold && game.state !== "dying") {
      stats.levels++;
      api.startGame(hold);
      frames(1);
      prevHomes = 0;
      prevLevel = game.level;
      continue;
    }

    const homes = game.bays.filter(Boolean).length;
    if (game.level > prevLevel) { stats.levels++; prevHomes = 0; }
    else if (homes > prevHomes) stats.homes += homes - prevHomes;
    if (game.level === prevLevel) prevHomes = homes;
    prevLevel = game.level;

    /* Top the lives up so one bad patch does not end the run early. */
    if (game.lives < 20) game.lives = 20;
  }

  return stats;
}


/* ==========================================================================
   The assertions
   ========================================================================== */

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${extra}`); }
}

/* --------------------------------------------------------------------------
   1. The invariant that was broken: every river row must always have
      somewhere dry to stand, on screen, at every moment.
   -------------------------------------------------------------------------- */
console.log("\n== every river row is always crossable ==");

/* Check it on the tightest river the plan ever asks for. */
const tightest = CROSS_LEVELS.filter(n => api.LEVELS[n - 1].river === "tight");
api.startGame(tightest.length ? tightest[tightest.length - 1] : CROSS_LEVELS[CROSS_LEVELS.length - 1]);
frames(1);
game.frog.row = 6;
game.timeLeft = 1e9;

const riverRows = lanes.filter((l) => l.type === "river");
const worst = riverRows.map(() => Infinity);

for (let f = 0; f < 4000; f++) {
  frames(1);
  riverRows.forEach((lane, i) => {
    let dryCells = 0;
    for (const ob of lane.obstacles) {
      if (divePhaseAt(lane, ob) === "under") continue;
      const from = Math.max(0, ob.x);
      const to = Math.min(WIDTH, ob.x + ob.cells * GRID);
      if (to > from) dryCells += (to - from) / GRID;
    }
    if (dryCells < worst[i]) worst[i] = dryCells;
  });
}

riverRows.forEach((lane, i) => {
  check(`row ${lane.row} (${lane.kind}) never runs out of footing`,
    worst[i] >= 1, `worst case only ${worst[i].toFixed(2)} squares of footing on screen`);
});

/* --------------------------------------------------------------------------
   2. A sensible bot can actually get frogs home.
   -------------------------------------------------------------------------- */
console.log("\n== level one should be a walk in the park ==");
api.startGame(1);
frames(1);
const lvl1 = play(6000);
console.log(`     homes=${lvl1.homes} deaths=${lvl1.deaths} levels=${lvl1.levels}`);
console.log(`     deaths by reason: ${JSON.stringify(lvl1.byReason)}`);

/* One frog clears a level, so a clean run shows up as "a home and a level"
   over and over rather than a big pile of frogs. */
check("the bot gets frogs home", lvl1.homes >= 2, `only ${lvl1.homes}`);
check("and clears levels back to back", lvl1.levels >= 2, `${lvl1.levels}`);
check("without dying, because level one is meant to be free",
  lvl1.deaths <= 1, `${lvl1.deaths} deaths`);
check("no single row is a death trap",
  Object.values(lvl1.byRow).every((n) => n <= Math.max(3, lvl1.deaths * 0.7)),
  JSON.stringify(lvl1.byRow));

console.log("\n== the difficulty curve actually curves ==");
const runs = [];
for (const n of [CROSS_LEVELS[0], CROSS_LEVELS[Math.floor(CROSS_LEVELS.length / 2)],
                 CROSS_LEVELS[CROSS_LEVELS.length - 1]]) {
  api.startGame(n);
  frames(1);
  const r = play(5000, n);
  runs.push({ n, name: api.levelName(n), ...r });
  console.log(`     level ${n} ${api.levelName(n)}: homes=${r.homes} deaths=${r.deaths} ` +
              `reasons=${JSON.stringify(r.byReason)}`);
}
check("the early level is kinder than the late one",
  runs[0].deaths <= runs[runs.length - 1].deaths,
  `${runs[0].deaths} vs ${runs[runs.length - 1].deaths}`);
check("even the hardest level is still winnable",
  runs[runs.length - 1].homes >= 2, `only ${runs[runs.length - 1].homes}`);

/* --------------------------------------------------------------------------
   Every crossing level has to be finishable. This is the sweep that would
   catch a level plan entry that reads fine but is quietly impossible.
   -------------------------------------------------------------------------- */
console.log("\n== every crossing level is crossable ==");
for (const level of CROSS_LEVELS) {
  api.startGame(level);
  frames(1);
  const r = play(4500);
  /* Only the rules that are switched ON. A level can turn one off, and
     printing that as if it were active reads as the opposite of the truth. */
  const rules = api.LEVELS[level - 1].rules || {};
  if (rules.airless) {
    console.log(`      air: lowest tank ${REPORT.lowTank.toFixed(1)}s of ${api.AIR.tank}, pockets taken ${REPORT.grabbed}`);
  }
  /* Only the switches, not the tuning values. `iceStep: 0.25` is a number, not
     a twist, and printing it as one reads like a mechanic that does not exist. */
  const twists = Object.keys(rules).filter((k) => rules[k] === true).join("+") || "-";
  console.log(`     ${String(level).padStart(2)} ${api.levelName(level).padEnd(17)}` +
              `[${twists.padEnd(5)}] homes=${r.homes} deaths=${r.deaths}`);
  check(`level ${level} (${api.levelName(level)}) is crossable`, r.homes >= 1,
    `no frogs home. deaths: ${JSON.stringify(r.byReason)}`);
}

console.log(`\n${pass} passed, ${fail} failed\n`);

if (fail) Deno.exit(1);
