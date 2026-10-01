#!/usr/bin/env node
/* =====================================================================
 *  Golden-Generator: Fahrzeitschaetzung (ackTravelTime) → Dart-Fixture
 * =====================================================================
 *  Erzeugt deterministisch (mulberry32, Seed 20260917) 24 Szenarien und
 *  druckt die fertige Dart-Fixture-Datei fuer den Port von
 *  `src/engine.js#ackTravelTime` (+ minTravelTime, wrapAngle) nach
 *  app/lib/engine/prediction/travel_time.dart (AckermannTravelTime).
 *
 *  Aufruf (Repo-Root):
 *    node tools/golden-dart-ack-travel-time.js \
 *      > app/test/engine/prediction/travel_time_fixture.dart
 *
 *  Je Szenario: Fahrzeugpose (x, y, th), Ziel (x, y) und Parameter aus den
 *  Sim-Bereichen (vMax 1,5–12, aMax 2–50, L/steerMax wie `src/sim.js` ACK
 *  und Varianten). Rollen erzwingen die Faelle: Ziel voraus (kleiner
 *  Dreh-Malus), Ziel quer (α ≈ 90°, groesster Malus), Ziel hinten
 *  (rueckwaerts naeher ⇒ α_eff klein), Ziel sehr nah (dreieckiges
 *  Bang-Bang-Profil), Ziel weit (trapezfoermig), Ziel exakt auf dem
 *  Fahrzeug (d = 0).
 *
 *  Erwartung ist IMMER der Rueckgabewert von E.ackTravelTime; zusaetzlich
 *  die holonome Zeit E.minTravelTime als Vergleich (der Ackermann-Wert
 *  darf nie kleiner sein).
 * ===================================================================== */
'use strict';
const E = require('../src/engine.js');

const SEED = 20260917;
const N_SCENARIOS = 24;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const uni = (lo, hi) => lo + rnd() * (hi - lo);

/* Skalar im double-Kontext: String(x) — ganzzahlig OHNE ".0" (prefer_int_literals). */
const ds = x => String(x);

/* Rollen: welche Geometrie soll herauskommen? */
const ROLES = [
  'ahead', 'ahead', 'ahead', 'across', 'across', 'across',
  'behind', 'behind', 'behind', 'near', 'near', 'far',
  'far', 'ahead', 'across', 'behind', 'near', 'far',
  'zero', 'ahead', 'across', 'behind', 'far', 'near'
];

/* Fahrzeugvarianten: Sim-Default (src/sim.js ACK) und zwei Nachbarn. */
const VEHICLES = [
  { L: 0.25, steerMax: 0.56, steerRate: 8 },    // Sim/Sweep-Default, ~1:12-RC
  { L: 0.18, steerMax: 0.7, steerRate: 10 },    // kuerzer, wendiger
  { L: 0.35, steerMax: 0.45, steerRate: 6 },    // laenger, traeger
];

function scenarioFor(role) {
  const veh = pick(VEHICLES);
  const vMax = pick([1.5, 2, 3, 4, 5, 6, 8, 12]);
  const aMax = pick([2, 4, 6, 8, 12, 20, 50]);
  const car = { x: uni(-6, 6), y: uni(-6, 6), th: uni(-Math.PI, Math.PI) };
  // Abstand je Rolle; `far` erzwingt das trapezfoermige Profil (d > vMax^2/aMax).
  const d = role === 'zero' ? 0
    : role === 'near' ? uni(0.05, 0.5)
    : role === 'far' ? vMax * vMax / aMax + uni(2, 20)
    : uni(1, 8);
  // Winkel zum Ziel relativ zur Fahrzeugachse.
  const alpha = role === 'ahead' ? uni(-0.5, 0.5)
    : role === 'across' ? pick([1, -1]) * uni(Math.PI / 2 - 0.15, Math.PI / 2 + 0.15)
    : role === 'behind' ? pick([1, -1]) * uni(Math.PI - 0.5, Math.PI)
    : uni(-Math.PI, Math.PI);
  const dir = car.th + alpha;
  const target = { x: car.x + d * Math.cos(dir), y: car.y + d * Math.sin(dir) };
  const o = { aMax, vMax, L: veh.L, steerMax: veh.steerMax, steerRate: veh.steerRate };
  return {
    role, car, target, o,
    ack: E.ackTravelTime(car, target.x, target.y, o),
    holo: E.minTravelTime(Math.hypot(target.x - car.x, target.y - car.y), vMax, aMax),
  };
}

const out = [];
const P = s => out.push(s);

P('// EINGEFRORENE Golden-Fixture fuer den Dart-Port der Fahrzeitschaetzung');
P('// (AckermannTravelTime = src/engine.js#ackTravelTime, HolonomicTravelTime');
P('// = minTravelTime).');
P('//');
P('// NICHT VON HAND EDITIEREN. Die ' + N_SCENARIOS + ' Szenarien (Eingaben UND');
P('// Erwartungswerte) wurden deterministisch durch die JS-Referenz');
P('// `src/engine.js` erzeugt (mulberry32, Seed ' + SEED + ', kein Math.random).');
P('// Zahlen sind mit JS `String(x)` gedruckt und damit bit-exakt als');
P('// IEEE-754-double reproduzierbar.');
P('//');
P('// Erzeugt mit exakt diesem Kommando vom Repo-Root (Node ' + process.version + '):');
P('//');
P('//   node tools/golden-dart-ack-travel-time.js \\');
P('//     > app/test/engine/prediction/travel_time_fixture.dart');
P('');
P('/// Ein eingefrorenes Szenario: Fahrzeugpose, Ziel und Fahrzeugparameter');
P('/// als Eingabe; die Ackermann-Fahrzeit (mit Dreh-Malus) und die holonome');
P('/// Bang-Bang-Zeit als Erwartung.');
P('class TravelTimeScenario {');
P('  const TravelTimeScenario({');
P('    required this.role,');
P('    required this.carXM,');
P('    required this.carYM,');
P('    required this.carHeadingRad,');
P('    required this.targetXM,');
P('    required this.targetYM,');
P('    required this.vMaxMps,');
P('    required this.aMaxMps2,');
P('    required this.wheelbaseM,');
P('    required this.steerMaxRad,');
P('    required this.expectedAckermannS,');
P('    required this.expectedHolonomicS,');
P('  });');
P('');
P("  /// Erzwungene Geometrie: `ahead`, `across`, `behind`, `near`, `far`, `zero`.");
P('  final String role;');
P('');
P('  /// Fahrzeugpose in der Ebene (Kurs in Radiant, 0 = +x).');
P('  final double carXM;');
P('  final double carYM;');
P('  final double carHeadingRad;');
P('');
P('  /// Zielpunkt in der Ebene.');
P('  final double targetXM;');
P('  final double targetYM;');
P('');
P('  /// Fahrzeugparameter (JS `o.vMax`, `o.aMax`, `o.L`, `o.steerMax`).');
P('  final double vMaxMps;');
P('  final double aMaxMps2;');
P('  final double wheelbaseM;');
P('  final double steerMaxRad;');
P('');
P('  /// Erwartung: `ackTravelTime` bzw. `minTravelTime` der JS-Referenz.');
P('  final double expectedAckermannS;');
P('  final double expectedHolonomicS;');
P('}');
P('');
P('/// Die ' + N_SCENARIOS + ' eingefrorenen Szenarien (Reihenfolge = Erzeugungsreihenfolge).');
P('const List<TravelTimeScenario> travelTimeScenarios = <TravelTimeScenario>[');

for (let sc = 0; sc < N_SCENARIOS; sc++) {
  const s = scenarioFor(ROLES[sc]);
  P('  TravelTimeScenario(');
  P("    role: '" + s.role + "',");
  P('    carXM: ' + ds(s.car.x) + ',');
  P('    carYM: ' + ds(s.car.y) + ',');
  P('    carHeadingRad: ' + ds(s.car.th) + ',');
  P('    targetXM: ' + ds(s.target.x) + ',');
  P('    targetYM: ' + ds(s.target.y) + ',');
  P('    vMaxMps: ' + ds(s.o.vMax) + ',');
  P('    aMaxMps2: ' + ds(s.o.aMax) + ',');
  P('    wheelbaseM: ' + ds(s.o.L) + ',');
  P('    steerMaxRad: ' + ds(s.o.steerMax) + ',');
  P('    expectedAckermannS: ' + ds(s.ack) + ',');
  P('    expectedHolonomicS: ' + ds(s.holo) + ',');
  P('  ),');
}
P('];');
P('');

process.stdout.write(out.join('\n'));
