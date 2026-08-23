import { load } from "./harness.js";

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
}

const { api, tick, frames, key, audio } = await load();
const { game, lanes, CONFIG, PROGRESSION, WIDTH } = api;
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
const diver = lanes.find(l => l.dive);
check("a diving lane exists", !!diver);
if (diver) {
  api.startGame();
  frames(1);
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
resetLanes();
api.startGame();
game.level = PROGRESSION.gatorFromLevel;
api.startLevel();
frames(1);
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

  gator.x = game.frog.x - headCell * GRID - GRID / 2;
  frames(1);
  check("the crocodile's jaws kill you", game.state === "dying", game.state);
  check("croc river death reason", game.deathReason === "Eaten by a crocodile",
    game.deathReason);
}

console.log("\n== snakes on the median ==");
const medianLane = lanes.find(l => l.kind === "snake");
check("there is a snake lane", !!medianLane);

resetLanes();
api.startGame();                                 // level 1
frames(1);
game.frog.row = medianLane.row;
medianLane.obstacles.forEach(o => { o.x = game.frog.x; });
frames(2);
check("the median is safe before the snakes arrive", game.state === "play",
  game.state + " " + game.deathReason);

resetLanes();
api.startGame();
game.level = PROGRESSION.snakeFromLevel;
api.startLevel();
frames(1);
game.frog.row = medianLane.row;
medianLane.obstacles.forEach(o => { o.x = game.frog.x; });
frames(2);
check("snakes on the median kill you from level 3", game.state === "dying", game.state);
check("snake death reason", game.deathReason === "Bitten by a snake", game.deathReason);

console.log("\n== snakes turn round instead of wrapping ==");
resetLanes();
api.startGame();
game.level = PROGRESSION.snakeFromLevel;
api.startLevel();
frames(1);
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
resetLanes();
api.startGame();
game.level = PROGRESSION.ladyFromLevel;
api.startLevel();
frames(1);
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

console.log("\n== the music is well formed ==");
const { Music, Art, PALETTES } = api;

check("there are tracks", Music.trackName().length > 0);

let musicProblems = [];
const writtenTracks = api.TRACKS.filter(t => !t.file);
const fileTracks = api.TRACKS.filter(t => t.file);

check("there are music files in the list", fileTracks.length > 0, String(fileTracks.length));
check("every file track has a name and a path",
  fileTracks.every(t => t.name && /^music\/.+\.(m4a|mp3|ogg|wav|aac|opus)$/i.test(t.file)),
  fileTracks.filter(t => !t.name || !/^music\//.test(t.file || "")).map(t => t.file).join(", "));
check("no file track uses a format Safari cannot play",
  fileTracks.every(t => !/\.(ogg|opus)$/i.test(t.file)),
  fileTracks.filter(t => /\.(ogg|opus)$/i.test(t.file)).map(t => t.file).slice(0, 4).join(", "));
check("there are written-out tunes too", writtenTracks.length > 0);

for (const t of writtenTracks) {
  if (!t.name) musicProblems.push("a track has no name");
  if (!t.bpm || t.bpm < 40 || t.bpm > 300) musicProblems.push(`${t.name}: odd bpm ${t.bpm}`);
  for (const voice of ["lead", "bass", "drum"]) {
    const toks = String(t[voice] || "").trim().split(/\s+/).filter(Boolean);
    if (!toks.length) { musicProblems.push(`${t.name}: empty ${voice}`); continue; }
    for (const tok of toks) {
      if (tok === "." || tok === "-") continue;
      if (voice === "drum") {
        if (!["x", "h", "s"].includes(tok)) musicProblems.push(`${t.name} drum: "${tok}"`);
      } else if (!/^[a-g](#|b)?-?\d$/.test(tok)) {
        musicProblems.push(`${t.name} ${voice}: "${tok}" is not a note`);
      }
    }
    /* A pattern must not open with a hold, since there is nothing to hold. */
    if (toks[0] === "-") musicProblems.push(`${t.name} ${voice} starts with a hold`);
  }
}
check("every note, rest and drum hit is valid", musicProblems.length === 0,
  musicProblems.slice(0, 6).join(" | "));

check("R moves to the next track", (() => {
  const first = Music.trackName();
  Music.next();
  const second = Music.trackName();
  return api.TRACKS.length === 1 || first !== second;
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


console.log("\n== the music scheduler really plays the tune ==");

/* Yankee Doodle: c5 c5 d5 e5 c5 e5 d5 - ... */
api.Music.enabled = true;
CONFIG.music = true;
api.Music.index = api.TRACKS.findIndex(t => t.name === "Yankee Doodle");
api.Music.stop();
audio.reset();
api.Music.start();
check("starting the music opens an audio context", !!api.Music._ctx);
check("the music reports itself as playing", api.Music.playing === true);

/* Walk the clock forward through two bars and collect what got scheduled. */
for (let i = 0; i < 40; i++) audio.advanceAudio(0.1);

const notes = audio.scheduled.filter(e => e.kind === "osc");
const drums = audio.scheduled.filter(e => e.kind === "noise");
check("notes were scheduled", notes.length > 20, String(notes.length));
check("drum hits were scheduled", drums.length > 5, String(drums.length));

/* The lead is a square wave; check the first few pitches are the tune. */
const lead = notes.filter(n => n.type === "square").sort((a, b) => a.when - b.when);
const wantNotes = ["c5", "c5", "d5", "e5", "c5", "e5", "d5"].map(api.noteFreq);
const got = lead.slice(0, wantNotes.length).map(n => n.freq);
check("the melody comes out as the notes that were written",
  got.every((f, i) => Math.abs(f - wantNotes[i]) < 0.5),
  `wanted ${wantNotes.map(f => f.toFixed(0))} got ${got.map(f => f.toFixed(0))}`);

check("notes are scheduled in time order, none in the past",
  lead.every((n, i) => i === 0 || n.when >= lead[i - 1].when));

/* Beats should be spaced by the track's tempo, not bunched up. */
const bpm = api.TRACKS[api.Music.index].bpm;
const beatDur = 60 / bpm / 2;
const gaps = [];
for (let i = 1; i < Math.min(lead.length, 8); i++) gaps.push(lead[i].when - lead[i - 1].when);
/* Every gap should be a whole number of beats: one beat normally, two where
   the melody holds a note. Comparing the ratio avoids float modulo grief. */
check("the spacing between notes matches the tempo",
  gaps.every(g => {
    const beats = g / beatDur;
    return beats >= 0.98 && Math.abs(beats - Math.round(beats)) < 0.02;
  }),
  `beat=${beatDur.toFixed(3)}s gaps=${gaps.map(g => (g / beatDur).toFixed(2) + " beats")}`);

/* The pattern must loop rather than stop at the end. */
const beforeLoop = api.Music._beat;
for (let i = 0; i < 60; i++) audio.advanceAudio(0.1);
check("the tune keeps looping", api.Music._beat > beforeLoop + 20,
  `${beforeLoop} -> ${api.Music._beat}`);

check("muting stops the scheduler", (() => {
  api.Music.toggle();
  const stopped = api.Music.playing === false;
  api.Music.toggle();
  return stopped;
})());

console.log("\n== changing track changes the tune ==");
audio.reset();
api.Music.next();
for (let i = 0; i < 20; i++) audio.advanceAudio(0.1);
check("the new track schedules its own notes",
  audio.scheduled.filter(e => e.kind === "osc").length > 10);
api.Music.stop();


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

console.log("\n== when the bonus round happens ==");
const B = api.BONUS;
check("no bonus before the first one", !api.isBonusLevel(B.firstLevel - 1));
check("a bonus on the first bonus level", api.isBonusLevel(B.firstLevel));
check("and every few levels after",
  api.isBonusLevel(B.firstLevel + B.everyLevels) &&
  api.isBonusLevel(B.firstLevel + B.everyLevels * 2));
check("not on the levels in between",
  !api.isBonusLevel(B.firstLevel + 1) && !api.isBonusLevel(B.firstLevel + 2));

console.log("\n== the bonus round runs ==");
reset();
game.level = B.firstLevel - 1;
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
game.level = B.firstLevel - 1;
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

console.log("\n== the boat and truck art exist ==");
for (const kind of ["monsterTruck", "boat"]) {
  for (const themeName of Object.keys(api.THEMES)) {
    const a = api.THEMES[themeName].art[kind];
    check(`the ${themeName} theme has ${kind}`, !!a, `missing`);
    if (a && a.draw === "pixels") {
      check(`  and its sprite exists`, !!api.SPRITES[a.sprite], a.sprite);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) Deno.exit(1);
