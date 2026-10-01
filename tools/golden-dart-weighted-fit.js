#!/usr/bin/env node
/* =====================================================================
 *  Golden-Generator: gewichteter Fit + Residuen → Dart-Fixture
 * =====================================================================
 *  Erzeugt deterministisch (mulberry32, Seed 20260905) 12 Kamera-Szenarien
 *  und druckt die fertige Dart-Fixture-Datei fuer den Port unter
 *  app/lib/engine/prediction/ (StateEstimator weighted, BallisticResidual).
 *
 *  Aufruf (Repo-Root):
 *    node tools/golden-dart-weighted-fit.js \
 *      > app/test/engine/prediction/weighted_fit_fixture.dart
 *
 *  Pro Szenario: 5–10 Messungen einer zufaelligen Parabel mit anisotroper
 *  Sichtlinien-Kovarianz (σ_lat 0,024 m, σ_d = 0,15·d, Kamera (0, −3, 0.25)),
 *  dazu je eine Sonderrolle (Mischung mit/ohne cov, eine singulaere cov,
 *  covFloor 0,2 m, Probe ohne cov mit/ohne σ). Erwartungswerte:
 *  E.estimateState(samples, G, { weighted: true }) (bzw. mit floorCov) sowie
 *  E.residual / E.residualMaha einer zusaetzlichen Probemessung.
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
const N_SCENARIOS = 12;

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
/* Skalar im double-Kontext: String(x) — ganzzahlig OHNE ".0", weil das
 * Lint `prefer_int_literals` dort int-Literale verlangt (implizit double). */
const ds = x => String(x);
/* Kovarianz als 6 Eintraege [xx, xy, xz, yy, yz, zz] oder null */
function cov6(c) {
  if (!c) return 'null';
  return '[' + [c[0][0], c[0][1], c[0][2], c[1][1], c[1][2], c[2][2]].map(d).join(', ') + ']';
}

/* Kamera-Messung mit Sichtlinien-Kovarianz (wie src/sensor.js#sample). */
function cameraSample(pTrue) {
  const lf = S.losFrame(CAM, pTrue);
  const sd = K_DEPTH * lf.d;
  const w = S.rotateVec(lf.R, [gauss() * sd, gauss() * SIG_LAT, gauss() * SIG_LAT]);
  return { p: [pTrue[0] + w[0], pTrue[1] + w[1], pTrue[2] + w[2]],
           cov: S.worldCov(lf.R, sd, SIG_LAT) };
}

const RANK1 = [[1, 2, 3], [2, 4, 6], [3, 6, 9]];   // singulaer ⇒ I₃ im Fit

const out = [];
const P = s => out.push(s);

P('// EINGEFRORENE Golden-Fixture fuer den Dart-Port des gewichteten Fits');
P('// (StateEstimator weighted/covFloorSigmaM) und der Residuen');
P('// (BallisticResidual euclideanM/mahalanobis).');
P('//');
P('// NICHT VON HAND EDITIEREN. Die ' + N_SCENARIOS + ' Szenarien (Eingaben UND');
P('// Erwartungswerte) wurden deterministisch durch die JS-Referenz');
P('// `src/engine.js` (+ `src/sensor.js` fuer die Sichtlinien-Kovarianzen,');
P('// `tools/sweep-basket.js#floorCov` fuer den Kovarianz-Boden) erzeugt');
P('// (mulberry32, Seed ' + SEED + ', kein Math.random). Zahlen sind mit JS');
P('// `String(x)` gedruckt und damit bit-exakt als IEEE-754-double reproduzierbar.');
P('//');
P('// Erzeugt mit exakt diesem Kommando vom Repo-Root (Node ' + process.version + '):');
P('//');
P('//   node tools/golden-dart-weighted-fit.js \\');
P('//     > app/test/engine/prediction/weighted_fit_fixture.dart');
P('');
P('/// Ein eingefrorenes Szenario: Messungen (Position + optionale Kovarianz)');
P('/// als Eingabe, der von der JS-Referenz gewichtet geschaetzte Zustand sowie');
P('/// die Residuen einer zusaetzlichen Probemessung gegen diesen Zustand.');
P('class WeightedFitScenario {');
P('  const WeightedFitScenario({');
P('    required this.covFloorSigmaM,');
P('    required this.samplesTxyzM,');
P('    required this.sampleCovsM2,');
P('    required this.expectedT0S,');
P('    required this.expectedP0M,');
P('    required this.expectedV0Mps,');
P('    required this.probeTxyzM,');
P('    required this.probeCovM2,');
P('    required this.probeSigmaM,');
P('    required this.expectedEuclideanM,');
P('    required this.expectedMahalanobis,');
P('  });');
P('');
P('  /// Kovarianz-Boden des Fits in Metern (`0` = aus; JS `floorCov`).');
P('  final double covFloorSigmaM;');
P('');
P('  /// Messpunkte, je Zeile `[tS, xM, yM, zM]`.');
P('  final List<List<double>> samplesTxyzM;');
P('');
P('  /// Kovarianz je Messpunkt als `[xx, xy, xz, yy, yz, zz]` in m² oder');
P('  /// `null` (Messung ohne cov ⇒ Gewicht `I₃`).');
P('  final List<List<double>?> sampleCovsM2;');
P('');
P('  /// Erwartetes `t0` in Sekunden (JS-Referenz, gewichtet).');
P('  final double expectedT0S;');
P('');
P('  /// Erwartetes `p0` in Metern, `[xM, yM, zM]` (JS-Referenz, gewichtet).');
P('  final List<double> expectedP0M;');
P('');
P('  /// Erwartetes `v0` in m/s, `[vxMps, vyMps, vzMps]` (JS-Referenz, gewichtet).');
P('  final List<double> expectedV0Mps;');
P('');
P('  /// Probemessung `[tS, xM, yM, zM]` fuer die Residuen.');
P('  final List<double> probeTxyzM;');
P('');
P('  /// Kovarianz der Probemessung (`[xx, xy, xz, yy, yz, zz]`) oder `null`.');
P('  final List<double>? probeCovM2;');
P('');
P('  /// σ-Argument fuer `residualMaha` (Fallback) oder `null`.');
P('  final double? probeSigmaM;');
P('');
P('  /// Erwartetes `residual(state, G, probe)` in Metern.');
P('  final double expectedEuclideanM;');
P('');
P('  /// Erwartetes `residualMaha(state, G, probe, sigma)` (dimensionslos).');
P('  final double expectedMahalanobis;');
P('}');
P('');
P('/// Gravitationskonstante, mit der ALLE Szenarien erzeugt wurden.');
P('const double weightedFitGravityMps2 = ' + ds(G) + ';');
P('');
P('/// Die ' + N_SCENARIOS + ' eingefrorenen Szenarien (Reihenfolge = Erzeugungsreihenfolge).');
P('const List<WeightedFitScenario> weightedFitScenarios = <WeightedFitScenario>[');

for (let sc = 0; sc < N_SCENARIOS; sc++) {
  const n = 5 + Math.floor(rnd() * 6);                    // 5..10
  const t0 = rnd() * 2;
  const p0 = [rnd() * 6 - 3, 2 + rnd() * 5, 0.5 + rnd() * 1.5];
  const v0 = [rnd() * 6 - 3, -(1 + rnd() * 4), 3 + rnd() * 5];
  const truePos = t => [p0[0] + v0[0] * t, p0[1] + v0[1] * t,
                        p0[2] + v0[2] * t - 0.5 * G * t * t];
  const mixed = sc === 3 || sc === 7;                     // jede 3. ohne cov
  const singular = sc === 6;                              // Messung 2 Rang 1
  const floor = sc === 9 ? 0.2 : 0;                       // Kovarianz-Boden
  const probeNoCov = sc === 10 || sc === 11;              // Fallback-Pfad
  const probeSigma = sc === 10 ? 0.05 : null;             // σ-Argument

  const samples = [];
  for (let i = 0; i < n; i++) {
    const t = i / HZ;
    const m = cameraSample(truePos(t));
    let cov = m.cov;
    if (mixed && i % 3 === 0) cov = null;
    if (singular && i === 2) cov = RANK1;
    samples.push(cov ? { t: t0 + t, p: m.p, cov } : { t: t0 + t, p: m.p });
  }
  const fitSamples = floor > 0 ? SW.floorCov(samples, floor) : samples;
  const st = E.estimateState(fitSamples, G, { weighted: true });
  if (!st) throw new Error('Szenario ' + sc + ': gewichteter Fit lieferte null');

  // Probe: 0,1 s nach der letzten Messung, absichtlich neben der Bahn.
  const tp = (n - 1) / HZ + 0.1;
  const pp = truePos(tp).map(c => c + gauss() * 0.1);
  const pm = cameraSample(pp);
  const probe = { t: t0 + tp, p: pm.p };
  if (!probeNoCov) probe.cov = pm.cov;
  const eucl = E.residual(st, G, probe);
  const maha = probeSigma == null ? E.residualMaha(st, G, probe)
                                  : E.residualMaha(st, G, probe, probeSigma);

  P('  WeightedFitScenario(');
  P('    // Szenario ' + sc + (mixed ? ' — jede 3. Messung ohne cov' : '') +
    (singular ? ' — Messung 2 mit singulaerer cov (Rang 1)' : '') +
    (floor > 0 ? ' — covFloor ' + floor + ' m' : '') +
    (probeNoCov ? (probeSigma == null ? ' — Probe ohne cov, ohne σ'
                                      : ' — Probe ohne cov, σ = ' + probeSigma) : ''));
  P('    covFloorSigmaM: ' + ds(floor) + ',');
  P('    samplesTxyzM: [');
  for (const s of samples)
    P('      [' + [s.t, s.p[0], s.p[1], s.p[2]].map(d).join(', ') + '],');
  P('    ],');
  P('    sampleCovsM2: [');
  for (const s of samples) P('      ' + cov6(s.cov) + ',');
  P('    ],');
  P('    expectedT0S: ' + ds(st.t0) + ',');
  P('    expectedP0M: [' + st.p0.map(d).join(', ') + '],');
  P('    expectedV0Mps: [' + st.v0.map(d).join(', ') + '],');
  P('    probeTxyzM: [' + [probe.t, probe.p[0], probe.p[1], probe.p[2]].map(d).join(', ') + '],');
  P('    probeCovM2: ' + cov6(probe.cov) + ',');
  P('    probeSigmaM: ' + (probeSigma == null ? 'null' : ds(probeSigma)) + ',');
  P('    expectedEuclideanM: ' + ds(eucl) + ',');
  P('    expectedMahalanobis: ' + ds(maha) + ',');
  P('  ),');
}
P('];');
console.log(out.join('\n'));
