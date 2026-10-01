/* =====================================================================
 *  Tests: Mahalanobis-Residuum + Gate-Politik (rms/maha, reset/drop)
 * =====================================================================
 *  node --test test/        (Node ≥ 18)
 *  Doku: .okf/engine/residual-gate.md, .okf/engine/state-estimation.md
 *  Alles deterministisch: mulberry32-RNG mit festem Seed, keine Math.random.
 * ===================================================================== */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');
const S = require('../src/sensor.js');
const SW = require('../tools/sweep-basket.js');

const G = 9.81;

/* Deterministischer RNG wie im Sweep-Harness */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Ruhender Zustand im Ursprung ohne Schwerkraft (g = 0) ⇒ p_pred ≡ 0,
 * das Residuum ist dann exakt die Messposition. */
const AT_ORIGIN = { t0: 0, p0: [0, 0, 0], v0: [0, 0, 0] };

/* ---------------------------------------------------------------------
 *  residualMaha — Handrechnung
 * ------------------------------------------------------------------ */

test('residualMaha: Diagonal-cov = komponentenweise σ-Vielfache', () => {
  const cov = [[0.04, 0, 0], [0, 0.01, 0], [0, 0, 0.25]];   // σ = 0.2 / 0.1 / 0.5
  // r = (0.4, 0.3, 1.5) ⇒ (2σ, 3σ, 3σ) ⇒ dM = √(4+9+9) = √22
  const m = { t: 0, p: [0.4, 0.3, 1.5], cov };
  assert.ok(Math.abs(E.residualMaha(AT_ORIGIN, 0, m) - Math.sqrt(22)) < 1e-12);
  // Einzelachse: 1σ in x ⇒ dM = 1
  assert.ok(Math.abs(E.residualMaha(AT_ORIGIN, 0, { t: 0, p: [0.2, 0, 0], cov }) - 1) < 1e-12);
});

test('residualMaha: gedrehte cov — Querabweichung wiegt schwerer als Tiefe', () => {
  // Sichtlinie entlang +x: σ_d = 1.0 (Tiefe), σ_lat = 0.02 (quer)
  const lf = S.losFrame([0, 0, 0], [5, 0, 0]);
  const cov = S.worldCov(lf.R, 1.0, 0.02);
  const state = { t0: 0, p0: [5, 0, 0], v0: [0, 0, 0] };
  const depth = { t: 0, p: [5.5, 0, 0], cov };     // 0.5 m Tiefe = 0.5 σ
  const lat   = { t: 0, p: [5, 0.5, 0], cov };     // 0.5 m quer  = 25 σ
  assert.ok(Math.abs(E.residualMaha(state, 0, depth) - 0.5) < 1e-9);
  assert.ok(Math.abs(E.residualMaha(state, 0, lat) - 25) < 1e-9);
  // Der euklidische Residuenwert sieht beide gleich — genau die Schwäche
  // des rms-Gates, die die Mahalanobis-Variante behebt.
  assert.ok(Math.abs(E.residual(state, 0, depth) - E.residual(state, 0, lat)) < 1e-12);
});

test('residualMaha: berücksichtigt Schwerkraft und Zeitbezug wie residual', () => {
  const state = { t0: 1.0, p0: [1, 2, 3], v0: [4, -1, 6] };
  const tau = 0.35, t = state.t0 + tau;
  const p = [state.p0[0] + state.v0[0] * tau,
             state.p0[1] + state.v0[1] * tau,
             state.p0[2] + state.v0[2] * tau - 0.5 * G * tau * tau];
  const m = { t, p, cov: [[0.01, 0, 0], [0, 0.01, 0], [0, 0, 0.01]] };
  assert.ok(E.residualMaha(state, G, m) < 1e-9);      // exakt auf der Bahn
  const off = { t, p: [p[0] + 0.3, p[1], p[2]], cov: m.cov };
  assert.ok(Math.abs(E.residualMaha(state, G, off) - 3) < 1e-9);   // 0.3 = 3·0.1
});

test('residualMaha: {x,y,z}-Form wird wie p akzeptiert', () => {
  const cov = [[0.04, 0, 0], [0, 0.04, 0], [0, 0, 0.04]];
  const a = E.residualMaha(AT_ORIGIN, 0, { t: 0, p: [0.2, 0.2, 0], cov });
  const b = E.residualMaha(AT_ORIGIN, 0, { t: 0, x: 0.2, y: 0.2, z: 0, cov });
  assert.equal(a, b);
});

/* ---------------------------------------------------------------------
 *  residualMaha — Fallbacks
 * ------------------------------------------------------------------ */

test('residualMaha: ohne cov ⇒ euklidisch / σ (Argument, sample.sigma, sonst 1)', () => {
  const m = { t: 0, p: [0.3, 0.4, 0] };              // ‖r‖ = 0.5
  assert.ok(Math.abs(E.residualMaha(AT_ORIGIN, 0, m) - 0.5) < 1e-12);
  assert.ok(Math.abs(E.residualMaha(AT_ORIGIN, 0, m, 0.1) - 5) < 1e-12);
  const ms = { t: 0, p: [0.3, 0.4, 0], sigma: 0.25 };
  assert.ok(Math.abs(E.residualMaha(AT_ORIGIN, 0, ms) - 2) < 1e-12);
  // Argument schlägt sample.sigma
  assert.ok(Math.abs(E.residualMaha(AT_ORIGIN, 0, ms, 0.5) - 1) < 1e-12);
  // Ohne cov und ohne σ identisch zu residual
  assert.equal(E.residualMaha(AT_ORIGIN, 0, m), E.residual(AT_ORIGIN, 0, m));
});

test('residualMaha: singuläre/ungültige cov ⇒ derselbe Fallback', () => {
  const zero = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rank1 = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
  const nan = [[NaN, 0, 0], [0, 1, 0], [0, 0, 1]];
  const bad = [[1, 0], [0, 1]];                       // falsche Form
  for (const cov of [zero, rank1, nan, bad]) {
    const m = { t: 0, p: [0.3, 0.4, 0], cov };
    assert.ok(Math.abs(E.residualMaha(AT_ORIGIN, 0, m, 0.1) - 5) < 1e-12,
      `Fallback fehlt für ${JSON.stringify(cov)}`);
  }
});

test('residualMaha: nicht positiv definite cov ⇒ Fallback statt NaN', () => {
  // invertierbar, aber indefinit ⇒ rᵀ·W·r kann negativ werden
  const cov = [[1, 0, 0], [0, -1, 0], [0, 0, 1]];
  const m = { t: 0, p: [0, 0.4, 0], cov };
  const d = E.residualMaha(AT_ORIGIN, 0, m, 0.1);
  assert.ok(isFinite(d) && d > 0, `endlich erwartet, war ${d}`);
  assert.ok(Math.abs(d - 4) < 1e-12);                 // 0.4 / 0.1
});

/* ---------------------------------------------------------------------
 *  χ²-Konsistenz des Sensormodells
 * ------------------------------------------------------------------ */

test('Sensormodell: rᵀ·cov⁻¹·r hat Mittel 3 (χ²₃) über 20 000 Ziehungen', () => {
  const rand = rng(20260905);
  const cam = S.createCamera({ recall: 1, precision: 1, tAcq: 0, hz: 1e6 });
  const robot = { x: 0, y: 0, th: 0 };
  let n = 0, sum = 0, sum2 = 0;
  let t = 0;
  while (n < 20000) {
    t += 1e-6;
    // Ball über den Sichtkegel und den Distanzbereich streuen
    const d = 0.6 + rand() * 9, az = (rand() * 2 - 1) * 0.5, el = (rand() * 2 - 1) * 0.4;
    const ball = { x: Math.cos(el) * Math.cos(az) * d,
                   y: Math.cos(el) * Math.sin(az) * d,
                   z: 0.25 + Math.sin(el) * d };
    const m = cam.sample({ t, ball, robot, rand });
    if (!m) continue;
    const W = E.invert3(m.cov);
    assert.ok(W, 'cov muss invertierbar sein');
    const r = [m.p[0] - ball.x, m.p[1] - ball.y, m.p[2] - ball.z];
    let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += r[i] * W[i][j] * r[j];
    n++; sum += s; sum2 += s * s;
    // dieselbe Größe über residualMaha (ruhender Zustand an der Wahrheit)
    const st = { t0: t, p0: [ball.x, ball.y, ball.z], v0: [0, 0, 0] };
    assert.ok(Math.abs(E.residualMaha(st, 0, m) ** 2 - s) < 1e-9 * Math.max(1, s));
  }
  const mean = sum / n;
  assert.ok(Math.abs(mean - 3) < 0.15,
    `Mittel der normalisierten Residuen ${mean.toFixed(4)}, erwartet 3 ± 0.15`);
  // Varianz von χ²₃ ist 6 — grober Formcheck, damit nicht nur der Mittelwert stimmt
  const varc = sum2 / n - mean * mean;
  assert.ok(Math.abs(varc - 6) < 1.2, `Varianz ${varc.toFixed(3)}, erwartet 6 ± 1.2`);
});

/* ---------------------------------------------------------------------
 *  Gate-Politik im Harness: drop vs. reset
 * ------------------------------------------------------------------ */

/* Exakte ballistische Messfolge (das Gate rechnet immer mit g = G) samt
 * isotroper cov (σ = 0.05); `bad` ersetzt Messungen durch Fehlmessungen
 * 3 m quer daneben. */
const COV = [[0.0025, 0, 0], [0, 0.0025, 0], [0, 0, 0.0025]];
const TRUTH = { t0: 0, p0: [0, 0, 3], v0: [2, 0, 1] };
function track(n, bad, cov) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i * 0.1, off = bad && bad.includes(i) ? 3 : 0;
    out.push({ t, cov: cov || COV, id: i, p: [
      TRUTH.p0[0] + TRUTH.v0[0] * t,
      TRUTH.p0[1] + TRUTH.v0[1] * t + off,
      TRUTH.p0[2] + TRUTH.v0[2] * t - 0.5 * G * t * t] });
  }
  return out;
}
/* Puffer-Aufbau exakt wie `integrate` in tools/sweep-basket.js */
function feedAll(params, meas) {
  const gate = SW.createGate(params);
  let samples = [], est = null;
  const log = [];
  for (const m of meas) {
    const dec = gate.feed(est, samples, m);
    log.push(dec.action);
    if (dec.action === 'drop') continue;
    if (dec.action === 'reset') samples = dec.samples;
    samples.push(m);
    est = E.estimateState(samples, G);
  }
  return { samples, log };
}
const BASE = { noise: 0.05, gateK: 5, gateHits: 3, gate: 'maha',
               outlier: 'drop', fit: 'plain' };

test('Gate drop: einzelne Fehlmessung landet NICHT im Puffer', () => {
  const meas = track(9, [5]);
  const r = feedAll(BASE, meas);
  assert.equal(r.log[5], 'drop');
  assert.ok(!r.samples.some(s => s.id === 5), 'Ausreißer darf nicht im Puffer sein');
  assert.equal(r.samples.length, 8);
  assert.deepEqual(r.log.filter(a => a === 'reset'), []);
});

test('Gate drop: drei Ausreißer in Folge ⇒ Reset auf genau diese drei', () => {
  const meas = track(10, [5, 6, 7]);
  const r = feedAll(BASE, meas);
  assert.deepEqual(r.log.slice(5, 8), ['drop', 'drop', 'reset']);
  // Puffer nach dem Reset: die drei Ausreißer, danach laufen wieder
  // gute Messungen ein (die gegen den neuen Fit erneut auffallen dürfen).
  assert.deepEqual(r.samples.slice(0, 3).map(s => s.id), [5, 6, 7]);
});

test('Gate reset: einzelne Fehlmessung löst einen unnötigen Reset aus', () => {
  // Sie kommt in den Puffer, verbiegt den Fit und lässt die NÄCHSTEN
  // (guten) Messungen als Ausreißer erscheinen ⇒ Reset auf 5/6/7, die
  // gesamte gute Vorgeschichte ist weg. Genau das vermeidet 'drop'.
  const meas = track(9, [5]);
  const r = feedAll({ ...BASE, outlier: 'reset' }, meas);
  assert.equal(r.log[5], 'accept');
  assert.equal(r.log[7], 'reset');
  assert.deepEqual(r.samples.map(s => s.id), [5, 6, 7, 8]);
  const d = feedAll(BASE, meas);
  assert.deepEqual(d.samples.map(s => s.id), [0, 1, 2, 3, 4, 6, 7, 8]);
});

test('Gate reset: drei Ausreißer in Folge maskieren sich selbst', () => {
  // Jeder Ausreißer landet im Puffer und zieht den Fit mit — nach dem
  // zweiten liegt der dritte innerhalb der Schwelle, das Gate schlägt NIE an.
  const r = feedAll({ ...BASE, outlier: 'reset' }, track(10, [5, 6, 7]));
  assert.ok(!r.log.includes('reset'), `Reset unerwartet: ${r.log}`);
  assert.equal(r.samples.length, 10);
});

test('Gate: erste drei Messungen passieren immer (kein est/zu kurzer Puffer)', () => {
  const r = feedAll(BASE, track(6, [0, 1, 2]));
  assert.deepEqual(r.log.slice(0, 3), ['accept', 'accept', 'accept']);
});

test('Gate rms: Querausreißer rutscht durch, maha fängt ihn', () => {
  // Sichtlinien-cov: σ_d = 1.0 entlang x, σ_lat = 0.02 quer
  const lf = S.losFrame([0, 0, 0], [1, 0, 0]);
  const cov = S.worldCov(lf.R, 1.0, 0.02);
  const meas = track(9, null, cov);
  // 0.5 m quer zur Sichtlinie = 25 σ_lat, aber nur 0.5·√(spur/3) im rms-Maß
  meas[5] = { ...meas[5], p: [meas[5].p[0], meas[5].p[1] + 0.5, meas[5].p[2]], id: 5 };
  const rms = feedAll({ ...BASE, gate: 'rms', outlier: 'drop' }, meas);
  const maha = feedAll({ ...BASE, gate: 'maha', outlier: 'drop' }, meas);
  assert.equal(rms.log[5], 'accept', 'rms-Schwelle ist quer zu lax');
  assert.equal(maha.log[5], 'drop', 'maha muss 25 σ erkennen');
});

test('Gate-Defaults rms/reset: Politik ist bit-identisch zur alten Logik', () => {
  const params = { noise: 0.05, gateK: 5, gateHits: 2, gate: 'rms', outlier: 'reset' };
  const meas = track(12, [4, 5, 9]);
  const neu = feedAll(params, meas);
  // Referenz: die frühere Inline-Logik aus tools/sweep-basket.js
  const sigmaEff = Math.max(params.noise, 0.02);
  const sigmaOf = m => m.cov
    ? Math.max(0.02, Math.sqrt((m.cov[0][0] + m.cov[1][1] + m.cov[2][2]) / 3))
    : sigmaEff;
  let samples = [], est = null, residHits = 0;
  for (const m of meas) {
    if (est && samples.length >= 3) {
      const thr = params.gateK * sigmaOf(m) + 0.03;
      residHits = E.residual(est, G, m) > thr ? residHits + 1 : 0;
      if (residHits >= params.gateHits) {
        samples = params.gateHits > 1 ? samples.slice(-(params.gateHits - 1)) : [];
        residHits = 0;
      }
    }
    samples.push(m);
    est = E.estimateState(samples, G);
  }
  assert.deepEqual(neu.samples.map(s => s.id), samples.map(s => s.id));
});

/* ---------------------------------------------------------------------
 *  Kovarianz-Boden wCap
 * ------------------------------------------------------------------ */

test('floorCov: hebt die Eigenwerte um wCap², wCap = 0 lässt die Liste unberührt', () => {
  const lf = S.losFrame([0, 0, 0], [4, 1, 0.5]);
  const cov = S.worldCov(lf.R, 0.6, 0.024);
  const s = [{ t: 0, p: [0, 0, 0], cov }];
  assert.equal(SW.floorCov(s, 0), s);                       // gleiche Referenz
  const f = SW.floorCov(s, 0.2)[0];
  assert.notEqual(f, s[0]);
  assert.deepEqual(s[0].cov, cov, 'Original darf nicht verändert werden');
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      assert.ok(Math.abs(f.cov[i][j] - (cov[i][j] + (i === j ? 0.04 : 0))) < 1e-15);
  // Gewichtsverhältnis (Spur der Inversen als Proxy) sinkt deutlich
  const trW = c => { const W = E.invert3(c); return W[0][0] + W[1][1] + W[2][2]; };
  assert.ok(trW(f.cov) < trW(cov) / 10);
});

test('floorCov: Messungen ohne cov bleiben unverändert', () => {
  const s = [{ t: 0, p: [1, 2, 3] }];
  assert.equal(SW.floorCov(s, 0.2)[0], s[0]);
});

/* ---------------------------------------------------------------------
 *  Harness-Verdrahtung
 * ------------------------------------------------------------------ */

test('Harness: Defaults gate/outlier/wCap sind rms/reset/0', () => {
  assert.equal(SW.DEFAULTS.gate, 'rms');
  assert.equal(SW.DEFAULTS.outlier, 'reset');
  assert.equal(SW.DEFAULTS.wCap, 0);
});

test('Harness: estimatorGrid deckt fit × gate × outlier × gateK × minSamples ab', () => {
  const g = SW.estimatorGrid();
  assert.equal(g.length, 2 * 2 * 2 * 6 * 4);
  assert.equal(new Set(g.map(c => JSON.stringify(c))).size, g.length);
  assert.ok(g.some(c => c.fit === 'plain' && c.gate === 'rms' && c.outlier === 'reset' &&
                        c.gateK === 5 && c.minSamples === 0), 'Referenz fehlt im Gitter');
});

test('Harness: gate/outlier/wCap-Defaults ändern die Fangquote nicht', () => {
  const base = { ...SW.WP.ack, ...SW.CAM_BASE, fit: 'weighted' };
  const ref = SW.catchRate(base, 60, 7);
  for (const o of [{ gate: 'rms' }, { outlier: 'reset' }, { wCap: 0 },
                   { gate: 'rms', outlier: 'reset', wCap: 0 }])
    assert.equal(SW.catchRate({ ...base, ...o }, 60, 7), ref);
});
