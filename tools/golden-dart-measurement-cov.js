#!/usr/bin/env node
/* =====================================================================
 *  golden-dart-measurement-cov — druckt die Golden-Faelle fuer den
 *  Dart-Port des Kamera-Messkovarianzmodells
 *  (app/lib/engine/world/measurement_covariance_model.dart) aus der
 *  JS-Referenz src/sensor.js (losFrame + worldCov).
 *
 *  Aufruf vom Repo-Root:   node tools/golden-dart-measurement-cov.js
 *
 *  Die Ausgabe ist ein Dart-Listenliteral und wird unveraendert in
 *  app/test/engine/world/measurement_covariance_model_test.dart
 *  (Konstante `_goldenCases`) eingefroren. Zahlen werden mit JS `String(x)`
 *  gedruckt (kuerzeste Roundtrip-Darstellung, bit-exakt als IEEE-754-double
 *  reproduzierbar). Ganzzahlen bleiben Int-Literale — Dart liest sie im
 *  double-Kontext als double, und der Lint `prefer_int_literals`
 *  (very_good_analysis) verbietet `0.0`. Die sechs Kovarianz-Eintraege
 *  stehen als Liste [xx, yy, zz, xy, xz, yz], nicht als `Covariance3(...)`,
 *  weil `xyM2: 0` dort den Lint `avoid_redundant_argument_values` ausloest.
 *  Kein RNG, keine Abhaengigkeiten — reine Funktionen der Referenz.
 *
 *  Wird von `npm test` (node --test test/) NICHT als Test erfasst.
 * ===================================================================== */
'use strict';

const S = require('../src/sensor.js');

// Z-Defaults des Sensormodells (sensor.js DEFAULTS): σ_lat = kLat·latRef,
// σ_d = kDepth·d.
const K_LAT = S.DEFAULTS.kLat;
const LAT_REF = S.DEFAULTS.latRef;
const K_DEPTH = S.DEFAULTS.kDepth;

// Kamera/Ball-Paare im Engine-Weltsystem E (z nach oben), Meter.
const CASES = [
  { name: 'Engine-Gate-Fall (4, 1, 0.5)', cam: [0, 0, 0], ball: [4, 1, 0.5] },
  { name: 'Roboterkamera 0.25 m, Ball voraus-oben', cam: [0.3, -0.2, 0.25], ball: [2.5, 6.0, 1.8] },
  { name: 'negative Koordinaten, Ball unter Kamera', cam: [-1.5, -2.0, 0.25], ball: [-4.2, -7.5, -0.3] },
  { name: 'Helfer-Schwelle knapp unterhalb (|e1.z| ~ 0.8996, Helfer z)', cam: [0, 0, 0], ball: [1, 0, 2.06] },
  { name: 'Helfer-Schwelle knapp oberhalb (|e1.z| ~ 0.9004, Helfer x)', cam: [0, 0, 0], ball: [1, 0, 2.07] },
  { name: 'steil nach unten (|e1.z| ~ 0.99, Helfer x)', cam: [0, 0, 1.2], ball: [0.05, 0.1, 0.0] },
  { name: 'exakt senkrecht nach oben (e1 = +z)', cam: [0, 0, 0], ball: [0, 0, 3] },
  { name: 'ferne Messung (~12.3 m)', cam: [0, 0, 0.25], ball: [8, -9, 2.5] },
];

// JS String(x): kuerzeste Roundtrip-Darstellung; Ganzzahlen ohne ".0".
const d = x => String(x);
const point = p => 'WorldPoint(xM: ' + d(p[0]) + ', yM: ' + d(p[1]) + ', zM: ' + d(p[2]) + ')';

const out = [];
out.push('const List<_GoldenCase> _goldenCases = <_GoldenCase>[');
for (const c of CASES) {
  const lf = S.losFrame(c.cam, c.ball);
  if (!lf) throw new Error('entarteter Fall: ' + c.name);
  const cov = S.worldCov(lf.R, K_DEPTH * lf.d, K_LAT * LAT_REF);
  out.push('  _GoldenCase(');
  out.push("    name: '" + c.name + "',");
  out.push('    cameraM: ' + point(c.cam) + ',');
  out.push('    ballM: ' + point(c.ball) + ',');
  out.push('    expectedDistanceM: ' + d(lf.d) + ',');
  out.push('    // xxM2, yyM2, zzM2, xyM2, xzM2, yzM2');
  out.push('    expectedCovM2: [');
  for (const v of [cov[0][0], cov[1][1], cov[2][2], cov[0][1], cov[0][2], cov[1][2]])
    out.push('      ' + d(v) + ',');
  out.push('    ],');
  out.push('  ),');
}
out.push('];');
console.log(out.join('\n'));
