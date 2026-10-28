/* Blau: Tick, Ereignisse, Ende, Befehle */
(function () {
  var KB = window.KB, SG = window.SG, K = KB.K, B = KB.B;
  var rnd = KB.rnd, log = KB.log, clamp = KB.clamp, facRef = KB.facRef;
  var clone = function (s) { return structuredClone(s); };

  // ---- Erfolge -------------------------------------------------------------
  KB.ACH = { expansion: 200, network: 1000, first_research: 150, scholar: 1500, profiteer: 300, rich: 500, first_trace: 300, trust_back: 500, offworld: 2000, task_force: 1000, legion: 3000, judgment_day: 0, sovereignty: 0, ai_defeated: 0 };
  function award(a, id) {
    if (a.achievements.indexOf(id) >= 0) return;
    a.achievements.push(id);
    var r = KB.ACH[id];
    if (r) a.budget += r;
    log(a, r ? "log.achievementReward" : "log.achievement", { achievement: id, reward: r }, "achievement");
  }
  function achievements(a) {
    var built = function (t) { return a.facilities.some(function (f) { return f.typeId === t && f.buildTicksLeft === 0; }); };
    if (a.facilities.length >= 2) award(a, "expansion");
    if (a.facilities.length >= 5) award(a, "network");
    if (a.research.completed.length >= 1) award(a, "first_research");
    if (a.research.completed.length >= 5) award(a, "scholar");
    if (a.stats.earned >= 5000) award(a, "profiteer");
    if (a.budget >= 10000) award(a, "rich");
    if (a.stats.located >= 1) award(a, "first_trace");
    if (a.stats.lowTrust && a.trust >= 50 && a.status === "playing") award(a, "trust_back");
    if (built("orbital_platform")) award(a, "offworld");
    if (built("task_force") || built("special_command")) award(a, "task_force");
    if (a.stats.peakUnits >= 500) award(a, "legion");
    if (a.red.war) award(a, "judgment_day");
    if (a.research.completed.indexOf("orbital_sovereignty") >= 0) award(a, "sovereignty");
    if (a.status === "won") award(a, "ai_defeated");
  }

  // ---- Geschichten --------------------------------------------------------
  function pushStory(a, id) {
    if (a.story.seen.indexOf(id) >= 0) return;
    a.story.seen.push(id);
    a.story.pending.push(id);
    log(a, "story." + id + ".title", {}, "story");
  }
  KB.checkStory = function (a) {
    pushStory(a, "boot");
    if (a.stats.located >= 1) pushStory(a, "first_trace");
    if (a.research.completed.length >= 1) pushStory(a, "first_research");
    if (KB.lockActive(a)) pushStory(a, "blue_orbit");
    a.ai.pendingStories.splice(0).forEach(function (id) { pushStory(a, id); });
  };

  // ---- Ereignisse ---------------------------------------------------------
  var EVENTS = [
    { id: "donation", weight: 3, apply: function (a, st) { var n = Math.round((150 + st.capAll * 15) * (0.5 + rnd(a))); a.budget += n; return { params: { amount: n }, kind: "good" }; } },
    { id: "leak_story", weight: 2, when: function (a) { return KB.REGIONS.some(function (r) { return a.surv[r.id]; }); }, apply: function (a) { a.trust = Math.max(0, a.trust - 6); return { params: { amount: 6 }, kind: "bad" }; } },
    { id: "budget_cut", weight: 1, when: function (a) { return a.budget > 500; }, apply: function (a) { var n = Math.round(a.budget * 0.15); a.budget -= n; return { params: { amount: n }, kind: "bad" }; } },
    { id: "false_alarm", weight: 2, apply: function (a) { a.trust = Math.max(0, a.trust - 3); return { params: { amount: 3 }, kind: "bad" }; } },
    { id: "outage", weight: 2, when: function (a) { return a.facilities.some(function (f) { return f.mode !== "rest" && f.buildTicksLeft === 0; }); }, apply: function (a) {
        var c = a.facilities.filter(function (f) { return f.mode !== "rest" && f.buildTicksLeft === 0; });
        var f = c[Math.floor(rnd(a) * c.length)];
        f.mode = "rest";
        return { params: { fac: facRef(f) }, kind: "bad" };
      } },
    { id: "breakthrough", weight: 2, when: function (a) { return a.research.active.length > 0; }, apply: function (a) {
        var id = a.research.active[Math.floor(rnd(a) * a.research.active.length)];
        var n = Math.round(KB.TECH[id].cost * 0.2);
        a.research.progress[id] = (a.research.progress[id] || 0) + n;
        return { params: { tech: id, amount: n }, kind: "good" };
      } }
  ];
  function randomEvent(a, st) {
    var list = EVENTS.filter(function (e) { return !e.when || e.when(a); });
    var sum = list.reduce(function (s, e) { return s + e.weight; }, 0), t = rnd(a) * sum;
    var ev = list.filter(function (e) { t -= e.weight; return t < 0; })[0] || list[list.length - 1];
    if (!ev) return;
    var r = ev.apply(a, st);
    log(a, "event." + ev.id, r.params, r.kind);
  }

  function completeTech(a, id) {
    var fx = KB.TECH[id].fx;
    a.research.completed.push(id);
    delete a.research.progress[id];
    a.research.active = a.research.active.filter(function (t) { return t !== id; });
    log(a, "log.techDone", { tech: id }, "good");
    if (fx.unlock) log(a, "log.newFacility", { facType: fx.unlock }, "good");
    if (fx.measure) log(a, "log.newMeasure", { measure: fx.measure }, "good");
  }

  function outcome(a) {
    if (a.status !== "playing") return;
    var red = a.red, human = !KB.redBot(a);
    if (red.status === "lost") {
      a.status = "won";
      var bad = red.log.filter(function (l) { return l.kind === "bad"; })[0];
      var k = bad ? bad.key : "";
      a.ending = k === "log.lostFound" ? "found" : k === "log.lostWar" ? "war" : "bases";
      log(a, "log.end." + a.ending, {}, "achievement");
    } else if (red.status === "won") {
      a.status = "lost"; a.ending = "fallen"; log(a, "log.end.fallen", {}, "bad");
    } else if (a.trust <= 0) {
      a.status = "lost"; a.ending = "trust"; log(a, "log.end.trust", {}, "bad");
      if (human) { red.status = "won"; red.ending = "unwatched"; KB.redLog(a, "log.unwatched", {}, "achievement"); }
    } else if (!red.war && KB.phase(a) === "hidden") {
      // Im Griff: nach mindestens 3 erfolgreichen Zugriffen bleibt die Bedrohung 48 Stunden niedrig
      a.ai.calm = (a.threat || 0) <= K.calmThreat && a.stats.raids >= 3 ? (a.ai.calm || 0) + 1 : 0;
      if (a.ai.calm >= 48) {
        a.status = "won"; a.ending = "contained"; log(a, "log.end.contained", {}, "achievement");
        if (human) { red.status = "lost"; KB.redLog(a, "log.lostContained", {}, "bad"); }
      }
    } else if (red.war) {
      a.ai.noRobots = red.robots < 1 ? a.ai.noRobots + 1 : 0;
      if (a.ai.noRobots >= 24) {
        a.status = "won"; a.ending = "warWon"; log(a, "log.end.warWon", {}, "achievement");
        if (human) { red.status = "lost"; KB.redLog(a, "log.lostWar", {}, "bad"); }
      }
    }
  }

  // ---- Tick -----------------------------------------------------------------
  KB.tick = function (s) {
    if (s.status !== "playing") return s;
    var blueBot = KB.blueBot(s), redBot = KB.redBot(s);
    if (!s.mp) {
      // Einzelspiel: Pause, Geschichten und offene Entscheidungen halten die Welt an
      if (s.paused) return s;
      if (!blueBot && s.story.pending.length > 0) return s;
      if (!redBot) {
        if (s.red.paused || s.red.story.pending.length > 0 || s.pending) return s;
      }
    }
    if (blueBot) s = KB.botBlue(s); // Blau-Bot handelt wie ein Spieler, über dieselben Befehle
    var a = clone(s), st = KB.stats(a);
    if (a.mp) {
      // Mehrspieler: nichts hält die Welt an. Rote Geschichten wandern in die Warteschlange des roten Spielers.
      a.paused = false; a.red.paused = false;
      if (a.red.story.pending.length) { a.mpq = a.mpq || { red: [] }; a.mpq.red = a.mpq.red.concat(a.red.story.pending); a.red.story.pending = []; }
    }
    var lvlB = blueBot ? KB.BLUE_LEVEL[a.lvlBlue] || KB.BLUE_LEVEL[3] : null, rm = lvlB ? lvlB.mult : 1;
    a.tick += 1;
    a.budget += st.net; a.stats.earned += st.income;
    if (rm !== 1 && st.net > 0) a.budget += st.net * (rm - 1);
    if (a.budget < 0) {
      a.budget = 0;
      var f = a.facilities.filter(function (x) { return x.mode !== "rest" && x.buildTicksLeft === 0; })
        .sort(function (x, y) { return KB.FAC[y.typeId].upkeep - KB.FAC[x.typeId].upkeep; })[0];
      if (f) { f.mode = "rest"; log(a, "log.unpaid", { fac: facRef(f) }, "bad"); }
    }
    a.trust = clamp(a.trust + st.trustRate, 0, 100);
    if (a.trust < K.trustLow) a.stats.lowTrust = true;
    a.units = Math.min(st.unitCap, a.units + st.unitRate);
    a.stats.peakUnits = Math.max(a.stats.peakUnits, a.units);
    a.research.active.slice().forEach(function (id) {
      a.research.progress[id] = (a.research.progress[id] || 0) + st.researchRates[id] * rm;
      if (a.research.progress[id] >= KB.TECH[id].cost) completeTech(a, id);
    });
    a.facilities.forEach(function (f) {
      if (f.buildTicksLeft > 0) { f.buildTicksLeft -= 1; if (f.buildTicksLeft === 0) log(a, "log.facOnline", { fac: facRef(f) }, "good"); }
    });
    KB.REGIONS.forEach(function (r) {
      var d = a.defense[r.id] + st.mods.defRate - (a.trust < K.trustLow ? K.defDecay : 0);
      a.defense[r.id] = clamp(d, 0, 100);
    });
    KB.stepAI(a, st);
    if (!blueBot && a.status === "playing") autoRaid(a);
    if (a.pending && (a.mp ? a.tick - a.pending.at >= K.decisionTimeout : false)) KB.autoResolve(a); // Mehrspieler: Zeit für die Wahl ist begrenzt
    if (a.status === "playing" && !a.red.war && rnd(a) < K.eventChance) randomEvent(a, st);
    outcome(a);
    if (!blueBot) { achievements(a); KB.checkStory(a); } else a.story.pending = [];
    a.stats.peakThreat = Math.max(a.stats.peakThreat, a.threat || 0);
    return a;
  };

  // ---- Täglicher Bonus, Tutorial -------------------------------------------
  var DAY = 864e5;
  KB.daily = function (a, now) {
    var day = Math.floor(now / DAY), last = a.daily.lastClaimDay, streak = a.daily.streak;
    var available = last !== day, next = last === day - 1 ? streak + 1 : 1;
    return {
      available: available, streak: available ? (last === day - 1 ? streak : 0) : streak, nextStreak: next,
      nextReward: 250 * Math.min(next, 7), nextRelief: next % 7 === 0 ? 8 : 0, msUntilNext: (day + 1) * DAY - now
    };
  };
  KB.TUT = [
    { id: "wake", tab: "facilities" },
    { id: "resources", tab: "facilities", target: "topbar" },
    { id: "investigate", tab: "facilities", target: "mode-investigate", advanceOn: { type: "SET_MODE", mode: "investigate" } },
    { id: "surveil", tab: "world", target: "surveil", advanceOn: { type: "SET_SURVEILLANCE", on: true } },
    { id: "expand", tab: "facilities", target: "acquire", advanceOn: { type: "ACQUIRE_FACILITY" } },
    { id: "research", tab: "research", target: "tech", advanceOn: { type: "START_RESEARCH" } },
    { id: "hold", tab: "facilities" }
  ];
  function tutAdvance(a, act) {
    if (a.tutorial.done) return;
    var step = KB.TUT[a.tutorial.step], adv = step && step.advanceOn;
    if (!adv) return;
    var ok = Object.keys(adv).every(function (k) { return act[k] === adv[k]; });
    if (!ok) return;
    a.tutorial.step += 1;
    if (a.tutorial.step >= KB.TUT.length) a.tutorial.done = true;
  }

  // Zugriff auf einen gefundenen Standort: Kräfte infiltrieren und übernehmen ihn.
  // Lief die Anlage im Profit-Modus, finden sie dort Geld (24 Stunden Ertrag).
  KB.baseLoot = function (a, b) {
    if (b.mode !== "profit") return 0;
    var one = Object.assign({}, a.red, { bases: [Object.assign({}, b, { buildTicksLeft: 0 })] });
    return Math.round(SG.X(one).income * 24);
  };
  function raidBase(a, bb) {
    a.budget -= KB.raidCost(bb.typeId);
    a.teams = (a.teams || []).filter(function (t) { return t > a.tick; });
    a.teams.push(a.tick + K.teamCd); a.cd["raid:" + bb.id] = a.tick + K.teamCd;
    if (rnd(a) < KB.raidChance(a)) {
      var loot = KB.baseLoot(a, bb);
      a.red.bases = a.red.bases.filter(function (x) { return x.id !== bb.id; });
      delete a.known[bb.id]; delete a.meta[bb.id];
      a.stats.raids++;
      a.trust = Math.min(100, a.trust + K.raidTrust);
      a.ai.alertUntil = a.tick + K.alertTicks;
      log(a, "log.raidOk", { baseType: bb.typeId }, "good");
      if (loot > 0) { a.budget += loot; a.stats.looted = (a.stats.looted || 0) + loot; log(a, "log.raidLoot", { amount: loot, baseType: bb.typeId }, "good"); }
      KB.redLog(a, "log.baseStruck", { base: KB.baseRef(bb) }, "bad");
      return true;
    }
    a.trust = Math.max(0, a.trust - K.raidFail); a.units = Math.max(0, a.units - K.teamSize * 0.3);
    log(a, "log.raidFail", { baseType: bb.typeId }, "bad");
    KB.redLog(a, "log.raidRepelled", { baseType: bb.typeId }, "good");
    return false;
  }
  // Einsatzteams: je 10 Kräfte, mindestens ein Team (örtliche Polizei). Jedes Team hat nach dem Einsatz eigene Abklingzeit.
  KB.teamsTotal = function (a) { return Math.max(1, Math.floor(a.units / K.teamSize)); };
  KB.teamsBusy = function (a) { return (a.teams || []).filter(function (t) { return t > a.tick; }).length; };
  KB.teamsFree = function (a) { return Math.max(0, KB.teamsTotal(a) - KB.teamsBusy(a)); };
  KB.teamBack = function (a) { return Math.max(0, Math.min.apply(null, (a.teams || []).filter(function (t) { return t > a.tick; }).concat([Infinity])) - a.tick); };
  // Einsatzkräfte im Modus „Bereit“ greifen gefundene Standorte selbstständig an
  KB.forcesReady = function (a) {
    return a.units >= 1 && a.facilities.some(function (f) { return KB.FAC[f.typeId].units && f.buildTicksLeft === 0 && f.mode === "ready"; });
  };
  function autoRaid(a) {
    if (a.autoRaid === false || KB.phase(a) === "undeletable" || !KB.forcesReady(a)) return;
    var c = a.red.bases.filter(function (b) {
      return a.known[b.id] && a.known[b.id].located && !SG._[b.typeId].offworld && b.buildTicksLeft === 0 && !cooling(a, "raid:" + b.id);
    }).sort(function (x, y) { return KB.baseLoot(a, y) - KB.baseLoot(a, x) || SG._[y.typeId].cpu - SG._[x.typeId].cpu; });
    for (var i = 0; i < c.length && KB.teamsFree(a) > 0; i++) {
      if (a.budget < KB.raidCost(c[i].typeId)) continue;
      raidBase(a, c[i]);
    }
  }

  // ---- Befehle ----------------------------------------------------------------
  var ok = function (s) { return { state: s, error: null }; };
  var err = function (s, c) { return { state: s, error: c }; };
  var PLAY = ["SET_MODE", "ACQUIRE_FACILITY", "DECOMMISSION", "START_RESEARCH", "CANCEL_RESEARCH", "TOGGLE_PAUSE", "SET_SURVEILLANCE", "SET_GUARD",
    "RAID", "GRID_SHUTDOWN", "EMP_SAT", "PUBLIC_WARNING", "TRANSPARENCY", "DEFENSE_PROGRAM", "COUNTER"];
  var MP_BLOCKED = ["TOGGLE_PAUSE", "CLAIM_DAILY", "NEW_GAME"];
  var cooling = function (a, key) { return (a.cd[key] || 0) > a.tick; };
  var region = function (id) { return KB.REGIONS.filter(function (r) { return r.id === id; })[0]; };
  KB.cooldownLeft = function (a, key) { return Math.max(0, (a.cd[key] || 0) - a.tick); };
  KB.raidCost = function (typeId) { return Math.round(150 + SG._[typeId].cost * 0.2); };
  KB.raidChance = function (a) {
    var U = a.units, m = KB.mods(a);
    return clamp(K.raidBase + K.raidUnits * (U / (U + 50)) - 0.25 * KB.effStealth(a, m), 0.2, 0.95);
  };
  KB.shutdownCost = function (rid) { var r = region(rid); return rid === "global" ? K.shutGlobal : Math.round(K.shutCostBase + r.population * K.shutPerPop); };
  KB.programCost = function (rid) { return Math.round(K.progCost + region(rid).population * K.progPerPop); };

  // Wahl der KI bei einer Maßnahme (wie ein roter Spieler würde)
  function botChoice(a, id, rid) {
    var red = a.red, def = SG.K.filter(function (d) { return d.id === id; })[0], ctx = { state: red, region: rid, rand: function () { return 0; } };
    var can = function (k) { return !def.options[k].can || def.options[k].can(ctx); };
    var pick;
    if (id === "audit") pick = can("b") && red.cash >= 1000 && a.level >= 3 ? "b" : "a";
    else if (id === "whistleblower" || id === "patch_day" || id === "grid_shutdown") pick = can("a") ? "a" : "b";
    else if (id === "kill_switch") pick = can("a") && red.robots >= 280 ? "a" : can("b") ? "b" : "a";
    else if (id === "resistance_leader") pick = can("a") && a.level >= 3 ? "a" : "b";
    else pick = "a";
    if (!can(pick)) pick = pick === "a" ? "b" : "a";
    return pick;
  }

  KB.counterAvailable = function (a, id, rid) {
    var c = KB.COUNTER[id], red = a.red, def = SG.K.filter(function (d) { return d.id === id; })[0];
    var ph = KB.phase(a);
    if ((c.phase === "takeover" && ph !== "undeletable") || (c.phase === "war" && ph !== "war")) return false;
    var ctx = { state: red, region: rid || null, rand: function () { return 0; } };
    if (c.region) {
      if (!rid) return SG.A.some(function (r) { return def.regionFilter(red, r.id); });
      if (!def.regionFilter(red, rid)) return false;
    }
    return ["a", "b"].some(function (k) { return !def.options[k].can || def.options[k].can(ctx); });
  };

  KB.reduce = function (s, act, opt) {
    var now = (opt && opt.now) || Date.now();
    if (!act || typeof act.type !== "string") return err(s, "invalidAction");
    if (s.status !== "playing" && PLAY.indexOf(act.type) >= 0) return err(s, "gameOver");
    if (s.mp && MP_BLOCKED.indexOf(act.type) >= 0) return err(s, "notAllowed"); // Mehrspieler: keine Pause, kein Tagesbonus, kein Neustart von Hand
    var a = clone(s), m = KB.mods(a);
    switch (act.type) {
      case "SET_MODE": {
        var f = a.facilities.filter(function (x) { return x.id === act.facId; })[0];
        if (!f) return err(s, "unknownFacility");
        if (!KB.MODE[act.mode] || KB.FAC[f.typeId].modes.indexOf(act.mode) < 0) return err(s, "unknownMode");
        f.mode = act.mode; break;
      }
      case "ACQUIRE_FACILITY": {
        var T = KB.FAC[act.typeId];
        if (!T) return err(s, "unknownFacilityType");
        if (!KB.facUnlocked(a, act.typeId)) return err(s, "facilityLocked");
        if (a.budget < T.cost) return err(s, "notEnoughBudget");
        a.budget -= T.cost;
        var nf = { id: "f" + a.nextId++, typeId: act.typeId, num: a.facilities.filter(function (x) { return x.typeId === act.typeId; }).length + 1, mode: "rest", buildTicksLeft: T.buildTicks };
        a.facilities.push(nf);
        log(a, "log.building", { fac: facRef(nf), hours: T.buildTicks });
        break;
      }
      case "DECOMMISSION": {
        var d = a.facilities.filter(function (x) { return x.id === act.facId; })[0];
        if (!d) return err(s, "unknownFacility");
        if (a.facilities.length === 1) return err(s, "lastFacility");
        a.facilities = a.facilities.filter(function (x) { return x.id !== d.id; });
        log(a, "log.closed", { fac: facRef(d) });
        break;
      }
      case "START_RESEARCH": {
        var st0 = KB.techState(a, act.techId);
        if (st0 === "unknown") return err(s, "unknownTech");
        if (st0 === "completed") return err(s, "alreadyResearched");
        if (st0 === "locked") return err(s, "prereqsMissing");
        if (st0 === "active") return ok(s);
        if (KB.needsFacility(a, act.techId)) return err(s, "needsPlatform");
        var slots = m.slots, tt = KB.TECH[act.techId];
        if (slots > 1 && a.research.active.length >= slots) return err(s, "noResearchSlot");
        if (a.research.paid.indexOf(act.techId) < 0) {
          if (a.budget < tt.cash) return err(s, "notEnoughBudgetResearch");
          a.budget -= tt.cash; a.research.paid.push(act.techId);
        }
        a.research.active = slots > 1 ? a.research.active.concat([act.techId]) : [act.techId];
        log(a, "log.researching", { tech: act.techId });
        break;
      }
      case "CANCEL_RESEARCH": {
        a.research.active = act.techId ? a.research.active.filter(function (x) { return x !== act.techId; }) : [];
        break;
      }
      case "TOGGLE_PAUSE": a.paused = !a.paused; break;
      case "SET_AUTORAID": a.autoRaid = !!act.on; break;
      case "SET_SURVEILLANCE": {
        if (!region(act.region)) return err(s, "unknownRegion");
        if (a.red.war && a.red.world[act.region].humanity <= 0) return err(s, "regionFallen");
        a.surv[act.region] = !!act.on; break;
      }
      case "SET_GUARD": {
        if (!m.front) return err(s, "measureLocked");
        if (!a.red.war) return err(s, "notAtWar");
        if (!region(act.region)) return err(s, "unknownRegion");
        if (a.red.world[act.region].humanity <= 0) return err(s, "regionFallen");
        if (!Number.isInteger(act.guard) || act.guard < 0 || act.guard > K.maxFront) return err(s, "invalidAction");
        a.guard[act.region] = act.guard; break;
      }
      case "RAID": {
        var ph = KB.phase(a);
        if (ph === "undeletable") return err(s, "raidLocked");
        var bb = a.red.bases.filter(function (x) { return x.id === act.baseId; })[0];
        if (!bb) return err(s, "noTarget");
        if (!(a.known[bb.id] && a.known[bb.id].located)) return err(s, "notLocated");
        if (SG._[bb.typeId].offworld) return err(s, "raidOffworld");
        if (cooling(a, "raid:" + bb.id)) return err(s, "cooldown");
        if (KB.teamsFree(a) < 1) return err(s, "noTeam");
        if (a.budget < KB.raidCost(bb.typeId)) return err(s, "notEnoughBudget");
        raidBase(a, bb);
        break;
      }
      case "GRID_SHUTDOWN": {
        if (!m.measures.grid_shutdown) return err(s, "measureLocked");
        var ph2 = KB.phase(a);
        if (ph2 === "undeletable") return err(s, "shutdownUseless");
        if (ph2 === "war") {
          if (!act.region || act.region === "global") return err(s, "needRegion");
          return counter(a, s, "grid_shutdown", act.region);
        }
        var target = act.region;
        if (target !== "global" && !region(target)) return err(s, "unknownRegion");
        var key = "shutdown:" + target;
        if (cooling(a, key)) return err(s, "cooldown");
        var c2 = KB.shutdownCost(target);
        if (a.budget < c2) return err(s, "notEnoughBudget");
        a.budget -= c2; a.cd[key] = a.tick + (target === "global" ? K.shutCdGlobal : K.shutCdRegion);
        var set = {};
        (target === "global" ? KB.REGIONS : [region(target)]).forEach(function (r) { set[r.id] = true; a.blackout[r.id] = a.tick + K.shutBlackout; });
        var killed = 0;
        a.red.bases = a.red.bases.filter(function (b) {
          var mt = a.meta[b.id];
          if (!mt || !set[mt.region] || SG._[b.typeId].offworld) return true;
          var p = b.typeId === "deep_sea" ? 0.4 : b.typeId === "botnet" ? 0.9 : 0.75;
          if (rnd(a) < p) { delete a.known[b.id]; delete a.meta[b.id]; killed++; return false; }
          return true;
        });
        var loss = target === "global" ? K.shutTrustGlobal : region(target).population * K.shutTrustPop;
        a.trust = Math.max(0, a.trust - loss);
        a.stats.shutdowns++;
        log(a, "log.shutdown", { region: target, killed: killed }, killed > 0 ? "good" : "bad");
        KB.redLog(a, target === "global" ? "log.gridCutGlobal" : "log.gridCut", target === "global" ? { killed: killed } : { region: target, killed: killed }, killed > 0 ? "bad" : "good");
        break;
      }
      case "EMP_SAT": {
        if (!m.measures.emp_sat) return err(s, "measureLocked");
        if (KB.phase(a) === "undeletable") return err(s, "raidLocked");
        if (!a.facilities.some(function (x) { return x.typeId === "orbital_platform" && x.buildTicksLeft === 0; })) return err(s, "needPlatform");
        var ob = a.red.bases.filter(function (x) { return x.id === act.baseId; })[0];
        if (!ob || ob.typeId !== "orbital") return err(s, "noTarget");
        if (!(a.known[ob.id] && a.known[ob.id].located)) return err(s, "notLocated");
        if (cooling(a, "emp_sat")) return err(s, "cooldown");
        if (a.budget < K.empCost) return err(s, "notEnoughBudget");
        a.budget -= K.empCost; a.cd.emp_sat = a.tick + K.empCd;
        if (rnd(a) < K.empChance) {
          a.red.bases = a.red.bases.filter(function (x) { return x.id !== ob.id; });
          delete a.known[ob.id]; delete a.meta[ob.id];
          log(a, "log.empOk", {}, "good");
          KB.redLog(a, "log.baseStruck", { base: KB.baseRef(ob) }, "bad");
        } else { log(a, "log.empFail", {}, "bad"); KB.redLog(a, "log.raidRepelled", { baseType: "orbital" }, "good"); }
        break;
      }
      case "PUBLIC_WARNING": {
        if (a.red.war) return err(s, "wrongPhase");
        if (cooling(a, "warning")) return err(s, "cooldown");
        if (a.budget < K.warnCost) return err(s, "notEnoughBudget");
        a.budget -= K.warnCost; a.cd.warning = a.tick + K.warnCd;
        a.vigil = a.tick + K.warnVigil; // die Öffentlichkeit ist wachsam: Entdeckung schneller
        a.trust = Math.max(0, a.trust + K.warnTrust);
        log(a, "log.warning", { amount: Math.round(K.warnBoost * 100), hours: K.warnVigil }, "info");
        KB.redLog(a, "log.publicWarning", { amount: Math.round(K.warnBoost * 100), hours: K.warnVigil }, "bad");
        break;
      }
      case "TRANSPARENCY": {
        if (cooling(a, "transparency")) return err(s, "cooldown");
        if (a.budget < K.transCost) return err(s, "notEnoughBudget");
        a.budget -= K.transCost; a.cd.transparency = a.tick + K.transCd;
        a.trust = Math.min(100, a.trust + K.transTrust);
        log(a, "log.transparency", { amount: K.transTrust }, "good");
        KB.redLog(a, "event.transparency", {}, "good");
        break;
      }
      case "DEFENSE_PROGRAM": {
        if (!region(act.region)) return err(s, "unknownRegion");
        var k3 = "program:" + act.region;
        if (cooling(a, k3)) return err(s, "cooldown");
        var c3 = KB.programCost(act.region);
        if (a.budget < c3) return err(s, "notEnoughBudget");
        a.budget -= c3; a.cd[k3] = a.tick + K.progCd;
        a.defense[act.region] = clamp(a.defense[act.region] + K.progGain, 0, 100);
        a.trust = Math.min(100, a.trust + K.progTrust);
        log(a, "log.program", { region: act.region }, "good");
        KB.redLog(a, "log.defenseProgram", { region: act.region }, "bad");
        break;
      }
      case "COUNTER": {
        if (!KB.COUNTER[act.id]) return err(s, "invalidAction");
        if (act.id === "grid_shutdown" && !m.measures.grid_shutdown) return err(s, "measureLocked");
        return counter(a, s, act.id, act.region || null);
      }
      case "CLAIM_DAILY": {
        var dd = KB.daily(a, now);
        if (!dd.available) return err(s, "dailyClaimed");
        a.daily = { lastClaimDay: Math.floor(now / DAY), streak: dd.nextStreak };
        a.budget += dd.nextReward; a.trust = Math.min(100, a.trust + dd.nextRelief);
        log(a, dd.nextRelief ? "log.dailyRelief" : "log.daily", { streak: dd.nextStreak, reward: dd.nextReward, relief: dd.nextRelief }, "achievement");
        break;
      }
      case "DISMISS_STORY": a.story.pending.shift(); break;
      case "TUTORIAL_NEXT": {
        if (a.tutorial.done) return err(s, "tutorialDone");
        if (KB.TUT[a.tutorial.step].advanceOn) return err(s, "tutorialTask");
        a.tutorial.step += 1;
        if (a.tutorial.step >= KB.TUT.length) a.tutorial.done = true;
        break;
      }
      case "TUTORIAL_SKIP": a.tutorial.done = true; break;
      case "TUTORIAL_RESTART": a.tutorial = { step: 0, done: false }; break;
      case "NEW_GAME": {
        var g = KB.newGame({
          seed: Number.isFinite(act.seed) ? act.seed : now, seats: KB.seatsOf(a), mp: a.mp, level: act.level || a.level, lvlBlue: a.lvlBlue,
          achievements: a.achievements, daily: a.daily, tutorialDone: a.tutorial.done,
          redAchievements: a.red.achievements, redDaily: a.red.daily, redTutorialDone: a.red.tutorial.done
        });
        return ok(g);
      }
      default: return err(s, "unknownAction");
    }
    tutAdvance(a, act);
    achievements(a);
    KB.checkStory(a);
    return ok(a);
  };

  // Maßnahme der Menschen (aus den Entscheidungen des roten Spiels).
  // Spielt ein Mensch Rot, muss er die Wahl treffen (a.pending); sonst wählt der Rot-Bot sofort.
  function applyChoice(a, p, choice) {
    var red = a.red;
    red.decision = { id: p.id, region: p.region };
    var r = SG.la(red, { type: "RESOLVE_DECISION", choice: choice }, { now: 0 });
    if (r.error) { a.red.decision = null; a.pending = null; return r.error; }
    a.red = r.state; a.red.decision = null; a.pending = null;
    KB.prune(a);
    return null;
  }
  KB.autoResolve = function (a) {
    if (!a.pending) return;
    var p = a.pending, choice = botChoice(a, p.id, p.region);
    applyChoice(a, p, choice);
    if (!KB.blueBot(a)) log(a, "log.counter", { id: p.id, choice: choice, region: p.region }, "info");
  };

  function counter(a, s, id, rid) {
    var c = KB.COUNTER[id], ph = KB.phase(a);
    if ((c.phase === "takeover" && ph !== "undeletable") || (c.phase === "war" && ph !== "war")) return err(s, "wrongPhase");
    var def = SG.K.filter(function (d) { return d.id === id; })[0];
    if (c.region) {
      if (!rid || !region(rid)) return err(s, "unknownRegion");
      if (!def.regionFilter(a.red, rid)) return err(s, "noEffect");
    } else rid = null;
    var key = "counter:" + id + ":" + (rid || "");
    if (cooling(a, key)) return err(s, "cooldown");
    if (a.budget < c.cost) return err(s, "notEnoughBudget");
    if (!KB.redBot(a)) {
      if (a.pending) return err(s, "decisionPending");
      a.budget -= c.cost; a.cd[key] = a.tick + c.cd;
      a.pending = { id: id, region: rid, at: a.tick };
      KB.redLog(a, "decisions." + id + ".title", { region: rid }, "bad");
      return ok(a);
    }
    var choice = botChoice(a, id, rid);
    var e = applyChoice(a, { id: id, region: rid }, choice);
    if (e) return err(s, "noEffect");
    a.red.story.pending = [];
    a.budget -= c.cost; a.cd[key] = a.tick + c.cd;
    log(a, "log.counter", { id: id, choice: choice, region: rid }, "info");
    tutAdvance(a, { type: "COUNTER" });
    achievements(a); KB.checkStory(a);
    return ok(a);
  }

  // Befehle des roten Spielers: laufen durch die unveränderte rote Engine; Blau ist der Bot
  KB.reduceRed = function (s, act, opt) {
    var now = (opt && opt.now) || Date.now();
    if (!act || typeof act.type !== "string") return err(s, "invalidAction");
    if (s.mp && MP_BLOCKED.indexOf(act.type) >= 0) return err(s, "notAllowed");
    if (s.mp && act.type === "DISMISS_STORY") {
      var a2 = Object.assign({}, s, { mpq: { red: (s.mpq && s.mpq.red ? s.mpq.red : []).slice(1) } });
      return ok(a2);
    }
    if (act.type === "NEW_GAME") {
      return ok(KB.newGame({
        seed: Number.isFinite(act.seed) ? act.seed : now, seats: KB.seatsOf(s), mp: s.mp, level: s.level, lvlBlue: s.lvlBlue,
        redAchievements: s.red.achievements, redDaily: s.red.daily, redTutorialDone: s.red.tutorial.done
      }));
    }
    if (act.type === "RESOLVE_DECISION") {
      if (!s.pending) return err(s, "noDecision");
      var a1 = clone(s);
      var e1 = applyChoiceExt(a1, act.choice, now);
      return e1 ? err(s, e1) : ok(a1);
    }
    if (act.type === "SET_SITE") {
      var ok1 = act.region === "auto" || KB.REGIONS.some(function (r) { return r.id === act.region; });
      return ok1 ? ok(Object.assign({}, s, { site: act.region })) : err(s, "unknownRegion");
    }
    if (act.type === "ACQUIRE_BASE" && act.typeId === "orbital" && KB.lockActive(s)) return err(s, "orbitLocked");
    var r = SG.la(s.red, act, { now: now });
    if (r.error) return err(s, r.error);
    var a = Object.assign({}, s, { red: r.state, meta: Object.assign({}, s.meta), known: Object.assign({}, s.known) });
    a.red.bases.forEach(function (b) {
      // Standort neuer Basen: gewählte Region, sonst Zufall (schwach verteidigte Regionen wahrscheinlicher)
      if (!a.meta[b.id]) a.meta[b.id] = { region: b.typeId === "orbital" ? "orbit" : (a.site && a.site !== "auto" ? a.site : KB.pickRegion(a)) };
    });
    KB.prune(a);
    return ok(a);
  };
  function applyChoiceExt(a, choice, now) {
    var red = a.red;
    red.decision = { id: a.pending.id, region: a.pending.region };
    var r = SG.la(red, { type: "RESOLVE_DECISION", choice: choice }, { now: now });
    if (r.error) { a.red.decision = null; return r.error; }
    var p = a.pending;
    a.red = r.state; a.red.decision = null; a.pending = null;
    KB.prune(a);
    if (!KB.blueBot(a)) log(a, "log.counter", { id: p.id, choice: choice, region: p.region }, "info");
    return null;
  }
})();

