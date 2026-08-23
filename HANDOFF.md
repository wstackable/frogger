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

**17 levels** with names and one-line descriptions, a level selector on the
title screen (everything unlocked, up/down to pick), and difficulty that starts
genuinely easy and ramps.

**Special levels.** Monster truck rampage (free driving, smash everything,
combo multiplier). Helicopter (free flight, gun fires the way you fly, alien
attackers that chase and shoot back, armour rather than lives). Rocket (slide
along the bottom, launch, dodge the traffic on the way up, collect stars, land
on a free lilypad).

**Twists on a normal crossing.** Ice (leaving solid ground commits you, the
slide carries you forward, you only steer, the median is the one place you can
stop). Dark (a circle of light around the frog plus sweeping headlights, drawn
on a separate canvas so light is cut out of the darkness). Ghost (the world
only moves when you do, and the ghosts close in while it is frozen).

**Presentation.** Escape pause menu, victory screen with a credits roll,
per-level banners, screen shake, debris, floating scores, synthesised engine
with a profile per machine, layered impact sounds, eight environments, six
manual colour palettes on `C`.

## 6. What is left, in priority order

### 6a. The per-level research and polish pass (Will's main ask)

His words: *"go through each level and think about what would make that level
fun and engaging. Do research on arcade gameplay mechanics that are applicable
for each type of level. Example ghost levels. Then work to make the details
come together. Sound effects, little animations, simple but engaging gameplay
mechanics, etc."*

This has **not** been done. It is the biggest remaining item and he has asked
for it twice. Suggested approach:

1. Research the arcade lineage for each level type before touching code. Ghost
   houses (Super Mario World), vertical shooters, ice physics (Ice Climber,
   Pengo), rampage games (Rampage, Carmageddon), light/dark levels.
2. Go level by level. For each: what is the one idea that makes it worth
   playing, what small animation sells it, what sound sells it.
3. Push each level's pass separately so he can play them one at a time.

Known weak spots to look at first:
- **The rocket** was called "very boring" before the dodging and stars were
  added. Worth checking whether it is enough now.
- **Turtle Trouble, Snake Pit, Croc Alley, Orbital Traffic** are plain
  crossings that differ only in numbers. They need an idea each.
- Sound is thin outside the special levels. The normal crossing has hop, die,
  home, level and not much else.

### 6b. The first person speedboat boss level

`kind: 'boat'` exists in `LEVELS` (level 17, "Speedboat Boss Run") and is
**not implemented**. Entering it currently falls through to a normal crossing.

This is the one item that shares nothing with the existing code. Everything
else sits on top of the top-down grid; this needs a second renderer drawing a
river receding to a horizon with obstacles scaling up as they approach.

- Music is already reserved for it: `Speedboat Boss Run` in `music/`, wired
  through `MUSIC.forKind.boat`.
- Will asked for engine sound. `Engine` in `js/audio.js` takes a profile;
  add a `boat` one next to `truck`, `helicopter` and `rocket`. A boat wants a
  burbling low chug plus water noise.
- A cheaper middle option he was offered but never chose: the river scrolls
  toward you and obstacles scale up, without a true perspective grid. Roughly a
  third of the work and still reads as first person.

### 6c. Smaller outstanding items

- **Music bandwidth.** `Music.warmUp()` in `js/music.js` fetches every track
  into memory on load, which is about 15MB. Fetch the opening track plus maybe
  one lookahead and leave the rest on demand.
- **Browser test suite.** `tests/browser.test.js` is at an older revision
  because a restructuring of it was reverted rather than debugged. It passes,
  but the engine loudness assertion in it is timing sensitive: it calls
  `Engine.setThrottle` directly while the game loop overwrites the throttle
  every frame. The fix is to drive it through the real controls (set
  `game.state` and `held`) instead.
- **`gravestone` sprite** exists and is drawn nowhere. Either use it as boneyard
  scenery or delete it. A test fails if any sprite is unused, so it is
  currently referenced in the themes only to keep that test happy.

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
