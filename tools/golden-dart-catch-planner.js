#!/usr/bin/env node
/* =====================================================================
 *  Golden-Generator: Fangchancen-Planung (planCatch) → Dart-Fixture
 * =====================================================================
 *  Erzeugt deterministisch (mulberry32, Seed 20260912) 16 Szenarien und
 *  druckt die fertige Dart-Fixture-Datei fuer den Port von
 *  `src/engine.js#planCatch` (+ minTravelTime, inField) nach
 *  app/lib/engine/prediction/catch_planner.dart (CatchPlanner).
 *
 *  Aufruf (Repo-Root):
 *    node tools/golden-dart-catch-planner.js \
 *      > app/test/engine/prediction/catch_planner_fixture.dart
 *
 *  Je Szenario: zufaelliger ballistischer Zustand (Position im Feld,
 *  Geschwindigkeit auf- oder abwaerts, teils schon unter der Fangebene),
 *  Aktuatorposition, `now` etwas nach t0, Parameter aus den Sim-Bereichen
 *  (rest 0,5–0,95, hgt 0,05–1,0, vMax 1,5–12, aMax 2–50), Feld null oder
 *  [fx, fy]. Rollen erzwingen die Faelle: Chance auf Bogen 0 erreichbar,
 *  erst nach Abpraller erreichbar (langsamer Aktuator weit weg), nicht
 *  erreichbar (Notziel = spaeteste Chance), kein Bogen (null: Feld schliesst
 *  alles aus oder Ball faellt unter die Fangebene und springt nicht mehr
 *  darueber). Erwartung: das planCatch-Ergebnis plus Fahrzeit und Reserve
 *  (mit E.minTravelTime gerechnet). Zahlen via String(x).
 * ===================================================================== */
'use strict';
const E = require('../src/engine.js');

const G = 9.81;
const SEED = 20260912;
const N_SCENARIOS = 16;

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

/* Dart-Literal in Listen: String(x), Ganzzahlen mit ".0" */
function d(x) {
  const s = String(x);
  return /[.eE]/.test(s) ? s : s + '.0';
}
/* Skalar im double-Kontext: String(x) — ganzzahlig OHNE ".0" (prefer_int_literals). */
const ds = x => String(x);
const list = xs => '<double>[' + xs.map(d).join(', ') + ']';

/* Rollen: welcher Fall soll herauskommen? Der Generator wuerfelt so lange,
 * bis das JS-Ergebnis zur Rolle passt (Ergebnis kommt IMMER aus E.planCatch). */
const ROLES = [
  'arc0', 'arc0', 'bounce', 'bounce', 'infeasible', 'infeasible', 'null-field', 'null-low',
  'arc0', 'bounce', 'infeasible', 'arc0-field', 'bounce-field', 'null-low', 'infeasible', 'arc0'
];

function scenarioFor(role) {
  for (let guard = 0; guard < 20000; guard++) {
    const field = role.endsWith('field') || rnd() < 0.3 ? [uni(4, 14), uni(4, 8)] : null;
    const hgt = pick([0.05, 0.1, 0.25, 0.5, 0.75, 1.0]);
    const rest = pick([0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.95]);
    const vMax = role.startsWith('bounce') || role === 'infeasible' ? pick([1.5, 2, 2.5, 3]) : pick([4, 5, 6, 7, 9, 12]);
    const aMax = role.startsWith('bounce') || role === 'infeasible' ? pick([2, 4, 6]) : pick([8, 10, 14, 20, 30, 50]);
    const t0 = uni(0, 3);
    const p0 = role === 'null-low'
      ? [uni(-3, 3), uni(-3, 3), uni(0.02, Math.max(hgt - 0.02, 0.03))]
      : [uni(-4, 4), uni(-4, 4), uni(hgt + 0.1, 3.5)];
    const v0 = role === 'null-low'
      ? [uni(-1, 1), uni(-1, 1), -uni(0.05, 0.6)]
      : [uni(-4, 4), uni(-4, 4), uni(-3, 7)];
    if (role === 'null-field') {
      // Ball fliegt weit ausserhalb des Feldes
      p0[0] = 30 + uni(0, 5); v0[0] = uni(1, 3);
    }
    const now = t0 + uni(0, 0.4);
    const act = role === 'infeasible' || role.startsWith('bounce')
      ? { x: p0[0] + pick([-1, 1]) * uni(6, 12), y: p0[1] + pick([-1, 1]) * uni(4, 10) }
      : { x: p0[0] + uni(-2, 2), y: p0[1] + uni(-2, 2) };
    const state = { t0, p0, v0 };
    const opts = { g: G, rest, hgt, vMax, aMax, field };
    const res = E.planCatch(state, act, now, opts);
    const ok =
      (role.startsWith('arc0') && res && res.feasible && res.bounce === 0) ||
      (role.startsWith('bounce') && res && res.feasible && res.bounce >= 1) ||
      (role === 'infeasible' && res && !res.feasible) ||
      (role.startsWith('null') && res === null);
    if (!ok) continue;
    const field2 = role.startsWith('null-low') ? field : field; // unveraendert
    let travel = null, slack = null;
    if (res) {
      travel = E.minTravelTime(Math.hypot(res.x - act.x, res.y - act.y), vMax, aMax);
      slack = res.tImpact - now - travel;
    }
    return { role, state, act, now, opts: { ...opts, field: field2 }, res, travel, slack };
  }
  throw new Error('Rolle nicht erzeugbar: ' + role);
}

const out = [];
const P = s => out.push(s);

P('// EINGEFRORENE Golden-Fixture fuer den Dart-Port der Fangchancen-Planung');
P('// (CatchPlanner.plan = src/engine.js#planCatch mit minTravelTime/inField).');
P('//');
P('// NICHT VON HAND EDITIEREN. Die ' + N_SCENARIOS + ' Szenarien (Eingaben UND');
P('// Erwartungswerte) wurden deterministisch durch die JS-Referenz');
P('// `src/engine.js` erzeugt (mulberry32, Seed ' + SEED + ', kein Math.random).');
P('// Zahlen sind mit JS `String(x)` gedruckt und damit bit-exakt als');
P('// IEEE-754-double reproduzierbar.');
P('//');
P('// Erzeugt mit exakt diesem Kommando vom Repo-Root (Node ' + process.version + '):');
P('//');
P('//   node tools/golden-dart-catch-planner.js \\');
P('//     > app/test/engine/prediction/catch_planner_fixture.dart');
P('');
P('/// Ein eingefrorenes Szenario: Zustand, Aktuator, Zeitpunkt und Parameter');
P('/// als Eingabe; das planCatch-Ergebnis (oder `null`) samt Fahrzeit und');
P('/// Reserve als Erwartung.');
P('class CatchPlannerScenario {');
P('  const CatchPlannerScenario({');
P('    required this.role,');
P('    required this.t0S,');
P('    required this.p0M,');
P('    required this.v0Mps,');
P('    required this.actuatorXM,');
P('    required this.actuatorYM,');
P('    required this.nowS,');
P('    required this.restitution,');
P('    required this.catchHeightM,');
P('    required this.vMaxMps,');
P('    required this.aMaxMps2,');
P('    required this.fieldHalfM,');
P('    required this.expectedXM,');
P('    required this.expectedYM,');
P('    required this.expectedImpactTimeS,');
P('    required this.expectedBounce,');
P('    required this.expectedFeasible,');
P('    required this.expectedTravelTimeS,');
P('    required this.expectedSlackS,');
P('  });');
P('');
P("  /// Erzwungener Fall: `arc0`, `bounce`, `infeasible`, `null-field`, `null-low`.");
P('  final String role;');
P('');
P('  /// Referenzzeit des Zustands.');
P('  final double t0S;');
P('');
P('  /// Position bei t0 in Metern (Boden bei z = 0).');
P('  final List<double> p0M;');
P('');
P('  /// Geschwindigkeit bei t0 in m/s.');
P('  final List<double> v0Mps;');
P('');
P('  /// Aktuatorposition in der Ebene.');
P('  final double actuatorXM;');
P('  final double actuatorYM;');
P('');
P('  /// Planungszeitpunkt `now`.');
P('  final double nowS;');
P('');
P('  /// Parameter (JS `o.rest`, `o.hgt`, `o.vMax`, `o.aMax`).');
P('  final double restitution;');
P('  final double catchHeightM;');
P('  final double vMaxMps;');
P('  final double aMaxMps2;');
P('');
P('  /// Feld als `[fx, fy]` (Halbausdehnung) oder `null` = unbegrenzt.');
P('  final List<double>? fieldHalfM;');
P('');
P('  /// Erwartung; alle `null`, wenn planCatch `null` liefert.');
P('  final double? expectedXM;');
P('  final double? expectedYM;');
P('  final double? expectedImpactTimeS;');
P('  final int? expectedBounce;');
P('  final bool? expectedFeasible;');
P('  final double? expectedTravelTimeS;');
P('  final double? expectedSlackS;');
P('}');
P('');
P('/// Gravitationskonstante, mit der ALLE Szenarien erzeugt wurden.');
P('const double catchPlannerGravityMps2 = ' + ds(G) + ';');
P('');
P('/// Die ' + N_SCENARIOS + ' eingefrorenen Szenarien (Reihenfolge = Erzeugungsreihenfolge).');
P('const List<CatchPlannerScenario> catchPlannerScenarios = <CatchPlannerScenario>[');

for (let sc = 0; sc < N_SCENARIOS; sc++) {
  const s = scenarioFor(ROLES[sc]);
  const r = s.res;
  P('  CatchPlannerScenario(');
  P("    role: '" + s.role + "',");
  P('    t0S: ' + ds(s.state.t0) + ',');
  P('    p0M: ' + list(s.state.p0) + ',');
  P('    v0Mps: ' + list(s.state.v0) + ',');
  P('    actuatorXM: ' + ds(s.act.x) + ',');
  P('    actuatorYM: ' + ds(s.act.y) + ',');
  P('    nowS: ' + ds(s.now) + ',');
  P('    restitution: ' + ds(s.opts.rest) + ',');
  P('    catchHeightM: ' + ds(s.opts.hgt) + ',');
  P('    vMaxMps: ' + ds(s.opts.vMax) + ',');
  P('    aMaxMps2: ' + ds(s.opts.aMax) + ',');
  P('    fieldHalfM: ' + (s.opts.field ? list(s.opts.field) : 'null') + ',');
  P('    expectedXM: ' + (r ? ds(r.x) : 'null') + ',');
  P('    expectedYM: ' + (r ? ds(r.y) : 'null') + ',');
  P('    expectedImpactTimeS: ' + (r ? ds(r.tImpact) : 'null') + ',');
  P('    expectedBounce: ' + (r ? String(r.bounce) : 'null') + ',');
  P('    expectedFeasible: ' + (r ? String(r.feasible) : 'null') + ',');
  P('    expectedTravelTimeS: ' + (r ? ds(s.travel) : 'null') + ',');
  P('    expectedSlackS: ' + (r ? ds(s.slack) : 'null') + ',');
  P('  ),');
}
P('];');
process.stdout.write(out.join('\n') + '\n');
