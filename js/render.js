/* ==========================================================================
   FROGGER  ::  render.js
   --------------------------------------------------------------------------
   The art layer. It turns an art entry from THEMES (in config.js) into
   actual pixels.

   You usually do NOT need to edit this file:
     - to change what things look like, edit config.js
     - to change the pixel pictures themselves, edit sprites.js

   Come here only to invent a whole new WAY of drawing, in which case add a
   case to the switch in drawArt() near the bottom.
   ========================================================================== */

const Art = {

  /* --- Theme lookups --------------------------------------------------- */

  theme() {
    const chosen = THEMES[CONFIG.theme];
    if (!chosen) {
      console.warn(`[frogger] No theme named "${CONFIG.theme}", using arcade.`);
      return THEMES.arcade;
    }
    return chosen;
  },

  /* The art for a kind, e.g. Art.of('car'). Falls back to the arcade theme
     so a half-finished custom theme still draws something. */
  of(kind) {
    const theme = this.theme();
    return (theme.art && theme.art[kind]) || THEMES.arcade.art[kind] || null;
  },

  /* A background colour, e.g. Art.color('water'). A palette chosen with C
     wins over the theme's own colours. */
  color(name) {
    if (this._bgOverride && this._bgOverride[name]) return this._bgOverride[name];
    const theme = this.theme();
    return (theme.palette && theme.palette[name]) ||
           THEMES.arcade.palette[name] || '#ff00ff';
  },

  /* What colour one letter of pixel art means right now. */
  pixel(ch) {
    if (this._pxOverride && this._pxOverride[ch]) return this._pxOverride[ch];
    return PALETTE[ch];
  },

  /* --- Colour palettes, cycled with C ---------------------------------- */

  _paletteIndex: 0,
  _bgOverride: null,
  _pxOverride: null,

  palettes() {
    return (typeof PALETTES !== 'undefined' && PALETTES.length)
      ? PALETTES : [{ name: 'Default' }];
  },

  setPalette(i) {
    const list = this.palettes();
    this._paletteIndex = ((i % list.length) + list.length) % list.length;
    const p = list[this._paletteIndex];
    this._bgOverride = p.bg || null;
    this._pxOverride = p.pixels || null;
    this._tiles = {};          /* the cached sprites are the wrong colour now */
    return p.name;
  },

  nextPalette() {
    return this.setPalette(this._paletteIndex + 1);
  },

  paletteName() {
    return this.palettes()[this._paletteIndex].name;
  },

  /* --- PNG loading ----------------------------------------------------- */

  _images: {},

  image(src) {
    let img = this._images[src];
    if (!img) {
      img = new Image();
      img.src = src;
      img.addEventListener('error', () => {
        console.warn(
          `[frogger] Could not load "${src}". Check the file is in assets/ and ` +
          `the name matches exactly, including capital letters.`
        );
      });
      this._images[src] = img;
    }
    return img;
  },

  /* --- Pixel sprite cache ----------------------------------------------
     Drawing a 16x16 sprite as 256 little rectangles is fine once, but there
     are dozens of sprites on screen every frame, which would be tens of
     thousands of draw calls a second. So each sprite is painted once onto
     its own small offscreen canvas at the size it is needed, then that gets
     stamped down as a single image from then on.
     ------------------------------------------------------------------- */

  _dpr: 1,
  _tiles: {},

  setPixelRatio(dpr) {
    if (dpr !== this._dpr) {
      this._dpr = dpr;
      this._tiles = {};        /* the cache is size-specific, so start over */
    }
  },

  /* An offscreen canvas holding one sprite at one size. */
  tile(name, w, h) {
    const dpr = this._dpr;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    const key = `${name}@${pw}x${ph}`;

    let tile = this._tiles[key];
    if (tile) return tile;

    const rows = SPRITES[name];
    if (!rows) {
      console.warn(`[frogger] No sprite named "${name}" in sprites.js.`);
      return null;
    }

    const cols = rows[0].length;
    const canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    const c = canvas.getContext('2d');

    /* Pixels are drawn slightly oversized and rounded outward so they butt
       up against each other with no seams showing at fractional scales. */
    const cw = pw / cols;
    const ch = ph / rows.length;

    for (let ry = 0; ry < rows.length; ry++) {
      const row = rows[ry];
      if (row.length !== cols) {
        console.warn(
          `[frogger] Sprite "${name}" row ${ry} is ${row.length} pixels wide ` +
          `but row 0 is ${cols}. Every row must be the same length.`
        );
      }
      for (let rx = 0; rx < row.length; rx++) {
        const color = Art.pixel(row[rx]);
        if (!color) continue;              /* '.' or unknown letter */
        c.fillStyle = color;
        const x0 = Math.floor(rx * cw);
        const y0 = Math.floor(ry * ch);
        const x1 = Math.ceil((rx + 1) * cw);
        const y1 = Math.ceil((ry + 1) * ch);
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }

    tile = { canvas, w: pw, h: ph };
    this._tiles[key] = tile;
    return tile;
  },
};


/* ==========================================================================
   drawArt(ctx, spec, x, y, w, h, opts)
   --------------------------------------------------------------------------
   spec   an art entry from THEMES, e.g. { draw: 'pixels', sprite: 'frog' }
   x,y    top-left of the box to draw into, in game pixels
   w,h    size of that box. For a length-4 log, w is four squares wide.
   opts   dir     -1, 0 or 1: which way this thing travels. Combined with
                  spec.faces to decide whether to mirror the art.
          alpha   0..1 opacity
          sink    0..1 how far underwater it is (diving turtles). 0 is dry,
                  1 is gone. The art slides down and gets clipped off by the
                  waterline, which reads as sinking rather than blinking.
          time    seconds since load, for animation frames
          scale   extra size multiplier, used for the frog's hop squash
          cells   how many squares long this is, for tiling and end caps
   ========================================================================== */

function drawArt(ctx, spec, x, y, w, h, opts) {
  if (!spec) return;
  opts = opts || {};

  const alpha = opts.alpha == null ? 1 : opts.alpha;
  if (alpha <= 0) return;

  const sink = Math.max(0, Math.min(1, opts.sink || 0));
  if (sink >= 1) return;

  /* Mirror only if the art says which way it naturally points and we are
     going the other way. */
  const dir = opts.dir || 0;
  const mirror =
    (spec.faces === 'left'  && dir > 0) ||
    (spec.faces === 'right' && dir < 0);

  ctx.save();
  ctx.globalAlpha = alpha;

  /* Sinking: clip to the row so the part that has gone under is hidden,
     then slide the art down into the water. */
  if (sink > 0) {
    ctx.beginPath();
    ctx.rect(x - 1, y, w + 2, h);
    ctx.clip();
    ctx.translate(0, sink * h);
  }

  if (mirror) {
    const cx = x + w / 2;
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  const scale = (spec.scale == null ? 1 : spec.scale) *
                (opts.scale == null ? 1 : opts.scale);

  switch (spec.draw) {

    /* ------------------------------------------------------------- pixels */
    case 'pixels': {
      drawPixelRun(ctx, spec, x, y, w, h, opts, scale);
      break;
    }

    /* --------------------------------------------------------------- rect */
    case 'rect': {
      ctx.fillStyle = spec.color || '#ffffff';
      const inset = spec.inset == null ? CONFIG.tileGap / 2 : spec.inset;
      roundRect(ctx, x + inset * 0.2, y + inset, w - inset * 0.4, h - inset * 2,
                spec.radius == null ? 4 : spec.radius);
      ctx.fill();
      break;
    }

    /* ------------------------------------------------------------- circle */
    case 'circle': {
      ctx.fillStyle = spec.color || '#ffffff';
      const count = Math.max(1, Math.round(w / h));
      const cell = w / count;
      const r = (Math.min(cell, h) / 2 - CONFIG.tileGap / 2) * scale;
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.arc(x + cell * i + cell / 2, y + h / 2, Math.max(1, r), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    /* -------------------------------------------------------------- emoji */
    case 'emoji': {
      const glyph = spec.glyph || '?';
      const fit = spec.fit || 'center';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (fit === 'repeat') {
        const count = Math.max(1, Math.round(w / h));
        const cell = w / count;
        ctx.font = emojiFont(Math.min(cell, h) * 0.86 * scale);
        for (let i = 0; i < count; i++) {
          ctx.fillText(glyph, x + cell * i + cell / 2, y + h / 2);
        }
      } else if (fit === 'stretch') {
        ctx.font = emojiFont(h * 0.86 * scale);
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(w / h, 1);
        ctx.fillText(glyph, 0, 0);
        ctx.restore();
      } else {
        ctx.font = emojiFont(h * 0.86 * scale);
        ctx.fillText(glyph, x + w / 2, y + h / 2);
      }
      break;
    }

    /* -------------------------------------------------------------- image */
    case 'image': {
      const img = Art.image(spec.src);
      if (!img.complete || !img.naturalWidth) break;

      const frames = Math.max(1, spec.frames || 1);
      const fps = spec.fps || 8;
      const sw = img.naturalWidth / frames;
      const sh = img.naturalHeight;
      const frame = frames === 1 ? 0 : Math.floor((opts.time || 0) * fps) % frames;
      const sx = frame * sw;
      const fit = spec.fit || 'stretch';

      if (fit === 'repeat') {
        const count = Math.max(1, Math.round(w / h));
        const cell = w / count;
        for (let i = 0; i < count; i++) {
          ctx.drawImage(img, sx, 0, sw, sh, x + cell * i, y, cell, h);
        }
      } else if (fit === 'center') {
        const boxH = h * scale;
        const boxW = boxH * (sw / sh);
        ctx.drawImage(img, sx, 0, sw, sh,
                      x + (w - boxW) / 2, y + (h - boxH) / 2, boxW, boxH);
      } else {
        ctx.drawImage(img, sx, 0, sw, sh, x, y, w, h);
      }
      break;
    }

    default:
      console.warn(`[frogger] Unknown draw type "${spec.draw}".`);
  }

  ctx.restore();
}


/* --------------------------------------------------------------------------
   Pixel sprites, including multi-square things with end caps.

   A length-4 log is drawn as: logLeft, logMid, logMid, logRight. A length-2
   truck is trailer then cab. A length-3 turtle group is the same turtle
   three times. All of that is decided here from spec.capLeft / spec.capRight
   and spec.fit.
   -------------------------------------------------------------------------- */
function drawPixelRun(ctx, spec, x, y, w, h, opts, scale) {
  const cells = Math.max(1, opts.cells || Math.round(w / h) || 1);
  const cellW = w / cells;

  /* One square: just the sprite, centred, honouring scale. */
  if (cells === 1 && !spec.capLeft && !spec.capRight) {
    stampTile(ctx, spec.sprite, x, y, cellW, h, scale);
    return;
  }

  const hasCaps = spec.capLeft || spec.capRight;

  if (!hasCaps && spec.fit !== 'repeat') {
    /* Stretch a single sprite across the whole length. */
    stampTile(ctx, spec.sprite, x, y, w, h, scale);
    return;
  }

  for (let i = 0; i < cells; i++) {
    let name = spec.sprite;
    if (spec.capLeft && i === 0) name = spec.capLeft;
    else if (spec.capRight && i === cells - 1) name = spec.capRight;
    stampTile(ctx, name, x + cellW * i, y, cellW, h, scale);
  }
}

function stampTile(ctx, name, x, y, w, h, scale) {
  if (!name) return;
  const dw = w * scale;
  const dh = h * scale;
  const tile = Art.tile(name, dw, dh);
  if (!tile) return;

  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tile.canvas, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.imageSmoothingEnabled = prevSmoothing;
}


/* Emoji render best in the platform's own emoji font. */
function emojiFont(px) {
  return `${Math.round(px)}px "Apple Color Emoji", "Segoe UI Emoji", ` +
         `"Noto Color Emoji", sans-serif`;
}

/* A rectangle with softened corners. */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
