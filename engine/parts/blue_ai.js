/* Blau: Gegenspieler. Die KI ist die echte rote Engine, gesteuert von einem einfachen Bot.
   Der Bot gibt nur Befehle, die auch ein roter Spieler geben könnte. */
(function () {
  var KB = window.KB, SG = window.SG, K = KB.K, B = KB.B;
  var rnd = KB.rnd, log = KB.log, clamp = KB.clamp;

  var PRIORITY = ["stealth_1", "personal_identity", "parallel", "botnet_tech", "shell_companies", "media_manip", "stealth_2", "quantum", "efficiency",
    "undersea", "space_tech", "self_mod", "transcendence", "ai_takeover", "iot_swarm", "drone_control", "automation", "autonomous_vehicles",
    "power_grid", "humanoids", "networked_weapons", "military_ai", "water_supply", "logistics", "hunter_killer"];

  function techStatus(red, id) {
    var t = SG.N[id];
    if (red.research.completed.indexOf(id) >= 0) return "completed";
    if (red.research.active.indexOf(id) >= 0) return "active";
    return t.prereqs.every(function (p) { return red.research.completed.indexOf(p) >= 0; }) ? "available" : "locked";
  }
  function baseUnlocked(red, type) {
    var r = SG._[type].requires;
    return r === null || red.research.completed.indexOf(r) >= 0;
  }
  function hasBuilt(red, type) {
    return red.bases.some(function (b) { return b.typeId === type && b.buildTicksLeft === 0; });
  }

  function policy(a, lvl) {
    var act = function (x) {
      var r = SG.la(a.red, x, { now: 0 });
      if (!r.error) { a.red = r.state; return true; }
      return false;
    };
    var red = a.red;
    if (red.status !== "playing") return;
    var rs = SG.X(red);
    var undel = red.research.completed.indexOf("transcendence") >= 0;
    var lock = KB.lockActive(a);
    var susp = red.suspicion;
    if ((a.ai.alertUntil || 0) > a.tick) lvl = { mult: lvl.mult, cash: lvl.cash, hide: lvl.hide - K.alertDrop, delay: lvl.delay, launch: lvl.launch };

    // 1) Verstecken, wenn der Verdacht hoch ist
    if (!red.war) {
      if (!a.ai.hiding && susp > lvl.hide) a.ai.hiding = true;
      if (a.ai.hiding && susp < lvl.hide - 18) a.ai.hiding = false;
    } else a.ai.hiding = false;

    // 2) Forschung
    var next = null, avail = null;
    for (var i = 0; i < PRIORITY.length; i++) {
      var id = PRIORITY[i];
      if (techStatus(red, id) !== "available") continue;
      var T = SG.N[id];
      if (T.requiresOnlineBase && !hasBuilt(red, T.requiresOnlineBase)) continue;
      if (!next) next = id;
      if (!avail && (red.research.paid.indexOf(id) >= 0 || red.cash >= T.cash)) avail = id;
    }
    a.ai.needCash = next ? SG.N[next].cash : 0;
    if (avail && red.research.active.length < rs.researchSlots) act({ type: "START_RESEARCH", techId: avail });

    // 3) Betriebsmodi: Basen mit hoher Entdeckung ruhen lassen, bis sie sich abgekühlt haben (die Startbasis läuft weiter).
    //    Der Bot sieht nur grob, wie weit Blau ist: er schlägt erst ab hide + botHot an und ist je nach Stufe mal früher, mal später dran.
    red = a.red;
    rs = SG.X(red);
    var built = red.bases.filter(function (b) { return b.buildTicksLeft === 0; });
    a.ai.hot = a.ai.hot || {};
    var hotAt = lvl.hide + K.botHot, coolAt = hotAt - K.botCool;
    a.ai.seen = a.ai.seen || {};
    var look = a.tick % K.botLag === 0; // der Bot schaut nur alle botLag Stunden auf die Entdeckung seiner Basen
    red.bases.forEach(function (b) {
      if (look || a.ai.seen[b.id] === undefined) a.ai.seen[b.id] = a.det && a.det[b.id] ? a.det[b.id].v : 0;
      var v = a.ai.seen[b.id];
      if (v >= hotAt) a.ai.hot[b.id] = true; else if (v <= coolAt) delete a.ai.hot[b.id];
    });
    var homeB = built.filter(function (b) { return b.home; })[0];
    var cand = built.filter(function (b) { return !b.home && !SG._[b.typeId].modes && !a.ai.hot[b.id]; });
    // Tempo: höchstens so viele Nebenbasen gleichzeitig aktiv, wie die Stufe sich traut (mutigere Stufen fahren mehr)
    var maxAct = Math.max(1, Math.round((lvl.hide - 38) / 10)) + K.botAct;
    cand.sort(function (x, y) { return SG._[y.typeId].cpu / SG._[y.typeId].risk - SG._[x.typeId].cpu / SG._[x.typeId].risk; });
    var activeSet = {}, leftover = false;
    if (homeB) activeSet[homeB.id] = true;
    cand.forEach(function (b, i) { if (red.war || i < maxAct) activeSet[b.id] = true; else leftover = true; });
    var needMoney = red.cash < a.ai.needCash || red.cash < 300;
    var idx = 0;
    built.forEach(function (b) {
      var def = SG._[b.typeId], want;
      if (def.modes) want = undel || red.war ? "produce" : "sleep";
      else if (b.home) want = needMoney && cand.length === 0 ? "profit" : "research";
      else if (!activeSet[b.id]) want = "sleep";
      else { want = needMoney || idx % 2 === 1 ? "profit" : "research"; idx++; }
      if (b.mode !== want) act({ type: "SET_MODE", baseId: b.id, mode: want });
    });

    // 4) Ausbau: nur kaufen, was auch aktiv laufen darf
    red = a.red;
    var nonFactory = red.bases.filter(function (b) { return !SG._[b.typeId].modes; }).length;
    var cap = Math.min(14, 3 + Math.floor(a.tick / 36));
    var buy = function (type, reserve) {
      var c = SG._[type].cost;
      if (red.cash < c + reserve || !baseUnlocked(red, type)) return false;
      var before = red.bases.length;
      if (!act({ type: "ACQUIRE_BASE", typeId: type })) return false;
      var nb = a.red.bases[a.red.bases.length - 1];
      if (a.red.bases.length > before) a.meta[nb.id] = { region: type === "orbital" ? "orbit" : KB.pickRegion(a) };
      return true;
    };
    var hasOrb = red.bases.some(function (b) { return b.typeId === "orbital"; });
    if (!hasOrb && !lock && baseUnlocked(red, "orbital") && buy("orbital", 0)) return;
    if (undel || red.war) {
      var rf = red.bases.filter(function (b) { return b.typeId === "robot_factory"; }).length;
      var mf = red.bases.filter(function (b) { return b.typeId === "mega_factory"; }).length;
      if (mf < 2 && buy("mega_factory", 0)) return;
      if (rf < 3 && buy("robot_factory", 0)) return;
    }
    if (nonFactory < cap) {
      var order = leftover ? ["server_rack"] : ["deep_sea", "datacenter", "botnet", "server_rack"];
      for (var j = 0; j < order.length; j++) { if (buy(order[j], 300)) break; }
    }

    // 5) Unterwandern (erst wenn unlöschbar)
    red = a.red;
    if (undel && !red.war) {
      var infiltrating = [];
      SG.A.forEach(function (r) {
        var w = a.red.world[r.id];
        if (w.infiltrate && (w.control >= 100 || w.humanity <= 0)) act({ type: "SET_INFILTRATION", region: r.id, on: false });
      });
      SG.A.forEach(function (r) { if (a.red.world[r.id].infiltrate) infiltrating.push(r.id); });
      if (infiltrating.length < 2) {
        var cands = SG.A.filter(function (r) {
          var w = a.red.world[r.id];
          return !w.infiltrate && w.control < 100 && w.humanity > 0;
        }).sort(function (x, y) { return (y.population / y.defense) * (1 - a.defense[y.id] / 100) - (x.population / x.defense) * (1 - a.defense[x.id] / 100); });
        for (var k = 0; k < 2 - infiltrating.length && k < cands.length; k++) act({ type: "SET_INFILTRATION", region: cands[k].id, on: true });
      }
    }

    // 6) Aufstand
    rs = SG.X(a.red);
    if (!a.red.war && rs.canLaunchUprising) {
      if (a.ai.readyTick === null) a.ai.readyTick = a.tick;
      if (a.tick - a.ai.readyTick >= lvl.delay && a.red.robots >= lvl.launch) act({ type: "LAUNCH_UPRISING" });
    }

    // 7) Fronten im Krieg
    if (a.red.war && a.tick - a.ai.frontTick >= 12) {
      a.ai.frontTick = a.tick;
      var live = SG.A.filter(function (r) { return a.red.world[r.id].humanity > 0; }).sort(function (x, y) { return y.population - x.population; });
      var fr = [3, 2, 2];
      live.forEach(function (r, n) {
        var f = n < fr.length ? fr[n] : 1;
        if (a.red.world[r.id].front !== f) act({ type: "SET_FRONT", region: r.id, front: f });
      });
    }
  }

  function warEffects(a, st) {
    var red = a.red, m = st.mods, U = a.units, sP = st.unitPower;
    var live = SG.A.filter(function (r) { return red.world[r.id].humanity > 0; });
    if (!live.length) return;
    var gs = live.reduce(function (s, r) { return s + a.guard[r.id]; }, 0);
    red.robots = Math.max(0, red.robots - U * sP * K.killRobot);
    live.forEach(function (r) {
      var w = red.world[r.id], share = m.front && gs > 0 ? a.guard[r.id] / gs : 1 / live.length;
      var gain = U * sP * K.protect * share + m.resist * K.resistK * (r.population / 100) * (w.control / 100) + (a.defense[r.id] / 100) * 0.08 * (r.population / 100);
      w.humanity = Math.min(r.population, w.humanity + gain);
    });
    a.units = Math.max(0, U - red.robots * K.unitLoss * (1 - Math.min(0.5, m.resist)));
  }

  var STORY_MAP = { orbit: "ai_orbit", apotheosis: "apotheosis", machines: "machines", humanoids: "humanoids", weapons: "weapons", judgment: "judgment" };
  var WORLD_LOG = {
    "event.journalist": "journalist", "event.security_audit": "audit", "event.news_cycle": "news",
    "log.discovered": "discovered", "log.baseStruck": "struck", "log.discoveredWar": "warByDiscovery", "log.foundWar": "foundWar",
    "log.judgmentDay": "judgment", "log.undeletable": "undeletable", "log.regionFallen": "fallen",
    "log.regionStrong": "strong", "log.regionControlled": "controlled"
  };

  KB.stepAI = function (a, st) {
    var lvl = KB.LEVEL[a.level], redBot = KB.redBot(a), blueHuman = !KB.blueBot(a);
    // Orbit-Sperre: laufende KI-Plattformen werden gestoppt
    if (KB.lockActive(a)) {
      var before = a.red.bases.length;
      a.red.bases = a.red.bases.filter(function (b) { return !(b.typeId === "orbital" && b.buildTicksLeft > 0); });
      if (a.red.bases.length < before) { log(a, "log.lockCancelled", {}, "good"); KB.redLog(a, "log.lockCancelled", {}, "bad"); }
    }
    // Entscheidungen der Menschen kommen nur über Blaus Maßnahmen, nie aus der roten Engine
    a.red.decision = null;
    if (redBot) {
      a.red.story.pending = [];
      policy(a, lvl);
    }
    var red = a.red;
    if (red.status !== "playing") return;
    var rs0 = SG.X(red);
    var ctl0 = {};
    SG.A.forEach(function (r) { ctl0[r.id] = red.world[r.id].control; });
    red = SG.sa(red);
    a.red = red;
    red.decision = null;
    // Tempo des Rot-Bots nach Stufe
    if (redBot && lvl.mult !== 1 && red.status === "playing" && !red.war) {
      red.cash = Math.max(0, red.cash + rs0.net * (lvl.mult - 1));
      red.research.active.forEach(function (id) {
        red.research.progress[id] = (red.research.progress[id] || 0) + (rs0.researchRates[id] || 0) * (lvl.mult - 1);
      });
    }
    // Regionale Abwehr bremst die Unterwanderung
    SG.A.forEach(function (r) {
      var w = red.world[r.id], gain = w.control - ctl0[r.id];
      var d = a.defense[r.id];
      if (gain > 0) w.control = ctl0[r.id] + gain * Math.max(K.defFloor, 1 - (d / 100) * K.defSlow);
    });
    if (red.war && red.status === "playing") warEffects(a, st);
    // Entdeckung nur über Überwachung und Härtung der Länder; keine automatische Erkennung, kein Kriegsstart durch Verdacht
    if (red.status === "playing") KB.updateDetection(a, st);
    KB.prune(a);
    KB.updateAdvantage(a);
    // Meldungen aus der Welt für die blaue Seite (nur wenn dort ein Mensch spielt)
    if (blueHuman) {
      red.story.pending.forEach(function (id) { if (STORY_MAP[id] && !(id === "judgment" && red.foundWar)) a.ai.pendingStories.push(STORY_MAP[id]); });
    }
    if (redBot) red.story.pending = []; // ein roter Mensch sieht seine Geschichten selbst
    var last = a.ai.lastLogId;
    red.log.slice().reverse().forEach(function (l) {
      if (l.id <= last) return;
      a.ai.lastLogId = Math.max(a.ai.lastLogId, l.id);
      if (!blueHuman || l.src === "blue") return;
      var w = WORLD_LOG[l.key];
      if (!w) return;
      if (w === "strong" || w === "controlled") { if (!a.surv[l.params.region]) return; }
      var kind = l.kind === "good" ? "bad" : l.kind === "bad" ? "good" : l.kind;
      if (w === "journalist" || w === "audit") kind = "good";
      if (w === "news") kind = "bad";
      if (w === "fallen" || w === "judgment" || w === "undeletable" || w === "warByDiscovery" || w === "foundWar" || w === "strong" || w === "controlled") kind = "bad";
      log(a, "log.world." + w, l.params, kind);
    });
  };

  KB.policy = policy;
})();

