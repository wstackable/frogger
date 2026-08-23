# Your own artwork goes in here

The game can draw PNG files instead of emoji or rectangles, so anything you can
draw can be in the game.

## The short version

1. Draw something. Paper and a phone camera is completely fine.
2. Make the background transparent and save it as a **PNG** in this folder.
3. In `js/config.js`, point one line at it:

```js
frog: { draw: 'image', src: 'assets/my-frog.png' },
```

4. Refresh the browser.

## Getting the background out

You need the area around your drawing to be transparent, or every car will be a
picture of a car sitting on a white square.

- **Easiest:** on a Mac, open the photo in Preview, use the Instant Alpha tool
  (the magic wand in the markup toolbar), click the white paper, press delete,
  then **File → Export** and choose PNG.
- **On a phone:** long-press the subject in the Photos app and use "Copy Subject",
  then paste it into a new blank image.
- **Drawing on a tablet:** most drawing apps can export a PNG with a transparent
  background. Just do not fill in the bottom layer.

## What size?

Anything, honestly. The game scales your picture to fit its square, which is
48×48 pixels by default. Somewhere around 96×96 or 192×192 looks crisp on a
retina screen without being a huge file. Square pictures are easiest.

For long things like logs, draw a long picture. The game will stretch it to the
full length of the log.

## Making it fit properly

The `fit` setting decides what happens when the picture is a different shape from
the thing it is drawing.

```js
// One copy, squashed to fill the whole length. Good for a log you drew long.
log: { draw: 'image', src: 'assets/log.png', fit: 'stretch' },

// One copy per square, tiled along the length. Good for a single log segment.
log: { draw: 'image', src: 'assets/log-piece.png', fit: 'repeat' },

// One copy, keeping its own proportions, centred. Good for cars.
car: { draw: 'image', src: 'assets/car.png', fit: 'center' },
```

## Mirroring

Vehicles that drive both ways need to know which way your drawing points.

```js
car: { draw: 'image', src: 'assets/car.png', faces: 'left' },
```

That means "this drawing points left, so flip it when it drives right". Use
`faces: 'right'` if you drew it the other way, and leave the line out entirely if
your drawing is symmetrical or faces the viewer.

## Making it move

Draw the frames side by side in one wide PNG, all the same width, then tell the
game how many there are.

```
my-frog.png   ->  [ frame 1 ][ frame 2 ][ frame 3 ][ frame 4 ]
```

```js
frog: { draw: 'image', src: 'assets/my-frog.png', frames: 4, fps: 8 },
```

`fps` is how many frames go by each second. 8 is a nice cartoon speed. 2 is a
slow blink. 24 is very busy.

## If it does not show up

Press **F12** in the browser and click **Console**. The game prints the exact
filename it could not find. Nine times out of ten it is a capital letter:
`Frog.png` and `frog.png` are different files as far as the browser is concerned.

## A note on what you put in here

If you want to publish the game, only use pictures you drew yourself or that you
definitely have permission to use. Anything in this folder gets uploaded to
GitHub and is public.
