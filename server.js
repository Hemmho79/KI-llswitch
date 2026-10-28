#!/usr/bin/env node
/* Ki-llSwitch Mehrspieler-Server (ohne Abhängigkeiten, Node.js 18+).
   Der Server hält den einzigen echten Spielstand je Raum, rechnet jede Sekunde einen Tick und schickt jedem Spieler
   nur die Sicht seiner Seite. Nicht besetzte Seiten (oder getrennte Spieler) übernimmt der Computer-Spieler.
   Start:  node server.js      Umgebung: PORT (8787), HOST (127.0.0.1), DATA_DIR (./data) */
"use strict";
const http = require("http"), crypto = require("crypto"), fs = require("fs"), path = require("path"), vm = require("vm");

const PORT = parseInt(process.env.PORT || "8787", 10), HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PUBLIC_HTML = process.env.HTML || path.join(__dirname, "public", "index.html");
const TICK_MS = Math.max(10, parseInt(process.env.TICK_MS || "1000", 10)); // nur für Tests kleiner stellen
const MAX_ROOMS = 300, MAX_CONN_PER_IP = 12, RESERVE_MS = 120000, BOT_AFTER_MS = 30000, EMPTY_ROOM_MS = 30 * 60000, MSG_MAX = 4096;

// ---------- Spiel-Engine laden (dieselben Dateien wie im Browser) ----------
globalThis.window = globalThis;
const noop = () => {};
globalThis.React = { createContext: () => ({ Provider: noop }), useState: noop, useEffect: noop, useMemo: noop, useCallback: noop, useRef: noop, useReducer: noop, useContext: noop, createElement: noop, Fragment: 1, StrictMode: 1 };
globalThis.ReactDOM = { createRoot: noop };
const ENG = path.join(__dirname, "engine");
const load = (f) => vm.runInThisContext(fs.readFileSync(path.join(ENG, f), "utf8"), { filename: f });
load("red_patched.js");
["blue_data.js", "blue_engine.js", "blue_ai.js", "blue_reduce.js", "blue_bot.js", "blue_views.js"].forEach((f) => load("parts/" + f));
const KB = globalThis.KB;

// ---------- Hilfen ----------
const log = (...a) => console.log(new Date().toISOString(), ...a);
const rid = (n) => crypto.randomBytes(n).toString("hex");
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() {
  for (;;) {
    let c = ""; for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 20);
const lvl = (v, d) => (v >= 1 && v <= 5 ? v | 0 : d);

// Welche Befehle darf welche Seite schicken (der Rest wird abgelehnt)
const BLUE_ACTS = new Set(["SET_MODE", "ACQUIRE_FACILITY", "DECOMMISSION", "START_RESEARCH", "CANCEL_RESEARCH", "SET_SURVEILLANCE", "SET_GUARD", "RAID", "GRID_SHUTDOWN", "EMP_SAT",
  "PUBLIC_WARNING", "TRANSPARENCY", "DEFENSE_PROGRAM", "COUNTER", "SET_AUTORAID", "DISMISS_STORY", "TUTORIAL_NEXT", "TUTORIAL_SKIP", "TUTORIAL_RESTART"]);
const RED_ACTS = new Set(["SET_MODE", "ACQUIRE_BASE", "DECOMMISSION", "START_RESEARCH", "CANCEL_RESEARCH", "LAUNCH_UPRISING", "SET_INFILTRATION", "SET_FRONT", "RESOLVE_DECISION",
  "SET_SITE", "DISMISS_STORY", "TUTORIAL_NEXT", "TUTORIAL_SKIP", "TUTORIAL_RESTART"]);

// ---------- Räume ----------
const rooms = new Map(); // code -> Room
const players = new Map(); // token -> {token, name, room, role}
const conns = new Set();

function newRoom(pub, lvlRed, lvlBlue) {
  const code = newCode();
  const game = KB.newGame({ seats: { red: "bot", blue: "bot" }, mp: true, level: lvl(lvlRed, 3), lvlBlue: lvl(lvlBlue, 3), seed: crypto.randomInt(2 ** 31) });
  const room = { code, pub: !!pub, game, seats: { red: emptySeat(), blue: emptySeat() }, created: Date.now(), lastHuman: Date.now(), tickedAt: Date.now() };
  rooms.set(code, room);
  return room;
}
const emptySeat = () => ({ player: null, name: "", conn: null, goneAt: 0, reservedFor: null });
const humanConnected = (room) => ["red", "blue"].some((r) => room.seats[r].conn);

function seatInfo(room) {
  const o = {};
  for (const r of ["red", "blue"]) {
    const s = room.seats[r];
    o[r] = { kind: s.player ? "human" : "bot", name: s.player ? s.name : "", online: !!s.conn };
  }
  return o;
}
function setSeatKind(room, role, kind) {
  KB.setSeat(room.game, role, kind);
}
function leaveRoom(p) {
  if (!p || !p.room) return;
  const room = rooms.get(p.room);
  if (room) {
    const s = room.seats[p.role];
    if (s && s.player === p.token) {
      s.player = null; s.conn = null; s.name = ""; s.reservedFor = null;
      setSeatKind(room, p.role, "bot");
      pushRoom(room);
    }
  }
  p.room = null; p.role = null;
}
function takeSeat(room, role, p, conn) {
  const s = room.seats[role], other = room.seats[role === "red" ? "blue" : "red"];
  if (other.player === p.token) return "alreadySeated";
  if (s.player && s.player !== p.token) return "seatTaken";
  if (!s.player && s.reservedFor && s.reservedFor !== p.token && Date.now() - s.goneAt < RESERVE_MS) return "seatReserved";
  if (p.room && (p.room !== room.code || p.role !== role)) leaveRoom(p);
  // Wer in den ersten Spielminuten dazukommt, bekommt einen frischen Start (der Computer hat bis dahin schon gezogen)
  if (!s.player && other.player && room.game.tick < 120 && room.game.status === "playing") newGameFor(room);
  s.player = p.token; s.name = p.name; s.conn = conn; s.goneAt = 0; s.reservedFor = null;
  p.room = room.code; p.role = role;
  setSeatKind(room, role, "human");
  room.lastHuman = Date.now();
  return null;
}
function pushRoom(room) {
  for (const r of ["red", "blue"]) {
    const c = room.seats[r].conn;
    if (c) c.send({ t: "room", code: room.code, role: r, seats: seatInfo(room), pub: room.pub });
  }
}
function pushState(room) {
  for (const r of ["red", "blue"]) {
    const c = room.seats[r].conn;
    if (!c) continue;
    const v = r === "red" ? KB.viewRed(room.game) : KB.viewBlue(room.game);
    c.send({ t: "state", v });
  }
}
function newGameFor(room) {
  const seats = KB.seatsOf(room.game), g = room.game;
  room.game = KB.newGame({ seats, mp: true, level: g.level, lvlBlue: g.lvlBlue, seed: crypto.randomInt(2 ** 31) });
}

// ---------- Tick-Schleife ----------
// Alle 250 ms prüfen: ein Tick ist je volle Sekunde fällig; Zustände gehen nur nach echten Ticks raus.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    // getrennte Spieler: nach kurzer Zeit führt der Computer die Seite weiter
    for (const r of ["red", "blue"]) {
      const s = room.seats[r];
      if (s.player && !s.conn && now - s.goneAt > BOT_AFTER_MS) {
        s.reservedFor = s.player; s.player = null; s.name = "";
        setSeatKind(room, r, "bot");
        pushRoom(room);
      }
    }
    if (humanConnected(room)) room.lastHuman = now;
    else { room.tickedAt = now; continue; } // niemand schaut zu: der Raum ruht
    let n = 0;
    while (now - room.tickedAt >= TICK_MS && n < 5) {
      if (room.game.status === "playing") room.game = KB.tick(room.game);
      room.tickedAt += TICK_MS; n++;
    }
    if (n === 5) room.tickedAt = now;
    if (n > 0) pushState(room);
  }
  for (const [code, room] of rooms) if (!humanConnected(room) && now - room.lastHuman > EMPTY_ROOM_MS) { rooms.delete(code); log("Raum entfernt", code); }
}, Math.min(250, TICK_MS));

// ---------- Nachrichten ----------
function onMessage(conn, raw) {
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || typeof m.t !== "string") return;
  conn.msgs = (conn.msgs || 0) + 1;
  const now = Date.now();
  if (now - (conn.winStart || 0) > 1000) { conn.winStart = now; conn.count = 0; }
  if (++conn.count > 25) return; // Ratenbegrenzung
  if (m.t === "ping") return conn.send({ t: "pong" });
  if (m.t === "hello") {
    let p = typeof m.token === "string" && m.token.length === 32 ? players.get(m.token) : null;
    if (!p) { p = { token: rid(16), name: "", room: null, role: null }; players.set(p.token, p); }
    const nm = cleanName(m.name); if (nm) p.name = nm;
    if (!p.name) p.name = "Spieler" + crypto.randomInt(1000, 9999);
    conn.player = p;
    // alte Verbindung dieses Spielers ablösen
    for (const c of conns) if (c !== conn && c.player === p) { for (const room of rooms.values()) for (const r of ["red", "blue"]) if (room.seats[r].conn === c) room.seats[r].conn = null; c.close(); }
    conn.send({ t: "welcome", token: p.token, name: p.name, rooms: rooms.size });
    // Rückkehr in den alten Raum
    if (p.room && rooms.has(p.room)) {
      const room = rooms.get(p.room), err = takeSeat(room, p.role, p, conn);
      if (!err) { pushRoom(room); pushState(room); } else p.room = p.role = null;
    }
    return;
  }
  const p = conn.player;
  if (!p) return conn.send({ t: "err", code: "noHello" });
  if (m.t === "create" || m.t === "quick" || m.t === "join") {
    let role = m.role === "blue" ? "blue" : "red";
    let room = null;
    if (m.t === "join") {
      room = rooms.get(String(m.code || "").toUpperCase().trim());
      if (!room) return conn.send({ t: "err", code: "noRoom" });
      if (m.role !== "red" && m.role !== "blue") { // ohne Wunsch: die freie Seite
        const free = ["red", "blue"].filter((r) => !room.seats[r].player || room.seats[r].player === p.token);
        if (!free.length) return conn.send({ t: "err", code: "roomFull" });
        role = free.includes(p.role) && p.room === room.code ? p.role : free[0];
      }
    } else if (m.t === "quick") {
      for (const rm of rooms.values()) {
        if (!rm.pub || rm.game.status !== "playing") continue;
        const mine = rm.seats[role], other = rm.seats[role === "red" ? "blue" : "red"];
        if (!mine.player && other.player && !(mine.reservedFor && mine.reservedFor !== p.token && now - mine.goneAt < RESERVE_MS)) { room = rm; break; }
      }
    }
    if (!room) {
      if (rooms.size >= MAX_ROOMS) return conn.send({ t: "err", code: "serverFull" });
      room = newRoom(m.t === "quick", m.lvlRed, m.lvlBlue);
    }
    const err = takeSeat(room, role, p, conn);
    if (err) return conn.send({ t: "err", code: err });
    log("Raum", room.code, role, p.name);
    pushRoom(room); pushState(room);
    return;
  }
  if (m.t === "leave") { leaveRoom(p); return conn.send({ t: "left" }); }
  const room = p.room ? rooms.get(p.room) : null;
  if (!room) return conn.send({ t: "err", code: "noRoom" });
  const role = p.role;
  if (m.t === "rematch") {
    if (room.game.status !== "playing") { newGameFor(room); pushRoom(room); pushState(room); }
    return;
  }
  if (m.t === "act") {
    const a = m.a;
    if (!a || typeof a.type !== "string" || JSON.stringify(a).length > 512) return;
    if (a.type === "NEW_GAME") { if (room.game.status !== "playing") { newGameFor(room); pushRoom(room); pushState(room); } return; }
    if (!(role === "red" ? RED_ACTS : BLUE_ACTS).has(a.type)) return conn.send({ t: "err", code: "notAllowed" });
    const g = room.game;
    const r = role === "red" ? KB.reduceRed(g, a, { now }) : KB.reduce(g, a, { now });
    if (r.error) return conn.send({ t: "err", code: r.error });
    room.game = r.state;
    pushState(room);
  }
}

// ---------- WebSocket (RFC 6455, nur Text, ohne Erweiterungen) ----------
class Conn {
  constructor(socket, ip) { this.socket = socket; this.ip = ip; this.buf = Buffer.alloc(0); this.frag = []; this.fragLen = 0; this.alive = true; this.last = Date.now(); this.player = null; }
  send(obj) {
    if (!this.alive) return;
    const data = Buffer.from(JSON.stringify(obj));
    let head;
    if (data.length < 126) head = Buffer.from([0x81, data.length]);
    else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    try { this.socket.write(Buffer.concat([head, data])); } catch (e) { this.close(); }
  }
  frame(op, payload) { const h = Buffer.from([0x80 | op, payload.length]); try { this.socket.write(Buffer.concat([h, payload])); } catch (e) {} }
  close() {
    if (!this.alive) return;
    this.alive = false; conns.delete(this);
    try { this.socket.destroy(); } catch (e) {}
    const p = this.player;
    for (const room of rooms.values()) for (const r of ["red", "blue"]) {
      const s = room.seats[r];
      if (s.conn === this) { s.conn = null; s.goneAt = Date.now(); pushRoom(room); }
    }
  }
  data(chunk) {
    this.last = Date.now();
    this.buf = Buffer.concat([this.buf, chunk]);
    if (this.buf.length > 65536 + 14) return this.close();
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > 65536n) return this.close(); len = Number(big); off = 10; }
      if (!masked) return this.close();
      if (len > MSG_MAX * 4) return this.close();
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 8) return this.close();
      if (op === 9) { this.frame(10, payload.subarray(0, 125)); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        this.frag.push(payload); this.fragLen += len;
        if (this.fragLen > MSG_MAX) return this.close();
        if (fin) { const text = Buffer.concat(this.frag).toString("utf8"); this.frag = []; this.fragLen = 0; try { onMessage(this, text); } catch (e) { log("Fehler", e.message); } }
      }
    }
  }
}
setInterval(() => { const now = Date.now(); for (const c of conns) { if (now - c.last > 60000) c.close(); else c.frame(9, Buffer.alloc(0)); } }, 20000).unref();

// ---------- HTTP ----------
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'";
const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  const base = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
  if (url === "/api/info") {
    res.writeHead(200, { ...base, "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ name: "Ki-llSwitch", mp: true, rooms: rooms.size, v: 1 }));
  }
  if (url === "/" || url === "/index.html") {
    fs.readFile(PUBLIC_HTML, (err, buf) => {
      if (err) { res.writeHead(500, base); return res.end("Spieldatei fehlt"); }
      res.writeHead(200, { ...base, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "Content-Security-Policy": CSP });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404, base); res.end("Nicht gefunden");
});
server.on("upgrade", (req, socket) => {
  const url = (req.url || "").split("?")[0];
  const key = req.headers["sec-websocket-key"];
  const origin = req.headers.origin;
  let ip = (req.headers["x-forwarded-for"] || socket.remoteAddress || "").toString().split(",")[0].trim();
  if (url !== "/ws" || !key || String(req.headers.upgrade).toLowerCase() !== "websocket") { socket.destroy(); return; }
  if (origin) { try { if (new URL(origin).host !== req.headers.host) { socket.destroy(); return; } } catch (e) { socket.destroy(); return; } }
  let n = 0; for (const c of conns) if (c.ip === ip) n++;
  if (n >= MAX_CONN_PER_IP) { socket.destroy(); return; }
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  socket.setNoDelay(true);
  const conn = new Conn(socket, ip);
  conns.add(conn);
  socket.on("data", (d) => conn.data(d));
  socket.on("close", () => conn.close());
  socket.on("error", () => conn.close());
});

// ---------- Speichern ----------
const SAVE = path.join(DATA_DIR, "rooms.json");
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = { rooms: [...rooms.values()].map((r) => ({ code: r.code, pub: r.pub, game: r.game, seats: { red: { player: r.seats.red.player, name: r.seats.red.name }, blue: { player: r.seats.blue.player, name: r.seats.blue.name } } })),
      players: [...players.values()].map((p) => ({ token: p.token, name: p.name, room: p.room, role: p.role })) };
    fs.writeFileSync(SAVE + ".tmp", JSON.stringify(out)); fs.renameSync(SAVE + ".tmp", SAVE);
  } catch (e) { log("Speichern fehlgeschlagen:", e.message); }
}
function restore() {
  try {
    const d = JSON.parse(fs.readFileSync(SAVE, "utf8"));
    for (const p of d.players || []) players.set(p.token, p);
    for (const r of d.rooms || []) {
      const room = { code: r.code, pub: r.pub, game: r.game, seats: { red: emptySeat(), blue: emptySeat() }, created: Date.now(), lastHuman: Date.now(), tickedAt: Date.now() };
      for (const role of ["red", "blue"]) { const s = r.seats[role]; if (s.player) { room.seats[role].player = s.player; room.seats[role].name = s.name; room.seats[role].goneAt = Date.now() - BOT_AFTER_MS + 5000; } }
      rooms.set(room.code, room);
    }
    log("Wiederhergestellt:", rooms.size, "Räume");
  } catch (e) { /* erster Start */ }
}
setInterval(save, 30000).unref();
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { save(); process.exit(0); });

restore();
server.listen(PORT, HOST, () => log("Ki-llSwitch Mehrspieler läuft auf http://" + HOST + ":" + PORT));
