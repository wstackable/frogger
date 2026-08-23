/* ==========================================================================
   FROGGER  ::  render.js
   --------------------------------------------------------------------------
   The art layer. This turns an art entry from THEMES in config.js into
   actual pixels on the canvas.

   You usually do NOT need to edit this file. Change art in config.js.
   Come here only if you want to invent a brand new kind of drawing
   (say draw: 'star' or draw: 'text'), in which case add a case to the
   switch in drawArt() below.
   ========================================================================== */

const Art = {

  /* Cache of loaded PNGs, so we only fetch each file once. */
  _images: {},

  /* Get an <img> for a path. Returns it immediately; it may not have
     finished loading yet, which drawArt() checks for. */
  image(src) {
    let img = this._images[src];
    if (!img) {
      img = new Image();
      img.decoding = 'sync';
      img.src = src;
      img.addEventListener('error', () => {
        console.warn(
          `[frogger] Could not load "${src}". Check the file is in assets/ ` +
          `and the name matches exactly (including capital letters).`
        );
      });
      this._images[src] = img;
    }
    return img;
  },

  /* The active theme, with the retro theme underneath as a safety net so a
     half-finished custom theme still renders something. */
  theme() {
    const chosen = THEMES[CONFIG.theme];
    if (!chosen) {
      console.warn(`[frogger] No theme named "${CONFIG.theme}", using retro.`);
      return THEMES.retro;
    }
    return chosen;
  },

  /* Look up the art for a kind, e.g. Art.of('car'). */
  of(kind) {
    const theme = this.theme();
    return (theme.art && theme.art[kind]) || THEMES.retro.art[kind] || null;
  },

  /* Look up a background colour, e.g. Art.color('water'). */
  color(name) {
    const theme = this.theme();
    return (theme.palette && theme.palette[name]) || THEMES.retro.palette[name] || '#ff00ff';
  },
};


/* --------------------------------------------------------------------------
   drawArt(ctx, spec, x, y, w, h, opts)

   spec  an art entry from THEMES, e.g. { draw: 'emoji', glyph: '🚗' }
   x,y   top-left of the box to draw into, in game pixels
   w,h   size of that box
   opts  { dir, alpha, time, scale }
           dir    -1, 0 or 1. Which way this thing is travelling, used
                  together with spec.faces to decide whether to mirror.
           alpha  0..1 opacity, used for diving turtles fading out.
           time   seconds since the game started, used for animation frames.
           scale  extra multiplier on top of spec.scale, used for the
                  frog's little squash-and-stretch on landing.
   -------------------------------------------------------------------------- */
function drawArt(ctx, spec, x, y, w, h, opts) {
  if (!spec) return;
  opts = opts || {};

  const gap = CONFIG.tileGap;
  const alpha = opts.alpha == null ? 1 : opts.alpha;
  if (alpha <= 0) return;

  /* Should we mirror horizontally? Only if the art declares which way it
     naturally points and we are moving the other way. */
  const dir = opts.dir || 0;
  const mirror =
    (spec.faces === 'left'  && dir > 0) ||
    (spec.faces === 'right' && dir < 0);

  ctx.save();
  ctx.globalAlpha = alpha;

  if (mirror) {
    const cx = x + w / 2;
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  const scale = (spec.scale == null ? 1 : spec.scale) * (opts.scale == null ? 1 : opts.scale);

  switch (spec.draw) {

    /* ---------------------------------------------------------------- rect */
    case 'rect': {
      ctx.fillStyle = spec.color || '#ffffff';
      const inset = spec.inset == null ? gap / 2 : spec.inset;
      roundRect(ctx, x + inset * 0.2, y + inset, w - inset * 0.4, h - inset * 2, spec.radius == null ? 4 : spec.radius);
      ctx.fill();
      break;
    }

    /* -------------------------------------------------------------- circle */
    /* One circle per grid square, so a length-3 obstacle is three circles.
       This is how the arcade drew turtles. */
    case 'circle': {
      ctx.fillStyle = spec.color || '#ffffff';
      const count = Math.max(1, Math.round(w / h));
      const cell = w / count;
      const r = (Math.min(cell, h) / 2 - gap / 2) * scale;
      for (let i = 0; i < count; i++) {
        ctx.beginPath();
        ctx.arc(x + cell * i + cell / 2, y + h / 2, Math.max(1, r), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }

    /* --------------------------------------------------------------- emoji */
    case 'emoji': {
      const glyph = spec.glyph || '?';
      const fit = spec.fit || 'center';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (fit === 'repeat') {
        /* Tile the glyph across the length of the obstacle. */
        const count = Math.max(1, Math.round(w / h));
        const cell = w / count;
        ctx.font = emojiFont(Math.min(cell, h) * 0.86 * scale);
        for (let i = 0; i < count; i++) {
          ctx.fillText(glyph, x + cell * i + cell / 2, y + h / 2);
        }
      } else if (fit === 'stretch') {
        /* One glyph squashed to fill the whole box. */
        ctx.font = emojiFont(h * 0.86 * scale);
        ctx.save();
        ctx.translate(x + w / 2, y + h / 2);
        ctx.scale(w / h, 1);
        ctx.fillText(glyph, 0, 0);
        ctx.restore();
      } else {
        /* One glyph, centred. */
        ctx.font = emojiFont(h * 0.86 * scale);
        ctx.fillText(glyph, x + w / 2, y + h / 2);
      }
      break;
    }

    /* --------------------------------------------------------------- image */
    case 'image': {
      const img = Art.image(spec.src);
      if (!img.complete || !img.naturalWidth) break;   /* still loading */

      /* Animation: treat the PNG as a horizontal strip of `frames` frames. */
      const frames = Math.max(1, spec.frames || 1);
      const fps = spec.fps || 8;
      const sw = img.naturalWidth / frames;
      const sh = img.naturalHeight;
      const frame = frames === 1
        ? 0
        : Math.floor((opts.time || 0) * fps) % frames;
      const sx = frame * sw;

      const fit = spec.fit || 'stretch';

      if (fit === 'repeat') {
        const count = Math.max(1, Math.round(w / h));
        const cell = w / count;
        for (let i = 0; i < count; i++) {
          ctx.drawImage(img, sx, 0, sw, sh, x + cell * i, y, cell, h);
        }
      } else if (fit === 'center') {
        /* Keep the artwork's own proportions, centred in the box. */
        const boxH = h * scale;
        const boxW = boxH * (sw / sh);
        ctx.drawImage(img, sx, 0, sw, sh, x + (w - boxW) / 2, y + (h - boxH) / 2, boxW, boxH);
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


/* Emoji render best in the platform's own emoji font. Falling through to a
   generic sans-serif keeps custom glyphs and plain text working too. */
function emojiFont(px) {
  return `${Math.round(px)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
}


/* A rectangle with softened corners. Pure sugar, but it makes the retro
   theme look a lot less like a spreadsheet. */
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
