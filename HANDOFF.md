# Handoff / continue here

Everything needed to pick this up on another machine. Written for a fresh
Claude Code session with no memory of the previous conversation.

```bash
git clone https://github.com/wstackable/frogger.git
cd frogger
python3 -m http.server 8000      # then open http://localhost:8000
```

Live build: **https://wstackable.github.io/frogger/**

---

## 1. What this is

A Frogger remake built to be **taken apart and customised with Will's kids**.
Plain HTML, CSS and JavaScript. No build step, no npm, no framework. Plain
`<script>` tags rather than ES modules, so double-clicking `index.html` works.

The point of the project is the customisation surface, not the game. If a
request can be satisfied by adding a config value or a theme entry, do that
rather than editing the engine. That is what makes it hackable by a child.

## 2. How Will wants to work

These are not guesses. He said each of them explicitly.

- **Push small and often.** He plays the live build while the next change is
  being written. Do not batch a large feature set into one commit. One coherent
  change, quick smoke check, push, repeat.
- **Light testing while prototyping.** His words: *"testing is good, but right
  now we are working on the basics of the game. we can refine and debug more
  after we get the basics right. let's focus on prototyping quickly and
  iterating."* Run the fast suite (seconds). Do not run the browser suite
  (minutes) on every change. If test scaffolding breaks, revert it rather than
  debugging it.
- **No em dashes** in any prose, comments or docs. Use commas, full stops or
  brackets.
- **Explain trade-offs before asking him to choose.** He will decline a
  multiple-choice question that does not tell him what each option costs.
- **Controls mirror his other game, Phoenix 89** (`wstackable/phoenix89`), on
  purpose, so there is one set of keys to remember: `R` next track, `M` mute,
  `C` next colour palette. Frogger adds `N` new game and `Esc` pause menu.
  If he says "like the Phoenix game", go and read that repo rather than guess.

## 3. File map

```
index.html            loads the six scripts in order
css/style.css         the page around the game
js/config.js      ←   START HERE. rules, levels, environments, palettes, themes
js/sprites.js     ←   ALL the pixel art, as grids of letters
js/music.js           the radio. track list is generated, see below
js/render.js          turns art settings into pixels
js/audio.js           sound effects and the synthesised engine
js/game.js            the engine: rules, collisions, scoring, the loop
music/                audio files. top level only, see below
tools/scan-music.js   rebuilds the track list from music/
tests/                three suites, see section 7
docs/                 screenshots for the README
```

Roughly 5,000 lines of JS. `js/game.js` is the big one.

## 4. Key structures in `js/config.js`

**`LEVELS`** is the whole game, one line per level. This is the most important
structure in the project.

```js
{ name: 'First Hop', blurb: 'two lanes, fat logs, nothing bites. a free win.',
  kind: 'cross', env: 'pond',
  speed: 0.62, roadLanes: 2, river: 'wide', hazards: [] },
```

- `kind` is `'cross'` (normal crossing), `'truck'`, `'heli'`, `'rocket'` or
  `'boat'`
- `roadLanes` is how many lanes of traffic are on, counting up from the start
- `river` is `'wide' | 'easy' | 'normal' | 'tight'`, which sets log length and
  gap size
- `hazards` from `'fly' | 'lady' | 'bayCroc' | 'snake' | 'gator' | 'diving'`
- `rules` for twists: `{ ice: true }`, `{ dark: true }`, `{ ghost: true }`
- `music` claims a track, which automatically removes it from the shuffle

Past the end of the list, `LEVEL_LOOP` repeats the last stretch with the speed
still climbing.

**`ENVIRONMENTS`** recolour the board per level and can swap sprites outright
(`art: { log: 'iceFloe' }` keeps how a log is drawn and changes only the
picture). Eight of them, and no two consecutive levels use the same one.

**`MODES`** is beginner and expert. The real difference is how lives come back:
beginner refills every level, expert never does and the bonus fly is worth a
whole frog.

**`MUSIC`, `BONUS`, `HELI`, `ROCKET`, `TWISTS`, `CREDITS`, `VICTORY`** are the
tuning tables for everything else.

## 5. What is already built

**Core.** Full arcade ruleset: five river rows, five road rows, log and turtle
riding, diving turtle groups, five lilypads, lives, 30s timer, arcade scoring,
bonus fly, lady frog, river crocodiles, lilypad crocodile, median snakes. One
frog clears a level (`baysToClear`, set it to 5 for the arcade rule).

**17 levels** with names and one-line descriptions, and difficulty that starts
genuinely easy and ramps.

**A main menu.** START GAME, DIFFICULTY, LEVEL SELECT. The level list lives
behind the third one. `titleMove` and `titleChoose` are the only two entry
points, shared by keyboard and touch.

**Special levels.** Monster truck rampage (free driving, smash everything,
combo multiplier, and it becomes a speedboat with a prop and a bow wave the
moment it hits the river). Helicopter (free flight, gun fires the way you fly,
aliens that chase and shoot back, two hits ends it). Rocket (line up, launch,
climb on a booster you can run out of, hover on the median, dodge the traffic,
collect stars, land on a free lilypad). Speedboat boss run, which is its own
thing and has its own section below.

**Twists on a normal crossing.** Ice (leaving solid ground commits you and the
frog glides rather than hops; `iceStep` per level, and Deep Freeze runs at
about half the usual). Dark (a lantern on a wire and headlights thrown ahead of
each car; Blackout takes the headlights away). Ghost (the world only moves when
you do, and the ghosts move with it). Airless (Orbital Traffic, where the clock
is a small tank and pockets of air drift past to refill it).

**Presentation.** Escape pause menu, victory screen with a credits roll, a
between-levels card that names and describes what is coming, per-level banners,
screen shake, debris, floating scores, a small effects layer for the crossing
levels, synthesised engine with a profile per machine, layered impact sounds,
nine environments, six manual colour palettes on `C`.

## 5b. The speedboat boss run

The only level not drawn on the top-down grid, and the only one with its own
renderer, so it gets its own section.

It is built the way pseudo-3D racers have been built since Pole Position. The
river is a list of segments in `boat.segs`, each carrying a `curve` and a
`hill`. `walkCourse()` walks them from the bow to the horizon once a frame,
accumulating both, and stashes each segment's scale, screen position and
lateral drift on the segment itself. Everything else, the water ribbon, the
banks, a log, the boss, is "which segment, how far across", looked up through
`thingView()`.

Things worth knowing before you change it:

- **The bends are the game.** `centrifugal` is set to roughly six tenths of
  what `steer` can hold at full curve and flat out. Push it higher and the
  river pins you to the bank with nothing you can do about it.
- **The boss's speed is solved, not guessed.** It runs at `bossPace` times your
  speed plus up to `bossRun` when you are on it, so the closing speed at point
  blank is `top * (1 - bossPace) - bossRun`. If that is not positive the chase
  cannot be won at all, which is exactly how the first version shipped. There
  is a test on it.
- **It also cannot be left behind.** `bossMin` keeps it in front of you.
- **Its dropped logs are culled.** They used to accumulate until every lateral
  was covered and no line existed.
- **The furniture is laid as one ordered run** with `hazardGap` between items,
  not as several independent sequences. Independent sequences can coincide and
  wall the river off.
- **Nothing but the clock ends the run.** Hitting something spins you out and
  costs you your speed, which costs time. Checkpoint gates put time back.

## 6. What is left

Everything the previous handoff listed under "what is left" has been done: the
per-level pass, the speedboat boss, the music preload, the browser test's
engine assertion and the orphan gravestone.

What is worth doing next, in no particular order:

### 6a. Play it with the kids and write down what they say

That is the only remaining source of truth. Most of what improved this build
came from Will playing it for twenty minutes and sending short, blunt messages
about what felt wrong. Nothing in here beats that.

Known soft spots that have not had a real player on them yet:

- The boss run's difficulty was tuned against a bot, not a person. `bossHits`,
  `hazardGap` and the `phases` table are the knobs.
- Orbital Traffic's `AIR.tank` is a guess at "a clean run makes it, a hesitant
  one does not". The bot crosses in two seconds and never needed a pocket, so
  it could not judge it.
- Deep Freeze at `iceStep: 0.25` may be too much.

### 6b. The music licensing question

Three tracks in `music/` are named like YouTube "no copyright" downloads, which
usually means credit required rather than public domain, and this repo is
public. Still unresolved. Ask Will.

### 6c. Smaller things

- `tests/browser.test.js` is the slow suite and only runs by hand. Worth
  wiring into whatever CI ever exists.
- The crossing levels' effects layer (`game.fx`) is two shapes, a puff and a
  ring. Anything wanting a third shape adds it there rather than inventing a
  new system.

## 7. Running the tests

```bash
deno task test          # mechanics. ~270 checks, a few seconds. USE THIS ONE.
deno task test:play     # a bot plays every level and reports how far it got
deno task test:browser  # real Chrome over CDP. minutes. before a push only.
deno task music         # rebuild the track list from music/
```

`tests/harness.js` stubs enough of a browser (canvas, audio context, timers)
to run the real game files in Deno. `tests/playability.test.js` is the
interesting one: a bot reads the board like a player and sends real arrow keys,
then reports frogs home, deaths and which row killed it. It has caught two
genuinely unwinnable levels that read fine in the config.

Deno is only needed for tests and the music scanner. Nothing else uses it.

## 8. Hard-won gotchas. Read this section.

Each of these cost real time to find.

- **Safari and iOS cannot play `.ogg` or `.opus` at all.** An ogg-only track is
  silence on an iPad with no visible error. Convert:
  `ffmpeg -i in.ogg -c:a aac -b:a 128k out.m4a`. The music scanner warns about
  it and a test fails on it.
- **Every `Art.of('kind')` needs an entry in every theme** in `THEMES`, or it
  returns null and `drawArt` silently draws nothing. This made the helicopter,
  its bullets, the rocket and the ghosts all invisible at once. A test now reads
  `js/game.js`, extracts every `Art.of()` literal, and fails on a missing one.
- **In tests, moving obstacles off screen does not clear a lane.** The wrap
  logic pulls them straight back. Set `lane.active = false` instead.
- **`Number(null)` is `0`.** A missing localStorage value read as "the player
  chose index 0" and silently defeated the configured opening track.
- **`Engine.start()` is a no-op while already running**, so going straight from
  one special level into another kept the previous machine's engine sound.
  Stop before switching profile.
- **Pass `--mute-audio` to headless Chrome** in tests and screenshot scripts, or
  the game's music plays out of the speakers. WebAudio still renders while
  muted, so an AnalyserNode can still measure output.
- **Pushes to this repo often fail the first time** with HTTP 408 and succeed on
  retry. `http.postBuffer` is not the fix, whatever Stack Overflow says. Just
  retry. There are no SSH keys on Will's machine and the `gh` token cannot add
  one.
- **An empty road row is harmless. An empty river row is lethal.** That is why
  early levels get easier by switching traffic lanes off and making logs longer,
  never by emptying the water.
- **River rows must alternate direction.** Log gaps are wider than one hop, so
  if every row flowed the same way an upstream lilypad would be unreachable and
  a level could be unfinishable.
- **When the playability bot says a level is impossible, suspect the bot
  first.** It plans one hop at a time. It called Deep Freeze unwinnable twice;
  both times the level was fine and the bot did not understand the mechanic.
  Teach it the mechanic, then believe it.
- **`x || 1` is a bug wherever 0 is a legal value.** A coiling snake sets its
  speed scale to 0, `ob.speedScale || 1` read that as full speed, and the snake
  slid along while claiming to be frozen. Same family as `Number(null)` being 0.
- **Set a state and the thing that state implies in the same place.** The snake
  set its mood in one branch and its speed in the next case down, so there was
  always one frame where it was coiled and still moving. One frame is visible.
- **A mid-air state has to be left cleanly.** Landing the last rocket returned
  from `updateRocket` without going through `resetRocket`, so `flying` stayed
  true into the next level. Nothing read it, so nothing broke, until something
  did.
- **Anything a level spawns has to be culled.** The boss dropped a log every
  couple of seconds and nothing removed them. After a minute the river was
  impassable and it looked like a difficulty problem.
- **Two positioning schemes on one screen will eventually meet.** The level
  blurb measured down from the bottom of the level list and the controls line
  measured down from the middle of the screen, and as the list grew they landed
  on the same pixel. Every screen's layout is one function now, and there are
  tests that no two lines collide.
- **A light source centred on a thing lights the thing.** The dark levels
  looked 97% black in the config and fully readable on screen, because every
  car's headlight was a round hole centred on the car. Throw the beam ahead.
- **Solve the chase, do not tune it.** If the pursued runs at `pace` times your
  speed plus `run` when close, you can only ever catch it if
  `top * (1 - pace) - run > 0`. Ours was negative and the boss was
  mathematically uncatchable. There is a test on that expression now.
- **Do not tune against a bot that ignores the mechanic.** The air level's tank
  size could not be judged by a bot that crosses in two seconds and never needs
  a pocket, and the boss run could not be judged by the hopping bot at all. Give
  the mechanic to the bot first, or admit the number is a guess and say so.
- **When the bot loses, suspect the bot, then suspect the level, in that
  order, but actually check.** The boss run bot was failing for three genuinely
  different reasons in a row: its own planner applied a bend correction after
  its collision check, then the boss was uncatchable, then the dropped logs
  were piling up. Only one of the three was the bot.
- **The board is laid out per level**, not at load. `applyPlan()` rebuilds every
  lane's obstacles. Anything caching obstacle positions across levels is wrong.

## 9. Credits and licensing

- Code is CC0. The lane and pattern system started from
  [straker's Basic Frogger](https://gist.github.com/straker/82a4368849cbd441b05bd6a044f2b2d3),
  also CC0.
- All pixel art was drawn for this project. None of it is Konami's.
- Music in `music/` was supplied by Will. `Mountain Climbing` carries over from
  Phoenix 89. Three tracks are named like YouTube "no copyright" downloads,
  which usually means credit required rather than public domain. **This is
  unresolved and worth asking him about**, since the repo is public.
- The credits roll names Kelli and Brady as creative directors, matching the
  Phoenix 89 convention.
