import { load } from "./harness.js";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const { api, tick, frames, key } = await load();
const { game, lanes, CONFIG } = api;
const GRID = CONFIG.grid;

// Lanes are built once at load, so tests that shove obstacles around must put
// them back or they poison every later test.
const LANE_SNAPSHOT = lanes.map(l => l.obstacles.map(o => ({ x: o.x, index: o.index })));
function resetLanes() {
  lanes.forEach((l, i) => l.obstacles.forEach((o, j) => {
    o.x = LANE_SNAPSHOT[i][j].x;
    o.index = LANE_SNAPSHOT[i][j].index;
  }));
}
function reset() { resetLanes(); api.startGame(); frames(1); }

console.log("\n== boot ==");
frames(1);
check("starts on title screen", game.state === "title", game.state);
check("lanes built", lanes.length === 13, lanes.length);
check("river lanes have obstacles",
  lanes.filter(l => l.type === "river").every(l => l.obstacles.length > 0));
check("road lanes have obstacles",
  lanes.filter(l => l.type === "road").every(l => l.obstacles.length > 0));
check("safe lanes are empty",
  lanes.filter(l => ["safe", "home", "start"].includes(l.type)).every(l => l.obstacles.length === 0));

console.log("\n== start ==");
key(" ");
frames(1);
check("space starts the game", game.state === "play", game.state);
check("frog at bottom centre", game.frog.row === 12 && game.frog.x === 6 * GRID,
  `${game.frog.row},${game.frog.x}`);
check("lives from config", game.lives === CONFIG.lives, game.lives);
check("timer full", Math.abs(game.timeLeft - CONFIG.timeLimit) < 0.1, game.timeLeft);

console.log("\n== hop scoring ==");
const s0 = game.score;
key("ArrowUp");   // 12 -> 11 (road, may die)
check("forward hop scored 10", game.score === s0 + CONFIG.score.forwardHop, game.score);

console.log("\n== road kills ==");
// Reset, then force a collision: put a car exactly on the frog.
reset();
const roadLane = lanes.find(l => l.type === "road");
game.frog.row = roadLane.row;
roadLane.obstacles[0].x = game.frog.x;
frames(1);
check("car squashes frog", game.state === "dying", game.state);
check("death reason recorded", game.deathReason === "Squashed", game.deathReason);
frames(60);   // ~1s, the dying timer is 0.85s
check("respawned after death", game.state === "play", game.state);
check("lost a life", game.lives === CONFIG.lives - 1, game.lives);
check("back at the start row", game.frog.row === 12, game.frog.row);

console.log("\n== river drowns ==");
reset();
const riverLane = lanes.find(l => l.type === "river");
game.frog.row = riverLane.row;
// Move every log far away so nothing is underneath.
riverLane.obstacles.forEach((o, i) => { o.x = -10000 - i * 500; });
frames(1);
check("drowns with no platform", game.state === "dying", game.state);
check("drown reason", game.deathReason === "Drowned", game.deathReason);

console.log("\n== river ride ==");
reset();
game.frog.row = riverLane.row;
riverLane.obstacles[0].x = game.frog.x - GRID;   // frog centre sits on this log
const before = game.frog.x;
frames(30);
check("still alive while riding", game.state === "play", game.state + " " + game.deathReason);
check("carried by the log", Math.abs(game.frog.x - before) > 1,
  `moved ${(game.frog.x - before).toFixed(1)}px`);
check("carried in the log's direction",
  Math.sign(game.frog.x - before) === Math.sign(riverLane.speed));

console.log("\n== washed off the edge ==");
reset();
game.frog.row = riverLane.row;
game.frog.x = 0;
riverLane.obstacles.forEach(o => { o.x = -10000; });
riverLane.obstacles[0].x = -GRID / 2;   // log hanging off the left edge, frog on it
frames(1);
check("alive on an edge log", game.state === "play", game.state + " " + game.deathReason);

console.log("\n== home bays ==");
reset();
const scoreBefore = game.score;
game.frog.row = 0;
game.frog.x = CONFIG.homeCols[0] * GRID;
frames(1);
check("bay 0 filled", game.bays[0] === true, JSON.stringify(game.bays));
check("scored for reaching home", game.score > scoreBefore, game.score);
check("time bonus applied",
  game.score - scoreBefore > CONFIG.score.reachHome, game.score - scoreBefore);
check("respawned at start", game.frog.row === 12, game.frog.row);
check("still alive", game.state === "play", game.state);

console.log("\n== level clear ==");
for (let i = 1; i < CONFIG.homeCols.length; i++) {
  game.frog.row = 0;
  game.frog.x = CONFIG.homeCols[i] * GRID;
  frames(1);
}
check("all bays filled", game.bays.every(Boolean), JSON.stringify(game.bays));
check("level clear state", game.state === "levelClear", game.state);
frames(130);   // levelClear waits 1.8s
check("advanced to level 2", game.level === 2, game.level);
check("bays reset", game.bays.every(b => !b), JSON.stringify(game.bays));
check("playing again", game.state === "play", game.state);

console.log("\n== timer ==");
reset();
game.frog.row = 6;   // the safe median, nothing can kill us
frames(60, 100);     // 60 frames; dt is capped at 1/20s so that is 3s of game time
check("timer counts down about 3s (dt is capped)",
  Math.abs((CONFIG.timeLimit - game.timeLeft) - 3) < 0.25, game.timeLeft.toFixed(2));
game.timeLeft = 0.01;
frames(2, 100);
check("running out of time kills", game.state === "dying", game.state);
check("timeout reason", game.deathReason === "Out of time", game.deathReason);

console.log("\n== game over ==");
reset();
game.lives = 1;
game.frog.row = 6;
game.timeLeft = 0.01;
frames(2, 100);
frames(80);
check("game over when out of lives", game.state === "gameOver", game.state);
check("high score persisted", game.highScore > 0, game.highScore);
key(" ");
frames(1);
check("space restarts from game over", game.state === "play", game.state);

console.log("\n== wrap-around integrity ==");
// Run a long while, then confirm every lane still has obstacles spread over
// the visible board with no huge hole and no pile-up.
reset();
game.frog.row = 6;
game.timeLeft = 1e9;
frames(3000);
for (const lane of lanes) {
  if (!lane.obstacles.length) continue;
  const onScreen = lane.obstacles.filter(o => o.x + lane.width > 0 && o.x < CONFIG.cols * GRID);
  check(`lane ${lane.row} (${lane.kind}) still populated after 3000 frames`,
    onScreen.length > 0, `${onScreen.length} on screen`);
  // No two obstacles should overlap each other.
  const sorted = [...lane.obstacles].sort((a, b) => a.x - b.x);
  let overlap = false;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].x < sorted[i - 1].x + lane.width - 0.5) overlap = true;
  }
  check(`lane ${lane.row} (${lane.kind}) no overlapping obstacles`, !overlap);
}

console.log("\n== diving turtles ==");
const diver = lanes.find(l => l.diving);
check("a diving lane exists", !!diver);
if (diver) {
  api.startGame();
  frames(1);
  game.frog.row = diver.row;
  game.timeLeft = 1e9;
  diver.obstacles.forEach(o => { o.x = game.frog.x - GRID / 2; });  // always underneath
  let died = false;
  const cycle = CONFIG.difficulty.diveUp + CONFIG.difficulty.diveBlink + CONFIG.difficulty.diveDown;
  for (let i = 0; i < cycle * 70; i++) {
    frames(1);
    if (game.state === "dying") { died = true; break; }
    diver.obstacles.forEach(o => { o.x = game.frog.x - GRID / 2; });
  }
  check("turtles eventually dive and drown the frog", died, game.state);
  check("dive death reason", game.deathReason === "The turtles dived", game.deathReason);
}

console.log("\n== theme fallback ==");
CONFIG.theme = "does-not-exist";
frames(2);
check("bad theme name does not crash", true);
CONFIG.theme = "retro";
frames(2);
check("retro theme renders", true);
CONFIG.theme = "emoji";
frames(2);

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) Deno.exit(1);
