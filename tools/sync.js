#!/usr/bin/env node
/* Engine-Dateien (engine/) in public/index.html einsetzen.
   Die Dateien unter engine/ sind die Quelle: der Server lädt sie direkt, der Browser bekommt sie über index.html.
   Aufruf:  node tools/sync.js          schreibt die Dateien in index.html
            node tools/sync.js --check  prüft nur, ob index.html und engine/ übereinstimmen (Exit-Code 1 bei Abweichung) */
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const htmlPath = path.join(root, "public", "index.html");
const check = process.argv.includes("--check");

// Blaue Teile: je ein <script>-Block, erkannt an seinem ersten Kommentar
const PARTS = [
  ["engine/parts/blue_data.js", "/* Blau: Daten (Einrichtungen"],
  ["engine/parts/blue_engine.js", "/* Blau: Spiellogik (Zustand"],
  ["engine/parts/blue_ai.js", "/* Blau: Gegenspieler. Die KI ist"],
  ["engine/parts/blue_reduce.js", "/* Blau: Tick, Ereignisse, Ende, Befehle"],
  ["engine/parts/blue_bot.js", "/* Blau: Computer-Gegner (Menschheit)"],
];
const RED = "engine/red_patched.js"; // rote Engine samt Oberfläche, ein einziger Block ohne Zeilenumbruch nach <script>

let html = fs.readFileSync(htmlPath, "utf8");
let bad = 0;

function replaceBlock(start, bodyStart, end, file) {
  let body = fs.readFileSync(path.join(root, file), "utf8");
  if (file === RED) body = body.replace(/\n$/, ""); // der rote Block steht ohne Zeilenumbruch vor </script>
  const cur = html.slice(bodyStart, end);
  if (cur === body) return;
  bad++;
  if (check) { console.log("weicht ab:", file); return; }
  html = html.slice(0, bodyStart) + body + html.slice(end);
  console.log("aktualisiert:", file);
}

// rot: <script>(function(h,Le){ ... })(React,ReactDOM);</script>
{
  const start = html.indexOf("<script>(function(h,Le){");
  if (start < 0) throw new Error("roter Block nicht gefunden");
  const bodyStart = start + "<script>".length;
  const end = html.indexOf("</script>", bodyStart);
  replaceBlock(start, bodyStart, end, RED);
}
for (const [file, marker] of PARTS) {
  const start = html.indexOf("<script>\n" + marker);
  if (start < 0) throw new Error("Block nicht gefunden: " + file);
  const bodyStart = start + "<script>\n".length;
  const end = html.indexOf("</script>", bodyStart);
  replaceBlock(start, bodyStart, end, file);
}

if (check) {
  if (bad) { console.log(bad + " Datei(en) weichen ab. Mit `node tools/sync.js` angleichen."); process.exit(1); }
  console.log("engine/ und public/index.html stimmen überein.");
} else {
  fs.writeFileSync(htmlPath, html);
  console.log(bad ? "index.html geschrieben." : "nichts zu tun.");
}
