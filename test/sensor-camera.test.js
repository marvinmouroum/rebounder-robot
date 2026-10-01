/* =====================================================================
 *  Tests: Kamera-Sensormodell (src/sensor.js)
 * =====================================================================
 *  node --test test/        (Node ≥ 18)
 *  Alles deterministisch: mulberry32-RNG mit festem Seed, keine Math.random.
 * ===================================================================== */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/sensor.js');
const SW = require('../tools/sweep-basket.js');

const D2R = Math.PI / 180;

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

/* Rauschfreie, lückenlose Kamera — isoliert die Geometrie */
const CLEAN = { recall: 1, precision: 1, kLat: 0, kDepth: 0, tAcq: 0, hz: 15 };
const ROBOT = { x: 0, y: 0, th: 0 };
const rand0 = rng(1);

/* Ein Frame zum Zeitpunkt 0 mit frischer Kamera */
function shot(params, ball, opts) {
  const cam = S.createCamera(Object.assign({}, CLEAN, params));
  cam.reset(null);
  return cam.sample(Object.assign({ t: 0, ball, robot: ROBOT, rand: rand0 }, opts));
}
/* Ball in Distanz d unter Azimut/Elevation (Grad) vor der Kamera bei z = camH */
function at(d, azDeg, elDeg, camH) {
  const az = azDeg * D2R, el = elDeg * D2R, h = camH === undefined ? 0.25 : camH;
  return { x: d * Math.cos(el) * Math.cos(az), y: d * Math.cos(el) * Math.sin(az),
           z: h + d * Math.sin(el) };
}

/* ---------------- Sichtfeld-Geometrie ---------------- */

test('Ball direkt vor der Kamera ist sichtbar und wird rauschfrei gemeldet', () => {
  const m = shot({}, at(5, 0, 0));
  assert.ok(m, 'Messung erwartet');
  assert.equal(m.kind, 'true');
  assert.ok(Math.abs(m.x - 5) < 1e-9 && Math.abs(m.y) < 1e-9);
  assert.ok(Math.abs(m.d - 5) < 1e-9);
  assert.equal(m.p.length, 3);
});

test('Azimutgrenze: knapp innerhalb hfov/2 sichtbar, knapp außerhalb nicht', () => {
  assert.ok(shot({}, at(5, 33.5, 0)), 'az = 33,5° < 34° muss sichtbar sein');
  assert.equal(shot({}, at(5, 34.5, 0)), null, 'az = 34,5° > 34° darf nicht sichtbar sein');
  assert.ok(shot({}, at(5, -33.5, 0)));
  assert.equal(shot({}, at(5, -34.5, 0)), null);
  assert.equal(shot({}, at(5, 180, 0)), null, 'Ball hinter der Kamera');
});

test('Elevationsgrenze: knapp innerhalb vfov/2 sichtbar, knapp außerhalb nicht', () => {
  assert.ok(shot({}, at(5, 0, 26)), 'el = 26° < 26,5°');
  assert.equal(shot({}, at(5, 0, 27)), null, 'el = 27° > 26,5°');
  assert.ok(shot({}, at(5, 0, -26)));
  assert.equal(shot({}, at(5, 0, -27)), null);
});

test('tilt verschiebt die Elevationsgrenze nach oben', () => {
  const high = at(5, 0, 40);
  assert.equal(shot({ tilt: 0 }, high), null, 'ohne Neigung außerhalb');
  assert.ok(shot({ tilt: 20 }, high), 'mit tilt = 20° innerhalb (rel. 20° < 26,5°)');
  const low = at(5, 0, -10);
  assert.ok(shot({ tilt: 0 }, low), 'flacher Ball ohne Neigung sichtbar');
  assert.equal(shot({ tilt: 20 }, low), null,
    'die geneigte Kamera verliert ihn dafür unten (rel. −30° > 26,5°)');
});

test('pan track macht einen seitlichen Ball sichtbar, fixed nicht', () => {
  const side = at(5, 60, 0);
  assert.equal(shot({ pan: 'fixed' }, side, { aim: side }), null);
  assert.ok(shot({ pan: 'track' }, side, { aim: side }), 'Gierwinkel folgt aim');
  // ohne aim fällt track auf das Fahrzeug-Heading zurück
  assert.equal(shot({ pan: 'track' }, side), null);
  // Neigung bleibt beim Schwenken erhalten: hoher seitlicher Ball bleibt draußen
  const sideHigh = at(5, 60, 40);
  assert.equal(shot({ pan: 'track' }, sideHigh, { aim: sideHigh }), null);
  assert.ok(shot({ pan: 'track', tilt: 30 }, sideHigh, { aim: sideHigh }));
});

test('inFov/viewAngles stimmen mit dem Sampling überein', () => {
  const pose = S.cameraPose([0, 0, 0.25], 0, 0);
  const va = S.viewAngles(pose, at(4, 20, 10));
  assert.ok(Math.abs(va.az / D2R - 20) < 1e-9);
  assert.ok(Math.abs(va.el / D2R - 10) < 1e-9);
  assert.ok(Math.abs(va.d - 4) < 1e-9);
  assert.ok(S.inFov(pose, at(4, 20, 10), 68 * D2R, 53 * D2R));
  assert.ok(!S.inFov(pose, at(4, 40, 10), 68 * D2R, 53 * D2R));
});

/* ---------------- Rauschrotation und Kovarianz ---------------- */

test('losFrame liefert eine orthonormale Basis mit der Sichtlinie in Spalte 0', () => {
  const lf = S.losFrame([0, 0, 0.25], { x: 3, y: 2, z: 1.5 });
  const col = j => [lf.R[0][j], lf.R[1][j], lf.R[2][j]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const e = [col(0), col(1), col(2)];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      assert.ok(Math.abs(dot(e[i], e[j]) - (i === j ? 1 : 0)) < 1e-12,
        `Orthonormalität ${i}${j}`);
  const d = Math.hypot(3, 2, 1.25);
  assert.ok(Math.abs(lf.d - d) < 1e-12);
  assert.ok(Math.abs(e[0][0] - 3 / d) < 1e-12);
});

test('worldCov: symmetrisch, Spur = σ_d² + 2σ_lat², Sichtlinie ist Eigenrichtung', () => {
  const target = { x: 3, y: 2, z: 1.5 }, camPos = [0, 0, 0.25];
  const lf = S.losFrame(camPos, target);
  const sd = 0.15 * lf.d, sl = 0.10 * 0.24;
  const C = S.worldCov(lf.R, sd, sl);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      assert.ok(Math.abs(C[i][j] - C[j][i]) < 1e-15, 'symmetrisch');
  const tr = C[0][0] + C[1][1] + C[2][2];
  assert.ok(Math.abs(tr - (sd * sd + 2 * sl * sl)) < 1e-12, 'Spur');
  // C·u = σ_d²·u für u = Sichtlinie (größte Varianz, da σ_d > σ_lat)
  const u = [lf.R[0][0], lf.R[1][0], lf.R[2][0]];
  const Cu = [0, 1, 2].map(i => C[i][0] * u[0] + C[i][1] * u[1] + C[i][2] * u[2]);
  for (let i = 0; i < 3; i++)
    assert.ok(Math.abs(Cu[i] - sd * sd * u[i]) < 1e-12, 'Eigenrichtung Sichtlinie');
  assert.ok(sd * sd > sl * sl, 'Tiefe ist die Richtung größter Varianz');
});

test('empirische Kovarianz aus 20 000 Ziehungen trifft cov auf 5 %', () => {
  const ball = { x: 3, y: 2, z: 1.5 };
  const cam = S.createCamera({ recall: 1, precision: 1, kLat: 0.10, kDepth: 0.15,
                               tAcq: 0, hz: 15, hfov: 120, vfov: 120 });
  cam.reset(null);
  const rand = rng(4242);
  const lf = S.losFrame([0, 0, 0.25], ball);
  const sd = 0.15 * lf.d, sl = 0.10 * 0.24;
  const col = j => [lf.R[0][j], lf.R[1][j], lf.R[2][j]];
  const e = [col(0), col(1), col(2)];
  const N = 20000, M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let cov = null;
  for (let i = 0; i < N; i++) {
    const m = cam.sample({ t: i / 15, ball, robot: ROBOT, rand });
    assert.ok(m, 'lückenlos bei recall = 1');
    cov = m.cov;
    const dv = [m.x - ball.x, m.y - ball.y, m.z - ball.z];
    const c = e.map(v => dv[0] * v[0] + dv[1] * v[1] + dv[2] * v[2]);  // ins LOS-Frame
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += c[a] * c[b];
  }
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] /= N;
  const want = [sd * sd, sl * sl, sl * sl];
  for (let a = 0; a < 3; a++) {
    assert.ok(Math.abs(M[a][a] / want[a] - 1) < 0.05,
      `Varianz Achse ${a}: ${M[a][a]} vs. ${want[a]}`);
    for (let b = 0; b < 3; b++)
      if (a !== b) assert.ok(Math.abs(M[a][b]) < 0.05 * Math.sqrt(want[a] * want[b]),
        `Kreuzterm ${a}${b} ≈ 0`);
  }
  // gemeldete Kovarianz = gedrehte Diagonale
  const back = S.rotateCov(lf.R, want);
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++)
    assert.ok(Math.abs(cov[a][b] - back[a][b]) < 1e-12);
});

/* ---------------- Raten: Aussetzer, Fehlmessungen ---------------- */

/* Liefert die Frame-Historie (true = Messung, false = Aussetzer) */
function frames(params, n, seed) {
  const cam = S.createCamera(Object.assign({ tAcq: 0, hz: 15, kLat: 0, kDepth: 0 }, params));
  cam.reset(null);
  const rand = rng(seed), ball = at(5, 0, 0), out = [];
  for (let i = 0; i < n; i++)
    out.push(cam.sample({ t: i / 15, ball, robot: ROBOT, rand }));
  return { out, stats: cam.stats() };
}
function meanDropRun(out) {
  let runs = 0, len = 0, run = 0;
  for (const m of out) {
    if (m) { if (run) { runs++; len += run; run = 0; } }
    else run++;
  }
  if (run) { runs++; len += run; }
  return runs ? len / runs : 0;
}

test('iid-Aussetzer treffen den Recall auf ±2 % (50 000 Frames)', () => {
  const { out, stats } = frames({ recall: 0.8, precision: 1, dropMode: 'iid' }, 50000, 11);
  const obs = out.filter(Boolean).length / out.length;
  assert.ok(Math.abs(obs - 0.8) < 0.02, `Recall beobachtet ${obs}`);
  assert.equal(stats.framesDue, 50000);
  assert.equal(stats.inFov, 50000);
  assert.ok(Math.abs(stats.recallObs - 0.8) < 0.02);
});

test('burst-Aussetzer halten denselben Langzeit-Recall, aber längere Runs', () => {
  const iid = frames({ recall: 0.8, precision: 1, dropMode: 'iid' }, 50000, 12);
  const bst = frames({ recall: 0.8, precision: 1, dropMode: 'burst', burstLen: 3 }, 50000, 12);
  const obs = bst.out.filter(Boolean).length / bst.out.length;
  assert.ok(Math.abs(obs - 0.8) < 0.02, `Recall burst ${obs}`);
  const rIid = meanDropRun(iid.out), rBst = meanDropRun(bst.out);
  assert.ok(rIid < 1.5, `iid-Aussetzer sind kurz (${rIid})`);
  assert.ok(Math.abs(rBst - 3) < 0.3, `mittlere Aussetzerlänge ≈ burstLen (${rBst})`);
  assert.ok(rBst > 2 * rIid, 'burst hat messbar längere Runs');
});

test('recall = 1 liefert jeden Frame, recall = 0 keinen', () => {
  assert.equal(frames({ recall: 1, precision: 1 }, 200, 13).out.filter(Boolean).length, 200);
  assert.equal(frames({ recall: 0, precision: 1 }, 200, 13).out.filter(Boolean).length, 0);
  assert.equal(frames({ recall: 0, precision: 1, dropMode: 'burst' }, 200, 13)
    .out.filter(Boolean).length, 0);
});

test('Fehlmessungsrate ≈ 1 − precision, Fehlmessungen tragen eine Kovarianz', () => {
  const { out, stats } = frames({ recall: 1, precision: 0.9, kLat: 0.1, kDepth: 0.15 },
                                50000, 14);
  const ms = out.filter(Boolean);
  const bad = ms.filter(m => m.kind === 'false');
  assert.ok(Math.abs(bad.length / ms.length - 0.1) < 0.02,
    `Fehlmessungsrate ${bad.length / ms.length}`);
  assert.ok(Math.abs(stats.falseRate - 0.1) < 0.02);
  for (const m of bad.slice(0, 50)) {
    assert.ok(m.cov[0][0] > 0 && m.cov[1][1] > 0 && m.cov[2][2] > 0);
    assert.ok(Number.isFinite(m.x + m.y + m.z));
    assert.ok(m.d >= 0.4 && m.d <= 12.5, `Fehlmessung im Distanzbereich (${m.d})`);
  }
  assert.ok(bad.some(m => Math.hypot(m.x - 5, m.y) > 1),
    'Fehlmessungen liegen woanders als der Ball');
});

/* ---------------- Erfassungslatenz und Takt ---------------- */

test('tAcq: keine Messung vor tRebound + tAcq, erste unmittelbar danach', () => {
  const cam = S.createCamera({ recall: 1, precision: 1, kLat: 0, kDepth: 0, tAcq: 0.3, hz: 15 });
  cam.reset({ t0: 0, tRebound: 1.0 });
  const rand = rng(5), ball = at(5, 0, 0), SUB = 1 / 480;
  let first = null, count = 0;
  for (let i = 1; i <= 960; i++) {
    const m = cam.sample({ t: i * SUB, ball, robot: ROBOT, rand });
    if (m) { count++; if (first === null) first = m.t; }
  }
  assert.ok(first !== null, 'nach der Latenz muss gemessen werden');
  assert.ok(first >= 1.3, `erste Messung bei ${first} ≥ 1,3 s`);
  assert.ok(first < 1.3 + 1 / 15, 'und spätestens einen Frame später');
  assert.ok(Math.abs(count - 0.7 * 15) <= 1, `${count} Frames in den restlichen 0,7 s`);
  assert.ok(cam.stats().preAcq > 0, 'Frames vor der Latenz werden gezählt');
});

test('Takt: Anzahl Frames über 2 s ≈ 2 · hz', () => {
  for (const hz of [5, 15, 30]) {
    const cam = S.createCamera({ recall: 1, precision: 1, kLat: 0, kDepth: 0, tAcq: 0, hz });
    cam.reset(null);
    const rand = rng(6), ball = at(5, 0, 0), SUB = 1 / 480;
    let n = 0;
    for (let i = 1; i <= 960; i++) if (cam.sample({ t: i * SUB, ball, robot: ROBOT, rand })) n++;
    assert.ok(Math.abs(n - 2 * hz) <= 1, `hz = ${hz}: ${n} Frames`);
  }
});

/* ---------------- Determinismus ---------------- */

test('gleicher Seed ⇒ identische Ausgabe', () => {
  const run = seed => {
    const cam = S.createCamera({ recall: 0.8, precision: 0.9, dropMode: 'burst', tAcq: 0.1, hz: 20 });
    cam.reset({ t0: 0, tRebound: 0.2 });
    const rand = rng(seed), out = [];
    for (let i = 1; i <= 480; i++) {
      const m = cam.sample({ t: i / 480, ball: at(4, 5, 8), robot: ROBOT, rand });
      if (m) out.push(m);
    }
    return out;
  };
  const a = run(99), b = run(99), c = run(100);
  assert.ok(a.length > 5, 'genug Messungen für den Vergleich');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

/* ---------------- Betriebsprofil ---------------- */

test('stats() aggregiert über reset() hinweg und zählt konsistent', () => {
  const cam = S.createCamera({ recall: 0.8, precision: 0.9, tAcq: 0, hz: 15 });
  const rand = rng(7), ball = at(5, 0, 0);
  for (let w = 0; w < 3; w++) {
    cam.reset(null);
    for (let i = 0; i < 100; i++) cam.sample({ t: i / 15, ball, robot: ROBOT, rand });
  }
  const s = cam.stats();
  assert.equal(s.framesDue, 300);
  assert.equal(s.inFov + s.outOfFov + s.preAcq, s.framesDue);
  assert.equal(s.inFov, s.dropped + s.emitted);
  assert.equal(s.seen.d.n, s.inFov);
  assert.ok(Math.abs(s.seen.d.mean - 5) < 1e-9);
  cam.resetStats();
  assert.equal(cam.stats().framesDue, 0);
});

/* ---------------- Integration in den Sweep-Harness ---------------- */

test('Sweep-Harness: Kamera-Modus läuft und liegt unter der iso-Referenz', () => {
  const wp = SW.WP.holo;
  const iso = SW.runCase({ ...wp }, 60, 3);
  const cam = SW.runCase({ ...wp, ...SW.CAM_BASE }, 60, 3, { profile: true });
  assert.ok(iso.rate > 0.8, `iso-Referenz ${iso.rate}`);
  assert.ok(cam.rate >= 0 && cam.rate < iso.rate, `Kamera ${cam.rate} < iso ${iso.rate}`);
  assert.ok(cam.stats.framesDue > 0 && cam.stats.emitted > 0);
  assert.ok(cam.stats.visibility > 0 && cam.stats.visibility <= 1);
});

test('Sweep-Harness: iso-Modus ist von den Kamera-Parametern unabhängig', () => {
  const a = SW.catchRate({}, 40, 8);
  const b = SW.catchRate({ recall: 0.3, precision: 0.5, tilt: 40, hfov: 5 }, 40, 8);
  assert.equal(a, b, 'Kamera-Parameter dürfen den iso-Pfad nicht beeinflussen');
});
