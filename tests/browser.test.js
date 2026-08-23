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
};
const server = Deno.serve({ port: PORT, onListen: () => {} }, async (req) => {
  let path = new URL(req.url).pathname;
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
  await evaluate("frogger.Music.enabled = true; CONFIG.music = true; frogger.Music.start()");
  await frames(20);

  check("an AudioContext is running",
    await evaluate("frogger.Music._ctx && frogger.Music._ctx.state === 'running'"),
    await evaluate("String(frogger.Music._ctx && frogger.Music._ctx.state)"));
  check("the music is playing", await evaluate("frogger.Music.playing === true"));

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
