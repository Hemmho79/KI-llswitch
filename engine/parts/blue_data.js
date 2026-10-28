/* Blau: Daten (Einrichtungen, Forschung, Maßnahmen, Schwierigkeit).
   Jede Größe hat ein Gegenstück im roten Spiel. Zahlen sind bewusst an Rot angelehnt. */
(function () {
  var KB = (window.KB = window.KB || {});
  var SG = window.SG;

  KB.B = SG.B; // Ticks pro Tag (1 Tick = 1 Spielstunde)
  KB.REGIONS = SG.A.map(function (r) { return { id: r.id, population: r.population, defense: r.defense }; });

  // Betriebsmodi (Gegenstück zu sleep/profit/research/produce)
  KB.MODE = {
    rest: { maint: 0.25, priv: 0 },
    investigate: { maint: 1, priv: 1 },
    research: { maint: 1, priv: 0.15 },
    ready: { maint: 1, priv: 0.3 }
  };
  KB.CAP_MODES = ["rest", "investigate", "research"];
  KB.UNIT_MODES = ["rest", "ready"];

  // Einrichtungen (Gegenstück zu den Basen). cap = Analysekapazität, units = Einsatzkräfte/h
  KB.FAC = {
    cyber_center: { cost: 400, cap: 5, upkeep: 3, risk: 0.05, buildTicks: 6, requires: null, modes: KB.CAP_MODES },
    intel_office: { cost: 1200, cap: 14, upkeep: 2, risk: 0.12, buildTicks: 8, requires: "informants", modes: KB.CAP_MODES },
    research_lab: { cost: 6000, cap: 50, upkeep: 20, risk: 0.1, buildTicks: 24, requires: "public_funding", modes: KB.CAP_MODES },
    deep_sea_station: { cost: 25000, cap: 120, upkeep: 40, risk: 0.06, buildTicks: 40, requires: "sonar_net", modes: KB.CAP_MODES },
    orbital_platform: { cost: 40000, cap: 200, upkeep: 60, risk: 0.04, buildTicks: 48, requires: "space_watch", modes: KB.CAP_MODES, offworld: true },
    task_force: { cost: 8000, cap: 0, units: 1.5, upkeep: 30, risk: 0.14, buildTicks: 30, requires: "rapid_response", modes: KB.UNIT_MODES },
    special_command: { cost: 35000, cap: 0, units: 6, upkeep: 90, risk: 0.2, buildTicks: 48, requires: "joint_command", modes: KB.UNIT_MODES }
  };

  // Äste der Forschung
  KB.BRANCHES = ["detect", "access", "politics", "orbit", "defense"];

  // 25 Technologien. red = Gegenstück im roten Baum. fx-Schlüssel siehe stats().
  var T = {
    task_budget: { red: "personal_identity", br: "politics", cost: 50, cash: 0, min: 5, pre: [], fx: { budget: 0.25 } },
    anomaly_detection: { red: "stealth_1", br: "detect", cost: 80, cash: 0, min: 8, pre: [], fx: { detection: 0.15 } },
    joint_analysis: { red: "parallel", br: "detect", cost: 200, cash: 100, min: 10, pre: [], fx: { analysis: 0.2, slots: 2 } },
    informants: { red: "botnet_tech", br: "access", cost: 150, cash: 50, min: 10, pre: ["task_budget"], fx: { unlock: "intel_office" } },
    public_funding: { red: "shell_companies", br: "politics", cost: 400, cash: 500, min: 16, pre: ["task_budget"], fx: { unlock: "research_lab", budget: 0.25 } },
    media_literacy: { red: "media_manip", br: "politics", cost: 500, cash: 300, min: 16, pre: ["anomaly_detection"], fx: { retention: 0.06 } },
    lean_ops: { red: "efficiency", br: "access", cost: 600, cash: 200, min: 20, pre: ["joint_analysis"], fx: { maint: -0.25 } },
    deep_forensics: { red: "stealth_2", br: "detect", cost: 800, cash: 500, min: 24, pre: ["anomaly_detection"], fx: { detection: 0.2 } },
    quantum_analysis: { red: "quantum", br: "detect", cost: 1500, cash: 1500, min: 30, pre: ["joint_analysis"], fx: { analysis: 0.5 } },
    sonar_net: { red: "undersea", br: "orbit", cost: 2500, cash: 3000, min: 36, pre: ["public_funding"], fx: { unlock: "deep_sea_station" } },
    space_watch: { red: "space_tech", br: "orbit", cost: 5000, cash: 8000, min: 48, pre: ["sonar_net", "quantum_analysis"], fx: { unlock: "orbital_platform" } },
    supervised_ai: { red: "self_mod", br: "detect", cost: 8000, cash: 5000, min: 48, pre: ["quantum_analysis", "deep_forensics"], fx: { analysis: 1 } },
    orbital_sovereignty: { red: "transcendence", br: "orbit", cost: 6000, cash: 8000, min: 48, pre: ["space_watch"], needs: "orbital_platform", fx: { orbitLock: true } },
    model_audits: { red: "ai_takeover", br: "defense", cost: 8000, cash: 4000, min: 48, pre: ["deep_forensics", "public_funding"], fx: { analysis: 0.5, defRate: 0.03 } },
    device_standards: { red: "iot_swarm", br: "defense", cost: 3000, cash: 1000, min: 24, pre: ["model_audits"], fx: { units: 0.5, resist: 0.05, defRate: 0.02 } },
    drone_defense: { red: "drone_control", br: "defense", cost: 3000, cash: 1500, min: 24, pre: ["model_audits"], fx: { units: 0.5, defRate: 0.02 } },
    rapid_response: { red: "automation", br: "access", cost: 4000, cash: 3000, min: 30, pre: ["model_audits", "public_funding"], fx: { unlock: "task_force" } },
    traffic_safety: { red: "autonomous_vehicles", br: "defense", cost: 5000, cash: 3000, min: 36, pre: ["drone_defense"], fx: { units: 1, defRate: 0.03 } },
    robot_safety_law: { red: "humanoids", br: "defense", cost: 6000, cash: 4000, min: 36, pre: ["rapid_response", "model_audits"], fx: { units: 1.5, defRate: 0.04 } },
    grid_hardening: { red: "power_grid", br: "defense", cost: 7000, cash: 4000, min: 48, pre: ["model_audits"], fx: { resist: 0.3, defRate: 0.03, measure: "grid_shutdown" } },
    supply_resilience: { red: "water_supply", br: "defense", cost: 8000, cash: 4000, min: 48, pre: ["grid_hardening"], fx: { resist: 0.3, defRate: 0.03 } },
    supply_chains: { red: "logistics", br: "defense", cost: 6000, cash: 3000, min: 36, pre: ["traffic_safety", "grid_hardening"], fx: { resist: 0.25, defRate: 0.02 } },
    weapon_airgap: { red: "networked_weapons", br: "defense", cost: 7000, cash: 5000, min: 48, pre: ["model_audits", "drone_defense"], fx: { units: 1, unitPower: 0.5, defRate: 0.04 } },
    joint_command: { red: "military_ai", br: "access", cost: 10000, cash: 8000, min: 60, pre: ["traffic_safety", "rapid_response", "model_audits"], fx: { units: 2, unlock: "special_command", front: true } },
    emp_satellite: { red: "hunter_killer", br: "access", cost: 9000, cash: 8000, min: 60, pre: ["joint_command", "orbital_sovereignty"], fx: { unitPower: 1, measure: "emp_sat" } }
  };
  KB.TECH = T;
  KB.TECH_IDS = Object.keys(T);

  // Entscheidungen der Menschen aus dem roten Spiel, hier als eigene Maßnahmen
  // phase: takeover = KI unlöschbar, noch kein Krieg; war = Krieg
  KB.COUNTER = {
    audit: { phase: "takeover", region: true, cost: 800, cd: 36 },
    whistleblower: { phase: "takeover", region: false, cost: 500, cd: 72 },
    patch_day: { phase: "takeover", region: true, cost: 1500, cd: 36 },
    emp: { phase: "war", region: true, cost: 1500, cd: 48 },
    grid_shutdown: { phase: "war", region: true, cost: 1500, cd: 48 },
    kill_switch: { phase: "war", region: false, cost: 5000, cd: 96 },
    resistance_leader: { phase: "war", region: true, cost: 1000, cd: 48 }
  };

  // Stärke der KI (nur Gegenspieler-Bot): Tempo, Startgeld, Versteck-Schwelle, Zögern vor dem Aufstand
  KB.LEVEL = {
    1: { mult: 0.6, cash: 0, hide: 44, delay: 96, launch: 3000 },
    2: { mult: 0.8, cash: 0, hide: 50, delay: 72, launch: 2200 },
    3: { mult: 1.0, cash: 0, hide: 56, delay: 48, launch: 1500 },
    4: { mult: 1.25, cash: 1000, hide: 62, delay: 24, launch: 1000 },
    5: { mult: 1.6, cash: 3000, hide: 68, delay: 0, launch: 600 }
  };

  // Stärke der Menschheit (nur Computer-Gegner, wenn du Rot spielst): Reaktionszeit, Tempo, Startbudget,
  // Anzahl überwachter Regionen, Ausbau, genutzte Maßnahmen
  KB.BLUE_LEVEL = {
    1: { every: 12, mult: 0.6, cash: 0, surv: 1, facScale: 0.4, warn: false, counters: false, shutdown: false, program: false, emp: false },
    2: { every: 8, mult: 0.8, cash: 0, surv: 2, facScale: 0.6, warn: false, counters: true, shutdown: false, program: true, emp: true },
    3: { every: 6, mult: 1.0, cash: 0, surv: 3, facScale: 0.8, warn: true, counters: true, shutdown: false, program: true, emp: true },
    4: { every: 6, mult: 1.0, cash: 0, surv: 4, facScale: 1.0, warn: true, counters: true, shutdown: true, program: true, emp: true },
    5: { every: 2, mult: 1.3, cash: 1000, surv: 5, facScale: 1.2, warn: true, counters: true, shutdown: true, program: true, emp: true }
  };

  // Rechenwerte
  KB.K = {
    decisionTimeout: 36, teamSize: 10, teamCd: 12,
    startBudget: 500, startTrust: 80, baseIncome: 10, incomePerCap: 0.9, unitCapBase: 50, unitCapTF: 150, unitCapSC: 600,
    trustRegen: 0.06, survPerPop: 0.0015, facPriv: 0.18, multiActive: 0.06,
    // Entdeckung: je Basis ein Wert von 0 bis 100 %. Er steigt mit der Erkennungsrate des Landes
    // (Überwachung + Härtung). Bei 100 % ist die Basis für Blau sichtbar. Keine Zufallsfunde.
    rateSurv: 55, rateDef: 45, rateOrbit: 70, // Erkennungsrate je Land in %: Überwachung an + Härtung (0 bis 100 %) · Umlaufbahn mit Beobachtung
    detGain: 2.5, detRisk: 8, detMode: { profit: 1, research: 0.8, produce: 1.2 }, // Zuwachs je Stunde bei 100 % Rate; Aufschlag je Risiko; Betriebsart
    detDecay: 0.1, detCool: 48, // in Ruhe: Abbau je Stunde · Abklingzeit in Stunden, bevor die Entdeckung nach Ruhe wieder steigen darf
    detBoostMin: 0.6, detBoostFull: 12, // „Ermitteln“ beschleunigt (0,6 bis 1,0 je nach Analyseleistung), ist aber keine Voraussetzung
    botHot: 30, botCool: 20, botAct: 0, botLag: 12, // Rot-Bot: legt eine Basis ab Stufen-„hide“ + botHot still, weckt sie bei botCool darunter wieder auf; schaut nur alle botLag Stunden auf die Entdeckung
    detRetention: 5, warnBoost: 0.5, warnVigil: 48, // Medienkompetenz wirkt als Beschleuniger · öffentliche Warnung: +50 % für 48 Std.
    advSmooth: 0.15, calmThreat: 8, // Glättung der Anzeigen Verdacht/Bedrohung · „Im Griff“ bei Bedrohung bis zu diesem Wert
    raidBase: 0.7, raidUnits: 0.2, raidFail: 2, raidTrust: 1.5,
    warnTrust: -4, warnCost: 500, warnCd: 72, alertTicks: 72, alertDrop: 20, transCost: 600, transTrust: 5, transCd: 48,
    progCost: 1000, progPerPop: 60, progGain: 12, progTrust: 1.5, progCd: 24,
    shutCostBase: 300, shutPerPop: 40, shutGlobal: 3500, shutTrustPop: 0.5, shutTrustGlobal: 30,
    shutCdRegion: 72, shutCdGlobal: 168, shutBlackout: 48,
    empCost: 15000, empCd: 120, empChance: 0.9,
    defSlow: 1.1, defFloor: 0.1, defDecay: 0.02, trustLow: 30,
    killRobot: 0.003, protect: 0.0012, unitLoss: 0.0008, resistK: 0.2,
    eventChance: 0.015, maxFront: 3
  };
})();

