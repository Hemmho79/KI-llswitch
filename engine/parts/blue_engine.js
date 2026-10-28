/* Blau: Spiellogik (Zustand, Tick, Befehle). Gegenspieler ist die echte rote Engine als Bot.
   Alles Wichtige steckt in reinen Funktionen: später auch auf einem Server nutzbar. */
(function () {
  var KB = window.KB, SG = window.SG, K = KB.K, B = KB.B;
  var clamp = function (x, a, b) { return Math.max(a, Math.min(b, x)); };
  var clone = function (s) { return structuredClone(s); };

  function rnd(a) {
    a.rng = (a.rng + 1831565813) >>> 0;
    var t = a.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function log(a, key, params, kind) {
    a.log.unshift({ id: a.nextId++, tick: a.tick, key: key, params: params || {}, kind: kind || "info" });
    if (a.log.length > 60) a.log.length = 60;
  }
  function facRef(f) { return { typeId: f.typeId, num: f.num, home: !!f.home }; }
  KB.rnd = rnd; KB.log = log; KB.clamp = clamp; KB.facRef = facRef;

  function pickRegion(a) {
    var w = KB.REGIONS.map(function (r) { return r.population * (1 - (a.defense[r.id] / 100) * 0.8); });
    var sum = w.reduce(function (x, y) { return x + y; }, 0), t = rnd(a) * sum;
    for (var i = 0; i < w.length; i++) { t -= w[i]; if (t < 0) return KB.REGIONS[i].id; }
    return KB.REGIONS[KB.REGIONS.length - 1].id;
  }
  KB.pickRegion = pickRegion;

  function addFacility(a, typeId, buildTicks) {
    var num = a.facilities.filter(function (f) { return f.typeId === typeId; }).length + 1;
    var f = { id: "f" + a.nextId++, typeId: typeId, num: num, mode: "rest", buildTicksLeft: buildTicks };
    a.facilities.push(f);
    return f;
  }

  // Sitze: jede Seite wird von einem Menschen ("human") oder einem Computer-Spieler ("bot") geführt.
  // opts.seats = {red, blue} hat Vorrang; opts.side ("blue" | "red" | "none") ist die Kurzform für Einzelspiele.
  KB.seatsOf = function (a) {
    if (a.seats) return a.seats;
    var side = a.side || "blue";
    return { red: side === "red" ? "human" : "bot", blue: side === "blue" ? "human" : "bot" };
  };
  KB.redBot = function (a) { return KB.seatsOf(a).red === "bot"; };
  KB.blueBot = function (a) { return KB.seatsOf(a).blue === "bot"; };
  KB.sideName = function (seats) { return seats.red === "human" && seats.blue === "human" ? "both" : seats.red === "human" ? "red" : seats.blue === "human" ? "blue" : "none"; };
  KB.setSeat = function (a, role, kind) { a.seats = Object.assign({}, KB.seatsOf(a)); a.seats[role] = kind; a.side = KB.sideName(a.seats); };

  KB.newGame = function (opts) {
    opts = opts || {};
    var seed = (opts.seed !== undefined ? opts.seed : Date.now()) >>> 0;
    var seats = opts.seats ? { red: opts.seats.red === "human" ? "human" : "bot", blue: opts.seats.blue === "human" ? "human" : "bot" }
      : { red: opts.side === "red" ? "human" : "bot", blue: opts.side === "red" || opts.side === "none" ? "bot" : "human" };
    var side = KB.sideName(seats);
    var lv = function (v) { return v >= 1 && v <= 5 ? v : 3; };
    var level = lv(opts.level !== undefined ? opts.level : opts.lvlRed); // Stärke der KI (Rot-Bot)
    var lvlBlue = lv(opts.lvlBlue); // Stärke der Menschheit (Blau-Bot)
    var redHuman = seats.red === "human";
    var red = SG.ge({
      seed: (seed ^ 0x9e3779b9) >>> 0, playerId: null,
      daily: redHuman ? opts.redDaily : undefined, achievements: redHuman ? opts.redAchievements : undefined
    });
    if (redHuman) {
      red.tutorial = { step: 0, done: !!opts.redTutorialDone };
    } else {
      red.tutorial = { step: 0, done: true };
      red.story.pending = [];
      if (red.story.seen.indexOf("boot") < 0) red.story.seen.push("boot");
      red.log = [];
      red.cash += KB.LEVEL[level].cash;
    }
    var botBlue = seats.blue === "bot";
    var a = {
      version: 1, team: side === "blue" ? "blue" : side === "red" ? "red" : side, side: side, seats: seats, mp: !!opts.mp, mpq: { red: [] },
      status: "playing", paused: false, tick: 0, rng: seed, nextId: 1, level: level, lvlBlue: lvlBlue,
      budget: K.startBudget + (botBlue ? KB.BLUE_LEVEL[lvlBlue].cash : 0), trust: K.startTrust, units: 0,
      facilities: [], research: { completed: [], active: [], progress: {}, paid: [] },
      surv: {}, defense: {}, guard: {}, known: {}, meta: {}, cd: {}, blackout: {},
      red: red, pending: null, site: "auto", autoRaid: true,
      ai: { hiding: false, needCash: 0, readyTick: null, frontTick: -99, lastLogId: 0, noRobots: 0, pendingStories: [] },
      achievements: opts.achievements ? opts.achievements.slice() : [],
      daily: opts.daily ? { lastClaimDay: opts.daily.lastClaimDay, streak: opts.daily.streak } : { lastClaimDay: null, streak: 0 },
      tutorial: { step: 0, done: botBlue || !!opts.tutorialDone },
      story: { seen: [], pending: [] },
      stats: { earned: 0, peakThreat: 0, lowTrust: false, located: 0, raids: 0, shutdowns: 0, peakUnits: 0 },
      log: [], ending: null
    };
    KB.REGIONS.forEach(function (r) {
      a.surv[r.id] = false; a.defense[r.id] = Math.round(25 * r.defense); a.guard[r.id] = 1; a.blackout[r.id] = 0;
    });
    var f = addFacility(a, "cyber_center", 0);
    f.home = true; f.mode = "research";
    a.meta[red.bases[0].id] = { region: pickRegion(a) };
    log(a, "log.start");
    KB.checkStory(a);
    if (botBlue) a.story.pending = [];
    return a;
  };

  // Meldung ins Protokoll der roten Seite (nur wenn ein Mensch Rot spielt)
  KB.redLog = function (a, key, params, kind) {
    if (KB.redBot(a)) return;
    var r = a.red;
    r.log.unshift({ id: r.nextId++, tick: r.tick, key: key, params: params || {}, kind: kind || "info", src: "blue" });
    if (r.log.length > 80) r.log.length = 80;
  };
  // Entdeckung bei 100 % Bedrohung, bevor die KI unlöschbar ist: der Krieg beginnt.
  // Notstart: die KI setzt ihre Reserven in Roboter um (je Basis und je 50 Geld). Läuft in der roten Engine (r = roter Zustand).
  KB.foundWar = function (r) {
    var built = r.bases.filter(function (b) { return b.buildTicksLeft === 0; }).length;
    var n = Math.min(600, 40 * built + Math.floor(r.cash / 50));
    r.robots = Math.max(r.robots, n);
    r.cash = 0;
    r.war = { startTick: r.tick }; r.suspicion = 100; r.foundWar = true;
    r.log.unshift({ id: r.nextId++, tick: r.tick, key: "log.foundWar", params: { robots: Math.floor(r.robots) }, kind: "bad" });
  };
  KB.baseRef = function (b) { return { typeId: b.typeId, num: b.num, home: !!b.home }; };
  // Aufräumen: Zustände zu verschwundenen Basen löschen
  KB.prune = function (a) {
    var alive = {};
    a.red.bases.forEach(function (b) { alive[b.id] = true; });
    Object.keys(a.known).forEach(function (k) { if (!alive[k]) delete a.known[k]; });
    Object.keys(a.meta).forEach(function (k) { if (!alive[k]) delete a.meta[k]; });
  };

  // ---- abgeleitete Werte -------------------------------------------------
  KB.mods = function (a) {
    var m = { budget: 0, detection: 0, analysis: 0, slots: 1, retention: 0, maint: 0, units: 0, unitPower: 0, resist: 0, defRate: 0, orbitLock: false, front: false, unlocked: {}, measures: {} };
    a.research.completed.forEach(function (id) {
      var fx = KB.TECH[id].fx;
      if (fx.budget) m.budget += fx.budget;
      if (fx.detection) m.detection += fx.detection;
      if (fx.analysis) m.analysis += fx.analysis;
      if (fx.slots) m.slots += fx.slots;
      if (fx.retention) m.retention += fx.retention;
      if (fx.maint) m.maint += fx.maint;
      if (fx.units) m.units += fx.units;
      if (fx.unitPower) m.unitPower += fx.unitPower;
      if (fx.resist) m.resist += fx.resist;
      if (fx.defRate) m.defRate += fx.defRate;
      if (fx.orbitLock) m.orbitLock = true;
      if (fx.front) m.front = true;
      if (fx.unlock) m.unlocked[fx.unlock] = true;
      if (fx.measure) m.measures[fx.measure] = true;
    });
    m.detection = Math.min(m.detection, 0.9);
    return m;
  };
  KB.unitCap = function (a) {
    var c = K.unitCapBase;
    a.facilities.forEach(function (f) {
      if (f.buildTicksLeft > 0) return;
      if (f.typeId === "task_force") c += K.unitCapTF;
      if (f.typeId === "special_command") c += K.unitCapSC;
    });
    return c;
  };
  KB.facUnlocked = function (a, typeId) {
    var r = KB.FAC[typeId].requires;
    return r === null || a.research.completed.indexOf(r) >= 0;
  };
  KB.techState = function (a, id) {
    var t = KB.TECH[id];
    if (!t) return "unknown";
    if (a.research.completed.indexOf(id) >= 0) return "completed";
    if (a.research.active.indexOf(id) >= 0) return "active";
    return t.pre.every(function (p) { return a.research.completed.indexOf(p) >= 0; }) ? "available" : "locked";
  };
  KB.needsFacility = function (a, id) {
    var n = KB.TECH[id].needs;
    return !!n && !a.facilities.some(function (f) { return f.typeId === n && f.buildTicksLeft === 0; });
  };
  KB.lockActive = function (a) {
    return a.research.completed.indexOf("orbital_sovereignty") >= 0 &&
      a.facilities.some(function (f) { return f.typeId === "orbital_platform" && f.buildTicksLeft === 0; });
  };
  KB.aiHasOrbit = function (a) {
    return a.red.bases.some(function (b) { return b.typeId === "orbital" && b.buildTicksLeft === 0; });
  };
  KB.orbitState = function (a) { return KB.aiHasOrbit(a) ? "ai" : KB.lockActive(a) ? "blue" : "open"; };
  KB.phase = function (a) {
    return a.red.war ? "war" : a.red.research.completed.indexOf("transcendence") >= 0 ? "undeletable" : "hidden";
  };
  KB.effStealth = function (a, m) {
    if (a.red.sh) return 0; // geschwärzte Sicht: die Tarnung der KI ist nicht bekannt
    var rs = SG.X(a.red);
    return rs.mods.stealth * (1 - (m || KB.mods(a)).detection);
  };

  function researchRates(a, cpu) {
    var n = {}, t = [];
    a.research.active.forEach(function (id) {
      n[id] = 0;
      if (!KB.needsFacility(a, id)) t.push({ id: id, cap: KB.TECH[id].cost / KB.TECH[id].min });
    });
    t.sort(function (x, y) { return x.cap - y.cap; });
    var s = cpu;
    t.forEach(function (o, i) { var r = s / (t.length - i); n[o.id] = Math.min(o.cap, r); s -= n[o.id]; });
    return n;
  }

  KB.stats = function (a) {
    var m = KB.mods(a), capAll = 0, capBase = 0, analysis = 0, researchCpu = 0, upkeep = 0, ready = 0, active = 0, orbWatch = false;
    a.facilities.forEach(function (f) {
      if (f.buildTicksLeft > 0) return;
      var T = KB.FAC[f.typeId], cap = T.cap * (1 + m.analysis);
      capAll += cap; capBase += T.cap;
      if (f.mode === "investigate") { analysis += cap; if (T.offworld) orbWatch = true; }
      if (f.mode === "research") researchCpu += cap;
      if (f.mode === "ready") ready += T.units || 0;
      if (f.mode !== "rest") active++;
      upkeep += T.upkeep * KB.MODE[f.mode].maint * Math.max(0.25, 1 + m.maint);
    });
    var mult = 1 + K.multiActive * Math.max(active - 1, 0), drain = 0;
    a.facilities.forEach(function (f) {
      if (f.buildTicksLeft > 0) return;
      drain += KB.FAC[f.typeId].risk * KB.MODE[f.mode].priv * K.facPriv * mult;
    });
    var survPop = 0, survCount = 0;
    KB.REGIONS.forEach(function (r) { if (a.surv[r.id] && a.red.world[r.id].humanity > 0) { survPop += r.population; survCount++; } });
    drain += survPop * K.survPerPop;
    var aw = a.red.suspicion, war = !!a.red.war;
    var relief = war ? 0.5 : 1 - aw / 150;
    var trustRate = K.trustRegen - drain * relief;
    var income = (K.baseIncome + K.incomePerCap * capBase) * (0.4 + 0.6 * a.trust / 100) * (1 + 0.6 * aw / 100) * (1 + m.budget);
    if (war) income *= 1.5;
    var bo = 0;
    KB.REGIONS.forEach(function (r) { if (a.blackout[r.id] > a.tick) bo += r.population / 100; });
    income *= 1 - 0.5 * bo;
    var rates = researchRates(a, researchCpu);
    var rsum = 0; Object.keys(rates).forEach(function (k) { rsum += rates[k]; });
    var rx = a.red.sh ? { war: a.red.warView } : SG.X(a.red);
    return {
      mods: m, capAll: capAll, capBase: capBase, unitCap: KB.unitCap(a), analysis: analysis, researchCpu: researchCpu, upkeep: upkeep, income: income, net: income - upkeep,
      trustRate: trustRate, trustDrain: drain * relief, survCount: survCount, orbWatch: orbWatch,
      researchRates: rates, researchRate: rsum, researchSlots: m.slots,
      unitRate: ready + m.units, unitPower: 1 + m.unitPower,
      threat: aw, phase: KB.phase(a), war: rx.war ? { humanity: rx.war.humanity, damage: rx.war.damage, regroup: rx.war.regroup } : null,
      day: Math.floor(a.tick / B) + 1, hour: a.tick % B, active: active
    };
  };

  // Sicht des Spielers auf eine Region (nur Spuren, nie die KI selbst)
  KB.regionView = function (a, rid) {
    var r = KB.REGIONS.filter(function (x) { return x.id === rid; })[0], red = a.red, m = KB.mods(a);
    var es = KB.effStealth(a, m), cpu = 0, located = [];
    red.bases.forEach(function (b) {
      var meta = a.meta[b.id];
      if (!meta || meta.region !== rid) return;
      if (!red.sh && b.buildTicksLeft === 0 && b.mode !== "sleep") cpu += SG._[b.typeId].cpu;
      var k = a.known[b.id];
      if (k && k.located) located.push({ id: b.id, typeId: b.typeId, mode: b.mode, building: b.buildTicksLeft > 0 });
    });
    var signal = red.sh ? (red.sig[rid] || 0) : 100 * (1 - Math.exp(-(cpu * (1 - es)) / 40));
    var ctl = red.world[rid].control;
    var level = ctl <= 0 ? 0 : ctl < 25 ? 1 : ctl < 50 ? 2 : ctl < 75 ? 3 : 4;
    return {
      id: rid, population: r.population, surveilled: !!a.surv[rid], defense: a.defense[rid], signal: signal, controlLevel: level,
      located: located, humanity: red.world[rid].humanity, fallen: !!red.war && red.world[rid].humanity <= 0, guard: a.guard[rid],
      blackout: a.blackout[rid] > a.tick, infiltrating: !!red.world[rid].infiltrate
    };
  };
})();

