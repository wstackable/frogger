# Making it yours 🐸

A list of things to change, easiest first.

Two files matter:

- **`js/config.js`** is the rules, the board and the difficulty
- **`js/sprites.js`** is all the pixel art

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
| The river becomes impossible | Two river rows next to each other flowing the same way. See the note in Level 6. |

Nothing you can type in `config.js` or `sprites.js` can break anything
permanently. Worst case, `git checkout js/config.js` puts it back, or download
the file again from GitHub.
