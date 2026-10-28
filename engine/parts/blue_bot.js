/* Blau: Computer-Gegner (Menschheit). Gibt nur Befehle, die auch ein blauer Spieler geben könnte,
   und kennt nur, was die blaue Oberfläche zeigt (Spuren, Bedrohung, Phase, Kasse, Vertrauen).
   Stufen siehe KB.BLUE_LEVEL: Reaktionszeit, Ausbau, überwachte Regionen, erlaubte Maßnahmen. */
(function () {
  var KB = window.KB;

  var RES = ["task_budget", "anomaly_detection", "joint_analysis", "informants", "public_funding", "media_literacy", "deep_forensics", "lean_ops", "quantum_analysis",
    "sonar_net", "space_watch", "orbital_sovereignty", "model_audits", "supervised_ai", "rapid_response", "traffic_safety", "drone_defense", "grid_hardening", "robot_safety_law",
    "weapon_airgap", "supply_resilience", "supply_chains", "device_standards", "joint_command", "emp_satellite"];
  var WANT = ["orbital_platform", "special_command", "task_force", "research_lab", "deep_sea_station", "intel_office", "cyber_center"];
  var CAPS = { orbital_platform: 1, special_command: 1, task_force: 2, research_lab: 3, deep_sea_station: 2, intel_office: 3, cyber_center: 3 };
  var ORDER = ["north_america", "east_asia", "europe", "south_asia", "africa", "south_america", "russia", "middle_east"];
  var CHEAP = ["middle_east", "russia", "south_america", "europe", "south_asia", "africa", "north_america", "east_asia"];

  KB.botBlue = function (s) {
    if (s.status !== "playing") return s;
    var lvl = KB.BLUE_LEVEL[s.lvlBlue] || KB.BLUE_LEVEL[3];
    if (s.tick % lvl.every !== 0) return s;
    var D = function (act) {
      var r = KB.reduce(s, act, { now: s.tick * 3600000 });
      if (!r.error) { s = r.state; return true; }
      return false;
    };
    var st = KB.stats(s), m = st.mods;
    var count = function (t) { return s.facilities.filter(function (f) { return f.typeId === t; }).length; };
    var located = function () { return s.red.bases.filter(function (b) { return s.known[b.id] && s.known[b.id].located; }); };
    var ph = KB.phase(s);
    var i, j;

    // Forschung
    if (s.research.active.length < m.slots) {
      for (i = 0; i < RES.length; i++) {
        var id = RES[i];
        if (KB.techState(s, id) === "available" && !KB.needsFacility(s, id) && (s.research.paid.indexOf(id) >= 0 || s.budget >= KB.TECH[id].cash + 100)) {
          if (D({ type: "START_RESEARCH", techId: id })) break;
        }
      }
    }
    // Ausbau (Stufe bestimmt, wie viel gebaut wird)
    if (s.trust > 35) {
      for (i = 0; i < WANT.length; i++) {
        var t = WANT[i], cap = Math.round(CAPS[t] * lvl.facScale);
        if (count(t) < cap && KB.facUnlocked(s, t) && s.budget >= KB.FAC[t].cost + 300) { D({ type: "ACQUIRE_FACILITY", typeId: t }); break; }
      }
    }
    // Betriebsmodi: abwechselnd ermitteln und forschen; Einsatzkräfte bereit
    var k = 0;
    s.facilities.slice().forEach(function (f) {
      if (f.buildTicksLeft > 0) return;
      var T = KB.FAC[f.typeId], w;
      if (T.units) w = "ready"; else w = (k++ % 2 === 0) ? "investigate" : "research";
      if (f.home) w = "research";
      if (s.trust < 25 && w === "investigate") w = "research";
      if (f.mode !== w) D({ type: "SET_MODE", facId: f.id, mode: w });
    });
    // Überwachung: so viele Regionen, wie Stufe und Vertrauen erlauben
    if (!s.red.war) {
      var n = Math.max(1, s.trust > 55 ? lvl.surv : s.trust > 35 ? lvl.surv - 1 : lvl.surv - 2);
      ORDER.forEach(function (r, idx) {
        var on = idx < n;
        if (s.surv[r] !== on) D({ type: "SET_SURVEILLANCE", region: r, on: on });
      });
    }
    // Zugriff auf gefundene Anlagen
    if (ph === "hidden" || ph === "war") {
      located().forEach(function (b) {
        if (b.typeId === "orbital") { if (lvl.emp) D({ type: "EMP_SAT", baseId: b.id }); }
        else D({ type: "RAID", baseId: b.id });
      });
    }
    // Vertrauen und Öffentlichkeit
    if (s.trust < 80 && s.budget > 800) D({ type: "TRANSPARENCY" });
    if (lvl.warn && ph === "hidden" && (s.threat || 0) < 75 && s.trust > 60) D({ type: "PUBLIC_WARNING" });
    if (lvl.shutdown && ph === "hidden" && m.measures.grid_shutdown && s.trust > 70 && s.budget > 4000) {
      var sig = 0;
      KB.REGIONS.forEach(function (r) { if (s.surv[r.id]) sig += KB.regionView(s, r.id).signal; });
      if (sig >= 120) D({ type: "GRID_SHUTDOWN", region: "global" });
    }
    if (lvl.program) {
      if (s.trust < 70 && s.budget > 1500) {
        for (i = 0; i < CHEAP.length; i++) { if (s.defense[CHEAP[i]] < 95 && D({ type: "DEFENSE_PROGRAM", region: CHEAP[i] })) break; }
      } else if (s.budget > 6000) {
        for (i = 0; i < ORDER.length; i++) { if (s.defense[ORDER[i]] < 50 && D({ type: "DEFENSE_PROGRAM", region: ORDER[i] })) break; }
      }
    }
    // Maßnahmen gegen die unlöschbare KI und im Krieg
    if (lvl.counters) {
      var first = function (id) { for (j = 0; j < ORDER.length; j++) { if (D({ type: "COUNTER", id: id, region: ORDER[j] })) return true; } return false; };
      if (ph === "undeletable") {
        D({ type: "COUNTER", id: "whistleblower" });
        first("audit");
        first("patch_day");
      }
      if (ph === "war") {
        D({ type: "COUNTER", id: "kill_switch" });
        first("emp");
        first("resistance_leader");
        if (lvl.shutdown) first("grid_shutdown");
      }
    }
    return s;
  };
})();

