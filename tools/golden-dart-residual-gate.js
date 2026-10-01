#!/usr/bin/env node
/* =====================================================================
 *  Golden-Generator: Residuen-Gate-Politik → Dart-Fixture
 * =====================================================================
 *  Erzeugt deterministisch (mulberry32, Seed 20260905) 8 Kamera-Szenarien
 *  und druckt die fertige Dart-Fixture-Datei fuer den Port der Gate-Politik
 *  `tools/sweep-basket.js#createGate` nach
 *  app/lib/engine/prediction/residual_gate.dart (ResidualGate).
 *
 *  Aufruf (Repo-Root):
 *    node tools/golden-dart-residual-gate.js \
 *      > app/test/engine/prediction/residual_gate_fixture.dart
 *
 *  Pro Szenario: 14–20 Messungen einer zufaelligen Parabel mit anisotroper
 *  Sichtlinien-Kovarianz (σ_lat 0,024 m, σ_d = 0,15·d, Kamera (0, −3, 0.25)),
 *  eingestreute Fehlmessungen (Zufallspunkt im Raum, einzeln oder als Lauf)
 *  und teils ein Modellbruch (zweite Parabel ab einem Index). Je Szenario
 *  eine Gate-Konfiguration aus {rms/reset/K5/H2, maha/drop/K10/H2,
 *  maha/drop/K5/H3, rms/drop/K7/H2}; zwei Szenarien ohne cov (Fallback
 *  ‖r‖/σ_eff), zwei mit gewichtetem Fit fuer den laufenden Zustand (so
 *  arbeitet die App: StateEstimator weighted + ResidualGate.recommended).
 *  Puffer-Aufbau exakt wie `integrate` im Harness. Erwartungswerte: die
 *  Aktionsfolge (accept|drop|reset), der finale Puffer als Sample-Indizes
 *  sowie E.estimateState ueber den finalen Puffer — ungewichtet UND gewichtet.
 *  Zahlen via String(x) (kuerzeste Roundtrip-Darstellung); Ganzzahlen in
 *  Listen mit ".0", Skalare im double-Kontext ohne (prefer_int_literals).
 * ===================================================================== */
'use strict';
const E = require('../src/engine.js');
const S = require('../src/sensor.js');
const SW = require('./sweep-basket.js');

const G = 9.81;
const SEED = 20260905;
const CAM = [0, -3, 0.25];
const SIG_LAT = 0.024;
const K_DEPTH = 0.15;
const HZ = 20;
const NOISE = 0.05;          // params.noise ⇒ σ_eff 0,05 (Dart-Default noiseSigmaM)
const N_SCENARIOS = 8;

const CONFIGS = [
  { gate: 'rms',  outlier: 'reset', gateK: 5,  gateHits: 2 },
  { gate: 'maha', outlier: 'drop',  gateK: 10, gateHits: 2 },
  { gate: 'maha', outlier: 'drop',  gateK: 5,  gateHits: 3 },
  { gate: 'rms',  outlier: 'drop',  gateK: 7,  gateHits: 2 }
];

/* Rollen je Szenario: cov ja/nein, Fit des laufenden Zustands, Anzahl
 * isolierter Fehlmessungen, Laenge eines Fehlmessungs-Laufs, Modellbruch. */
const ROLES = [
  { cov: true,  weighted: false, isolated: 2, run: 0, brk: false },
  { cov: true,  weighted: true,  isolated: 2, run: 0, brk: false },
  { cov: false, weighted: false, isolated: 1, run: 3, brk: false },
  { cov: true,  weighted: false, isolated: 0, run: 0, brk: true },
  { cov: true,  weighted: false, isolated: 1, run: 0, brk: true },
  { cov: false, weighted: true,  isolated: 2, run: 0, brk: false },
  { cov: true,  weighted: false, isolated: 1, run: 0, brk: true },
  { cov: true,  weighted: false, isolated: 1, run: 2, brk: false }
];

/* Deterministischer RNG (mulberry32) — Vorlage: tools/sweep-basket.js */
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
const gauss = () => S.gauss(rnd);

/* Dart-Literal in Listen: String(x), Ganzzahlen mit ".0" */
function d(x) {
  const s = String(x);
  return /[.eE]/.test(s) ? s : s + '.0';
}
/* Skalar im double-Kontext: String(x) — ganzzahlig OHNE ".0" (prefer_int_literals). */
const ds = x => String(x);
/* Kovarianz als 6 Eintraege [xx, xy, xz, yy, yz, zz] oder null */
function cov6(c) {
  if (!c) return 'null';
  return '[' + [c[0][0], c[0][1], c[0][2], c[1][1], c[1][2], c[2][2]].map(d).join(', ') + ']';
}
const dartEnum = (prefix, v) => prefix + '.' + v;

/* Kamera-Messung mit Sichtlinien-Kovarianz (wie src/sensor.js#sample). */
function cameraSample(pTrue) {
  const lf = S.losFrame(CAM, pTrue);
  const sd = K_DEPTH * lf.d;
  const w = S.rotateVec(lf.R, [gauss() * sd, gauss() * SIG_LAT, gauss() * SIG_LAT]);
  return { p: [pTrue[0] + w[0], pTrue[1] + w[1], pTrue[2] + w[2]],
           cov: S.worldCov(lf.R, sd, SIG_LAT) };
}

function randomParabola() {
  const p0 = [rnd() * 6 - 3, 2 + rnd() * 5, 0.5 + rnd() * 1.5];
  const v0 = [rnd() * 6 - 3, -(1 + rnd() * 4), 3 + rnd() * 5];
  return t => [p0[0] + v0[0] * t, p0[1] + v0[1] * t, p0[2] + v0[2] * t - 0.5 * G * t * t];
}

/* Fehlmessungs-Muster: 'good' | 'bad' je Index; Laeufe und isolierte
 * Fehlmessungen liegen ab Index 3 (davor ist das Gate nie aktiv) und
 * isolierte haben keine 'bad'-Nachbarn. */
function pattern(n, role) {
  const kind = new Array(n).fill('good');
  if (role.run > 0) {
    const start = 3 + Math.floor(rnd() * (n - 3 - role.run));
    for (let i = start; i < start + role.run; i++) kind[i] = 'bad';
  }
  let placed = 0, guard = 0;
  while (placed < role.isolated && guard++ < 1000) {
    const i = 3 + Math.floor(rnd() * (n - 3));
    if (kind[i] !== 'good') continue;
    if (kind[i - 1] === 'bad' || (i + 1 < n && kind[i + 1] === 'bad')) continue;
    kind[i] = 'bad'; placed++;
  }
  if (placed < role.isolated) throw new Error('Fehlmessungen nicht platzierbar');
  return kind;
}

const out = [];
const P = s => out.push(s);

P('// EINGEFRORENE Golden-Fixture fuer den Dart-Port der Residuen-Gate-Politik');
P('// (ResidualGate: rms|maha x reset|drop, gateK, gateHits) samt Puffer-Aufbau');
P('// wie `integrate` im Sweep-Harness.');
P('//');
P('// NICHT VON HAND EDITIEREN. Die ' + N_SCENARIOS + ' Szenarien (Eingaben UND');
P('// Erwartungswerte) wurden deterministisch durch die JS-Referenz');
P('// `tools/sweep-basket.js#createGate` + `src/engine.js` (+ `src/sensor.js`');
P('// fuer die Sichtlinien-Kovarianzen) erzeugt (mulberry32, Seed ' + SEED + ',');
P('// kein Math.random). Zahlen sind mit JS `String(x)` gedruckt und damit');
P('// bit-exakt als IEEE-754-double reproduzierbar.');
P('//');
P('// Erzeugt mit exakt diesem Kommando vom Repo-Root (Node ' + process.version + '):');
P('//');
P('//   node tools/golden-dart-residual-gate.js \\');
P('//     > app/test/engine/prediction/residual_gate_fixture.dart');
P('');
P("import 'package:rebounder/engine/prediction/gate_metric.dart';");
P("import 'package:rebounder/engine/prediction/outlier_policy.dart';");
P('');
P('/// Ein eingefrorenes Szenario: Messfolge (Position + optionale Kovarianz),');
P('/// Gate-Konfiguration und Fit-Variante des laufenden Zustands als Eingabe;');
P('/// die Aktionsfolge des Gates, der finale Puffer (Sample-Indizes) und der');
P('/// ungewichtet wie gewichtet geschaetzte Zustand ueber den finalen Puffer');
P('/// als Erwartung.');
P('class ResidualGateScenario {');
P('  const ResidualGateScenario({');
P('    required this.metric,');
P('    required this.outlierPolicy,');
P('    required this.gateK,');
P('    required this.gateHits,');
P('    required this.fitWeighted,');
P('    required this.samplesTxyzM,');
P('    required this.sampleCovsM2,');
P('    required this.expectedActions,');
P('    required this.expectedBufferIndices,');
P('    required this.expectedT0S,');
P('    required this.expectedPlainP0M,');
P('    required this.expectedPlainV0Mps,');
P('    required this.expectedWeightedP0M,');
P('    required this.expectedWeightedV0Mps,');
P('  });');
P('');
P('  /// Abstandsmass des Gates (JS `gate`).');
P('  final GateMetric metric;');
P('');
P('  /// Ausreisser-Politik (JS `outlier`).');
P('  final OutlierPolicy outlierPolicy;');
P('');
P('  /// Schwellenfaktor (dimensionslos).');
P('  final double gateK;');
P('');
P('  /// Ausreisser in Folge bis zum Reset.');
P('  final int gateHits;');
P('');
P('  /// Laufender Zustand fuer `feed` gewichtet (`estimateState(..., {weighted: true})`)');
P('  /// statt ungewichtet.');
P('  final bool fitWeighted;');
P('');
P('  /// Messpunkte, je Zeile `[tS, xM, yM, zM]`; Index = Sample-Index.');
P('  final List<List<double>> samplesTxyzM;');
P('');
P('  /// Kovarianz je Messpunkt als `[xx, xy, xz, yy, yz, zz]` in m² oder `null`.');
P('  final List<List<double>?> sampleCovsM2;');
P('');
P("  /// Gate-Entscheidung je Messpunkt: `'accept'`, `'drop'` oder `'reset'`.");
P('  final List<String> expectedActions;');
P('');
P('  /// Sample-Indizes im Puffer nach der letzten Messung (Reihenfolge = Puffer).');
P('  final List<int> expectedBufferIndices;');
P('');
P('  /// `t0` des finalen Zustands (Zeit des ersten Puffer-Samples).');
P('  final double expectedT0S;');
P('');
P('  /// `p0` in Metern, ungewichteter Fit ueber den finalen Puffer.');
P('  final List<double> expectedPlainP0M;');
P('');
P('  /// `v0` in m/s, ungewichteter Fit ueber den finalen Puffer.');
P('  final List<double> expectedPlainV0Mps;');
P('');
P('  /// `p0` in Metern, gewichteter Fit ueber den finalen Puffer.');
P('  final List<double> expectedWeightedP0M;');
P('');
P('  /// `v0` in m/s, gewichteter Fit ueber den finalen Puffer.');
P('  final List<double> expectedWeightedV0Mps;');
P('}');
P('');
P('/// Gravitationskonstante, mit der ALLE Szenarien erzeugt wurden.');
P('const double residualGateGravityMps2 = ' + ds(G) + ';');
P('');
P('/// `params.noise` der Referenz (= `ResidualGate.noiseSigmaM`).');
P('const double residualGateNoiseSigmaM = ' + ds(NOISE) + ';');
P('');
P('/// Die ' + N_SCENARIOS + ' eingefrorenen Szenarien (Reihenfolge = Erzeugungsreihenfolge).');
P('const List<ResidualGateScenario> residualGateScenarios = <ResidualGateScenario>[');

for (let sc = 0; sc < N_SCENARIOS; sc++) {
  const cfg = CONFIGS[sc % CONFIGS.length];
  const role = ROLES[sc];
  const n = 14 + Math.floor(rnd() * 7);                   // 14..20
  const t0 = rnd() * 2;
  const truth1 = randomParabola();
  const truth2 = role.brk ? randomParabola() : null;
  const brkAt = role.brk ? Math.floor(n / 2) + Math.floor(rnd() * 3) : -1;
  const kind = pattern(n, role);

  const all = [];
  for (let i = 0; i < n; i++) {
    const t = i / HZ;
    const pTrue = (role.brk && i >= brkAt) ? truth2(t) : truth1(t);
    const p = kind[i] === 'bad' ? [rnd() * 8 - 4, rnd() * 8, rnd() * 4] : pTrue;
    const m = cameraSample(p);
    all.push(role.cov ? { t: t0 + t, p: m.p, cov: m.cov, idx: i }
                      : { t: t0 + t, p: m.p, idx: i });
  }

  // Puffer-Aufbau exakt wie `integrate` in tools/sweep-basket.js
  const gate = SW.createGate({ noise: NOISE, ...cfg });
  let samples = [], est = null;
  const actions = [];
  for (const m of all) {
    const dec = gate.feed(est, samples, m);
    actions.push(dec.action);
    if (dec.action === 'drop') continue;
    if (dec.action === 'reset') samples = dec.samples;
    samples.push(m);
    est = role.weighted ? E.estimateState(samples, G, { weighted: true })
                        : E.estimateState(samples, G);
  }
  const plain = E.estimateState(samples, G);
  const weighted = E.estimateState(samples, G, { weighted: true });
  if (!plain || !weighted) throw new Error('Szenario ' + sc + ': finaler Fit lieferte null');

  const bad = kind.map((k, i) => k === 'bad' ? i : -1).filter(i => i >= 0);
  const count = a => actions.filter(x => x === a).length;
  P('  ResidualGateScenario(');
  P('    // Szenario ' + sc + ' — ' + cfg.gate + '/' + cfg.outlier + '/K' + cfg.gateK + '/H' + cfg.gateHits +
    ', ' + (role.cov ? 'mit cov' : 'OHNE cov') + ', Fit ' + (role.weighted ? 'gewichtet' : 'ungewichtet') +
    '; Fehlmessungen [' + bad.join(', ') + ']' + (role.brk ? ', Modellbruch ab ' + brkAt : '') +
    '; Aktionen: ' + count('accept') + ' accept / ' + count('drop') + ' drop / ' + count('reset') + ' reset');
  P('    metric: ' + dartEnum('GateMetric', cfg.gate) + ',');
  P('    outlierPolicy: ' + dartEnum('OutlierPolicy', cfg.outlier) + ',');
  P('    gateK: ' + ds(cfg.gateK) + ',');
  P('    gateHits: ' + cfg.gateHits + ',');
  P('    fitWeighted: ' + role.weighted + ',');
  P('    samplesTxyzM: [');
  for (const s of all)
    P('      [' + [s.t, s.p[0], s.p[1], s.p[2]].map(d).join(', ') + '],');
  P('    ],');
  P('    sampleCovsM2: [');
  for (const s of all) P('      ' + cov6(s.cov) + ',');
  P('    ],');
  P('    expectedActions: [' + actions.map(a => "'" + a + "'").join(', ') + '],');
  P('    expectedBufferIndices: [' + samples.map(s => s.idx).join(', ') + '],');
  P('    expectedT0S: ' + ds(plain.t0) + ',');
  P('    expectedPlainP0M: [' + plain.p0.map(d).join(', ') + '],');
  P('    expectedPlainV0Mps: [' + plain.v0.map(d).join(', ') + '],');
  P('    expectedWeightedP0M: [' + weighted.p0.map(d).join(', ') + '],');
  P('    expectedWeightedV0Mps: [' + weighted.v0.map(d).join(', ') + '],');
  P('  ),');
}
P('];');
console.log(out.join('\n'));
