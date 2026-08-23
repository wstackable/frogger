# Making it yours 🐸

A list of things to change, easiest first.

Three files matter:

- **`js/config.js`** is the rules, the board, the difficulty and the palettes
- **`js/sprites.js`** is all the pixel art
- **`js/music.js`** is all the tunes

The loop for everything here is the same:

1. Open the file in a text editor
2. Change something
3. Save
4. Refresh the browser tab

If the game goes blank you have almost certainly deleted a comma or a bracket.
Press **F12**, click **Console**, and it will tell you which line. That is not a
disaster, it is how everyone does this.

---

## Level 1: draw your own frog

Open **`js/sprites.js`**. Every picture in the game is in there, drawn as a grid
of letters. One letter is one pixel.

```js
frog: [
  '................',
  '..gg........gg..',
  '..gGg......gGg..',
  '..gGGWW..WWGGg..',      // WW is an eye, K is the pupil
  '..gGGWK..KWGGg..',
  '..gGGGGGGGGGGg..',
  ...
```

- `.` means see-through, so the water shows behind it
- `G` is bright green, `g` mid green, `d` dark green
- `W` white, `K` black, `R` red, `Y` yellow, `P` pink, `C` cyan
- the full list is at the top of the file, in `PALETTE`

**Give the frog a hat.** Change the top row to `'....YYYYYYYY....'`.

**Make the frog angry.** Move the pupils to the inside corners.

**Every row must be the same length.** If one row is 15 characters and the rest
are 16, the picture comes out sheared. `deno task test` checks this for you if
you have Deno, and the browser console warns you if you do not.

## Level 2: recolour everything at once

The colours live in `PALETTE` at the top of `js/sprites.js`. Change one value
and every sprite using that letter changes with it.

```js
G: '#00e000',       // make this '#ff00ff' and the frog goes hot pink
R: '#f83800',       // the turtle shells
B: '#a86028',       // the logs
```

The flat background bands are separate, in the theme's `palette` in
`js/config.js`:

```js
water:  '#000098',
road:   '#000000',
grass:  '#00a800',
median: '#8000c0',
```

A sunset road, a purple river, a black-and-white game: all one-line changes.

## Level 3: switch to emoji, or make a new theme

At the top of `js/config.js`:

```js
theme: 'arcade',    // the 1981 pixel look
theme: 'emoji',     // 🐸 🪵 🐢 🚗 🚜 🚕
```

The emoji theme is a whole different set of art in the same file. Change any
glyph:

| Theme | frog | log | turtle | traffic |
|---|---|---|---|---|
| Space | 🚀 | ☄️ | 🛸 | 👽 👾 🌑 |
| Ocean | 🐠 | 🛶 | 🐋 | 🦈 🐙 🦑 |
| Dinosaurs | 🦖 | 🪨 | 🐢 | 🦕 🦴 🌋 |
| Breakfast | 🥞 | 🥓 | 🍳 | ☕ 🧇 🍩 |
| Your pets | 🐶 | 🦴 | 🐱 | 🚗 🚚 🚜 |

On a Mac, **Ctrl + Cmd + Space** opens the emoji picker.

> **Why `faces: 'left'` on some of them?** Most vehicle emoji point left. That
> line tells the game to flip the picture when the thing drives right, so cars
> never drive backwards. Delete the line if your art points at the viewer.

To make a brand new theme, copy either block in `THEMES`, give it a new name,
and set `theme:` to that name.

## Level 3b: change the music

Everything in the `music/` folder is in the radio. To change what plays, put
files in that folder and run:

```bash
deno task music
```

That rewrites the track list at the top of `js/music.js`. Do not hand-edit
between the `MUSIC-FILES` markers, because the next run overwrites it.

Only the **top level** of `music/` is scanned. So you can drop a whole pack of
fifty tracks into `music/big-pack/` and pick the good ones out by moving them
up a level, without deleting anything.

Use **.m4a** or **.mp3**. Safari and iOS cannot play `.ogg` at all, so an
ogg-only track is silence on an iPad. If you have ogg files, convert them:

```bash
cd music && for f in *.ogg; do ffmpeg -i "$f" -c:a aac -b:a 128k "${f%.ogg}.m4a" && rm "$f"; done
```

The scanner warns you if it finds any it is worried about.

The name shown in the game comes from the filename, with any `Artist - ` prefix
stripped. So `Three Red Hearts - Box Jump.m4a` shows up as `Box Jump`.

The bonus round uses one specific track, named in `BONUS.music` in
`js/config.js`. If you rename that file, update that line too, or the game
falls back to whatever was already playing.

## Level 3c: add a colour palette

Press **C** in the game to flip through them. They live in `PALETTES` at the
bottom of `js/config.js`.

```js
{
  name: 'Game Boy',
  bg: {                          // the flat background bands
    water: '#0f380f', road: '#081808', grass: '#8bac0f', median: '#306230',
  },
  pixels: {                      // what the pixel art letters mean
    G: '#9bbc0f',                // every G in sprites.js becomes this
    R: '#8bac0f',
    B: '#306230',
  },
},
```

Leave out `bg` and only the sprites change. Leave out `pixels` and only the
backgrounds change. Copy a block, rename it, and it joins the C rotation.

Ideas: a black-and-white one, a single-colour one, your football team's
colours, one where everything is a shade of purple.

## Level 3d: change the modes

`MODES` in `js/config.js`. Left and right on the title screen pick between
them, and anything a mode does not mention falls back to the settings above it.

```js
beginner: {
  label: 'BEGINNER',
  blurb: 'lives refill every level',
  lives: 5,
  refillLivesOnLevel: true,   // full tank at the start of each level
  flyGivesLife: false,        // the fly is just points here
  baySpawnGap: 5,             // so flies turn up often
  speedStep: 0.08,            // a gentler climb
  rules: { bankIsDeath: false, occupiedBayIsDeath: false },
},
```

**Add a third mode.** Copy a block, give it a name, and it joins the rotation.
An "impossible" mode is one frog, `speedStep: 0.25`, and every rule on. A "tiny
kid" mode is 99 lives, `timeLimit: 90` and `speedStep: 0`.

**Make one frog into five.** At the top of the file:

```js
baysToClear: 1,     // 5 is the arcade rule: fill every lilypad to advance
```

## Level 3e: change the bonus round

`BONUS` in `js/config.js` is the monster truck rampage.

```js
firstLevel: 3,      // the first one happens on the way to level 3
everyLevels: 4,     // and then every 4 levels after that
duration: 22,       // seconds of rampage
speed: 250,         // how fast the truck drives, pixels a second
points: { car: 100, truck: 250, boat: 150 },
comboWindow: 1.6,   // hit something within this long and the multiplier climbs
comboMax: 10,
respawnDelay: 1.4,  // how long a flattened thing stays gone
```

Things to try:

- **`firstLevel: 1`** so the bonus round is the first thing you see
- **`everyLevels: 1`** for nothing but bonus rounds, which is very silly
- **`duration: 60`** and let them get it out of their system
- **`comboWindow: 3`** makes big multipliers much easier, which is more fun for
  a younger kid than it is fair
- **`speed: 500`** is genuinely hard to control and very funny

The truck and the boats are pixel art like everything else, in
`js/sprites.js` under `monsterTruck` and `boat`. Draw the kids' own truck.

## Level 4: make it easier, or brutal

Top of `js/config.js`:

```js
lives: 5,                  // try 99
timeLimit: 30,             // 60 is relaxed, 12 is mean
hopDuration: 80,           // 0 makes the frog snap instantly, very arcade
sound: true,
```

And the arcade rules. All `true` is faithful. Turning them off is kinder.

```js
rules: {
  bankIsDeath: true,        // landing on the green bank between two lilypads kills
  occupiedBayIsDeath: true, // so does jumping into a lilypad you already filled
  edgeIsDeath: true,        // riding a log off the side of the screen kills
  divingTurtles: true,      // turtle groups that sink
  gatorMouthIsDeath: true,  // the front of a crocodile kills
},
```

**For a first go with a younger kid**, `bankIsDeath: false` and
`occupiedBayIsDeath: false` remove the two deaths that feel unfair before you
know they are coming.

Turtles too mean? They are timed in seconds:

```js
diveUp: 4.5,      // how long they stay dry. make it 8 to be gentle.
diveTuck: 1.2,    // the warning, while they are still safe to stand on
diveUnder: 1.6,   // how long they are gone
```

## Level 5: change when the hazards arrive

`PROGRESSION` in `js/config.js` is how the game gets harder.

```js
speedStep: 0.10,     // +10% speed per level
easeEvery: 5,        // every 5 levels it backs off a bit before climbing again
easeAmount: 0.25,    // how much speed it gives back

flyFromLevel:      1,   // the bonus fly, worth 200
ladyFromLevel:     2,   // the lady frog on a log, worth 200
bayCrocFromLevel:  2,   // a crocodile lurking in a lilypad
snakeFromLevel:    3,   // snakes on the median
gatorFromLevel:    3,   // crocodiles instead of logs
```

Set any of the `FromLevel` numbers to **1** to have that hazard from the very
start, or **99** to switch it off completely.

Want a chaotic first level? Set them all to 1. Want a calm game for a five year
old? Set them all to 99 and `speedStep: 0`.

## Level 6: rewrite the board

`LANES` is the whole layout, one line per row, top to bottom.

```js
{ type: 'road', kind: 'car', length: 1, spacing: [3,3,7], speed: -0.9 },
```

- **`type`** what the row does. `'road'` kills you, `'river'` drowns you unless
  you are standing on something, `'safe'` cannot hurt you, `'home'` is the
  lilypads, `'start'` is where you begin.
- **`kind`** which art to use. Must match a name in the theme's `art` list.
- **`length`** how many squares long each thing is. A turtle group of three is
  `length: 3`. The long log is `length: 6`.
- **`spacing`** the gaps between them, in squares, repeating forever. `[3]` is
  always 3 apart. `[3, 8]` alternates, which makes convoys with a gap you can
  time your run through.
- **`speed`** pixels per frame. **Negative goes left, positive goes right.**
  0.5 is a crawl, 1.6 is the racing car.
- **`dive: 'alternate'`** on a turtle row means every other group sinks.

> **One rule worth knowing before you change the river.** Log gaps are wider
> than a single hop, so you cannot cross them. If every river row flowed the
> same way, a lilypad behind you would be unreachable and the level could become
> impossible to finish. The rows **alternate direction** so you can always drop
> back a row, get carried the other way, and try again. If you change the
> speeds, keep them alternating, and run `deno task test:play` to check a bot
> can still get across.

Things to try:

- **A sixth lane of traffic.** Copy any `road` line and paste it below. The
  board gets taller on its own.
- **A river-only game.** Delete all the `road` lines except the median.
- **Two medians.** Add `{ type: 'safe' }` in the middle of the traffic.
- **Seven lilypads.** `homeCols: [0, 2, 4, 6, 8, 10, 12]`.
- **A wider board.** Change `cols: 13`. Keep it odd so the frog starts centred,
  and update `homeCols` to match.

## Level 7: use your own drawings

The best version of this project. Draw a frog on paper, photograph it, cut the
background out, save it as a PNG in `assets/`, then:

```js
frog: { draw: 'image', src: 'assets/my-frog.png' },
```

Full instructions, including how to make it animate, are in
[assets/README.md](assets/README.md).

## Level 8: change the rules

Now you are in `js/game.js`. Two functions matter:

- **`checkLane()`** decides what happens to the frog where it is standing. Every
  rule about dying, riding, picking up the lady frog and scoring is in there.
- **`update()`** runs once a frame and moves the world.

Ideas, roughly in order of difficulty:

- A `'lily'` row: safe, but only every other square
- A frog that can hop two squares if you hold shift
- Otters, which the original had and this does not: they swim to a log and tip
  one end into the water
- A second frog on WASD, for two players at once
- Bonus points for crossing without stopping

Run `deno task test` and `deno task test:play` after changing `game.js`. The
first tells you if you broke a rule. The second tells you if you broke the
*game*, which is a different and more embarrassing thing.

---

## When something breaks

| What you see | What it usually is |
|---|---|
| Blank black page | A missing comma or bracket. Check the console (F12). |
| A sprite looks sheared or stretched | One row of that sprite is a different length from the others. |
| Everything is bright pink | A colour name the palette does not have. Check the spelling. |
| A sprite is invisible | The `kind` in `LANES` does not match any name in the theme's `art`, or a letter in the pixel grid is not in `PALETTE`. |
| Emoji shows as a box | Your device does not have that emoji. Pick another. |
| Your PNG does not appear | Wrong filename or folder. The console says which file it could not load. Capital letters matter. |
| The frog dies instantly | You probably gave the bottom row a `'road'` or `'river'` type. The last row should be `'start'`. |
| No music | Click or press a key first: browsers will not play sound until you have touched the page. Then check `music: true` in config.js and that M has not muted it. |
| A track is silent on an iPad | It is probably a `.ogg`. Convert it to `.m4a`, see Level 3b. |
| A new music file does not appear | Run `deno task music` to rebuild the list. |
| The river becomes impossible | Two river rows next to each other flowing the same way. See the note in Level 6. |

Nothing you can type in `config.js` or `sprites.js` can break anything
permanently. Worst case, `git checkout js/config.js` puts it back, or download
the file again from GitHub.
