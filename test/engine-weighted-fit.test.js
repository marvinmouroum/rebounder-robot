/* =====================================================================
 *  Tests: gewichteter Least-Squares-Fit (estimateState mit opts.weighted)
 * =====================================================================
 *  Aufruf:  node --test test/            (Node ≥ 18)
 *  Doku:    .okf/engine/state-estimation.md
 *  Alles deterministisch (mulberry32, feste Seeds) — keine Math.random().
 * ===================================================================== */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/engine.js');

const G = 9.81;

/* Deterministischer RNG (mulberry32) — Vorlage: tools/sweep-basket.js */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussOf(rand) {
  return function () {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/* Vergleich zweier Zustände mit relativer Toleranz (Skala ≥ 1). */
function assertStateClose(a, b, tol, msg) {
  assert.ok(a && b, `${msg}: Zustand fehlt`);
  assert.equal(a.t0, b.t0, `${msg}: t0`);
  for (let k = 0; k < 3; k++) {
    assert.ok(Math.abs(a.p0[k] - b.p0[k]) <= tol * Math.max(1, Math.abs(b.p0[k])),
      `${msg}: p0[${k}] ${a.p0[k]} vs ${b.p0[k]}`);
    assert.ok(Math.abs(a.v0[k] - b.v0[k]) <= tol * Math.max(1, Math.abs(b.v0[k])),
      `${msg}: v0[${k}] ${a.v0[k]} vs ${b.v0[k]}`);
  }
}

/* Synthetische Parabel mit isotropem Rauschen. */
function parabola(rand, opts) {
  const o = Object.assign({ p0: [1, -2, 3], v0: [4, 3, 7], n: 12, hz: 20,
                            sigma: 0.05, t0: 0.7, g: G }, opts || {});
  const gauss = gaussOf(rand), s = [];
  for (let i = 0; i < o.n; i++) {
    const t = i / o.hz;
    s.push({ t: o.t0 + t, p: [
      o.p0[0] + o.v0[0] * t + gauss() * o.sigma,
      o.p0[1] + o.v0[1] * t + gauss() * o.sigma,
      o.p0[2] + o.v0[2] * t - 0.5 * o.g * t * t + gauss() * o.sigma] });
  }
  return { samples: s, truth: o };
}

const I3 = () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/* ---- (a) Wᵢ = I₃ ≡ ungewichtet -------------------------------------- */

test('gewichtet mit I3 stimmt mit dem ungewichteten Fit überein', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const { samples } = parabola(rng(seed * 7919));
    const plain = E.estimateState(samples, G);
    const withCov = samples.map(s => ({ t: s.t, p: s.p, cov: I3() }));
    const w = E.estimateState(withCov, G, { weighted: true });
    assertStateClose(w, plain, 1e-9, `seed ${seed}`);
  }
});

test('gewichtet ohne cov (implizit I3) stimmt mit dem ungewichteten Fit überein', () => {
  const { samples } = parabola(rng(4242));
  assertStateClose(E.estimateState(samples, G, { weighted: true }),
    E.estimateState(samples, G), 1e-9, 'ohne cov');
});

test('gewichteter Pfad akzeptiert {t,x,y,z}-Messungen', () => {
  const { samples } = parabola(rng(31337));
  const xyz = samples.map(s => ({ t: s.t, x: s.p[0], y: s.p[1], z: s.p[2], cov: I3() }));
  assertStateClose(E.estimateState(xyz, G, { weighted: true }),
    E.estimateState(samples, G), 1e-9, 'xyz-Form');
});

test('mit g = 0 bleibt der gewichtete Fit ein Konstantgeschwindigkeits-Fit', () => {
  const { samples } = parabola(rng(99), { g: 0 });
  assertStateClose(E.estimateState(samples, 0, { weighted: true }),
    E.estimateState(samples, 0), 1e-9, 'g = 0');
});

/* ---- (b) anisotroper (sichtlinien-)Fall ------------------------------ */

/* Orthonormalbasis mit u als dritter Achse. */
function frame(u) {
  const ref = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1 = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2],
            u[0] * ref[1] - u[1] * ref[0]];
  const n1 = Math.hypot(e1[0], e1[1], e1[2]);
  e1 = e1.map(c => c / n1);
  const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2],
              u[0] * e1[1] - u[1] * e1[0]];
  return [e1, e2];
}

/* Kamera-Messung: σ seitlich klein, σ entlang der Sichtlinie groß.
 * cov = σ_lat²·(e1e1ᵀ + e2e2ᵀ) + σ_d²·uuᵀ  (Weltsystem). */
function cameraSample(pTrue, cam, kDepth, sigLat, gauss) {
  const dv = [pTrue[0] - cam[0], pTrue[1] - cam[1], pTrue[2] - cam[2]];
  const d = Math.hypot(dv[0], dv[1], dv[2]);
  const u = dv.map(c => c / d);
  const [e1, e2] = frame(u);
  const sigD = kDepth * d;
  const n1 = gauss() * sigLat, n2 = gauss() * sigLat, n3 = gauss() * sigD;
  const p = [0, 1, 2].map(k => pTrue[k] + e1[k] * n1 + e2[k] * n2 + u[k] * n3);
  const cov = [];
  for (let r = 0; r < 3; r++) {
    cov.push([]);
    for (let c = 0; c < 3; c++)
      cov[r].push(sigLat * sigLat * (e1[r] * e1[c] + e2[r] * e2[c])
                + sigD * sigD * u[r] * u[c]);
  }
  return { p, cov };
}

function cameraRun(seed) {
  const rand = rng(seed), gauss = gaussOf(rand);
  const cam = [0, -3, 0.25];
  const truth = { p0: [-4, 6, 1.5], v0: [3, -4, 8] };
  const n = 14, hz = 20, samples = [];
  for (let i = 0; i < n; i++) {
    const t = i / hz;
    const pTrue = [truth.p0[0] + truth.v0[0] * t,
                   truth.p0[1] + truth.v0[1] * t,
                   truth.p0[2] + truth.v0[2] * t - 0.5 * G * t * t];
    const m = cameraSample(pTrue, cam, 0.15, 0.024, gauss);
    samples.push({ t, p: m.p, cov: m.cov });
  }
  // Fehlermaß: prognostizierte Position 0,4 s nach der letzten Messung.
  const tH = (n - 1) / hz + 0.4;
  const truePos = [truth.p0[0] + truth.v0[0] * tH,
                   truth.p0[1] + truth.v0[1] * tH,
                   truth.p0[2] + truth.v0[2] * tH - 0.5 * G * tH * tH];
  const err = st => {
    if (!st) return Infinity;
    const tau = tH - st.t0;
    return Math.hypot(
      st.p0[0] + st.v0[0] * tau - truePos[0],
      st.p0[1] + st.v0[1] * tau - truePos[1],
      st.p0[2] + st.v0[2] * tau - 0.5 * G * tau * tau - truePos[2]);
  };
  return { plain: err(E.estimateState(samples, G)),
           weighted: err(E.estimateState(samples, G, { weighted: true })) };
}

/* Gemessen (Seeds 1..200): RMS 0,53 m gewichtet vs. 1,21 m ungewichtet
 * (Verhältnis 0,44), Median-Verhältnis 0,41, gewichtet besser in 156/200
 * Läufen. Schwellen unten mit deutlichem Abstand darunter gewählt. */
test('anisotropes Rauschen: gewichteter Fit schlägt den ungewichteten', () => {
  const median = a => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
  let sp = 0, sw = 0, better = 0;
  const N = 200, ep = [], ew = [];
  for (let seed = 1; seed <= N; seed++) {
    const r = cameraRun(seed * 2654435761 >>> 0);
    assert.ok(Number.isFinite(r.plain) && Number.isFinite(r.weighted), `seed ${seed}`);
    sp += r.plain * r.plain; sw += r.weighted * r.weighted;
    ep.push(r.plain); ew.push(r.weighted);
    if (r.weighted < r.plain) better++;
  }
  const rmsPlain = Math.sqrt(sp / N), rmsW = Math.sqrt(sw / N);
  assert.ok(rmsW < 0.6 * rmsPlain,
    `RMS gewichtet ${rmsW.toFixed(3)} m vs. ungewichtet ${rmsPlain.toFixed(3)} m`);
  assert.ok(median(ew) < 0.6 * median(ep),
    `Median gewichtet ${median(ew).toFixed(3)} m vs. ungewichtet ${median(ep).toFixed(3)} m`);
  assert.ok(better >= 0.65 * N,
    `gewichtet besser in ${better}/${N} Läufen (erwartet ≥ ${0.65 * N})`);
});

/* ---- (c) Mischung mit/ohne cov -------------------------------------- */

test('Messungen ohne cov werden im gewichteten Modus mit I3 gewichtet', () => {
  const { samples } = parabola(rng(5150));
  const mixed = samples.map((s, i) =>
    i % 2 ? { t: s.t, p: s.p } : { t: s.t, p: s.p, cov: I3() });
  assertStateClose(E.estimateState(mixed, G, { weighted: true }),
    E.estimateState(samples, G), 1e-9, 'Mischung I3/ohne cov');
});

test('Mischung echter Kovarianzen mit cov-losen Messungen liefert einen plausiblen Zustand', () => {
  const rand = rng(777), gauss = gaussOf(rand);
  const truth = { p0: [-4, 6, 1.5], v0: [3, -4, 8] };
  const samples = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 20;
    const pTrue = [truth.p0[0] + truth.v0[0] * t, truth.p0[1] + truth.v0[1] * t,
                   truth.p0[2] + truth.v0[2] * t - 0.5 * G * t * t];
    const m = cameraSample(pTrue, [0, -3, 0.25], 0.05, 0.024, gauss);
    samples.push(i % 3 === 0 ? { t, p: m.p } : { t, p: m.p, cov: m.cov });
  }
  const st = E.estimateState(samples, G, { weighted: true });
  assert.ok(st, 'Zustand erwartet');
  for (let k = 0; k < 3; k++) {
    assert.ok(Number.isFinite(st.p0[k]) && Number.isFinite(st.v0[k]), 'endlich');
    assert.ok(Math.abs(st.p0[k] - truth.p0[k]) < 1, `p0[${k}] nahe Wahrheit`);
    assert.ok(Math.abs(st.v0[k] - truth.v0[k]) < 3, `v0[${k}] nahe Wahrheit`);
  }
});

/* ---- (d) singuläre / kaputte cov ⇒ Fallback, keine Exception -------- */

test('singuläre cov einer Messung ⇒ I3 für diese Messung, keine Exception', () => {
  const { samples } = parabola(rng(2024));
  const sing = samples.map((s, i) => i === 3
    ? { t: s.t, p: s.p, cov: [[1, 2, 3], [2, 4, 6], [3, 6, 9]] }   // Rang 1
    : { t: s.t, p: s.p });
  const st = E.estimateState(sing, G, { weighted: true });
  assertStateClose(st, E.estimateState(samples, G), 1e-9, 'singuläre cov');
});

test('durchweg singuläre/ungültige cov ⇒ Ergebnis wie ungewichtet', () => {
  const { samples } = parabola(rng(1234));
  const variants = [
    [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    [[1, 0, 0], [0, 1, 0]],
    [[NaN, 0, 0], [0, 1, 0], [0, 0, 1]],
    'kaputt'
  ];
  for (const cov of variants) {
    const s = samples.map(x => ({ t: x.t, p: x.p, cov }));
    const st = E.estimateState(s, G, { weighted: true });
    assertStateClose(st, E.estimateState(samples, G), 1e-9, `cov ${JSON.stringify(cov)}`);
  }
});

test('singuläre Normalmatrix (alle Messungen zur selben Zeit) ⇒ null wie ungewichtet', () => {
  const s = [{ t: 1, p: [0, 0, 0], cov: I3() }, { t: 1, p: [0.1, 0, 0], cov: I3() }];
  assert.equal(E.estimateState(s, G, { weighted: true }), null);
  assert.equal(E.estimateState(s, G), null);
});

test('n < 2 liefert auch gewichtet null', () => {
  assert.equal(E.estimateState([{ t: 0, p: [0, 0, 0], cov: I3() }], G, { weighted: true }), null);
  assert.equal(E.estimateState([], G, { weighted: true }), null);
});

/* ---- (e) invert3 / solveLinear --------------------------------------- */

test('invert3 gegen bekannte Matrix', () => {
  const M = [[4, 7, 2], [3, 6, 1], [2, 5, 3]];          // det = 9
  const inv = E.invert3(M);
  assert.ok(inv, 'Inverse erwartet');
  const exp = [[13 / 9, -11 / 9, -5 / 9],               // adj(M)/det
               [-7 / 9, 8 / 9, 2 / 9],
               [3 / 9, -6 / 9, 3 / 9]];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      assert.ok(Math.abs(inv[r][c] - exp[r][c]) < 1e-12, `inv[${r}][${c}]`);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += M[r][k] * inv[k][c];
      assert.ok(Math.abs(s - (r === c ? 1 : 0)) < 1e-12, `M·M⁻¹[${r}][${c}]`);
    }
});

test('invert3 auf Diagonalmatrix und Singularität', () => {
  const d = E.invert3([[0.04, 0, 0], [0, 0.04, 0], [0, 0, 0.25]]);
  assert.ok(Math.abs(d[0][0] - 25) < 1e-9 && Math.abs(d[2][2] - 4) < 1e-9);
  assert.equal(E.invert3([[1, 2, 3], [2, 4, 6], [3, 6, 9]]), null, 'Rang 1 ⇒ null');
  assert.equal(E.invert3([[1, 0], [0, 1]]), null, 'falsche Form ⇒ null');
  assert.equal(E.invert3(null), null);
});

test('solveLinear löst ein bekanntes System und erkennt Singularität', () => {
  const x = E.solveLinear([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]], [8, -11, -3]);
  assert.ok(x);
  const exp = [2, 3, -1];
  for (let k = 0; k < 3; k++) assert.ok(Math.abs(x[k] - exp[k]) < 1e-12, `x[${k}]`);
  assert.equal(E.solveLinear([[1, 2], [2, 4]], [1, 2]), null, 'singulär ⇒ null');
  assert.equal(E.solveLinear([[1, 2]], [1, 2]), null, 'Formfehler ⇒ null');
});

/* ---- (f) Bestandsverhalten: Aufruf ohne opts unverändert ------------- */

/* Golden-Werte, erzeugt mit der Fassung von src/engine.js VOR der
 * Erweiterung (Commit ef4faa5) — exakter Vergleich (Object.is). */
const GOLD_SAMPLES = [
  { t: 0.0,  p: [1.00, -2.00, 3.00] },
  { t: 0.05, p: [1.21, -1.83, 3.42] },
  { t: 0.10, p: [1.39, -1.71, 3.77] },
  { t: 0.15, p: [1.63, -1.55, 4.05] },
  { t: 0.20, p: [1.78, -1.42, 4.29] },
  { t: 0.25, p: [2.02, -1.24, 4.46] },
  { t: 0.30, p: [2.21, -1.09, 4.58] }
];
const GOLD_G = { t0: 0,
  p0: [1.0014285714285711, -1.9985714285714289, 3.0908303571428584],
  v0: [4.028571428571429, 3.0000000000000013, 6.714357142857135] };
const GOLD_0 = { t0: 0,
  p0: [1.0014285714285711, -1.9985714285714289, 3.1521428571428585],
  v0: [4.028571428571429, 3.0000000000000013, 5.242857142857134] };

function assertBitEqual(a, b, msg) {
  assert.ok(a, `${msg}: Zustand fehlt`);
  assert.ok(Object.is(a.t0, b.t0), `${msg}: t0`);
  for (let k = 0; k < 3; k++) {
    assert.ok(Object.is(a.p0[k], b.p0[k]), `${msg}: p0[${k}] ${a.p0[k]} ≠ ${b.p0[k]}`);
    assert.ok(Object.is(a.v0[k], b.v0[k]), `${msg}: v0[${k}] ${a.v0[k]} ≠ ${b.v0[k]}`);
  }
}

test('Aufruf ohne opts ist bit-identisch zum Verhalten vor der Erweiterung', () => {
  assertBitEqual(E.estimateState(GOLD_SAMPLES, G), GOLD_G, 'g = 9.81');
  assertBitEqual(E.estimateState(GOLD_SAMPLES, 0), GOLD_0, 'g = 0');
});

test('opts ohne weighted (bzw. weighted: false) nimmt denselben Codepfad', () => {
  assertBitEqual(E.estimateState(GOLD_SAMPLES, G, {}), GOLD_G, 'leeres opts');
  assertBitEqual(E.estimateState(GOLD_SAMPLES, G, { weighted: false }), GOLD_G, 'weighted: false');
  assertBitEqual(E.estimateState(GOLD_SAMPLES, G, { weighted: 1 }), GOLD_G, 'weighted: 1 (nicht ===true)');
  assertBitEqual(E.estimateState(GOLD_SAMPLES, G, null), GOLD_G, 'opts = null');
});

test('cov wird ohne weighted ignoriert (Bestandsaufrufer merken nichts)', () => {
  const withCov = GOLD_SAMPLES.map(s => ({ t: s.t, p: s.p,
    cov: [[0.0004, 0, 0], [0, 0.0004, 0], [0, 0, 1]] }));
  assertBitEqual(E.estimateState(withCov, G), GOLD_G, 'cov ignoriert');
});

test('Rückgabestruktur unverändert (nur t0, p0, v0) und mit residual/planCatch nutzbar', () => {
  const { samples } = parabola(rng(8080));
  const st = E.estimateState(samples, G, { weighted: true });
  assert.deepEqual(Object.keys(st), ['t0', 'p0', 'v0']);
  assert.equal(st.p0.length, 3);
  assert.equal(st.v0.length, 3);
  const r = E.residual(st, G, samples[3]);                 // Residuen in Metern
  assert.ok(Number.isFinite(r) && r >= 0 && r < 1, `Residuum ${r}`);
  const imp = E.predictImpact(st, G, 0.5);
  assert.ok(imp && Number.isFinite(imp.x) && Number.isFinite(imp.tImpact));
});
