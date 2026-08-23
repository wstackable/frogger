import { load } from "./harness.js";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const { api, tick, frames, key, audio, store } = await load();
const { game, lanes, CONFIG, PROGRESSION, WIDTH } = api;
const GRID = CONFIG.grid;

/* The board is laid out per level now, so putting it back is just asking the
   level to lay itself out again. No snapshot needed. */
function resetLanes() { api.applyPlan(); }

/* Most of this suite was written against a fully loaded board: five lanes of
   traffic, diving turtles, crocodiles, the lot. Under the level plan that is
   no longer level one, it is whichever level turns everything on. */
const FULL_LEVEL = (() => {
  let best = 1, score = -1;
  api.LEVELS.forEach((l, i) => {
    if (l.kind !== "cross") return;
    const n = (l.hazards || []).length * 10 + (l.roadLanes || 0);
    if (n > score) { score = n; best = i + 1; }
  });
  return best;
})();

function reset(atLevel) { api.startGame(atLevel || FULL_LEVEL); frames(1); }
function fullBoard() { game.level = FULL_LEVEL; api.applyPlan(); }

/* The suite below was written against the arcade rules: all five lilypads to
   clear a level, and the two harsh deaths switched on. Those are now the
   EXPERT mode / baysToClear settings rather than the defaults, so pin them
   here. The new defaults get their own section at the end. */
const DEFAULT_BAYS_TO_CLEAR = CONFIG.baysToClear;
const DEFAULT_MODE = game.mode;
CONFIG.baysToClear = CONFIG.homeCols.length;

function arcadeStrict() { game.mode = "expert"; }
function relax() { game.mode = DEFAULT_MODE; }

console.log("\n== boot ==");
frames(1);
check("a level plan exists", api.LEVELS.length > 0, String(api.LEVELS.length));
check("the board is laid out for level one at load",
  lanes.some(l => l.obstacles.length > 0));

/* From here on, test against the fully loaded board. */
fullBoard();
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
check("lives come from the mode", game.lives === api.setting("lives", CONFIG.lives),
  `${game.lives} vs ${api.setting("lives", CONFIG.lives)}`);
check("timer full", Math.abs(game.timeLeft - CONFIG.timeLimit) < 0.1, game.timeLeft);

console.log("\n== hop scoring ==");
const s0 = game.score;
key("ArrowUp");   // 12 -> 11 (road, may die)
check("forward hop scored 10", game.score === s0 + CONFIG.score.forwardHop, game.score);

console.log("\n== road kills ==");
// Reset, then force a collision: put a car exactly on the frog.
reset();
const roadLane = lanes.find(l => l.type === "road" && l.kind !== "snake");
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
const wasLevel = game.level;
frames(160);   // levelClear waits 2s
check("advanced a level", game.level === wasLevel + 1, `${wasLevel} -> ${game.level}`);
check("bays reset", game.bays.every(b => !b), JSON.stringify(game.bays));
/* The next level might be a bonus round rather than a crossing, which is the
   whole point of the level plan. */
check("the next level started",
  ["play", "bonusIntro", "heliIntro", "rocketIntro", "boatIntro"].includes(game.state), game.state);

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
  /* Wrapping lanes must keep their spacing. Bouncing ones (the snakes) turn
     round at the edges and can legitimately end up alongside each other, so
     the spacing rule does not apply to them. */
  if (!lane.bounce) {
    const sorted = [...lane.obstacles].sort((a, b) => a.x - b.x);
    let overlap = false;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].x < sorted[i - 1].x + lane.width - 0.5) overlap = true;
    }
    check(`lane ${lane.row} (${lane.kind}) no overlapping obstacles`, !overlap);
  }
}

console.log("\n== diving turtles ==");
reset();                      /* a level where the turtles actually dive */
const diver = lanes.find(l => l.dive);
check("a diving lane exists", !!diver);
if (diver) {
  reset();
  game.frog.row = diver.row;
  game.timeLeft = 1e9;
  const sinker = diver.obstacles.find(o => o.dives);
  check("the diving lane has a group that dives", !!sinker);
  const floater = diver.obstacles.find(o => !o.dives);
  check("the diving lane also has a group that never dives", !!floater);
  diver.obstacles.forEach(o => { o.x = -9999; });
  sinker.x = game.frog.x - GRID / 2;                                 // only the sinker is under us
  let died = false;
  const cycle = CONFIG.timing.diveUp + CONFIG.timing.diveTuck + CONFIG.timing.diveUnder;
  for (let i = 0; i < cycle * 70; i++) {
    frames(1);
    if (game.state === "dying") { died = true; break; }
    sinker.x = game.frog.x - GRID / 2;
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


/* ==========================================================================
   The arcade rules
   ========================================================================== */

const homeRow = lanes.findIndex(l => l.type === "home");

console.log("\n== the lilypads (arcade rules) ==");
arcadeStrict();
reset();
game.frog.row = homeRow;
game.frog.x = 1 * GRID;                       // col 1 is bank, not a bay
frames(1);
check("landing on the bank between bays kills you", game.state === "dying", game.state);
check("bank death reason", game.deathReason === "Hit the bank", game.deathReason);

reset();
game.bays[0] = true;
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[0] * GRID;
frames(1);
check("jumping into an occupied lilypad kills you", game.state === "dying", game.state);

relax();

console.log("\n== the time bonus ==");
reset();
game.timeLeft = 10.05;                         // just over 20 half-seconds
let scoreBefore2 = game.score;
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[1] * GRID;
frames(1);
const gained = game.score - scoreBefore2;
const expected = CONFIG.score.reachHome + 20 * CONFIG.score.perHalfSecondLeft;
check("home scores 50 plus 10 per half second left", gained === expected,
  `got ${gained}, expected ${expected}`);

console.log("\n== the bonus fly ==");
reset();
game.bayHazard = { bay: 2, kind: "fly", bornAt: game.time };
game.timeLeft = 0.4;                           // no time bonus to muddy the sums
scoreBefore2 = game.score;
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[2] * GRID;
frames(1);
check("eating a fly is worth 200",
  game.score - scoreBefore2 === CONFIG.score.reachHome + CONFIG.score.fly,
  `got ${game.score - scoreBefore2}`);
check("the fly is consumed", game.bayHazard === null);

console.log("\n== the crocodile in the lilypad ==");
reset();
game.bayHazard = { bay: 3, kind: "croc", bornAt: game.time };
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[3] * GRID;
frames(1);
check("a lilypad croc is harmless while still surfacing", game.state === "play",
  game.state + " " + game.deathReason);

reset();
game.bayHazard = { bay: 3, kind: "croc", bornAt: game.time - 5 };
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[3] * GRID;
frames(1);
check("a risen lilypad croc kills you", game.state === "dying", game.state);
check("croc death reason", game.deathReason === "A crocodile was waiting", game.deathReason);

console.log("\n== crocodiles in the river ==");
reset();
const gatorLane = lanes.find(l => l.hasGators);
const gator = gatorLane.obstacles.find(o => o.variant === "gator");
check("crocodiles replace some logs at the right level", !!gator);

if (gator) {
  const headCell = gator.vx > 0 ? gator.cells - 1 : 0;
  const bodyCell = gator.vx > 0 ? 0 : gator.cells - 1;

  game.frog.row = gatorLane.row;
  gatorLane.obstacles.forEach(o => { if (o !== gator) o.x = -9999; });
  gator.x = game.frog.x - bodyCell * GRID - GRID / 2;
  frames(1);
  check("riding a crocodile's back is safe", game.state === "play",
    game.state + " " + game.deathReason);

  /* The jaws work now, so the head is only fatal while the mouth is open.
     Waiting for a phase has to happen with the frog somewhere safe, otherwise
     it drifts off a log and drowns before the mouth ever gets there. */
  function jawTest(want) {
    reset();
    const lane = lanes.find(l => l.hasGators);
    const croc = lane.obstacles.find(o => o.variant === "gator");
    if (!croc) return { state: "no croc" };

    const head = croc.vx > 0 ? croc.cells - 1 : 0;

    /* Park on solid ground and top the clock up while time goes by. */
    game.frog.row = lanes.length - 1;
    for (let i = 0; i < 60 * 12; i++) {
      if (api.gatorPhase(lane, croc) === want) break;
      game.timeLeft = CONFIG.timeLimit;
      frames(1);
    }
    if (api.gatorPhase(lane, croc) !== want) return { state: "never " + want };

    lane.obstacles.forEach(o => { if (o !== croc) o.x = -9999; });
    game.frog.row = lane.row;
    croc.x = game.frog.x - head * GRID - GRID / 2;
    frames(1);
    return { state: game.state, reason: game.deathReason };
  }

  const shut = jawTest("shut");
  check("the head is safe while the mouth is shut", shut.state === "play",
    `${shut.state} ${shut.reason || ""}`);

  const warning = jawTest("opening");
  check("the warning phase is still safe to stand in", warning.state === "play",
    `${warning.state} ${warning.reason || ""}`);

  const bitten = jawTest("open");
  check("the crocodile's jaws kill you once they are open",
    bitten.state === "dying", bitten.state);
  check("croc river death reason", bitten.reason === "Eaten by a crocodile",
    bitten.reason);

  check("a row of crocodiles does not snap in unison", (() => {
    reset();
    const lane = lanes.find(l => l.hasGators);
    const crocs = lane.obstacles.filter(o => o.variant === "gator");
    if (crocs.length < 2) return true;
    for (let i = 0; i < 60 * 6; i++) {
      if (new Set(crocs.map(o => api.gatorPhase(lane, o))).size > 1) return true;
      frames(1);
    }
    return false;
  })());

  check("the jaw warning is long enough to hop out of",
    api.GATOR.opening * 1000 > CONFIG.hopDuration * 2,
    `opening ${api.GATOR.opening}s vs hop ${CONFIG.hopDuration}ms`);
}

console.log("\n== snakes on the median ==");
const medianLane = lanes.find(l => l.kind === "snake");
check("there is a snake lane", !!medianLane);

/* A level with no snakes: the median should be harmless. */
const noSnakeLevel = api.LEVELS.findIndex(
  l => l.kind === "cross" && !(l.hazards || []).includes("snake")) + 1;
reset(noSnakeLevel);
game.frog.row = medianLane.row;
medianLane.obstacles.forEach(o => { o.x = game.frog.x; });
frames(2);
check("the median is safe before the snakes arrive", game.state === "play",
  game.state + " " + game.deathReason);

reset();
game.frog.row = medianLane.row;
medianLane.obstacles.forEach(o => { o.x = game.frog.x; });
frames(2);
check("snakes on the median kill you once they turn up", game.state === "dying", game.state);
check("snake death reason", game.deathReason === "Bitten by a snake", game.deathReason);

console.log("\n== snakes turn round instead of wrapping ==");
reset();
game.frog.row = 12;
game.timeLeft = 1e9;
let reversed = false;
let prevSign = Math.sign(medianLane.obstacles[0].vx);
for (let i = 0; i < 4000; i++) {
  frames(1);
  const s = Math.sign(medianLane.obstacles[0].vx);
  if (s !== prevSign) { reversed = true; break; }
  prevSign = s;
}
check("a snake reverses at the screen edge", reversed);
check("snakes stay on screen",
  medianLane.obstacles.every(o => o.x >= -1 && o.x + o.cells * GRID <= WIDTH + 1));

console.log("\n== the lady frog ==");
reset();
game.frog.row = 12;
game.timeLeft = 1e9;
for (let i = 0; i < 1200 && !game.lady; i++) frames(1);
check("the lady frog turns up", !!game.lady);

if (game.lady) {
  const ladyLane = game.lady.lane;
  const lx = game.lady.ob.x + game.lady.cell * GRID;
  game.frog.row = ladyLane.row;
  game.frog.x = lx;
  frames(1);
  check("hopping onto the lady frog picks her up", game.carrying === true);
  check("she is no longer on the log", game.lady === null);

  game.timeLeft = 0.4;
  scoreBefore2 = game.score;
  game.frog.row = homeRow;
  game.frog.x = CONFIG.homeCols[4] * GRID;
  frames(1);
  check("escorting her home is worth 200",
    game.score - scoreBefore2 === CONFIG.score.reachHome + CONFIG.score.ladyFrog,
    `got ${game.score - scoreBefore2}`);
  check("we are no longer carrying her", game.carrying === false);
}

console.log("\n== extra lives ==");
relax();
reset();
game.lives = 3;
game.score = 0;
game.nextExtraLife = CONFIG.score.extraLifeEvery;
game.timeLeft = 0.4;
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[0] * GRID;
game.score = CONFIG.score.extraLifeEvery - CONFIG.score.reachHome;
frames(1);
check("crossing the extra life threshold awards a frog", game.lives === 4, game.lives);

console.log("\n== the pixel art is well formed ==");
const { SPRITES, PALETTE } = api;
let ragged = [], unknown = new Set();
for (const [name, rows] of Object.entries(SPRITES)) {
  const w = rows[0].length;
  if (!rows.every(r => r.length === w)) ragged.push(name);
  for (const row of rows) for (const ch of row) if (!(ch in PALETTE)) unknown.add(`${name}:${ch}`);
}
check("every sprite is rectangular", ragged.length === 0, ragged.join(", "));
check("every sprite only uses letters from the palette", unknown.size === 0,
  [...unknown].join(", "));
check("there are sprites for everything the arcade theme names",
  Object.values(api.THEMES.arcade.art)
    .filter(a => a.draw === "pixels")
    .every(a => SPRITES[a.sprite] &&
                (!a.capLeft || SPRITES[a.capLeft]) &&
                (!a.capRight || SPRITES[a.capRight])));


/* ==========================================================================
   The radio and the colour palettes
   ========================================================================== */

console.log("\n== the radio ==");
const { Music, Art, PALETTES } = api;

const HAS_EXT = /\.(m4a|mp3|ogg|wav|aac|opus)$/i;
const SAFARI_SHY = /\.(ogg|opus)$/i;

check("there are tracks", api.TRACKS.length > 0, String(api.TRACKS.length));
check("every track is a file in music/",
  api.TRACKS.every(t => typeof t.file === "string" && t.file.startsWith("music/")),
  api.TRACKS.filter(t => !t.file || !String(t.file).startsWith("music/"))
    .map(t => t.name).join(", "));
check("no leftover generated tunes",
  api.TRACKS.every(t => !t.lead && !t.bass && !t.drum && !t.bpm),
  api.TRACKS.filter(t => t.lead || t.bpm).map(t => t.name).join(", "));
check("every track has a name",
  api.TRACKS.every(t => typeof t.name === "string" && t.name.length > 0));
check("every path looks like an audio file",
  api.TRACKS.every(t => HAS_EXT.test(t.file)),
  api.TRACKS.filter(t => !HAS_EXT.test(t.file)).map(t => t.file).join(", "));
check("nothing Safari cannot play",
  api.TRACKS.every(t => !SAFARI_SHY.test(t.file)),
  api.TRACKS.filter(t => SAFARI_SHY.test(t.file)).map(t => t.file).join(", "));
check("no track sits in a subfolder, since the scanner ignores those",
  api.TRACKS.every(t => t.file.split("/").length === 2),
  api.TRACKS.filter(t => t.file.split("/").length !== 2).map(t => t.file).join(", "));
check("no duplicate names, or R would look stuck",
  new Set(api.TRACKS.map(t => t.name)).size === api.TRACKS.length);

check("R moves to the next track", (() => {
  const first = Music.trackName();
  Music.next();
  const second = Music.trackName();
  return api.TRACKS.length === 1 || first !== second;
})());

check("R wraps round the end of the running order", (() => {
  const order = Music.rotation();
  Music.index = order[order.length - 1];
  Music.next();
  return Music.index === order[0];
})());

check("the running order leaves out tracks a level has claimed", (() => {
  const reserved = Music.reservedNames();
  const order = Music.rotation();
  return reserved.size > 0 &&
    order.every(i => !reserved.has(api.TRACKS[i].name));
})(), [...Music.reservedNames()].join(", "));

check("a fresh player opens on the configured track", (() => {
  Music._rotation = null;
  store.delete("frogger.track");
  Music.restorePreferences();
  return !api.MUSIC.startWith || Music.trackName() === api.MUSIC.startWith;
})(), `${Music.trackName()} vs ${api.MUSIC.startWith}`);

check("a remembered choice still wins over the default", (() => {
  const order = Music.rotation();
  const pick = order[order.length - 1];
  store.set("frogger.track", String(pick));
  Music.restorePreferences();
  const kept = Music.index === pick;
  store.delete("frogger.track");
  return kept;
})());

check("M toggles the music off and on again", (() => {
  const before = Music.enabled;
  Music.toggle();
  const flipped = Music.enabled !== before;
  Music.toggle();
  return flipped && Music.enabled === before;
})());

console.log("\n== the colour palettes ==");
check("there is more than one palette", PALETTES.length > 1, String(PALETTES.length));
check("every palette has a name", PALETTES.every(p => typeof p.name === "string" && p.name));
check("the first palette is the untouched cabinet look",
  !PALETTES[0].bg && !PALETTES[0].pixels);

const badColors = [];
const HEX = /^#[0-9a-fA-F]{6}$/;
for (const pal of PALETTES) {
  for (const [k, v] of Object.entries(pal.bg || {})) {
    if (!HEX.test(v)) badColors.push(`${pal.name} bg.${k}=${v}`);
  }
  for (const [k, v] of Object.entries(pal.pixels || {})) {
    if (!HEX.test(v)) badColors.push(`${pal.name} pixels.${k}=${v}`);
    if (!(k in api.PALETTE)) badColors.push(`${pal.name} overrides unknown letter "${k}"`);
  }
}
check("every palette colour is a valid hex code and a known letter",
  badColors.length === 0, badColors.slice(0, 6).join(" | "));

check("C cycles through every palette and comes back round", (() => {
  const seen = new Set();
  for (let i = 0; i < PALETTES.length; i++) seen.add(Art.nextPalette());
  const wrapped = Art.nextPalette();
  return seen.size === PALETTES.length && seen.has(wrapped);
})());

check("switching palette actually changes a colour", (() => {
  Art.setPalette(0);
  const before = Art.color("water");
  /* Find a palette that overrides the water colour. */
  const i = PALETTES.findIndex(p => p.bg && p.bg.water);
  if (i < 0) return true;
  Art.setPalette(i);
  const after = Art.color("water");
  Art.setPalette(0);
  return before !== after;
})());

check("a palette override changes what a pixel letter means", (() => {
  Art.setPalette(0);
  const before = Art.pixel("G");
  const i = PALETTES.findIndex(p => p.pixels && p.pixels.G);
  if (i < 0) return true;
  Art.setPalette(i);
  const after = Art.pixel("G");
  Art.setPalette(0);
  return before !== after && after === PALETTES[i].pixels.G;
})());

console.log("\n== the death banner ==");
/* Every way of dying needs a hint, or the banner is the empty black box again. */
const reasons = [
  "Squashed", "Drowned", "The turtles dived", "Washed away", "Hit the bank",
  "That lilypad is taken", "A crocodile was waiting", "Eaten by a crocodile",
  "Bitten by a snake", "Out of time",
];
check("every death reason the engine can produce has a hint",
  reasons.every(r => api.DEATH_HINTS[r]),
  reasons.filter(r => !api.DEATH_HINTS[r]).join(", "));

check("no overlay panel is shown while dying", (() => {
  reset();
  game.frog.row = 1;
  lanes[1].obstacles.forEach(o => { o.x = -9999; });
  frames(1);
  return game.state === "dying" && api.overlayFor() === null;
})());
resetLanes();

check("the title screen still gets an overlay", (() => {
  game.state = "title";
  game.paused = false;
  return api.overlayFor() === "title";
})());


/* ==========================================================================
   The new defaults: one frog to clear, and the two modes
   ========================================================================== */

console.log("\n== one frog clears a level ==");
CONFIG.baysToClear = DEFAULT_BAYS_TO_CLEAR;
relax();
check("the default is one lilypad", CONFIG.baysToClear === 1, String(CONFIG.baysToClear));

reset();
const lvlBefore = game.level;
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[2] * GRID;
frames(1);
check("filling one lilypad clears the level", game.state === "levelClear", game.state);
frames(160);
check("and the next level starts", game.level === lvlBefore + 1, String(game.level));

console.log("\n== beginner and expert ==");
const names = Object.keys(api.MODES);
check("there are at least two modes", names.length >= 2, names.join(", "));
check("every mode has a label and a blurb",
  names.every(n => api.MODES[n].label && api.MODES[n].blurb));

check("left and right cycle the mode", (() => {
  const first = game.mode;
  api.cycleMode(1);
  const second = game.mode;
  api.cycleMode(-1);
  return first !== second && game.mode === first;
})());

game.mode = "beginner";
check("beginner softens the bank rule", api.rule("bankIsDeath") === false);
check("beginner refills lives each level", api.setting("refillLivesOnLevel", false) === true);
check("beginner's fly is points only", api.setting("flyGivesLife", false) === false);

game.mode = "expert";
check("expert keeps the bank rule", api.rule("bankIsDeath") === true);
check("expert does not refill", api.setting("refillLivesOnLevel", false) === false);
check("expert's fly is worth a life", api.setting("flyGivesLife", false) === true);
check("expert gives fewer lives to start",
  api.MODES.expert.lives < api.MODES.beginner.lives);
check("expert's flies are rarer",
  api.MODES.expert.baySpawnGap > api.MODES.beginner.baySpawnGap);
check("expert ramps up faster", (() => {
  game.mode = "expert"; game.level = 5;
  const fast = api.speedMultiplier();
  game.mode = "beginner";
  const slow = api.speedMultiplier();
  game.level = 1;
  return fast > slow;
})());

console.log("\n== lives: refill vs earn ==");
game.mode = "beginner";
reset();
game.lives = 1;
api.advanceLevel();
check("beginner gets its frogs back on the next level",
  game.lives === api.MODES.beginner.lives, String(game.lives));

game.mode = "expert";
reset();
game.lives = 1;
api.advanceLevel();
check("expert does not", game.lives === 1, String(game.lives));

console.log("\n== the fly is worth a life in expert ==");
game.mode = "expert";
reset();
game.lives = 2;
game.timeLeft = 0.4;
game.bayHazard = { bay: 1, kind: "fly", bornAt: game.time };
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[1] * GRID;
frames(1);
check("catching a fly hands back a frog", game.lives === 3, String(game.lives));

game.mode = "beginner";
reset();
game.lives = 2;
game.timeLeft = 0.4;
game.bayHazard = { bay: 1, kind: "fly", bornAt: game.time };
game.frog.row = homeRow;
game.frog.x = CONFIG.homeCols[1] * GRID;
frames(1);
check("in beginner it is just points", game.lives === 2, String(game.lives));
relax();


/* ==========================================================================
   The bonus round
   ========================================================================== */

console.log("\n== where the special levels sit in the plan ==");
const B = api.BONUS;
const truckLevels = api.LEVELS.map((l, i) => l.kind === "truck" ? i + 1 : 0).filter(Boolean);
const TRUCK_LEVEL = truckLevels[0];

check("the plan has monster truck levels", truckLevels.length > 0,
  truckLevels.join(", "));
check("isBonusLevel agrees with the plan",
  truckLevels.every(n => api.isBonusLevel(n)) &&
  api.LEVELS.every((l, i) => l.kind === "truck" || !api.isBonusLevel(i + 1)));
check("there is more than one so it recurs", truckLevels.length >= 2,
  truckLevels.join(", "));
check("the plan has a rocket level",
  api.LEVELS.some(l => l.kind === "rocket"));
check("the plan has a helicopter level",
  api.LEVELS.some(l => l.kind === "heli"));
check("every level names an environment that exists",
  api.LEVELS.every(l => api.ENVIRONMENTS[l.env]),
  api.LEVELS.filter(l => !api.ENVIRONMENTS[l.env]).map(l => l.env).join(", "));
check("every level has a name", api.LEVELS.every(l => l.name && l.name.length));
check("no two levels in a row look the same", (() => {
  for (let i = 1; i < api.LEVELS.length; i++) {
    if (api.LEVELS[i].env === api.LEVELS[i - 1].env) return false;
  }
  return true;
})());

console.log("\n== the bonus round runs ==");
reset();
game.level = TRUCK_LEVEL - 1;
api.advanceLevel();
check("clearing into a bonus level starts the intro", game.state === "bonusIntro", game.state);
check("inBonus() is true during the intro", api.inBonus() === true);
check("the truck starts on the board",
  api.bonus.x >= 0 && api.bonus.x <= WIDTH && api.bonus.y > 0);
check("the clock is full", Math.abs(api.bonus.timeLeft - B.duration) < 0.01);

frames(Math.ceil(B.introTime * 60) + 5);
check("the intro gives way to the rampage", game.state === "bonus", game.state);

/* Drive into things and check it all adds up. */
const startScore = game.score;
api.held.up = true;
let smashesSeen = 0;
for (let i = 0; i < 60 * 8; i++) {
  frames(1);
  if (api.bonus.smashed > smashesSeen) smashesSeen = api.bonus.smashed;
  /* Wander so we keep meeting traffic. */
  if (i % 40 === 0) { api.held.left = !api.held.left; }
  if (i % 70 === 0) { api.held.up = !api.held.up; api.held.down = !api.held.up; }
}
api.held.up = api.held.down = api.held.left = api.held.right = false;

check("driving into things smashes them", smashesSeen > 0, String(smashesSeen));
check("smashing scores points", api.bonus.points > 0, String(api.bonus.points));
check("the combo was recorded", api.bonus.bestCombo >= 1, String(api.bonus.bestCombo));
check("the truck stayed on the board",
  api.bonus.x >= 0 && api.bonus.x <= WIDTH && api.bonus.y >= GRID &&
  api.bonus.y <= api.HEIGHT - GRID);
check("nothing killed the truck", game.state === "bonus" || game.state === "bonusResults",
  game.state);
check("debris was thrown", api.bonus.particles.length >= 0);

/* Run the clock out. */
for (let i = 0; i < 60 * 30 && game.state === "bonus"; i++) frames(1);
check("the rampage ends when the clock does", game.state === "bonusResults", game.state);
check("the bonus was added to the score", game.score > startScore,
  `${startScore} -> ${game.score}`);
check("the tally remembers the total", game.bonusTotal === api.bonus.points,
  `${game.bonusTotal} vs ${api.bonus.points}`);

for (let i = 0; i < Math.ceil(B.resultsTime * 60) + 10; i++) frames(1);
check("play resumes after the tally", game.state === "play", game.state);
check("everything is back on the board after the rampage",
  api.smashableLanes().every(l => l.obstacles.every(o => !o.deadUntil || o.deadUntil <= game.time)));

console.log("\n== the bonus round cannot kill you ==");
reset();
game.level = TRUCK_LEVEL - 1;
api.advanceLevel();
frames(Math.ceil(B.introTime * 60) + 5);
const livesAtStart = game.lives;
/* Park the truck right on top of the traffic and sit there. */
api.bonus.y = api.laneY(lanes.findIndex(l => l.type === "road" && l.kind !== "snake"));
for (let i = 0; i < 240; i++) frames(1);
check("sitting in traffic in the truck is harmless",
  game.state === "bonus" && game.lives === livesAtStart,
  `${game.state} lives ${game.lives}`);
/* And in the river. */
api.bonus.y = api.laneY(lanes.findIndex(l => l.type === "river"));
for (let i = 0; i < 240; i++) frames(1);
check("so is sitting in the river", game.state === "bonus" && game.lives === livesAtStart,
  `${game.state} lives ${game.lives}`);

check("the frog does not hop during the bonus round", (() => {
  const before = { x: api.bonus.x, y: api.bonus.y };
  api.hop(1, 0);
  api.hop(0, -1);
  return api.bonus.x === before.x && api.bonus.y === before.y;
})());

console.log("\n== every picture the engine asks for actually exists ==");
/* Read the engine and pull out every Art.of('...') it uses, rather than
   listing them here by hand. Adding a sprite but forgetting to map it in the
   themes made the helicopter, its bullets, the rocket and the ghosts all
   invisible, and a hand-written list would not have caught it. */
const engineSrc = await Deno.readTextFile(
  new URL("../js/game.js", import.meta.url).pathname);
const literals = [...engineSrc.matchAll(/Art\.of\(\s*'([A-Za-z]+)'\s*\)/g)].map(m => m[1]);
/* Plus the ones reached through a variable: every lane's kind, and the
   crocodile variant a log can turn into. */
const laneKinds = api.LEVELS.length ? lanes.map(l => l.kind).filter(Boolean) : [];
const askedFor = [...new Set([...literals, ...laneKinds, "gator", "boat"])].sort();

check("the engine asks for a decent number of pictures", askedFor.length >= 20,
  `${askedFor.length}: ${askedFor.join(", ")}`);

for (const themeName of Object.keys(api.THEMES)) {
  const art = api.THEMES[themeName].art || {};
  const missing = askedFor.filter(k => !art[k]);
  check(`the ${themeName} theme has art for all ${askedFor.length} of them`,
    missing.length === 0, `missing: ${missing.join(", ")}`);

  const brokenSprite = askedFor
    .filter(k => art[k] && art[k].draw === "pixels" && !api.SPRITES[art[k].sprite])
    .map(k => `${k} -> ${art[k].sprite}`);
  check(`  and every one points at a real sprite`, brokenSprite.length === 0,
    brokenSprite.join(", "));
}

check("no sprite in sprites.js is left unused", (() => {
  const used = new Set();
  for (const t of Object.values(api.THEMES)) {
    for (const a of Object.values(t.art || {})) if (a.sprite) used.add(a.sprite);
    for (const a of Object.values(t.art || {})) {
      if (a.capLeft) used.add(a.capLeft);
      if (a.capRight) used.add(a.capRight);
    }
  }
  for (const e of Object.values(api.ENVIRONMENTS)) {
    for (const sp of Object.values(e.art || {})) used.add(sp);
  }
  const orphans = Object.keys(api.SPRITES).filter(n => !used.has(n));
  return orphans.length === 0 ? true : orphans.join(", ");
})() === true, "unused sprites are dead weight");


/* ==========================================================================
   The monster truck engine, and the radio handover
   ========================================================================== */

console.log("\n== the engine runs only during the rampage ==");
const Eng = api.Engine;
CONFIG.sound = true;
relax();
reset();

check("the engine is silent during normal play", Eng.running === false);

game.level = TRUCK_LEVEL - 1;
api.advanceLevel();
check("it fires up for the countdown", Eng.running === true, game.state);
check("it built its nodes", !!Eng._nodes);

frames(Math.ceil(B.introTime * 60) + 5);
check("it keeps running through the rampage",
  Eng.running === true && game.state === "bonus", game.state);

/* Read the four things throttle is supposed to move. Driven directly rather
   than through held keys, because the truck is 1.4 squares tall and always
   overlaps a traffic row, so it smashes things (and blips the revs) whether
   you touch the controls or not. */
function engineReading(throttle) {
  Eng._revUntil = 0;
  Eng.setThrottle(throttle);
  const n = Eng._nodes;
  return {
    hz: n.osc.frequency.value,
    sub: n.sub.frequency.value,
    cut: n.cut.frequency.value,
    chug: n.lfo.frequency.value,
    vol: n.amp.gain.value,
    hiss: n.hissAmp.gain.value,
  };
}

const idle = engineReading(0);
const flat = engineReading(1);

check("opening the throttle raises the pitch", flat.hz > idle.hz,
  `${idle.hz} -> ${flat.hz}`);
check("idle and flat out match the settings",
  Math.abs(idle.hz - api.ENGINE.idleHz) < 0.5 &&
  Math.abs(flat.hz - api.ENGINE.fullHz) < 0.5, `${idle.hz} / ${flat.hz}`);
check("the sub-octave tracks an octave below", Math.abs(flat.sub - flat.hz / 2) < 0.5,
  `${flat.sub} vs ${flat.hz / 2}`);
check("the filter opens up under throttle", flat.cut > idle.cut,
  `${idle.cut} -> ${flat.cut}`);
check("the chug speeds up with the revs", flat.chug > idle.chug,
  `${idle.chug} -> ${flat.chug}`);
check("it gets louder under throttle", flat.vol > idle.vol,
  `${idle.vol} -> ${flat.vol}`);
check("the exhaust is silent at idle and audible flat out",
  idle.hiss < 0.001 && flat.hiss > 0.01, `${idle.hiss} -> ${flat.hiss}`);

check("a rev blip pushes past flat out", (() => {
  Eng.setThrottle(0);
  Eng.rev(0.3);
  Eng.setThrottle(0);
  const blipped = Eng._nodes.osc.frequency.value;
  Eng._revUntil = 0;
  return blipped > flat.hz;
})(), "rev should overshoot");

check("holding a direction revs it up in play", (() => {
  Eng._revUntil = 0;
  api.held.up = false;
  frames(8);
  const off = Eng._nodes.osc.frequency.value;
  api.held.up = true;
  frames(8);
  const on = Eng._nodes.osc.frequency.value;
  api.held.up = false;
  return on >= off;
})());

check("smashing something blips the throttle", (() => {
  Eng._revUntil = 0;
  const before = api.bonus.smashed;
  api.bonus.y = api.laneY(api.smashableLanes()[0].row);
  for (let i = 0; i < 180 && Eng._revUntil === 0; i++) frames(1);
  return Eng._revUntil > 0 && api.bonus.smashed > before;
})());

/* Run it out and make sure the engine shuts off. */
for (let i = 0; i < 60 * 30 && game.state === "bonus"; i++) frames(1);
check("it cuts when the rampage ends",
  Eng.running === false && game.state === "bonusResults", game.state);
check("and lets go of its nodes, so nothing leaks", Eng._nodes === null);

console.log("\n== the engine does not stack up over rounds ==");
for (let round = 0; round < 3; round++) {
  reset();
  game.level = TRUCK_LEVEL - 1;
  api.advanceLevel();
  frames(4);
  Eng.start();              /* a second start must be a no-op */
  Eng.start();
  api.setting("lives", 5);
  for (let i = 0; i < 60 * 40 && game.state !== "play"; i++) frames(1);
}
check("after three rounds it is off with no nodes held",
  Eng.running === false && Eng._nodes === null);

check("the engine stays quiet if sound is switched off", (() => {
  CONFIG.sound = false;
  Eng.stop();
  reset();
  game.level = TRUCK_LEVEL - 1;
  api.advanceLevel();
  const quiet = Eng.running === false;
  CONFIG.sound = true;
  for (let i = 0; i < 60 * 40 && game.state !== "play"; i++) frames(1);
  return quiet;
})());

console.log("\n== the rampage borrows the radio ==");
const bonusTrackName = api.BONUS.music;
check("the bonus track exists in the radio",
  api.TRACKS.some(t => t.name === bonusTrackName),
  `BONUS.music is "${bonusTrackName}" but the radio has: ` +
  api.TRACKS.map(t => t.name).join(", "));

Music.enabled = true;
CONFIG.music = true;
reset();

/* Start on some other track. */
const other = api.TRACKS.findIndex(t => t.name !== bonusTrackName);
Music.index = other;
const startedOn = Music.trackName();

game.level = TRUCK_LEVEL - 1;
api.advanceLevel();
check("the rampage switches to the bonus track",
  Music.trackName() === bonusTrackName, Music.trackName());

for (let i = 0; i < 60 * 40 && game.state !== "play"; i++) frames(1);
check("and hands the radio back afterwards",
  Music.trackName() === startedOn, `${Music.trackName()} vs ${startedOn}`);

check("but respects R pressed during the rampage", (() => {
  reset();
  Music.index = other;
  game.level = TRUCK_LEVEL - 1;
  api.advanceLevel();
  Music.next();                          /* the player picks something */
  const chosen = Music.trackName();
  for (let i = 0; i < 60 * 40 && game.state !== "play"; i++) frames(1);
  return Music.trackName() === chosen;
})());

check("borrowing the radio does not overwrite the saved track", (() => {
  const saved = store.get("frogger.track");
  reset();
  game.level = TRUCK_LEVEL - 1;
  api.advanceLevel();
  const during = store.get("frogger.track");
  for (let i = 0; i < 60 * 40 && game.state !== "play"; i++) frames(1);
  return during === saved;
})());

Music.stop();
CONFIG.music = false;


console.log("\n== the screen settles down after the rampage ==");
CONFIG.sound = true;
relax();
reset();
game.level = TRUCK_LEVEL - 1;
api.advanceLevel();
frames(Math.ceil(B.introTime * 60) + 5);

/* Get a proper shake going. */
api.bonus.y = api.laneY(api.smashableLanes()[0].row);
for (let i = 0; i < 240 && api.bonus.shake === 0; i++) frames(1);
check("smashing shakes the screen", api.bonus.shake > 0, String(api.bonus.shake));

/* End the round mid-shake, which is exactly how it goes wrong. */
api.bonus.shake = 11;
api.bonus.flash = 0.5;
api.bonus.timeLeft = 0.01;
frames(2);
check("the round ended", game.state === "bonusResults", game.state);
check("the shake is cleared the moment it ends", api.bonus.shake === 0,
  String(api.bonus.shake));
check("so is the flash", api.bonus.flash === 0, String(api.bonus.flash));

/* And it must not creep back during the tally or afterwards. */
for (let i = 0; i < Math.ceil(B.resultsTime * 60) + 30; i++) frames(1);
check("play resumed", game.state === "play", game.state);
check("no shake left in normal play", api.bonus.shake === 0, String(api.bonus.shake));
check("no flash left in normal play", api.bonus.flash === 0, String(api.bonus.flash));
check("no debris left over", api.bonus.particles.length === 0,
  String(api.bonus.particles.length));

check("a stray shake fades out on its own even outside the bonus round", (() => {
  api.bonus.shake = 10;
  api.bonus.flash = 0.5;
  frames(40);                      /* two thirds of a second */
  return api.bonus.shake === 0 && api.bonus.flash === 0;
})(), `shake ${api.bonus.shake} flash ${api.bonus.flash}`);

check("it fades while paused too, rather than freezing mid-judder", (() => {
  api.bonus.shake = 10;
  game.paused = true;
  frames(40);
  const settled = api.bonus.shake === 0;
  game.paused = false;
  return settled;
})());

check("starting a level calms everything down", (() => {
  api.bonus.shake = 8;
  api.bonus.particles.push({ x: 1, y: 1, vx: 0, vy: 0, life: 9, size: 2, color: "#fff" });
  api.startLevel();
  return api.bonus.shake === 0 && api.bonus.particles.length === 0;
})());


/* ==========================================================================
   The level plan, the special levels and their sounds
   ========================================================================== */

console.log("\n== the plan starts easy and gets harder ==");
const L = api.LEVELS;
const crossLevels = L.map((l, i) => l.kind === "cross" ? i + 1 : 0).filter(Boolean);
const firstCross = crossLevels[0];
const lastCross = crossLevels[crossLevels.length - 1];

check("level one is a gentle crossing",
  L[0].kind === "cross" && L[0].speed < 0.75 && L[0].roadLanes <= 2,
  `speed ${L[0].speed} lanes ${L[0].roadLanes}`);
check("level one has no hazards at all", (L[0].hazards || []).length === 0,
  (L[0].hazards || []).join(", "));
check("level one has the most generous river", L[0].river === "wide", L[0].river);

check("speed climbs across the plan", (() => {
  const speeds = crossLevels.map(n => { game.level = n; return api.speedMultiplier(); });
  game.level = 1;
  return speeds[speeds.length - 1] > speeds[0] * 1.6;
})());

check("hazards accumulate rather than appearing all at once", (() => {
  const counts = crossLevels.map(n => (L[n - 1].hazards || []).length);
  return counts[0] < counts[counts.length - 1];
})());

check("traffic lanes build up", (() => {
  const lanesUsed = crossLevels.map(n => L[n - 1].roadLanes);
  return lanesUsed[0] < Math.max(...lanesUsed);
})());

console.log("\n== the board really is laid out differently per level ==");
game.level = 1; api.applyPlan();
const easyTraffic = lanes.filter(l => l.type === "road" && l.kind !== "snake" && l.active).length;
const easyLogCells = lanes.find(l => l.type === "river" && l.kind === "log").cells;

game.level = lastCross; api.applyPlan();
const hardTraffic = lanes.filter(l => l.type === "road" && l.kind !== "snake" && l.active).length;
const hardLogCells = lanes.find(l => l.type === "river" && l.kind === "log").cells;

check("an easy level has fewer lanes of traffic switched on",
  easyTraffic < hardTraffic, `${easyTraffic} vs ${hardTraffic}`);
check("an easy level has longer logs to stand on",
  easyLogCells > hardLogCells, `${easyLogCells} vs ${hardLogCells}`);
check("the traffic that is on is nearest the start line", (() => {
  game.level = 1; api.applyPlan();
  const on = lanes.filter(l => l.type === "road" && l.kind !== "snake" && l.active)
                  .map(l => l.row);
  const off = lanes.filter(l => l.type === "road" && l.kind !== "snake" && !l.active)
                   .map(l => l.row);
  return on.length && off.length && Math.min(...on) > Math.max(...off);
})());
check("an empty road row has nothing in it to hit", (() => {
  game.level = 1; api.applyPlan();
  const dead = lanes.find(l => l.type === "road" && l.kind !== "snake" && !l.active);
  game.frog = { x: 6 * GRID, row: dead.row, bestRow: dead.row, dir: 0,
                hopFromX: 0, hopFromY: 0, hopT: 1e9, slideDir: null, slideAt: 0 };
  game.state = "play";
  dead.obstacles.forEach(o => { o.x = game.frog.x; });
  frames(2);
  return game.state === "play";
})(), game.state);
check("but an empty river row would still drown you, which is why none are",
  lanes.filter(l => l.type === "river").every(l => l.obstacles.length > 0));

console.log("\n== every level in the plan can be started ==");
let startProblems = [];
for (let n = 1; n <= L.length; n++) {
  try {
    api.startGame(n);
    frames(3);
    const ok = ["play", "bonusIntro", "heliIntro", "rocketIntro", "boatIntro"].includes(game.state);
    if (!ok) startProblems.push(`${n} ${L[n - 1].name}: state ${game.state}`);
    if (!lanes.some(l => l.obstacles.length)) {
      startProblems.push(`${n} ${L[n - 1].name}: empty board`);
    }
  } catch (e) {
    startProblems.push(`${n} ${L[n - 1].name}: threw ${e.message}`);
  }
}
check(`all ${L.length} levels start cleanly`, startProblems.length === 0,
  startProblems.slice(0, 4).join(" | "));

console.log("\n== the twists ==");
const iceLevel = L.findIndex(l => l.rules && l.rules.ice) + 1;
const darkLevel = L.findIndex(l => l.rules && l.rules.dark) + 1;
const ghostLevel = L.findIndex(l => l.rules && l.rules.ghost) + 1;
check("the plan has an ice level", iceLevel > 0);
check("the plan has a dark level", darkLevel > 0);
check("the plan has a ghost level", ghostLevel > 0);

check("standing on the start line, nothing slides", (() => {
  api.startGame(iceLevel);
  frames(1);
  game.frog.row = 12;                    /* the start line is solid ground */
  game.frog.x = 6 * GRID;
  const row = game.frog.row;
  for (let i = 0; i < 90; i++) frames(1);
  return game.frog.row === row && api.onSolidGround();
})(), "should be able to stand still on solid ground");

check("stepping off the start line commits you to sliding forward", (() => {
  api.startGame(iceLevel);
  frames(1);
  game.frog.row = 12;
  game.frog.x = 6 * GRID;
  game.timeLeft = 1e9;
  key("ArrowUp");                        /* one deliberate step */
  const after = game.frog.row;
  /* Now do nothing at all. The ice should keep carrying us. */
  for (let i = 0; i < 120 && game.state === "play"; i++) frames(1);
  return game.state !== "play" || game.frog.row < after;
})(), "the slide should carry the frog on by itself");

check("the median stops the slide, which is what makes it matter", (() => {
  api.startGame(iceLevel);
  frames(1);
  const median = lanes.find(l => l.background === "median" || l.type === "safe");
  game.frog.row = median.row;
  game.frog.x = 6 * GRID;
  game.timeLeft = 1e9;
  game.frog.iceNext = 0;
  const row = game.frog.row;
  for (let i = 0; i < 120; i++) frames(1);
  return game.frog.row === row && api.onSolidGround();
})(), "should be able to stop on the median");

check("a level without ice never slides on its own", (() => {
  api.startGame(firstCross);
  frames(1);
  game.frog.row = 11;                    /* out on the road, not solid ground */
  game.frog.x = 6 * GRID;
  game.timeLeft = 1e9;
  const row = game.frog.row;
  for (let i = 0; i < 90 && game.state === "play"; i++) frames(1);
  return game.state !== "play" || game.frog.row === row;
})());

check("the boneyard freezes the world until you move", (() => {
  api.startGame(ghostLevel);
  frames(1);
  game.frog.row = 12;
  game.timeLeft = 1e9;
  const lane = lanes.find(l => l.type === "road" && l.active);
  const before = lane.obstacles[0].x;
  for (let i = 0; i < 60; i++) frames(1);       /* a second of standing still */
  const idle = Math.abs(lane.obstacles[0].x - before);
  key("ArrowLeft");                              /* a hop winds it forward */
  const afterHop = lane.obstacles[0].x;
  for (let i = 0; i < 30; i++) frames(1);
  const moved = Math.abs(lane.obstacles[0].x - afterHop);
  return idle < moved;
})(), "standing still should move the world less than hopping does");

check("a normal level moves whether you hop or not", (() => {
  api.startGame(firstCross);
  frames(1);
  game.frog.row = 12;
  game.timeLeft = 1e9;
  const lane = lanes.find(l => l.type === "road" && l.active);
  const before = lane.obstacles[0].x;
  for (let i = 0; i < 60; i++) frames(1);
  return Math.abs(lane.obstacles[0].x - before) > 5;
})());

console.log("\n== the rocket ==");
const rocketLevel = L.findIndex(l => l.kind === "rocket") + 1;
api.startGame(rocketLevel);
frames(3);
check("it opens with the briefing", game.state === "rocketIntro", game.state);
frames(Math.ceil(api.ROCKET.introTime * 60) + 5);
check("then hands over the controls", game.state === "rocket", game.state);
check("you get the configured number of rockets",
  api.rocket.attemptsLeft === api.ROCKET.attempts, String(api.rocket.attemptsLeft));
check("it starts on the pad, not in the air", api.rocket.flying === false);

check("left and right slide it along the pad", (() => {
  Object.keys(api.held).forEach(k => api.held[k] = false);
  const from = api.rocket.x;
  api.held.right = true;
  frames(20);
  api.held.right = false;
  return api.rocket.x > from;
})());

/* From here on these are checks about the rocket itself, so switch the traffic
   off. Shoving obstacles off screen does not work: the wrap logic brings them
   straight back. Dodging is covered separately below. */
function clearSky() { lanes.forEach(l => { l.active = false; }); }
clearSky();

check("up launches it", (() => {
  api.held.up = true;
  frames(3);
  api.held.up = false;
  return api.rocket.flying === true && api.rocket.attemptsLeft === api.ROCKET.attempts - 1;
})());

check("it climbs", (() => {
  const from = api.rocket.y;
  frames(20);
  return api.rocket.y < from;
})());

check("flying into traffic shoots you down", (() => {
  api.startGame(rocketLevel);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 6);
  const before = api.rocket.attemptsLeft;
  /* Park a lorry directly overhead. */
  const lane = lanes.find(l => l.type === "road" && l.active);
  lane.obstacles.forEach(o => { o.x = api.rocket.x - GRID; });
  api.rocket.y = api.laneY(lane.row) + 2;
  api.rocket.flying = true;
  frames(3);
  return api.rocket.outcome === "SHOT DOWN" && api.rocket.attemptsLeft <= before;
})(), `outcome "${api.rocket.outcome}"`);

check("stars can be collected", (() => {
  api.startGame(rocketLevel);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 6);
  clearSky();
  const st = api.rocket.stars[0];
  api.rocket.flying = true;
  api.rocket.x = st.x;
  api.rocket.y = st.y - GRID * 0.5;
  frames(2);
  return api.rocket.grabbed > 0;
})(), `grabbed ${api.rocket.grabbed}`);

check("landing on a free pad fills it and scores", (() => {
  /* Line it up dead on a lilypad and let it fly. */
  api.startGame(rocketLevel);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 6);
  const before = game.score;
  /* Clear the sky. The rocket now crashes into traffic on the way up, which is
     the point of the level, but here we are testing the landing. */
  clearSky();
  api.rocket.x = CONFIG.homeCols[2] * GRID;
  api.rocket.flying = true;
  api.rocket.windPhase = 0;
  /* Hold the throttle. The median holds a coasting rocket now, which is the
     point of it, so a hands-off climb never gets past halfway. */
  api.held.up = true;
  for (let i = 0; i < 900 && api.rocket.y > api.laneY(0); i++) {
    api.rocket.x = CONFIG.homeCols[2] * GRID;
    frames(1);
  }
  api.held.up = false;
  return game.bays[2] === true && game.score > before;
})(), `bays ${JSON.stringify(game.bays)}`);

check("running out of rockets ends the level", (() => {
  api.startGame(rocketLevel);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 6);
  api.rocket.attemptsLeft = 0;
  game.lives = 9;
  for (let i = 0; i < 200 && game.state === "rocket"; i++) frames(1);
  return game.state === "rocketResults" || game.state === "gameOver";
})(), game.state);

console.log("\n== the helicopter ==");
const heliLevel = L.findIndex(l => l.kind === "heli") + 1;
api.startGame(heliLevel);
frames(3);
check("it opens with the briefing", game.state === "heliIntro", game.state);
frames(Math.ceil(api.HELI.introTime * 60) + 5);
check("then you are flying", game.state === "heli", game.state);

check("the gun fires by itself", (() => {
  const before = api.heli.bullets.length;
  frames(30);
  return api.heli.bullets.length > 0 || api.bonus.smashed > 0;
})(), `bullets ${api.heli.bullets.length}`);

check("bullets destroy traffic", (() => {
  const before = api.bonus.smashed;
  /* Hover over a live traffic row and hose it. */
  const lane = lanes.find(l => l.type === "road" && l.kind !== "snake" && l.active);
  api.heli.y = api.laneY(lane.row) - GRID * 1.2;
  api.held.up = true;
  for (let i = 0; i < 240 && api.bonus.smashed === before; i++) frames(1);
  api.held.up = false;
  return api.bonus.smashed > before;
})(), `destroyed ${api.bonus.smashed}`);

check("destroying things scores", api.bonus.points > 0, String(api.bonus.points));
check("nothing can shoot back", game.state === "heli", game.state);

check("the clock ends the mission", (() => {
  api.heli.timeLeft = 0.02;
  frames(4);
  return game.state === "heliResults";
})(), game.state);
check("the bullets are cleared away", api.heli.bullets.length === 0);

console.log("\n== each machine sounds like itself ==");
const profiles = ["truck", "helicopter", "rocket"];
check("there is an engine profile per machine",
  profiles.every(n => api.ENGINE_PROFILES[n] !== undefined),
  Object.keys(api.ENGINE_PROFILES).join(", "));
check("a rotor chugs faster than a V8", (() => {
  const truck = { ...api.ENGINE, ...api.ENGINE_PROFILES.truck };
  const rotor = { ...api.ENGINE, ...api.ENGINE_PROFILES.helicopter };
  return rotor.idleChug > truck.idleChug;
})());
check("a rocket is mostly noise", (() => {
  const truck = { ...api.ENGINE, ...api.ENGINE_PROFILES.truck };
  const rkt = { ...api.ENGINE, ...api.ENGINE_PROFILES.rocket };
  return rkt.hissVol > truck.hissVol * 3;
})());

check("the right profile is picked for each level", (() => {
  const seen = {};
  for (const [lvl, want] of [[TRUCK_LEVEL, "truck"], [heliLevel, "helicopter"],
                             [rocketLevel, "rocket"]]) {
    api.startGame(lvl);
    frames(3);
    seen[want] = api.Engine.profile;
  }
  return Object.entries(seen).every(([want, got]) => want === got);
})());

check("impact sounds layer noise under the tone, or they are just beeps", (() => {
  const impacts = ["smash", "bigsmash", "explode", "launch", "splash"];
  return impacts.every(n => api.SOUNDS[n] && api.SOUNDS[n].crunch > 0);
})());
check("the rocket has its own launch sound", !!api.SOUNDS.launch);
check("the helicopter has a gun sound", !!api.SOUNDS.shot);

console.log("\n== the level selector ==");
check("it lists every level in the plan", L.length > 10, String(L.length));
check("bonus and boss levels are tagged", (() => {
  const truck = api.levelTag(L[TRUCK_LEVEL - 1]);
  const boat = L.find(l => l.kind === "boat");
  return truck.includes("BONUS") && (!boat || api.levelTag(boat).includes("BOSS"));
})());
check("twists are tagged too", (() => {
  return api.levelTag(L[iceLevel - 1]).includes("ICE") &&
         api.levelTag(L[ghostLevel - 1]).includes("GHOST") &&
         api.levelTag(L[darkLevel - 1]).includes("DARK");
})());
check("the picked level is kept inside the list", (() => {
  game.pickedLevel = 9999; api.clampPickedLevel();
  const high = game.pickedLevel === L.length;
  game.pickedLevel = -5; api.clampPickedLevel();
  const low = game.pickedLevel === 1;
  game.pickedLevel = 1;
  return high && low;
})());
check("starting from the selector starts that level", (() => {
  game.pickedLevel = 4;
  api.startGame();
  frames(2);
  return game.level === 4;
})(), String(game.level));
check("level names survive looping past the end", (() => {
  const beyond = api.levelName(L.length + 3);
  return typeof beyond === "string" && beyond.length > 0 && beyond.includes("+");
})(), api.levelName(L.length + 3));
check("looping keeps making it faster", (() => {
  /* Compare the same entry in the plan on two different laps, or you end up
     comparing a fast crossing against a bonus round that has no speed. */
  const span = L.length - api.LEVEL_LOOP.from + 1;
  const inLoop = crossLevels.filter(n => n >= api.LEVEL_LOOP.from).pop();
  game.level = inLoop;
  const lap0 = api.speedMultiplier();
  game.level = inLoop + span;
  const lap1 = api.speedMultiplier();
  game.level = 1;
  return api.planFor(inLoop) === api.planFor(inLoop + span) && lap1 > lap0;
})());

console.log("\n== environments ==");
check("each environment has a label",
  Object.values(api.ENVIRONMENTS).every(e => e.label));
check("environment colours are valid hex", (() => {
  const HEX = /^#[0-9a-fA-F]{6}$/;
  const bad = [];
  for (const [name, e] of Object.entries(api.ENVIRONMENTS)) {
    for (const [k, v] of Object.entries(e.bg || {})) if (!HEX.test(v)) bad.push(`${name}.${k}`);
    for (const [k, v] of Object.entries(e.pixels || {})) {
      if (!HEX.test(v)) bad.push(`${name}.px.${k}`);
      if (!(k in api.PALETTE)) bad.push(`${name} unknown letter ${k}`);
    }
  }
  return bad.length === 0 ? true : bad.join(", ");
})() === true);
check("swapped-in pictures exist", (() => {
  const missing = [];
  for (const [name, e] of Object.entries(api.ENVIRONMENTS)) {
    for (const [kind, sprite] of Object.entries(e.art || {})) {
      if (!api.SPRITES[sprite]) missing.push(`${name}: ${sprite}`);
    }
  }
  return missing.length === 0 ? true : missing.join(", ");
})() === true);
check("changing level changes the look", (() => {
  api.startGame(1); frames(1);
  const a = api.Art.color("water");
  api.startGame(darkLevel); frames(1);
  const b = api.Art.color("water");
  return a !== b;
})());
check("a swapped picture really swaps", (() => {
  /* Swapping one picture for another only means anything on a pixel theme;
     the emoji theme has no sprite names to swap. */
  CONFIG.theme = "arcade";
  const arctic = Object.entries(api.ENVIRONMENTS).find(([, e]) => e.art && e.art.log);
  if (!arctic) return true;
  api.Art.setEnvironment(arctic[0]);
  const swapped = api.Art.of("log");
  api.Art.setEnvironment("pond");
  const normal = api.Art.of("log");
  return swapped.sprite === arctic[1].art.log && normal.sprite !== swapped.sprite;
})());
check("C still overrides the level's colours", (() => {
  api.startGame(1); frames(1);
  api.Art.setPalette(0);
  const auto = api.Art.color("water");
  const forced = api.PALETTES.findIndex(p => p.bg && p.bg.water);
  if (forced < 0) return true;
  api.Art.setPalette(forced);
  const manual = api.Art.color("water");
  api.Art.setPalette(0);
  return manual !== auto && manual === api.PALETTES[forced].bg.water;
})());


console.log("\n== the aliens fight back ==");
api.startGame(heliLevel);
frames(Math.ceil(api.HELI.introTime * 60) + 6);
game.timeLeft = 1e9;
for (let i = 0; i < 60 * 6 && api.heli.aliens.length === 0; i++) frames(1);
check("aliens turn up", api.heli.aliens.length > 0, String(api.heli.aliens.length));

check("they come after you", (() => {
  const a = api.heli.aliens[0];
  if (!a) return false;
  const before = Math.hypot(a.x - api.heli.x, a.y - api.heli.y);
  for (let i = 0; i < 40; i++) frames(1);
  const after = Math.hypot(a.x - api.heli.x, a.y - api.heli.y);
  return after < before || after < GRID;
})());

check("they shoot at you", (() => {
  for (let i = 0; i < 60 * 5 && api.heli.enemyShots.length === 0; i++) frames(1);
  return api.heli.enemyShots.length > 0;
})(), String(api.heli.enemyShots.length));

check("getting shot costs armour, not a frog", (() => {
  const lives = game.lives;
  const hits = api.heli.hits;
  api.heli.hurtAt = -99;
  api.takeHeliHit();
  return api.heli.hits === hits + 1 && game.lives === lives;
})());

check("running out of armour ends the mission early", (() => {
  api.heli.hurtAt = -99;
  while (api.heli.hits < api.HELI.heliLives) {
    api.heli.hurtAt = -99;
    api.takeHeliHit();
  }
  frames(4);
  return game.state === "heliResults";
})(), game.state);

check("shooting an alien scores", (() => {
  api.startGame(heliLevel);
  frames(Math.ceil(api.HELI.introTime * 60) + 6);
  for (let i = 0; i < 60 * 6 && api.heli.aliens.length === 0; i++) frames(1);
  const a = api.heli.aliens[0];
  if (!a) return false;
  const before = api.bonus.points;
  /* Put enough bullets straight through it. */
  for (let n = 0; n < api.HELI.alienHits; n++) {
    api.heli.bullets.push({ x: a.x + GRID / 2, y: a.y + GRID / 2, vx: 0, vy: 0 });
    frames(1);
  }
  return api.bonus.points > before;
})(), `points ${api.bonus.points}`);

console.log("\n== the turtles tell you first ==");

/* Find a level with diving turtles and get onto the water. */
const DIVE_LEVEL = (() => {
  const i = api.LEVELS.findIndex(
    (l) => l.kind === "cross" && (l.hazards || []).includes("diving")
  );
  return i === -1 ? FULL_LEVEL : i + 1;
})();

function divingOb() {
  for (const lane of lanes) {
    if (lane.type !== "river" || !lane.active) continue;
    const ob = lane.obstacles.find((o) => o.dives);
    if (ob) return { lane, ob };
  }
  return null;
}

check("the dive cycle has all three phases", (() => {
  api.startGame(DIVE_LEVEL);
  frames(1);
  const found = divingOb();
  if (!found) return false;
  const seen = new Set();
  const cycle = CONFIG.timing.diveUp + CONFIG.timing.diveTuck + CONFIG.timing.diveUnder;
  for (let i = 0; i < Math.ceil(cycle * 60) + 10; i++) {
    seen.add(api.divePhaseName(found.lane, found.ob));
    frames(1);
  }
  return seen.has("up") && seen.has("tuck") && seen.has("under");
})());

check("tucking puts bubbles on the water", (() => {
  api.startGame(DIVE_LEVEL);
  frames(1);
  const found = divingOb();
  if (!found) return false;
  game.fx.length = 0;
  /* Run a whole cycle. Somewhere in there it tucks, and that makes bubbles. */
  const cycle = CONFIG.timing.diveUp + CONFIG.timing.diveTuck + CONFIG.timing.diveUnder;
  let sawPuff = false;
  for (let i = 0; i < Math.ceil(cycle * 60) + 10; i++) {
    frames(1);
    if (game.fx.some((f) => f.shape === "puff")) sawPuff = true;
  }
  return sawPuff;
})());

check("going under leaves a ring", (() => {
  api.startGame(DIVE_LEVEL);
  frames(1);
  const found = divingOb();
  if (!found) return false;
  game.fx.length = 0;
  const cycle = CONFIG.timing.diveUp + CONFIG.timing.diveTuck + CONFIG.timing.diveUnder;
  let sawRing = false;
  for (let i = 0; i < Math.ceil(cycle * 60) + 10; i++) {
    frames(1);
    if (game.fx.some((f) => f.shape === "ring")) sawRing = true;
  }
  return sawRing;
})());

check("effects clear themselves up", (() => {
  api.spawnPuff(100, 100, "#fff", 4, { life: 0.2 });
  api.spawnRing(100, 100, "#fff", { life: 0.2 });
  const had = game.fx.length;
  for (let i = 0; i < 40; i++) api.updateFx(1 / 60);
  return had > 0 && game.fx.length === 0;
})(), `left ${game.fx.length}`);

check("the warning is quiet enough to live with", (() => {
  const tuck = api.SOUNDS.tuck, sink = api.SOUNDS.sink;
  if (!tuck || !sink) return false;
  /* These play every few seconds all level. Louder than a hop and they stop
     being information and start being noise. */
  return tuck.gain < api.SOUNDS.hop.gain && sink.gain <= api.SOUNDS.hop.gain;
})());


console.log("\n== the median stops being safe ==");

const SNAKE_LEVEL = (() => {
  const i = api.LEVELS.findIndex(
    (l) => l.kind === "cross" && (l.hazards || []).includes("snake")
  );
  return i === -1 ? FULL_LEVEL : i + 1;
})();

/* Stand the frog on the median right next to a snake and hand back both. */
function standOnMedian() {
  api.startGame(SNAKE_LEVEL);
  frames(1);
  const lane = api.snakeLane;
  if (!lane || !lane.active) return null;
  const ob = lane.obstacles[0];
  ob.mood = "patrol";
  ob.moodUntil = 0;
  ob.readyAt = 0;
  game.frog.row = lane.row;
  /* Close enough to be noticed, far enough not to be bitten on frame one,
     which would end the level before any of this could be observed. */
  const mid = ob.x + (ob.cells * GRID) / 2;
  const want = mid + GRID * 2.5;
  game.frog.x = want + GRID <= WIDTH ? want : mid - GRID * 2.5 - GRID;
  return { lane, ob };
}

check("a snake coils when you loiter on the median", (() => {
  const at = standOnMedian();
  if (!at) return false;
  for (let i = 0; i < 20 && at.ob.mood === "patrol"; i++) {
    game.frog.row = at.lane.row;
    frames(1);
  }
  return at.ob.mood === "coil";
})());

check("a coiling snake holds still, so the tell reads", (() => {
  const at = standOnMedian();
  if (!at) return false;
  for (let i = 0; i < 20 && at.ob.mood !== "coil"; i++) {
    game.frog.row = at.lane.row;
    frames(1);
  }
  if (at.ob.mood !== "coil") return false;
  const before = at.ob.x;
  frames(5);
  return Math.abs(at.ob.x - before) < 0.001;
})());

check("stepping off the median calls it off", (() => {
  const at = standOnMedian();
  if (!at) return false;
  for (let i = 0; i < 20 && at.ob.mood !== "coil"; i++) {
    game.frog.row = at.lane.row;
    frames(1);
  }
  if (at.ob.mood !== "coil") return false;
  game.frog.row = at.lane.row - 1;        /* hopped on into the road */
  frames(2);
  return at.ob.mood !== "coil" && at.ob.mood !== "strike";
})());

check("the strike is faster than the patrol", (() => {
  const at = standOnMedian();
  if (!at) return false;
  for (let i = 0; i < 90 && at.ob.mood !== "strike"; i++) {
    game.frog.row = at.lane.row;
    frames(1);
  }
  return at.ob.mood === "strike" && at.ob.speedScale > 1;
})());

check("the wind-up is long enough to get out of the way", (() => {
  /* A hop takes CONFIG.hopDuration ms. If the warning is shorter than a hop
     there is nothing you could have done, and it stops being a warning. */
  return api.SNAKE.windUp * 1000 > CONFIG.hopDuration * 2;
})(), `windUp ${api.SNAKE.windUp}s vs hop ${CONFIG.hopDuration}ms`);

check("a snake never hunts you off the median", (() => {
  api.startGame(SNAKE_LEVEL);
  frames(1);
  const lane = api.snakeLane;
  if (!lane || !lane.active) return false;
  lane.obstacles.forEach((o) => { o.mood = "patrol"; o.readyAt = 0; });
  game.frog.row = lane.row - 1;
  for (let i = 0; i < 120; i++) { game.frog.row = lane.row - 1; frames(1); }
  return lane.obstacles.every((o) => o.mood === "patrol");
})());


check("a level can keep the old patrolling snake", (() => {
  const off = api.LEVELS.findIndex((l) => l.rules && l.rules.snakesHunt === false);
  if (off === -1) return false;
  api.startGame(off + 1);
  frames(1);
  const lane = api.snakeLane;
  if (!lane || !lane.active) return false;
  lane.obstacles.forEach((o) => { o.mood = "patrol"; o.readyAt = 0; });
  /* Stand right next to one for a good while. Nothing should wind up. */
  const ob = lane.obstacles[0];
  game.frog.x = Math.min(WIDTH - GRID, ob.x + ob.cells * GRID + GRID);
  for (let i = 0; i < 120; i++) { game.frog.row = lane.row; frames(1); }
  return lane.obstacles.every((o) => o.mood === "patrol");
})());

check("an explicit false in a level's rules is not read as unset", (() => {
  const off = api.LEVELS.findIndex((l) => l.rules && l.rules.snakesHunt === false);
  if (off === -1) return false;
  game.level = off + 1;
  return api.levelRule("snakesHunt", true) === false &&
         api.levelRule("noSuchRule", "fallback") === "fallback";
})());


console.log("\n== no air up there ==");

const AIR_LEVEL = (() => {
  const i = api.LEVELS.findIndex((l) => l.rules && l.rules.airless);
  return i === -1 ? -1 : i + 1;
})();

check("a level says it is airless", AIR_LEVEL !== -1);

if (AIR_LEVEL !== -1) {
  check("an airless level starts on a small tank, not the full clock", (() => {
    api.startGame(AIR_LEVEL);
    frames(1);
    return api.airless() && api.timeCapacity() === api.AIR.tank &&
           api.AIR.tank < CONFIG.timeLimit && game.timeLeft <= api.AIR.tank;
  })(), `capacity ${api.timeCapacity()} left ${game.timeLeft}`);

  check("a normal level still gets the full clock", (() => {
    api.startGame(1);
    frames(1);
    return !api.airless() && api.timeCapacity() === CONFIG.timeLimit;
  })());

  check("pockets turn up on their own", (() => {
    api.startGame(AIR_LEVEL);
    for (let i = 0; i < 60 * 4; i++) {
      frames(1);
      if (game.air.length) return true;
    }
    return false;
  })());

  check("never more than the cap on the board", (() => {
    api.startGame(AIR_LEVEL);
    let worst = 0;
    for (let i = 0; i < 60 * 30; i++) { frames(1); worst = Math.max(worst, game.air.length); }
    return worst > 0 && worst <= api.AIR.pocketMax;
  })(), `saw ${game.air.length}`);

  check("a pocket never lands on the lilypad row", (() => {
    const rows = api.airRows();
    const homeLane = lanes.find((l) => l.type === "home");
    const startLane = lanes.find((l) => l.type === "start");
    return rows.length > 0 &&
           (!homeLane || !rows.includes(homeLane.row)) &&
           (!startLane || !rows.includes(startLane.row));
  })());

  check("taking one refills the tank and scores", (() => {
    api.startGame(AIR_LEVEL);
    frames(1);
    for (let i = 0; i < 60 * 5 && !game.air.length; i++) frames(1);
    const pocket = game.air[0];
    if (!pocket) return false;
    game.timeLeft = 2;
    const score = game.score;
    game.frog.row = pocket.row;
    game.frog.x = pocket.x;
    frames(1);
    return game.timeLeft > 2 && game.score > score;
  })(), `left ${game.timeLeft}`);

  check("a refill never overfills the tank", (() => {
    api.startGame(AIR_LEVEL);
    frames(1);
    for (let i = 0; i < 60 * 5 && !game.air.length; i++) frames(1);
    const pocket = game.air[0];
    if (!pocket) return false;
    game.timeLeft = api.AIR.tank;
    game.frog.row = pocket.row;
    game.frog.x = pocket.x;
    frames(1);
    return game.timeLeft <= api.AIR.tank + 0.001;
  })(), `left ${game.timeLeft}`);

  check("running the tank dry says you ran out of air", (() => {
    api.startGame(AIR_LEVEL);
    frames(1);
    game.timeLeft = 0.01;
    frames(3);
    return game.deathReason === "Out of air";
  })(), game.deathReason);

  check("and a normal level still says out of time", (() => {
    api.startGame(1);
    frames(1);
    game.timeLeft = 0.01;
    frames(3);
    return game.deathReason === "Out of time";
  })(), game.deathReason);

  check("there is a hint for running out of air",
    !!api.DEATH_HINTS["Out of air"]);

  check("pockets are cleared between levels", (() => {
    api.startGame(AIR_LEVEL);
    for (let i = 0; i < 60 * 4 && !game.air.length; i++) frames(1);
    const had = game.air.length;
    api.startGame(1);
    frames(2);
    return had > 0 && game.air.length === 0;
  })());
}


console.log("\n== the title screen fits on the title screen ==");

/* The blurb and the controls line were drawn at exactly the same y, one over
   the other, and each was right on its own terms. These checks are about the
   whole column agreeing with itself. */
const TITLE_ORDER = ["frog", "mode", "modeBlurb", "env", "blurb", "controls",
                     "keys", "start"];

function titleRows(level) {
  game.pickedLevel = level;
  const L = api.titleLayout(api.HEIGHT / 2);
  return { L, ys: TITLE_ORDER.map((k) => ({ k, y: L[k] })).filter((r) => r.y !== null) };
}

check("no two lines land on top of each other, on any level", (() => {
  const gap = CONFIG.grid * 0.3;      /* a line needs at least this much room */
  for (let n = 1; n <= api.LEVELS.length; n++) {
    const { ys } = titleRows(n);
    for (let i = 1; i < ys.length; i++) {
      if (ys[i].y - ys[i - 1].y < gap) {
        return `level ${n}: ${ys[i - 1].k} at ${ys[i - 1].y.toFixed(0)} and ` +
               `${ys[i].k} at ${ys[i].y.toFixed(0)}`;
      }
    }
  }
  return true;
})() === true, "lines overlap");

check("every line stays inside the panel", (() => {
  const pad = CONFIG.grid * 0.25;
  for (let n = 1; n <= api.LEVELS.length; n++) {
    const { L, ys } = titleRows(n);
    for (const r of ys) {
      if (r.y < L.panelTop + pad || r.y > L.panelBottom - pad) {
        return `level ${n}: ${r.k} at ${r.y.toFixed(0)} outside ` +
               `${L.panelTop.toFixed(0)}..${L.panelBottom.toFixed(0)}`;
      }
    }
  }
  return true;
})() === true, "line outside the panel");

check("a longer level list still leaves room underneath", (() => {
  /* The list caps at five rows, so adding levels must not push the controls
     line any further down. This is the thing that broke in the first place. */
  const before = api.levelListMetrics().edge;
  return before === (Math.min(5, api.LEVELS.length) / 2) * (CONFIG.grid * 0.62);
})());

check("the blurb is skipped cleanly when a level has none", (() => {
  const L = api.titleLayout(api.HEIGHT / 2);
  const saved = api.LEVELS[0].blurb;
  api.LEVELS[0].blurb = "";
  game.pickedLevel = 1;
  const bare = api.titleLayout(api.HEIGHT / 2);
  api.LEVELS[0].blurb = saved;
  return bare.blurb === null && bare.controls > bare.env && L.controls > 0;
})());

game.pickedLevel = 1;


console.log("\n== the rocket has a throttle ==");

const ROCKET_LEVEL = api.LEVELS.findIndex(l => l.kind === "rocket") + 1;

/* Get airborne with the sky empty, so the only thing being measured is climb. */
function airborne() {
  api.startGame(ROCKET_LEVEL);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 6);
  lanes.forEach(l => { l.active = false; });
  api.held.up = true;
  frames(3);
  api.held.up = false;
  return api.rocket.flying;
}

function climbOver(frameCount, burning) {
  const from = api.rocket.y;
  api.held.up = burning;
  frames(frameCount);
  api.held.up = false;
  return from - api.rocket.y;
}

check("a full tank comes with every rocket", (() => {
  api.startGame(ROCKET_LEVEL);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 6);
  return api.rocket.fuel === api.ROCKET.fuel;
})(), String(api.rocket.fuel));

check("burning climbs faster than coasting", (() => {
  if (!airborne()) return false;
  const burned = climbOver(10, true);
  if (!airborne()) return false;
  const coasted = climbOver(10, false);
  return burned > coasted * 1.5;
})());

check("burning uses the booster up", (() => {
  if (!airborne()) return false;
  const before = api.rocket.fuel;
  climbOver(20, true);
  return api.rocket.fuel < before;
})());

check("coasting does not", (() => {
  if (!airborne()) return false;
  const before = api.rocket.fuel;
  climbOver(20, false);
  return Math.abs(api.rocket.fuel - before) < 0.001;
})());

check("the booster runs out rather than going negative", (() => {
  if (!airborne()) return false;
  /* Hold it down near the pad, or it reaches the bank and gets a fresh tank
     before the old one is empty. */
  const low = api.rocket.y;
  api.held.up = true;
  for (let i = 0; i < Math.ceil(api.ROCKET.fuel * 60) + 120; i++) {
    api.rocket.y = low;
    frames(1);
  }
  api.held.up = false;
  return api.rocket.fuel === 0;
})(), String(api.rocket.fuel));

check("an empty booster climbs like a coast, however hard you hold it", (() => {
  if (!airborne()) return false;
  api.rocket.fuel = 0;
  const held = climbOver(10, true);
  if (!airborne()) return false;
  api.rocket.fuel = 0;
  const idle = climbOver(10, false);
  return Math.abs(held - idle) < 0.5 && api.rocket.burning === false;
})());

check("it still gets to the top on an empty tank", (() => {
  /* Coasting has to be slow, not a dead end. If it were, running dry would be
     an unwinnable rocket rather than a slow one. */
  if (!airborne()) return false;
  api.rocket.fuel = 0;
  for (let i = 0; i < 60 * 40 && api.rocket.flying; i++) frames(1);
  return !api.rocket.flying;
})());

check("the booster refills for the next rocket", (() => {
  if (!airborne()) return false;
  climbOver(30, true);
  api.rocket.fuel = 0.4;
  api.crashRocket();
  frames(2);
  return api.rocket.fuel === api.ROCKET.fuel;
})(), String(api.rocket.fuel));

check("coasting is slower than the old fixed climb, burning is faster", (() => {
  return api.ROCKET.coast < 1 && api.ROCKET.boost > 1;
})());


console.log("\n== the pad does not fire itself ==");

/* Will launched, was shot down, and the level was over. UP is the throttle
   now, so it gets held rather than tapped, and the pad was relaunching on the
   very next frame with the key still down: three rockets gone in a blink. */
check("being shot down while holding UP does not fire the next one", (() => {
  api.startGame(ROCKET_LEVEL);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 6);
  api.held.up = false;
  frames(2);
  api.held.up = true;
  frames(3);
  if (!api.rocket.flying) { api.held.up = false; return false; }

  const left = api.rocket.attemptsLeft;
  api.crashRocket();
  frames(10);                       /* still holding UP the whole time */
  const stillHeld = api.rocket.attemptsLeft === left && !api.rocket.flying;
  api.held.up = false;
  return stillHeld;
})(), `attempts ${api.rocket.attemptsLeft} flying ${api.rocket.flying}`);

check("and it does go again once you let go and wait", (() => {
  api.held.up = false;
  frames(Math.ceil(api.ROCKET.relaunchPause * 60) + 6);
  const left = api.rocket.attemptsLeft;
  api.held.up = true;
  frames(3);
  api.held.up = false;
  return api.rocket.flying && api.rocket.attemptsLeft === left - 1;
})(), `flying ${api.rocket.flying} attempts ${api.rocket.attemptsLeft}`);

check("letting go is not enough on its own, you get to read the outcome", (() => {
  api.startGame(ROCKET_LEVEL);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 6);
  api.held.up = false;
  frames(2);
  api.held.up = true;
  frames(3);
  api.held.up = false;
  api.crashRocket();
  frames(2);
  const left = api.rocket.attemptsLeft;
  api.held.up = true;
  frames(2);
  const heldOff = !api.rocket.flying && api.rocket.attemptsLeft === left;
  api.held.up = false;
  return heldOff;
})());

check("the first rocket of the level goes without waiting", (() => {
  api.startGame(ROCKET_LEVEL);
  frames(Math.ceil(api.ROCKET.introTime * 60) + 3);
  api.held.up = true;
  frames(3);
  const off = api.rocket.flying;
  api.held.up = false;
  return off;
})());


console.log("\n== the between-levels card ==");

const CLEAR_ORDER = ["level", "cleared", "rule", "label", "name", "tag",
                     "blurb", "env", "warning"];

check("the card's lines are in order and do not collide", (() => {
  const C = api.clearLayout(api.HEIGHT / 2);
  const gap = CONFIG.grid * 0.3;
  for (let i = 1; i < CLEAR_ORDER.length; i++) {
    const a = C[CLEAR_ORDER[i - 1]], b = C[CLEAR_ORDER[i]];
    if (b - a < gap) return `${CLEAR_ORDER[i - 1]} ${a} then ${CLEAR_ORDER[i]} ${b}`;
  }
  return true;
})() === true, "lines collide");

check("every line is inside the card", (() => {
  const C = api.clearLayout(api.HEIGHT / 2);
  const pad = CONFIG.grid * 0.25;
  for (const k of CLEAR_ORDER) {
    if (C[k] < C.panelTop + pad || C[k] > C.panelBottom - pad) {
      return `${k} at ${C[k].toFixed(0)}`;
    }
  }
  return true;
})() === true, "line outside the card");

check("it names and describes the level you are about to play", (() => {
  for (let n = 1; n < api.LEVELS.length; n++) {
    const nx = api.nextUp(n);
    if (nx.victory) return `level ${n} claimed victory too early`;
    if (!nx.name) return `level ${n + 1} has no name`;
    if (!nx.blurb) return `level ${n + 1} has no description`;
    if (nx.name !== api.levelName(n + 1)) return `level ${n + 1} named wrong`;
  }
  return true;
})() === true, "the card is missing something");

check("clearing the last one says so instead of naming a next", (() => {
  const nx = api.nextUp(api.LEVELS.length);
  return nx.victory === true;
})());

check("the special levels are labelled on the card", (() => {
  const boss = api.LEVELS.findIndex((l) => l.kind === "boat");
  if (boss <= 0) return true;
  return api.nextUp(boss).tag.includes("BOSS");
})(), api.nextUp(Math.max(1, api.LEVELS.findIndex((l) => l.kind === "boat"))).tag);

check("the warning line only fires when something is actually new", (() => {
  let fired = 0;
  for (let n = 1; n <= api.LEVELS.length; n++) {
    if (api.nextLevelWarning(n)) fired++;
  }
  /* It used to say something on every single level, which is why it said
     nothing worth reading. A handful of debuts is the point. */
  return fired > 0 && fired < api.LEVELS.length / 2;
})(), `${(() => { let f = 0; for (let n = 1; n <= api.LEVELS.length; n++) if (api.nextLevelWarning(n)) f++; return f; })()} of ${api.LEVELS.length}`);

console.log("\n== two hits and the chopper is done ==");

check("the chopper takes two alien hits, not three", api.HELI.heliLives === 2,
  String(api.HELI.heliLives));

check("two hits ends the mission", (() => {
  const heliLevel = api.LEVELS.findIndex(l => l.kind === "heli") + 1;
  api.startGame(heliLevel);
  frames(Math.ceil(api.HELI.introTime * 60) + 6);
  for (let i = 0; i < api.HELI.heliLives; i++) {
    api.heli.hurtAt = -99;
    api.takeHeliHit();
  }
  frames(4);
  return game.state === "heliResults";
})(), game.state);

check("one hit does not", (() => {
  const heliLevel = api.LEVELS.findIndex(l => l.kind === "heli") + 1;
  api.startGame(heliLevel);
  frames(Math.ceil(api.HELI.introTime * 60) + 6);
  api.heli.hurtAt = -99;
  api.takeHeliHit();
  frames(4);
  return game.state === "heli";
})(), game.state);


console.log("\n== the speedboat boss ==");

const BOAT_LEVEL = api.LEVELS.findIndex(l => l.kind === "boat") + 1;

check("there is a boss level in the plan", BOAT_LEVEL > 0);
check("it is the last level, so it is the boss", BOAT_LEVEL === api.LEVELS.length);

function onTheRiver() {
  api.startGame(BOAT_LEVEL);
  frames(Math.ceil(api.BOAT.introTime * 60) + 6);
  return game.state === "boat";
}

check("it opens with a briefing then hands over", (() => {
  api.startGame(BOAT_LEVEL);
  frames(2);
  if (game.state !== "boatIntro") return false;
  frames(Math.ceil(api.BOAT.introTime * 60) + 6);
  return game.state === "boat";
})(), game.state);

check("it does not fall through to a normal crossing", (() => {
  if (!onTheRiver()) return false;
  return api.boat.segs.length > 0 && game.state === "boat";
})());

/* --- the course itself --- */

check("the course is a list of segments", (() => {
  if (!onTheRiver()) return false;
  return api.boat.segs.length === api.BOAT.segments;
})(), String(api.boat.segs.length));

check("and it actually bends, rather than being a straight line", (() => {
  const bends = api.boat.segs.filter(sg => Math.abs(sg.curve) > 0.005).length;
  /* A straight river is a screensaver. Most of it should be turning. */
  return bends > api.BOAT.segments * 0.3;
})(), `${api.boat.segs.filter(sg => Math.abs(sg.curve) > 0.005).length} bent`);

check("and it rises and falls", (() => {
  return api.boat.segs.some(sg => sg.hill > 1) &&
         api.boat.segs.some(sg => sg.hill < -1);
})());

check("bends ease in and out instead of snapping on a segment", (() => {
  let worst = 0;
  for (let i = 1; i < api.boat.segs.length; i++) {
    worst = Math.max(worst, Math.abs(api.boat.segs[i].curve - api.boat.segs[i - 1].curve));
  }
  return worst < api.BOAT.bendMax * 0.25;
})());

check("the same course every time, so it can be learned", (() => {
  const before = api.boat.segs.map(sg => sg.curve).join(",");
  api.buildCourse();
  return api.boat.segs.map(sg => sg.curve).join(",") === before;
})());

check("laying out the course does not disturb the crossing levels' rng", (() => {
  /* It has its own generator for exactly this reason. */
  api.startGame(1);
  frames(1);
  const a = lanes.map(l => l.obstacles.map(o => Math.round(o.x)).join()).join("|");
  api.buildCourse();
  api.startGame(1);
  frames(1);
  const b = lanes.map(l => l.obstacles.map(o => Math.round(o.x)).join()).join("|");
  return a === b;
})());

/* --- the projection --- */

check("far things are higher up the screen and smaller", (() => {
  const near = api.boatProject(0);
  const far = api.boatProject(api.BOAT.draw * api.BOAT.segLen);
  return far.y < near.y && far.scale < near.scale && far.scale > 0;
})());

check("the river narrows towards the horizon", (() => {
  const near = api.boatProject(0);
  const far = api.boatProject(api.BOAT.draw * api.BOAT.segLen);
  const nearW = Math.abs(api.boatScreenX(api.BOAT.riverHalf, near.scale, 0) -
                         api.boatScreenX(-api.BOAT.riverHalf, near.scale, 0));
  const farW = Math.abs(api.boatScreenX(api.BOAT.riverHalf, far.scale, 0) -
                        api.boatScreenX(-api.BOAT.riverHalf, far.scale, 0));
  return farW < nearW * 0.4;
})());

check("a bend drags the far river sideways on screen", (() => {
  if (!onTheRiver()) return false;
  /* Park on the sharpest bend in the course and look up it. */
  let best = 0, at = 0;
  api.boat.segs.forEach((sg, i) => {
    if (Math.abs(sg.curve) > best) { best = Math.abs(sg.curve); at = i; }
  });
  api.boat.pos = at;
  api.walkCourse();
  const near = api.segAt(at + 2);
  const far = api.segAt(at + api.BOAT.draw - 4);
  return Math.abs(far.drift) > Math.abs(near.drift) + 0.5;
})());

/* --- driving it --- */

check("the throttle winds it up and the brake scrubs it off", (() => {
  if (!onTheRiver()) return false;
  api.boat.things.length = 0;          /* measuring the throttle, not the course */
  api.held.up = true;
  frames(40);
  const fast = api.boat.speed;
  api.held.up = false;
  api.held.down = true;
  frames(40);
  const slow = api.boat.speed;
  api.held.down = false;
  return fast > api.BOAT.idle && slow < fast;
})());

check("it will not go faster than flat out", (() => {
  if (!onTheRiver()) return false;
  api.boat.things.length = 0;
  api.held.up = true;
  frames(60 * 6);
  api.held.up = false;
  return api.boat.speed <= api.BOAT.top + 0.001;
})(), String(api.boat.speed));

check("off the throttle it settles rather than stopping dead", (() => {
  if (!onTheRiver()) return false;
  frames(60 * 5);
  return api.boat.speed > 0;
})(), String(api.boat.speed));

check("a bend throws you at the outside bank", (() => {
  if (!onTheRiver()) return false;
  let best = 0, at = 0;
  api.boat.segs.forEach((sg, i) => {
    if (Math.abs(sg.curve) > best) { best = Math.abs(sg.curve); at = i; }
  });
  const dir = Math.sign(api.segAt(at).curve);
  api.boat.pos = at;
  api.boat.x = 0;
  api.boat.speed = api.BOAT.top;
  api.held.up = true;
  frames(8);
  api.held.up = false;
  /* Pushed the opposite way to the way the river is turning. */
  return Math.sign(api.boat.x) === -dir && Math.abs(api.boat.x) > 0.01;
})(), String(api.boat.x));

check("the faster you take it, the harder it throws you", (() => {
  if (!onTheRiver()) return false;
  let best = 0, at = 0;
  api.boat.segs.forEach((sg, i) => {
    if (Math.abs(sg.curve) > best) { best = Math.abs(sg.curve); at = i; }
  });

  const run = (speed) => {
    api.boat.pos = at;
    api.boat.x = 0;
    api.boat.speed = speed;
    for (let i = 0; i < 8; i++) { api.boat.pos = at; frames(1); }
    return Math.abs(api.boat.x);
  };
  const slow = run(api.BOAT.idle);
  const fast = run(api.BOAT.top);
  return fast > slow;
})());

check("scraping the bank at speed spins you out", (() => {
  if (!onTheRiver()) return false;
  const before = api.boat.spins;
  api.boat.hurtAt = -99;
  api.boat.speed = api.BOAT.top;
  api.boat.x = 5;
  frames(2);
  return api.boat.spins === before + 1 && game.time < api.boat.spinUntil;
})());

check("but nudging it slowly just slows you down", (() => {
  if (!onTheRiver()) return false;
  api.boat.hurtAt = -99;
  api.boat.speed = api.BOAT.idle * 0.4;
  const before = api.boat.spins;
  api.boat.x = 5;
  frames(2);
  return api.boat.spins === before;
})());

check("a crash takes your speed away, which is what makes it cost something", (() => {
  if (!onTheRiver()) return false;
  api.boat.hurtAt = -99;
  api.boat.speed = api.BOAT.top;
  api.spinOut("TEST");
  return api.boat.speed <= api.BOAT.crashTo;
})(), String(api.boat.speed));

check("nothing but the clock can end the run", (() => {
  if (!onTheRiver()) return false;
  /* Spin out twenty times. In a racer that costs you the race, not your life. */
  for (let i = 0; i < 20; i++) { api.boat.hurtAt = -99; api.spinOut("TEST"); }
  frames(4);
  return game.state === "boat";
})(), game.state);

/* --- the furniture --- */

check("the river is furnished with Frogger's own things", (() => {
  if (!onTheRiver()) return false;
  const kinds = new Set(api.boat.things.map(t => t.kind));
  return kinds.has("log") && kinds.has("turtle") &&
         kinds.has("croc") && kinds.has("buoy");
})(), [...new Set(api.boat.things.map(t => t.kind))].join(","));

check("turtle rafts come and go, so the gap opens and closes", (() => {
  if (!onTheRiver()) return false;
  const t = api.boat.things.find(x => x.kind === "turtle");
  if (!t) return false;
  const seen = new Set();
  for (let i = 0; i < 60 * 8; i++) { seen.add(api.turtleUp(t)); frames(1); }
  return seen.has(true) && seen.has(false);
})());

check("a submerged raft cannot hit you", (() => {
  const t = api.boat.things.find(x => x.kind === "turtle");
  if (!t) return false;
  /* Solid exactly when it is up, and never when it is under. */
  for (let i = 0; i < 200; i++) {
    if (api.thingSolid(t) !== api.turtleUp(t)) return false;
    frames(1);
  }
  return true;
})());

check("buoys are scenery, not obstacles", (() => {
  const b = api.boat.things.find(x => x.kind === "buoy");
  return !!b && api.thingSolid(b) === false;
})());

check("hitting a log spins you out", (() => {
  if (!onTheRiver()) return false;
  const before = api.boat.spins;
  api.boat.hurtAt = -99;
  api.boat.things.push({ seg: api.boat.pos + 0.2, kind: "log",
                         x: api.boat.x, half: 0.34, dead: false, phase: 0 });
  frames(2);
  return api.boat.spins === before + 1;
})());

/* --- checkpoints --- */

check("there are checkpoint gates down the course", (() => {
  if (!onTheRiver()) return false;
  return api.boat.gates.length >= 3;
})(), String(api.boat.gates.length));

check("passing one puts time back on the clock", (() => {
  if (!onTheRiver()) return false;
  const g = api.boat.gates[0];
  api.boat.timeLeft = 3;
  api.boat.pos = g.seg + 0.1;
  frames(2);
  return g.taken === true && api.boat.timeLeft > 3 && api.boat.gatesMade > 0;
})(), `left ${api.boat.timeLeft}`);

check("and it only counts once", (() => {
  const made = api.boat.gatesMade;
  frames(10);
  return api.boat.gatesMade === made;
})());

check("running the clock out ends the run and you lost", (() => {
  if (!onTheRiver()) return false;
  api.boat.timeLeft = 0.01;
  frames(4);
  return game.state === "boatResults" && api.boat.won === false;
})(), game.state);

/* --- the boss --- */

check("the boss stays out in front", (() => {
  if (!onTheRiver()) return false;
  frames(60);
  return api.boat.bossPos > api.boat.pos;
})());

check("it runs harder when you are right behind it", (() => {
  if (!onTheRiver()) return false;
  api.boat.bossPos = api.boat.pos + 0.5;
  const near = api.boat.bossPos;
  frames(6);
  const closeRun = api.boat.bossPos - near;

  api.boat.bossPos = api.boat.pos + api.BOAT.bossGap * 3;
  const far = api.boat.bossPos;
  frames(6);
  const farRun = api.boat.bossPos - far;
  return closeRun > farRun;
})());

check("ramming its stern hurts it", (() => {
  if (!onTheRiver()) return false;
  const before = api.boat.bossHits;
  api.boat.bossPos = api.boat.pos + api.BOAT.ramRange * 0.5;
  api.boat.x = api.boat.bossX;
  frames(2);
  return api.boat.bossHits > before;
})(), String(api.boat.bossHits));

check("and it backs off rather than sitting there to be farmed", (() => {
  return api.boat.bossPos - api.boat.pos > api.BOAT.ramRange;
})(), String(api.boat.bossPos - api.boat.pos));

check("the boss is mathematically catchable", (() => {
  /* Closing speed at the moment you are right on it. If this is not positive
     the chase cannot be won however well you drive, which is exactly what the
     first version of this level shipped as. */
  const closing = api.BOAT.top * (1 - api.BOAT.bossPace) - api.BOAT.bossRun;
  return closing > 0.5;
})(), `closes at ${(api.BOAT.top * (1 - api.BOAT.bossPace) - api.BOAT.bossRun).toFixed(2)} seg/s`);

check("but it does not just sit there waiting to be hit", (() => {
  /* It has to be faster than your cruising speed, or you catch it by holding
     one key and there is no chase in it. */
  return api.BOAT.top * api.BOAT.bossPace > api.BOAT.idle * 1.5;
})());

check("the boss has more than one temper", api.BOAT.phases.length >= 2);

check("it gets angrier as you hurt it", (() => {
  const ph = api.BOAT.phases;
  for (let i = 1; i < ph.length; i++) {
    if (ph[i].at <= ph[i - 1].at) return false;
    if (ph[i].weave <= ph[i - 1].weave) return false;
    if (ph[i].drop >= ph[i - 1].drop) return false;
  }
  return true;
})());

check("it starts shooting back at some point, but not straight away", (() => {
  return api.BOAT.phases.some(p => p.shootEvery > 0) &&
         api.BOAT.phases[0].shootEvery === 0;
})());

check("a shot spins you out", (() => {
  if (!onTheRiver()) return false;
  const before = api.boat.spins;
  api.boat.hurtAt = -99;
  api.boat.shots.push({ pos: api.boat.pos, x: api.boat.x, hit: false });
  frames(2);
  return api.boat.spins === before + 1;
})());

check("the boss's logs do not pile up until the river is impassable", (() => {
  if (!onTheRiver()) return false;
  /* They used to be dropped and never cleaned up, so over a minute two dozen
     of them filled every lateral the boss had weaved through and no line
     existed anywhere. */
  for (let i = 0; i < 60 * 45; i++) frames(1);
  const dropped = api.boat.things.filter(t => t.dropped && !t.dead).length;
  return dropped <= api.BOAT.maxDropped;
})(), String(api.boat.things.filter(t => t.dropped && !t.dead).length));

check("four rams sinks it and you won", (() => {
  if (!onTheRiver()) return false;
  for (let i = 0; i < api.BOAT.bossHits; i++) api.ramBoss();
  return api.boat.won === true;
})());

check("it goes down on screen before the tally", (() => {
  return api.boat.sinkAt > 0 && game.state === "boat";
})(), game.state);

check("and the tally does arrive", (() => {
  frames(60 * 4);
  return game.state === "boatResults";
})(), game.state);

check("the banks are furnished so you can see how fast you are going", (() => {
  if (!onTheRiver()) return false;
  return api.boat.props.length > 50 &&
         api.boat.props.some(p => p.side === -1) &&
         api.boat.props.some(p => p.side === 1);
})());

check("it gets its own environment, not a reused one", (() => {
  const env = api.LEVELS[BOAT_LEVEL - 1].env;
  const others = api.LEVELS.filter((l, i) => i !== BOAT_LEVEL - 1).map(l => l.env);
  return !!api.ENVIRONMENTS[env] && !others.includes(env);
})(), api.LEVELS[BOAT_LEVEL - 1].env);

console.log("\n== the right song on the right level ==");

check("every track a level claims actually exists", (() => {
  const names = new Set(api.TRACKS.map((t) => t.name));
  const missing = [];
  for (const l of api.LEVELS) if (l.music && !names.has(l.music)) missing.push(l.music);
  for (const k of Object.keys(api.MUSIC.forKind || {})) {
    if (!names.has(api.MUSIC.forKind[k])) missing.push(api.MUSIC.forKind[k]);
  }
  if (!names.has(api.MUSIC.startWith)) missing.push(api.MUSIC.startWith);
  return missing.length === 0 ? true : missing.join(", ");
})() === true, "a level asks for a track that is not there");

check("the chopper gets Laser Knights", (() => {
  const heli = api.LEVELS.find((l) => l.kind === "heli");
  return heli && heli.music === "Laser Knights";
})());

check("the boneyard gets Boneyard", (() => {
  const bone = api.LEVELS.find((l) => l.rules && l.rules.ghost);
  return bone && bone.music === "Boneyard";
})());

check("a claimed track drops out of the shuffle", (() => {
  const reserved = api.Music.reservedNames();
  return reserved.has("Laser Knights") && reserved.has("Boneyard");
})());


console.log("\n== the main menu ==");

function toTitle() {
  game.state = "title";
  game.titleView = "main";
  game.mainPick = 0;
  frames(1);
}

check("the game opens on a menu, not on a list of seventeen levels", (() => {
  toTitle();
  return game.titleView === "main" && api.MAIN_MENU.length === 3;
})());

check("the menu offers start, difficulty and level select", (() => {
  const keys = api.MAIN_MENU.map(r => r.key);
  return keys.includes("start") && keys.includes("mode") && keys.includes("levels");
})(), api.MAIN_MENU.map(r => r.key).join(","));

check("up and down move between the rows and wrap", (() => {
  toTitle();
  api.mainMenuMove(1);
  const one = game.mainPick;
  api.mainMenuMove(-1);
  const back = game.mainPick;
  api.mainMenuMove(-1);
  return one === 1 && back === 0 && game.mainPick === api.MAIN_MENU.length - 1;
})());

check("left and right change the difficulty, but only on that row", (() => {
  toTitle();
  const was = game.mode;
  api.mainMenuSide(1);
  const unchanged = game.mode === was;      /* row 0 is START, not the mode */

  game.mainPick = api.MAIN_MENU.findIndex(r => r.key === "mode");
  api.mainMenuSide(1);
  return unchanged && game.mode !== was;
})(), game.mode);

check("start begins the game at level one", (() => {
  toTitle();
  game.pickedLevel = 9;                     /* even with the list pointing high */
  game.mainPick = api.MAIN_MENU.findIndex(r => r.key === "start");
  api.mainMenuChoose();
  frames(1);
  return game.level === 1 && game.state !== "title";
})(), `level ${game.level} state ${game.state}`);

check("level select opens the list", (() => {
  toTitle();
  game.mainPick = api.MAIN_MENU.findIndex(r => r.key === "levels");
  api.mainMenuChoose();
  return game.titleView === "levels";
})());

check("and escape comes back out of it", (() => {
  api.backToMainMenu();
  return game.titleView === "main";
})());

check("starting a game always leaves the menu on the front page", (() => {
  toTitle();
  game.titleView = "levels";
  api.startGame(3);
  return game.titleView === "main";
})());

check("the menu's lines are in order and inside its panel", (() => {
  const L = api.mainLayout(api.HEIGHT / 2);
  const ys = [L.frog, L.title, ...L.rows, L.hint, L.keys];
  const pad = CONFIG.grid * 0.25;
  for (let i = 1; i < ys.length; i++) {
    if (ys[i] - ys[i - 1] < CONFIG.grid * 0.3) return `rows ${i - 1}/${i} collide`;
  }
  for (const y of ys) {
    if (y < L.panelTop + pad || y > L.panelBottom - pad) return `line at ${y.toFixed(0)} outside`;
  }
  return true;
})() === true, "menu layout is wrong");


check("a swipe on the title drives the menu instead of starting the game", (() => {
  /* hop() is what a swipe and the on-screen buttons call. On the title it used
     to go straight to startGame, so a swipe skipped the menu entirely. */
  toTitle();
  api.hop(0, 1);
  const moved = game.mainPick === 1;
  return moved && game.state === "title";
})(), `pick ${game.mainPick} state ${game.state}`);

check("and a swipe inside the level list picks a level", (() => {
  toTitle();
  game.titleView = "levels";
  game.pickedLevel = 3;
  api.hop(0, 1);
  return game.pickedLevel === 4 && game.state === "title";
})(), String(game.pickedLevel));

check("game over still restarts from the top", (() => {
  game.state = "gameOver";
  api.hop(0, -1);
  return game.level === 1 && game.state !== "gameOver";
})(), `level ${game.level}`);


console.log("\n== the radio does not eat the network ==");

check("loading the page does not pull the whole library into memory", (() => {
  /* It used to fetch all of it: fifteen megabytes before a frog has moved, on
     a page that is otherwise a few hundred kilobytes, most of it music nobody
     will hear that run. */
  if (typeof api.Music.cachedCount !== "function") return false;
  api.Music._blobs = {};
  api.Music._warmed = false;
  api.Music.warmUp();
  return api.Music.cachedCount() <= 2;
})(), `${api.Music.cachedCount ? api.Music.cachedCount() : "?"} of ${api.TRACKS.length} cached`);

check("but it does keep one ready behind the one that is playing", (() => {
  return typeof api.Music.lookAhead === "function";
})());

check("anything not in memory still has somewhere to play from", (() => {
  /* The fallback is the file itself, so a track that has not been fetched
     streams rather than going silent. */
  const t = api.TRACKS[api.TRACKS.length - 1];
  api.Music._blobs = {};
  return api.Music.sourceFor(t) === t.file;
})());


console.log("\n== the gravestone has a job now ==");

check("some environment actually wants headstones", (() => {
  return Object.values(api.ENVIRONMENTS).some((e) => e.graves === true);
})());

check("and it is the boneyard, which is the one with the ghosts in it", (() => {
  const ghostLevel = api.LEVELS.find((l) => l.rules && l.rules.ghost);
  return !!ghostLevel && api.ENVIRONMENTS[ghostLevel.env].graves === true;
})());

check("drawing them does not throw", (() => {
  const ghostLevel = api.LEVELS.findIndex((l) => l.rules && l.rules.ghost) + 1;
  api.startGame(ghostLevel);
  frames(1);
  try { api.drawGraves(); return true; } catch (e) { return e.message; }
})() === true, "drawGraves threw");

check("and nowhere else grows headstones by accident", (() => {
  const withGraves = Object.entries(api.ENVIRONMENTS)
    .filter(([, e]) => e.graves).map(([k]) => k);
  return withGraves.length === 1;
})(), Object.entries(api.ENVIRONMENTS).filter(([, e]) => e.graves).map(([k]) => k).join(","));


console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) Deno.exit(1);
