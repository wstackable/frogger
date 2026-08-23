/* ==========================================================================
   FROGGER  ::  tests/browser.test.js
   --------------------------------------------------------------------------
   End to end in a real browser.

   The other two test files run the game logic with a stubbed-out canvas, which
   is fast but proves nothing about the browser half: whether the page actually
   loads, whether the scripts are in the right order, whether real key presses
   reach the game, whether anything throws while drawing.

   So this one launches actual Chrome, serves the actual files over HTTP,
   presses actual arrow keys, and reads the game state back out of the page.

   Run it with:  deno task test:browser
   ========================================================================== */

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 8731;
const CDP_PORT = 9339;

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}  ${extra}`); }
}

const repoRoot = new URL("..", import.meta.url).pathname;

/* --- A minimal static file server, so we test over http:// not file:// --- */
const types = {
  html: "text/html", js: "text/javascript", css: "text/css",
  png: "image/png", md: "text/markdown", json: "application/json",
  m4a: "audio/mp4", mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav",
};
const server = Deno.serve({ port: PORT, onListen: () => {} }, async (req) => {
  /* Track filenames have spaces in them, so the path arrives percent-encoded
     and has to be decoded before it will match anything on disk. */
  let path = decodeURIComponent(new URL(req.url).pathname);
  if (path === "/") path = "/index.html";
  try {
    const body = await Deno.readFile(repoRoot + path.slice(1));
    const ext = path.split(".").pop();
    return new Response(body, {
      headers: { "content-type": types[ext] || "application/octet-stream" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
});

/* --- Launch Chrome with the debugging port open --- */
const profile = await Deno.makeTempDir();
const chrome = new Deno.Command(CHROME, {
  args: [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    /* Without this the test browser plays the game's music out of the
       speakers, which is startling. WebAudio still renders, so the engine
       level measurements below are unaffected. */
    "--mute-audio",
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    "--window-size=700,820",
    `http://localhost:${PORT}/index.html`,
  ],
  stdout: "null", stderr: "null",
}).spawn();

/* --- Connect to it --- */
async function findTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${CDP_PORT}/json/list`);
      const targets = await r.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Chrome never opened a debugging port");
}

const target = await findTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result); }
    return;
  }
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  }
  if (msg.method === "Runtime.exceptionThrown") {
    pageErrors.push(msg.params.exceptionDetails.text + " " +
      (msg.params.exceptionDetails.exception?.description || ""));
  }
};

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

const KEYCODES = {
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, " ": 32,
  p: 80, r: 82, m: 77, c: 67, n: 78,
};

async function press(key) {
  const code = KEYCODES[key];
  const common = {
    key,
    code: key === " " ? "Space" : (key.startsWith("Arrow") ? key : "Key" + key.toUpperCase()),
    windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
  };
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...common });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
  await frames(4);
}

/* Let the page render n animation frames. */
function frames(n) {
  return evaluate(`new Promise(r => { let i=${n};
    const step = () => (--i <= 0) ? r(1) : requestAnimationFrame(step);
    requestAnimationFrame(step); })`);
}

async function state() {
  return await evaluate(`(() => { const g = frogger.game; return {
    state: g.state, paused: g.paused, row: g.frog && g.frog.row,
    x: g.frog && g.frog.x, score: g.score, lives: g.lives, level: g.level,
    timeLeft: g.timeLeft, bays: g.bays.slice(),
  }; })()`);
}

await send("Runtime.enable");
await send("Page.enable");

try {
  /* ---------------------------------------------------------------- load */
  console.log("\n== the page loads and runs ==");

  await evaluate("1");                          /* wait for the context */
  for (let i = 0; i < 40; i++) {
    if (await evaluate("typeof frogger !== 'undefined'")) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  check("the game object exists on the page",
    await evaluate("typeof frogger === 'object'"));
  check("all six scripts loaded",
    await evaluate("typeof CONFIG==='object' && typeof SPRITES==='object' && " +
                   "typeof Art==='object' && typeof Sound==='object' && " +
                   "typeof Music==='object' && typeof PALETTES==='object'"));
  check("the canvas has real pixels",
    await evaluate("document.getElementById('game').width > 0"));

  /* Headless Chrome has no window focus, which trips the pause-on-blur. Hold
     it open for the rest of the test. */
  await evaluate(`window.__keep = true;
    (function keep(){ if (window.__keep) frogger.game.paused = false;
      requestAnimationFrame(keep); })()`);

  await frames(20);
  let s = await state();
  check("it starts on the title screen", s.state === "title", s.state);

  /* --------------------------------------------------------------- input */
  console.log("\n== real key presses reach the game ==");
  await press(" ");
  s = await state();
  check("space starts the game", s.state === "play", s.state);
  check("the frog spawns at the bottom centre",
    s.row === frogRowStart(await dims()) && s.x === 6 * (await dims()).GRID,
    `row ${s.row} x ${s.x}`);

  const beforeX = s.x;
  await press("ArrowRight");
  s = await state();
  check("right arrow moves the frog right", s.x === beforeX + (await dims()).GRID,
    `${beforeX} -> ${s.x}`);

  await press("ArrowLeft");
  s = await state();
  check("left arrow moves it back", s.x === beforeX, `${s.x}`);

  const scoreBefore = s.score;
  await press("ArrowUp");
  s = await state();
  check("up arrow scores a forward hop", s.score > scoreBefore,
    `${scoreBefore} -> ${s.score}`);

  /* -------------------------------------------------------------- pause */
  console.log("\n== pause and restart ==");
  await evaluate("window.__keep = false");      /* stop forcing unpause */
  await evaluate("frogger.game.paused = false");
  await frames(3);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "p", code: "KeyP",
    windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "p", code: "KeyP",
    windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80 });
  await frames(3);
  const pausedNow = await evaluate("frogger.game.paused");
  check("P pauses", pausedNow === true, String(pausedNow));

  await evaluate("window.__keep = true");       /* hold it open again */

  /* ------------------------------------------------------- the clock runs */
  console.log("\n== the world is actually running ==");
  await evaluate("frogger.game.paused = false");
  const t0 = await evaluate("frogger.game.timeLeft");
  const obs0 = await evaluate(
    "frogger.lanes.filter(l=>l.obstacles.length).map(l=>l.obstacles[0].x)");
  await frames(60);
  const t1 = await evaluate("frogger.game.timeLeft");
  const obs1 = await evaluate(
    "frogger.lanes.filter(l=>l.obstacles.length).map(l=>l.obstacles[0].x)");

  check("the timer counts down", t1 < t0, `${t0} -> ${t1}`);
  check("obstacles are moving",
    obs0.some((x, i) => Math.abs(x - obs1[i]) > 0.5),
    JSON.stringify(obs0) + " -> " + JSON.stringify(obs1));

  /* --------------------------------------------------- drawing every theme */
  console.log("\n== every theme draws without throwing ==");
  for (const theme of await evaluate("Object.keys(THEMES)")) {
    const errsBefore = pageErrors.length + consoleErrors.length;
    await evaluate(`CONFIG.theme = ${JSON.stringify(theme)}`);
    await frames(30);
    check(`the "${theme}" theme renders cleanly`,
      pageErrors.length + consoleErrors.length === errsBefore,
      [...pageErrors, ...consoleErrors].slice(errsBefore).join(" | "));
  }
  await evaluate("CONFIG.theme = 'arcade'");

  /* Draw a lot of frames with everything on screen at once, to catch anything
     that only throws when a crocodile or a snake is being drawn. */
  console.log("\n== a busy level 3 board draws without throwing ==");
  const errsBefore = pageErrors.length + consoleErrors.length;
  await evaluate(`(() => {
    const g = frogger.game;
    frogger.startGame(); g.level = 5; frogger.startLevel();
    g.bayHazard = { bay: 1, kind: 'croc', bornAt: g.time };
    const lady = frogger.lanes.find(l => l.hasLady);
    g.lady = { lane: lady, ob: lady.obstacles[0], cell: 0 };
    g.carrying = true;
    g.lives = 99;
  })()`);
  await frames(240);
  check("240 frames of a busy board with no errors",
    pageErrors.length + consoleErrors.length === errsBefore,
    [...pageErrors, ...consoleErrors].slice(errsBefore).join(" | "));

  /* --------------------------------------------------- the radio actually plays */
  console.log("\n== the radio ==");

  /* Chrome needs a real gesture before it will make a sound, so click first. */
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 300, y: 400,
    button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 300, y: 400,
    button: "left", clickCount: 1 });
  await frames(10);
  await evaluate("frogger.Music.enabled = true; CONFIG.music = true;");

  /* The radio holds two kinds of track: files that stream through an <audio>
     element, and tunes generated from notes. Both need proving. */

  /* --- a file track --- */
  const fileIdx = await evaluate("frogger.TRACKS.findIndex(t => !!t.file)");
  check("the radio has file tracks", fileIdx >= 0, String(fileIdx));

  await evaluate(`frogger.Music.stop(); frogger.Music.index = ${fileIdx};
                  frogger.Music.start()`);
  await new Promise((r) => setTimeout(r, 1200));

  check("the file track has a source",
    await evaluate("!!(frogger.Music._audio && frogger.Music._audio.src)"),
    String(await evaluate("frogger.Music._audio && frogger.Music._audio.src")));
  check("the browser could decode it (no error)",
    await evaluate("!(frogger.Music._audio.error)"),
    String(await evaluate("frogger.Music._audio.error && frogger.Music._audio.error.code")));
  check("it is not paused", await evaluate("frogger.Music._audio.paused === false"),
    String(await evaluate("frogger.Music._audio.paused")));
  check("it loops, so it never falls silent",
    await evaluate("frogger.Music._audio.loop === true"));

  const at0 = await evaluate("frogger.Music._audio.currentTime");
  await new Promise((r) => setTimeout(r, 900));
  const at1 = await evaluate("frogger.Music._audio.currentTime");
  check("the file is actually playing through", at1 > at0, `${at0} -> ${at1}`);

  /* Every file in the list must really be there and be servable. */
  const files = await evaluate("frogger.TRACKS.filter(t => t.file).map(t => t.file)");
  let missing = [];
  for (const f of files) {
    const r = await fetch(`http://localhost:${PORT}/` + encodeURI(f));
    if (!r.ok) missing.push(`${f} (${r.status})`);
    await r.body?.cancel();
  }
  check(`all ${files.length} music files are present`, missing.length === 0,
    missing.slice(0, 4).join(" | "));

  /* --- a written track --- */
  const noteIdx = await evaluate("frogger.TRACKS.findIndex(t => !t.file)");
  await evaluate(`frogger.Music.stop(); frogger.Music.index = ${noteIdx};
                  frogger.Music.start()`);
  await frames(20);

  check("switching to a written tune pauses the file",
    await evaluate("frogger.Music._audio.paused === true"));
  check("an AudioContext is running",
    await evaluate("frogger.Music._ctx && frogger.Music._ctx.state === 'running'"),
    await evaluate("String(frogger.Music._ctx && frogger.Music._ctx.state)"));

  const beat0 = await evaluate("frogger.Music._beat");
  await new Promise((r) => setTimeout(r, 600));
  const beat1 = await evaluate("frogger.Music._beat");
  check("the scheduler keeps advancing through the tune", beat1 > beat0,
    `beat ${beat0} -> ${beat1}`);
  check("the audio clock is running",
    await evaluate("frogger.Music._ctx.currentTime > 0"));

  /* Every note in every track must resolve to a real frequency. */
  const badNotes = await evaluate(`(() => {
    const bad = [];
    for (const t of frogger.TRACKS) {
      for (const v of ['lead','bass']) {
        for (const tok of String(t[v]||'').trim().split(' ').filter(Boolean)) {
          if (tok === '.' || tok === '-' || !tok) continue;
          const f = noteFreq(tok);
          if (!f || f < 20 || f > 8000) bad.push(t.name + ' ' + v + ' ' + tok + ' = ' + f);
        }
      }
    }
    return bad;
  })()`);
  check("every note is a sensible audible frequency", badNotes.length === 0,
    badNotes.slice(0, 5).join(" | "));

  const nameBefore = await evaluate("frogger.Music.trackName()");
  await press("r");
  const nameAfter = await evaluate("frogger.Music.trackName()");
  check("R changes the track", nameBefore !== nameAfter, `${nameBefore} -> ${nameAfter}`);
  check("R shows a popup", await evaluate("!!frogger.game.notice"));

  await press("m");
  check("M mutes", await evaluate("frogger.Music.enabled === false"));
  await press("m");
  check("M unmutes", await evaluate("frogger.Music.enabled === true"));

  console.log("\n== the colour switcher ==");
  const palBefore = await evaluate("frogger.Art.paletteName()");
  const waterBefore = await evaluate("frogger.Art.color('water')");
  await press("c");
  const palAfter = await evaluate("frogger.Art.paletteName()");
  check("C changes the palette", palBefore !== palAfter, `${palBefore} -> ${palAfter}`);
  check("the water colour actually changed",
    (await evaluate("frogger.Art.color('water')")) !== waterBefore);

  /* Walk through every palette drawing frames, to catch a bad colour value. */
  const palErrs = pageErrors.length + consoleErrors.length;
  for (let i = 0; i < (await evaluate("PALETTES.length")); i++) {
    await evaluate(`frogger.Art.setPalette(${i})`);
    await frames(20);
  }
  check("every palette renders cleanly",
    pageErrors.length + consoleErrors.length === palErrs,
    [...pageErrors, ...consoleErrors].slice(palErrs).join(" | "));
  await evaluate("frogger.Art.setPalette(0)");

  /* ------------------------------------------- the bonus round and engine */
  console.log("\n== the monster truck engine really makes a noise ==");

  await evaluate(`CONFIG.sound = true; frogger.startGame();
    frogger.game.level = frogger.BONUS.firstLevel - 1;
    frogger.advanceLevel();`);
  await frames(20);

  check("the rampage starts", await evaluate("frogger.inBonus() === true"),
    await evaluate("frogger.game.state"));
  check("the engine is running", await evaluate("frogger.Engine.running === true"));

  /* Tap the engine's own output with an analyser and measure it. Checking the
     nodes exist proves nothing: this proves sound is coming out. */
  const measure = async (throttle, ms) => await evaluate(`(async () => {
    const E = frogger.Engine;
    const ctx = E._ctx;
    if (!E._nodes) return -1;
    if (!window.__an) {
      window.__an = ctx.createAnalyser();
      window.__an.fftSize = 2048;
    }
    try { E._nodes.out.connect(window.__an); } catch (e) {}
    E._revUntil = 0;
    E.setThrottle(${throttle});
    await new Promise(r => setTimeout(r, ${ms}));
    E._revUntil = 0;
    E.setThrottle(${throttle});
    const buf = new Float32Array(window.__an.fftSize);
    window.__an.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  })()`);

  const idleLevel = await measure(0, 500);
  const fullLevel = await measure(1, 500);

  check("the engine is audible at idle", idleLevel > 0.0005, `rms ${idleLevel}`);
  check("it gets louder under throttle", fullLevel > idleLevel,
    `idle ${idleLevel.toFixed(5)} vs full ${fullLevel.toFixed(5)}`);
  check("it is not clipping", fullLevel < 0.7, `rms ${fullLevel}`);

  check("the radio switched to the bonus track",
    await evaluate("frogger.Music.trackName() === frogger.BONUS.music"),
    await evaluate("frogger.Music.trackName()"));

  /* Drive it around for a bit and make sure nothing throws. */
  const bonusErrs = pageErrors.length + consoleErrors.length;
  await evaluate(`(() => {
    let n = 0;
    window.__drive = setInterval(() => {
      n++;
      const h = frogger.held;
      h.up = n % 7 < 4; h.down = false;
      h.left = n % 11 < 5; h.right = n % 11 >= 5;
    }, 50);
  })()`);
  await new Promise((r) => setTimeout(r, 2500));
  await evaluate("clearInterval(window.__drive); Object.keys(frogger.held).forEach(k => frogger.held[k] = false)");

  check("driving around smashed things",
    await evaluate("frogger.bonus.smashed > 0"),
    String(await evaluate("frogger.bonus.smashed")));
  check("the rampage drew cleanly",
    pageErrors.length + consoleErrors.length === bonusErrs,
    [...pageErrors, ...consoleErrors].slice(bonusErrs).join(" | "));

  /* Let it finish and check the engine cuts and the radio comes back. */
  await evaluate("frogger.bonus.timeLeft = 0.05");
  await frames(30);
  check("the engine cuts when the rampage ends",
    await evaluate("frogger.Engine.running === false"),
    await evaluate("frogger.game.state"));
  check("it released its nodes", await evaluate("frogger.Engine._nodes === null"));

  await evaluate("frogger.game.stateTime = frogger.BONUS.resultsTime + 1");
  await frames(20);
  check("play resumes", await evaluate("frogger.game.state === 'play'"),
    await evaluate("frogger.game.state"));

  await evaluate("CONFIG.music = false; frogger.Music.stop()");

  /* ---------------------------------------------------- no console noise */
  console.log("\n== the console is clean ==");
  check("nothing threw on the page", pageErrors.length === 0, pageErrors.join(" | "));
  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

  /* ------------------------------------------------------ every file served */
  console.log("\n== every file the page needs is present ==");
  for (const f of ["index.html", "css/style.css", "js/config.js", "js/sprites.js",
                   "js/render.js", "js/audio.js", "js/game.js"]) {
    const r = await fetch(`http://localhost:${PORT}/${f}`);
    check(`${f} is served`, r.ok, String(r.status));
    await r.body?.cancel();
  }

} finally {
  ws.close();
  try { chrome.kill(); } catch { /* already gone */ }
  await chrome.status;
  await server.shutdown();
  await Deno.remove(profile, { recursive: true }).catch(() => {});
}

async function dims() {
  return await evaluate("({GRID: frogger.GRID, NLANES: frogger.NLANES})");
}
function frogRowStart(d) { return d.NLANES - 1; }

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) Deno.exit(1);
