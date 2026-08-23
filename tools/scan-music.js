/* ==========================================================================
   FROGGER  ::  tools/scan-music.js
   --------------------------------------------------------------------------
   Rebuilds the list of music files in js/music.js from whatever is actually
   sitting in the music/ folder.

       deno task music

   So adding music is: drop the files in music/, run that, refresh. You never
   have to hand-edit the list.

   It only rewrites the block between the two MUSIC-FILES markers, so the
   written-out chiptune tunes below it are left alone.

   Only the top level of music/ is scanned. Subfolders are ignored on purpose,
   so you can park a whole pack in music/unused/ and pick tracks out of it by
   moving them up a level.

   A note on formats. Every browser plays .m4a and .mp3. Safari and iOS do NOT
   play .ogg, so an ogg-only track means silence on an iPad. If you drop in
   .ogg files, convert them first:

       ffmpeg -i "track.ogg" -c:a aac -b:a 128k "track.m4a"
   ========================================================================== */

const ROOT = new URL("..", import.meta.url).pathname;
const MUSIC_DIR = ROOT + "music";
const TARGET = ROOT + "js/music.js";

const PLAYABLE = new Set([".m4a", ".mp3", ".ogg", ".wav", ".aac", ".opus"]);
const SAFARI_SHY = new Set([".ogg", ".opus"]);

/* "Three Red Hearts - Box Jump.m4a" -> "Box Jump" */
function displayName(fileName) {
  let n = fileName.replace(/\.[^.]+$/, "");
  const dash = n.indexOf(" - ");
  if (dash > 0 && dash < 30) n = n.slice(dash + 3);
  n = n.trim();
  /* "boneyard.mp3" reads badly next to "Ninja Boogie", so title-case anything
     that arrived all in lower case. Names with capitals are left alone. */
  if (n === n.toLowerCase()) {
    n = n.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  }
  return n;
}

const found = [];
let skippedDirs = 0;
try {
  for await (const entry of Deno.readDir(MUSIC_DIR)) {
    if (entry.isDirectory) { skippedDirs++; continue; }
    if (!entry.isFile) continue;
    const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
    if (!PLAYABLE.has(ext)) continue;
    found.push({
      path: "music/" + entry.name,
      name: displayName(entry.name),
      ext,
      size: (await Deno.stat(MUSIC_DIR + "/" + entry.name)).size,
    });
  }
} catch (e) {
  console.error(`Could not read ${MUSIC_DIR}: ${e.message}`);
  Deno.exit(1);
}

found.sort((a, b) => a.name.localeCompare(b.name));

if (!found.length) {
  console.log("No music files in music/. Leaving the list alone.");
  Deno.exit(0);
}

const width = Math.max(...found.map((f) => f.name.length)) + 2;
const lines = found.map((f) =>
  `  { name: ${(`'${f.name.replace(/'/g, "\\'")}',`).padEnd(width + 2)}` +
  `file: '${f.path.replace(/'/g, "\\'")}' },`
);

const START = "  /* MUSIC-FILES:START";
const END = "  /* MUSIC-FILES:END */";

let src = await Deno.readTextFile(TARGET);
const a = src.indexOf(START);
const b = src.indexOf(END);
if (a === -1 || b === -1) {
  console.error(`Could not find the MUSIC-FILES markers in ${TARGET}.`);
  Deno.exit(1);
}

const header = `${START} -- rebuilt by \`deno task music\`, do not hand-edit */\n`;
src = src.slice(0, a) + header + lines.join("\n") + "\n" + src.slice(b);
await Deno.writeTextFile(TARGET, src);

const total = found.reduce((n, f) => n + f.size, 0) / 1048576;
console.log(`Wrote ${found.length} tracks to js/music.js (${total.toFixed(1)} MB total).`);
found.forEach((f) => console.log(`  ${f.name}`));
if (skippedDirs) {
  console.log(`\nIgnored ${skippedDirs} subfolder(s) in music/. Only the top ` +
              `level is scanned, so move a file up a level to use it.`);
}

const shy = found.filter((f) => SAFARI_SHY.has(f.ext));
if (shy.length) {
  console.warn(
    `\nWARNING: ${shy.length} track(s) are ${[...new Set(shy.map((f) => f.ext))].join("/")}, ` +
    `which Safari and iOS cannot play:\n` +
    shy.slice(0, 5).map((f) => `  ${f.path}`).join("\n") +
    (shy.length > 5 ? `\n  ...and ${shy.length - 5} more` : "") +
    `\n\nConvert them so they work on an iPad:\n` +
    `  cd music && for f in *.ogg; do ffmpeg -i "$f" -c:a aac -b:a 128k "\${f%.ogg}.m4a" && rm "$f"; done\n`
  );
}
