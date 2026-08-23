# 🐸 Frogger

The 1981 arcade game, rebuilt to be taken apart. Plain HTML, CSS and
JavaScript: no build step, no npm install, no framework. Open `index.html` in a
browser and it runs.

**▶ Play it: https://wstackable.github.io/frogger/**

![the game](docs/screenshot.png)

## What's in it

The actual arcade ruleset, not a demo of one.

**The board.** Five river rows and five road rows either side of the purple
median, laid out like the cabinet. Trucks nearest the median, then the fast
racing car, pink cars, bulldozers and taxis. Logs of three lengths and two rows
of turtles.

**The river is not just an obstacle course.** On the road you avoid everything.
On the river you have to be standing on something. That inversion halfway up
the screen is the whole design.

**The hazards, arriving as you climb the levels.**

| | |
|---|---|
| Diving turtles | groups that sink. They tuck in first as a warning, and only *alternating* groups dive, so there is always somewhere dry |
| The bonus fly | lands in a lilypad, worth 200 |
| The lady frog | rides a log. Hop onto her, carry her home, 200 more |
| A crocodile in a lilypad | jumping in kills you, unless it is still surfacing |
| Snakes | patrol the median from level 3, so the safe row stops being safe |
| River crocodiles | replace some logs. The back is a fine boat. The jaws are not |

**One frog clears a level.** The arcade wanted all five, which is a long haul
when you are playing in short bursts. There are still five lilypads to aim at,
but the level ends when you land in one. Set `baysToClear` to 5 for the arcade
rule.

**Two modes**, chosen with left and right on the title screen. The real
difference is how you get lives back.

| | |
|---|---|
| **Beginner** | 5 frogs, and they all come back every time you clear a level, so a rough patch never ends the run. The bank and a taken lilypad are harmless. |
| **Expert** | 3 frogs and no refills, ever. The only way back is the bonus fly, which is worth a whole frog and only turns up now and again. Full arcade rules. |

**A monster truck bonus round**, on the way into level 3 and every four levels
after. The frog gets into a monster truck, the rules stop applying, and the
river fills with boats. Nothing can hurt you: drive around flattening traffic
and ramming boats against the clock. Keep hitting things and a multiplier
climbs, the screen shakes harder, and debris goes everywhere. The engine is
synthesised live, so it idles lumpily when you are coasting, revs as you drive
and bites every time you connect with something. Then a tally, and a rank you
probably did not earn.

**Arcade scoring.** 10 a hop, 50 a frog home, 10 per remaining half-second,
200 for a fly, 200 for the lady frog, 1000 for clearing a level, a free frog
every 20,000.

**Difficulty that scales the way the original did.** Everything speeds up per
level, new kinds of hazard arrive, and every fifth level eases off slightly
before climbing again. Speed alone gets boring and then impossible; the new
hazards are what keep it interesting.

**Learnable, not random.** The traffic and the river run on fixed repeating
patterns, and the flies, crocodiles and lady frog come from a seeded generator
keyed to the level number. Level 3 plays the same way every time, so getting
better is actually possible. That was most of the appeal of the cabinet.

**It tells you why you died.** The arcade never explained itself, but the
arcade also had a queue of people watching over your shoulder. One line under
the splat is enough to teach the rule that catches everybody: on the river you
have to be standing on something.

**A radio and a colour switcher**, same controls as Phoenix 89. **R** changes
track, **M** mutes, **C** cycles the colour palette. It plays whatever is in
`music/`, plus five tunes written out as notes in the source and generated in
the browser. Two of those, *Yankee Doodle* and *Camptown Races*, are tunes the
actual cabinet played. The bonus round borrows the radio for its own track and
hands it back afterwards.

Plus lives, a 30 second timer, a high score that sticks, pause, keyboard,
swipe, on-screen buttons on phones, and sound effects with no audio files.

## Playing

| | |
|---|---|
| Move | Arrow keys, WASD, or swipe. In the bonus round, **hold** them to drive |
| Pick a mode | Left and right on the title screen |
| Start / pause | Space, Enter, or tap. **P** also pauses |
| New game | **N** |
| Change music | **R**, or the ♪ button |
| Mute music | **M**, or the 🔊 button |
| Change colours | **C**, or the 🎨 button |

One piece of real strategy, straight from the arcade: **fill the lilypads from
left to right.** The top log row flows left to right and its gaps are wider
than a hop, so a lilypad behind you is gone. Take the left one while you can
and the last one left is the easy one.

## The files

```
index.html          the page. loads the six scripts in order.
css/style.css       the page around the game (the game itself is a canvas)
js/config.js    ←   START HERE. rules, board, difficulty, themes, palettes.
js/sprites.js   ←   THE PIXEL ART. every picture, drawn as letters.
js/music.js     ←   THE TUNES. the track list, and notes you can edit.
music/              the audio files themselves
js/render.js        turns art settings into pixels
js/audio.js         the beeps, generated in code
js/game.js          the engine: rules, collisions, scoring, the game loop
assets/             put your own drawings here
tests/              three suites. worth running. see below.
tools/              scan-music.js, which rebuilds the track list
```

Everything you would want to change is in **`js/config.js`**,
**`js/sprites.js`** and **`js/music.js`**, and all three are heavily
commented. The engine reads their values and hardcodes nothing.

## Customising it

See **[CUSTOMIZE.md](CUSTOMIZE.md)** for the guided version, written to be
followed by a kid sitting next to you. The short version:

**Edit the pixel art directly.** Every picture in the game is a grid of letters
in `js/sprites.js`. One letter is one pixel. This is the best part.

```js
frog: [
  '..gg........gg..',      // g is mid green
  '..gGg......gGg..',      // G is bright green
  '..gGGWW..WWGGg..',      // W is white, K is black, . is see-through
  ...
```

**Or switch the whole look with one line.**

```js
theme: 'arcade',    // the 1981 pixel look
theme: 'emoji',     // 🐸 🪵 🐢 🚗, for when the kids want silly
```

**Or add a colour palette to the C rotation.** Sunset Highway, Game Boy, Neon
Night, Ice World and Candy ship with it; a new one is a block of hex codes.

```js
{ name: 'Game Boy',
  bg:     { water: '#0f380f', road: '#081808', grass: '#8bac0f' },
  pixels: { G: '#9bbc0f', R: '#8bac0f', B: '#306230' } },
```

**Or add music.** Drop files into `music/` and run `deno task music`. That
rewrites the track list for you, so you never hand-edit it. Use `.m4a` or
`.mp3`: Safari and iOS will not play `.ogg`, and the scanner warns you if it
finds any.

**Or write your own tune from scratch.** One note per beat, `-` holds, `.`
rests.

```js
{ name: 'Hop To It', bpm: 132,
  lead: 'e5 .  g5 .  a5 -  g5 e5',
  bass: 'a2 -  a3 -  a2 -  a3 -',
  drum: 'x  .  h  .  x  .  h  h' },
```

**Or drop in your own drawings.** Draw a frog on paper, photograph it, save a
PNG in `assets/`, and point one line at it.

```js
frog: { draw: 'image', src: 'assets/my-frog.png' },
```

**Turn the difficulty up or down without touching any logic.**

```js
lives: 5,
timeLimit: 30,
rules: {
  bankIsDeath: true,        // false is much kinder for younger kids
  occupiedBayIsDeath: true,
  divingTurtles: true,
},
```

**Move a hazard to a different level, or switch it off.**

```js
snakeFromLevel: 3,     // 1 for straight away, 99 for never
gatorFromLevel: 3,
```

**Redesign the board.** Each row is one line.

```js
{ type: 'river', kind: 'turtle', length: 3, spacing: [2], speed: -1, dive: 'alternate' },
//              ^ which art     ^ group of 3 ^ gaps      ^ direction  ^ only every other
//                                                          and speed    group sinks
```

## Running it

Double-clicking `index.html` works, because the scripts are plain scripts
rather than ES modules. To serve it properly:

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```

## Tests

Three suites, and they are genuinely worth running once you start changing
things. They need [Deno](https://deno.com); nothing else in the project does.

```bash
deno task test          # the rules: what kills you, what scores, what unlocks when
deno task test:play     # a bot plays the game and reports how far it got
deno task test:browser  # real Chrome, real key presses, real audio, real rendering
deno task test:all

deno task music         # rebuild the track list from the music/ folder
```

The middle one is the interesting one. **"Is this game fair?" is not a question
you can answer by reading code**, so a small bot reads the board the way a
player would and sends real arrow keys, then reports frogs home, deaths, and
which row killed it. It earned its keep immediately: an early version of this
game had whole rows of turtles diving at once, leaving nothing to stand on. The
bot found it, and the test that now guards against it asserts that every river
row always has somewhere dry to stand.

## Credit and licence

The lane and pattern system started from
[straker's Basic Frogger](https://gist.github.com/straker/82a4368849cbd441b05bd6a044f2b2d3),
released under CC0. Everything else, including all of the pixel art and the
music, was written for this project. The behaviour was matched against
[Wikipedia's description of the arcade game](https://en.wikipedia.org/wiki/Frogger)
and [Prime Time Amusements' strategy guide](https://primetimeamusements.com/getting-good-frogger/).

Three things from the original are deliberately missing. **Otters**, which tip
one end of a log into the water. **Two-player alternating mode**. And most of
the soundtrack: Konami's medley was built from existing tunes, and while
*Yankee Doodle* and *Camptown Races* are out of copyright and are included, the
famous opening jingle (*Inu no Omawarisan*, Yoshimi Sato, 1960) and the main
theme (the opening of the anime *Araiguma Rascal*) are not, so they are not
here. The home ports had to replace them for exactly the same reason.

Frogger is a trademark of Konami. This is a hobby reimplementation for
learning, not affiliated with or endorsed by them, and none of the artwork is
theirs.

**Music.** *Box Jump* is from the *Three Red Hearts* pack by
[Abstraction](https://abstractionmusic.com), released CC-0 through
[Tallbeard Studios](https://tallbeard.itch.io/three-red-hearts-prepare-to-dev):
no attribution required, but it deserves the credit. *Mountain Climbing*
carries over from Phoenix 89. The remaining tracks in `music/` were added by
the repository owner. The written-out tunes are in `js/music.js` and are ours.

The code is licensed under [CC0 1.0](LICENSE). Do whatever you like with it.
