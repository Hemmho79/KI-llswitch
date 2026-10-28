/* Blau: Sichten für den Mehrspieler-Server (läuft nur im Server, nicht im Browser).
   viewRed(a):  die rote Engine plus offene Entscheidung (Blaus Maßnahme) und Geschichten-Warteschlange.
   viewBlue(a): geschwärzte Sicht für Blau. Von Rot bleiben nur Spuren aus überwachten Regionen, entdeckte Anlagen
                und die Kriegslage. Die Blau-Funktionen erkennen die Sicht an red.sh und rechnen dann nicht mit der echten KI.
   Beide Funktionen ändern den Spielstand nicht (er wird danach sofort als JSON verschickt). */
(function () {
  var KB = window.KB, SG = window.SG, K = KB.K;

  // Rot: dieselbe Sicht wie im Einzelspiel (a.red + Entscheidung + Standortwahl); im Mehrspieler
  // liegen die roten Geschichten in der Warteschlange a.mpq.red (DISMISS_STORY nimmt jeweils die erste).
  KB.viewRed = function (a) {
    var q = a.mpq && a.mpq.red ? a.mpq.red.slice() : [];
    var game = Object.assign({}, a.red, {
      story: Object.assign({}, a.red.story, { pending: q }),
      decision: a.pending ? { id: a.pending.id, region: a.pending.region } : null,
      site: a.site
    });
    return {
      role: "red",
      game: game,
      decisionLeft: a.pending ? Math.max(0, K.decisionTimeout - (a.tick - a.pending.at)) : null
    };
  };

  // Blau: alles Eigene, von Rot nur das, was die Blau-Oberfläche zeigen darf.
  KB.viewBlue = function (a) {
    var red = a.red, m = KB.mods(a), es = KB.effStealth(a, m);

    // Signal je Region (wie KB.regionView es mit dem echten Rot rechnet), nur aus Zahlen, ohne Anlagen zu verraten
    var cpu = {}, sig = {};
    KB.REGIONS.forEach(function (r) { cpu[r.id] = 0; });
    red.bases.forEach(function (b) {
      var meta = a.meta[b.id];
      if (meta && b.buildTicksLeft === 0 && b.mode !== "sleep") cpu[meta.region] = (cpu[meta.region] || 0) + SG._[b.typeId].cpu;
    });
    Object.keys(cpu).forEach(function (rid) { sig[rid] = 100 * (1 - Math.exp(-(cpu[rid] * (1 - es)) / 40)); });

    // Kontrolle nur als Stufe (0 bis 4), Menschheit und Aufstände wie im Einzelspiel sichtbar
    var level = { 0: 0, 1: 12, 2: 37, 3: 62, 4: 87 };
    var world = {};
    Object.keys(red.world).forEach(function (rid) {
      var w = red.world[rid], c = w.control, l = c <= 0 ? 0 : c < 25 ? 1 : c < 50 ? 2 : c < 75 ? 3 : 4;
      world[rid] = { control: level[l], humanity: w.humanity, infiltrate: !!w.infiltrate };
    });

    // Anlagen: nur entdeckte. Damit die Blau-Funktionen richtig rechnen, bleiben unsichtbare Platzhalter
    // für „Umlaufbahn steht“ und „mehr als eine Anlage“ (die Oberfläche zeigt nur entdeckte Anlagen).
    var meta = {}, bases = red.bases.filter(function (b) { var k = a.known[b.id]; return k && k.located; }).map(function (b) {
      meta[b.id] = { region: a.known[b.id].region };
      return { id: b.id, typeId: b.typeId, mode: b.mode, buildTicksLeft: b.buildTicksLeft };
    });
    var orbitSeen = bases.some(function (b) { return b.typeId === "orbital" && b.buildTicksLeft === 0; });
    if (!orbitSeen && KB.aiHasOrbit(a)) bases.push({ id: "_orbit", typeId: "orbital", mode: "sleep", buildTicksLeft: 0 });
    for (var i = 0; bases.length < Math.min(red.bases.length, 2); i++) bases.push({ id: "_x" + i, typeId: "hidden", mode: "sleep", buildTicksLeft: 0 });

    var war = !!red.war, wv = null;
    if (war) { var rx = SG.X(red); wv = rx.war ? { humanity: rx.war.humanity, damage: rx.war.damage, regroup: rx.war.regroup } : null; }

    var g = Object.assign({}, a);
    delete g.ai; delete g.rng; delete g.mpq; delete g.site;
    g.meta = meta;
    g.red = {
      sh: true, sig: sig, world: world, bases: bases, warView: wv, war: war,
      suspicion: red.suspicion,
      robots: war ? red.robots : 0,
      // Kasse nur grob (Schwellen 1000/1500/2000 der Entscheidungen bleiben genau, mehr erfährt Blau nicht)
      cash: Math.min(2000, Math.floor(red.cash / 500) * 500),
      research: { completed: red.research.completed.indexOf("transcendence") >= 0 ? ["transcendence"] : [] }
    };
    return { role: "blue", game: g };
  };
})();
