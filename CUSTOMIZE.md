# Making it yours 🐸

This is a list of things to change, roughly easiest first. Everything here is in
**`js/config.js`** unless it says otherwise.

The loop for all of them is the same:

1. Open `js/config.js` in a text editor
2. Change something
3. Save
4. Refresh the browser tab

If the game goes blank, you have almost certainly deleted a comma or a bracket.
Press **F12** in the browser, click **Console**, and it will tell you which line.
That is not a disaster, it is how everyone does this.

---

## Level 1: change one character

Find the `emoji` theme near the bottom of `config.js`. Every line in there is a
picture in the game. Change the emoji between the quote marks.

```js
frog:   { draw: 'emoji', glyph: '🐸', scale: 0.92 },
car:    { draw: 'emoji', glyph: '🚗', faces: 'left' },
log:    { draw: 'emoji', glyph: '🪵', fit: 'repeat' },
turtle: { draw: 'emoji', glyph: '🐢', faces: 'left' },
```

Some ideas that make a whole new game:

| Theme | frog | log | turtle | cars become |
|---|---|---|---|---|
| Space | 🚀 | ☄️ | 🛸 | 👽 👾 🌑 |
| Ocean | 🐠 | 🛶 | 🐋 | 🦈 🐙 🦑 |
| Dinosaurs | 🦖 | 🪨 | 🐢 | 🦕 🦴 🌋 |
| Breakfast | 🥞 | 🥓 | 🍳 | ☕ 🧇 🍩 |
| Your pets | 🐶 | 🦴 | 🐱 | 🚗 🚚 🚜 |

On a Mac, **Ctrl + Cmd + Space** opens the emoji picker.

> **Why `faces: 'left'`?** Most vehicle emoji are drawn pointing left. That line
> tells the game to flip the picture when the thing is driving right, so cars
> never drive backwards. If your new emoji already points right, change it to
> `faces: 'right'`. If it points at you (like 🐸), delete the line.

## Level 2: change the colours

Each theme has a `palette`. These are the flat background bands.

```js
palette: {
  water:  '#123f6d',    // the river
  road:   '#2b2b33',    // the tarmac
  grass:  '#2f9e44',    // the bank at the top and the start at the bottom
  median: '#6741d9',    // the safe strip in the middle
},
```

Those `#` codes are colours. Search the web for "color picker", grab a code,
paste it in. A sunset road, a purple river, a pink median: it all works.

## Level 3: make it easier (or brutal)

At the top of `config.js`:

```js
lives: 5,                  // try 99
timeLimit: 30,             // seconds per frog. 60 is relaxed, 12 is mean.
speedRampPerLevel: 0.12,   // 0 = it never gets faster. 0.4 = it gets silly.
hopDuration: 90,           // 0 makes the frog snap instantly, very arcade
sound: true,               // false for silence
```

And in `difficulty`:

```js
difficulty: {
  hitBankIsDeath: false,   // true = landing between two bays kills you (arcade rule)
  divingTurtles: true,     // false = turtles stay up and can be trusted
  diveUp: 4.0,             // seconds the turtles stay up
  diveBlink: 1.5,          // seconds of warning flashing
  diveDown: 1.5,           // seconds underwater
},
```

## Level 4: rewrite the board

This is the big one. `LANES` is the whole layout, one line per row, top to bottom.

```js
{ type: 'road', kind: 'car', length: 1, spacing: [3,3,7], speed: -0.75 },
```

- **`type`** what the row does. `'road'` squashes you, `'river'` drowns you
  unless you are riding something, `'safe'` cannot hurt you, `'home'` is the
  goal, `'start'` is where you begin.
- **`kind`** which art to use. It has to match a name in the theme's `art` list.
- **`length`** how many squares long each obstacle is. `1` is a car, `7` is a
  very long log.
- **`spacing`** the gaps between obstacles, in squares, repeating forever.
  `[3]` means always 3 apart. `[3, 8]` means 3, then 8, then 3, then 8, which
  makes convoys with a gap you can sneak through. `[0, 0, 1]` makes groups of
  three touching each other, which is how the turtles work.
- **`speed`** pixels per frame. **Negative goes left, positive goes right.**
  `0.5` is a crawl, `1.5` is quick, `3` is nearly impossible.

Things to try:

- **Add a sixth traffic lane.** Copy any `road` line, paste it below, change the
  numbers. The board gets taller on its own.
- **Make a river-only game.** Delete all the `road` lines.
- **Two medians.** Add another `{ type: 'safe' }` in the middle of the traffic.
- **A one-way boulevard.** Make every road speed positive.
- **A wider board.** Change `cols: 13` at the top. Keep it an odd number so the
  frog can start dead centre, and update `homeCols` to match.
- **Seven bays instead of five.** `homeCols: [0, 2, 4, 6, 8, 10, 12]`.

## Level 5: use your own drawings

The best version of this project. Draw a frog on paper, photograph it, cut the
background out, save it as a PNG in `assets/`, then:

```js
frog: { draw: 'image', src: 'assets/my-frog.png' },
```

Full instructions, including how to make it animate, are in
[assets/README.md](assets/README.md).

## Level 6: make a whole new theme

Copy either theme block, give it a new name, and switch to it at the top.

```js
const THEMES = {
  retro: { ... },
  emoji: { ... },

  space: {                                  // ← your new one
    palette: { water: '#0b0b2a', road: '#101018', grass: '#2b2b4a',
               median: '#3a2a5a', bankLine: '#8888ff', hudBg: '#05050c',
               text: '#ffffff', textDim: '#9aa0b5',
               timeBar: '#6cf', timeLow: '#f66' },
    art: {
      frog:   { draw: 'emoji', glyph: '🚀' },
      scored: { draw: 'emoji', glyph: '🛰️', scale: 0.7 },
      life:   { draw: 'emoji', glyph: '🚀', scale: 0.7 },
      home:   { draw: 'emoji', glyph: '🪐', scale: 0.75 },
      log:    { draw: 'emoji', glyph: '☄️', fit: 'repeat' },
      turtle: { draw: 'emoji', glyph: '🛸', faces: 'left' },
      truck:  { draw: 'emoji', glyph: '🛰️', faces: 'left', fit: 'repeat' },
      racer:  { draw: 'emoji', glyph: '💫' },
      car:    { draw: 'emoji', glyph: '👽' },
      dozer:  { draw: 'emoji', glyph: '👾' },
      taxi:   { draw: 'emoji', glyph: '🌑' },
      splat:  { draw: 'emoji', glyph: '💥' },
    },
  },
};
```

Then at the top of the file: `theme: 'space',`

A theme needs an `art` entry for every `kind` used in `LANES`, plus `frog`,
`scored`, `life`, `home` and `splat`. Miss one and the game quietly falls back
to the retro version of it rather than breaking.

## Level 7: change the rules

Now you are in `js/game.js`. Two functions matter:

- **`checkLane()`** decides what happens to the frog where it is standing. Every
  rule about dying, riding and scoring is in here. A new lane type, a lane that
  bounces you sideways, a lane that is safe only on even seconds: all of it goes
  here.
- **`update()`** runs once per frame and moves the world.

Ideas, in rough order of difficulty:

- A `'lily'` lane type: safe, but only every other square
- A bonus fly that appears in a random bay and is worth 200 points
- A second frog controlled with WASD, for two players at once
- Crocodiles in the river: a log you can ride, except the head end
- Snakes that patrol the median, like the later arcade levels

Run `deno task test` after changing `game.js`. It drives the real game code and
will tell you if frogs stopped drowning or levels stopped advancing.

---

## When something breaks

| What you see | What it usually is |
|---|---|
| Blank black page | A missing comma or bracket in `config.js`. Check the browser console (F12). |
| Everything is bright pink | A colour name the palette does not have. Check the spelling. |
| An obstacle is invisible | The `kind` in `LANES` does not match any name in the theme's `art`. |
| Emoji shows as `?` or a box | Your device does not have that emoji. Pick another. |
| Your PNG does not appear | Wrong filename or folder. The console will say which file it could not load. Capital letters matter. |
| The frog dies instantly | You probably put a `'road'` or `'river'` type on the bottom row. The last row should be `'start'`. |

Nothing you can type in `config.js` can break anything permanently. Worst case,
`git checkout js/config.js` puts it back, or download the file again from GitHub.
