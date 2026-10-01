/* =====================================================================
 *  Tests: Experiment-Modi des Sweep-Harness (basis/mount/curves/loo/…)
 * =====================================================================
 *  node --test test/        (Node ≥ 18)
 *  Doku: .okf/simulation/basketball-sweep.md,
 *        .okf/simulation/detector-kpi-catch-rate.md,
 *        .okf/simulation/path-to-80-percent.md
 *
 *  Smoke-Tests: die Experiment-Funktionen laufen deterministisch durch,
 *  liefern die erwartete Zahl Läufe und die in den Findings zitierten Zahlen
 *  bleiben stabil. Bewusst mit KLEINEM n (Laufzeit) — geprüft werden
 *  Struktur und Determinismus, nicht die Studienzahlen; die Ankerwerte der
 *  Findings laufen einzeln mit n = 1000–2000.
 * ===================================================================== */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const SW = require('../tools/sweep-basket.js');

const CAM = { sensor: 'camera', hz: 15 };
const REC = { fit: 'weighted', gate: 'maha', outlier: 'drop', gateK: 10, minSamples: 0 };
const REF = { fit: 'plain', gate: 'rms', outlier: 'reset', gateK: 5, minSamples: 0 };
const MOUNT_W = { tilt: 60, pan: 'fixed', hfov: 68, vfov: 53 };
const rate = (p, n, seed) => SW.runCase(p, n, seed == null ? 12345 : seed).rate;

/* ---------------------------------------------------------------------
 *  Registrierung der Modi
 * ------------------------------------------------------------------ */

test('EXPERIMENTS listet genau die dispatchbaren Modi', () => {
  assert.deepEqual(SW.EXPERIMENTS,
    ['basis', 'mount', 'curves', 'loo', 'estimators', 'profile', 'design']);
});

test('MOUNT/PERFECT/BEST/ZDEF sind exportiert und konsistent', () => {
  // Perfekter Detektor: keine Aussetzer, keine Fehlmessungen, kein Rauschen,
  // keine Latenz — was dann fehlt, fehlt der Halterung.
  assert.equal(SW.PERFECT.recall, 1);
  assert.equal(SW.PERFECT.precision, 1);
  assert.equal(SW.PERFECT.tAcq, 0);
  assert.ok(SW.PERFECT.kLat <= 0.001 && SW.PERFECT.kDepth <= 0.001);
  assert.equal(SW.MOUNT.tilt.length * SW.MOUNT.pan.length * SW.MOUNT.fov.length, 30);
  // BEST und ZDEF spannen dieselben KPIs auf (sonst ist leave-one-out schief)
  assert.deepEqual(Object.keys(SW.BEST), Object.keys(SW.ZDEF));
  for (const k of Object.keys(SW.BEST)) assert.notEqual(SW.BEST[k], SW.ZDEF[k]);
});

/* ---------------------------------------------------------------------
 *  Dispatch: Zahl der Läufe je Modus
 * ------------------------------------------------------------------ */

test('runExperiment mount: 1 omni + 30 Gitterzellen je Arbeitspunkt', () => {
  const out = SW.runExperiment('mount', { ...REC }, 3, 12345, ['holo']);
  assert.equal(out.results.length, 31);
  assert.equal(out.exp, 'mount');
  // Jede Zelle trägt ihre Parameter und eine auswertbare Quote.
  for (const r of out.results) {
    assert.equal(r.params.sensor, 'camera');
    assert.equal(r.params.recall, 1);
    assert.ok(r.rate >= 0 && r.rate <= 1);
  }
  const omni = out.results[0].params;
  assert.equal(omni.hfov, 179);
});

test('runExperiment loo: Z-Basis + Bestwert + je ein zurückgesetzter KPI', () => {
  const out = SW.runExperiment('loo', { ...REC }, 3, 12345, ['ack']);
  assert.equal(out.results.length, 2 + Object.keys(SW.BEST).length);
  assert.equal(out.results[0].params.recall, SW.ZDEF.recall);
  assert.equal(out.results[1].params.recall, SW.BEST.recall);
  // Lauf i+2 unterscheidet sich vom Bestwert-Lauf in genau einem KPI.
  Object.keys(SW.BEST).forEach((k, i) => {
    const p = out.results[i + 2].params;
    assert.equal(p[k], SW.ZDEF[k]);
    for (const o of Object.keys(SW.BEST)) if (o !== k) assert.equal(p[o], SW.BEST[o]);
  });
});

test('runExperiment curves: Basis + jede Stufe jedes KPI', () => {
  const total = Object.values(SW.CURVES).reduce((s, v) => s + v.length, 0);
  const out = SW.runExperiment('curves', { ...REC }, 3, 12345, ['holo']);
  assert.equal(out.results.length, 1 + total);
});

test('runExperiment profile: tilt-Override ⇒ genau ein profilierter Lauf', () => {
  const one = SW.runExperiment('profile', { ...REC, tilt: 60 }, 5, 12345, ['holo']);
  assert.equal(one.results.length, 1);
  assert.equal(one.results[0].params.tilt, 60);
  // Ohne Override die Neigungsreihe 0/15/30.
  const many = SW.runExperiment('profile', { ...REC }, 3, 12345, ['holo']);
  assert.deepEqual(many.results.map(r => r.params.tilt), [0, 15, 30]);
});

test('runExperiment profile: stats bilanzieren die fälligen Frames', () => {
  const out = SW.runExperiment('profile', { ...REC, tilt: 60 }, 20, 12345, ['ack']);
  const s = out.results[0].stats;
  assert.ok(s.framesDue > 0);
  assert.equal(s.framesDue, s.preAcq + s.outOfFov + s.inFov);
  assert.equal(s.inFov, s.dropped + s.emitted);
  assert.ok(s.falseMeas <= s.emitted);
  // Beobachteter Recall trifft den eingestellten (0,80) grob.
  assert.ok(Math.abs(s.recallObs - 0.80) < 0.10);
});

/* ---------------------------------------------------------------------
 *  Determinismus und iso-Unabhängigkeit
 * ------------------------------------------------------------------ */

test('Experimente sind bei gleichem Seed bit-identisch reproduzierbar', () => {
  const a = SW.runExperiment('loo', { ...REC }, 5, 4242, ['holo']);
  const b = SW.runExperiment('loo', { ...REC }, 5, 4242, ['holo']);
  assert.deepEqual(a.results.map(r => r.caught), b.results.map(r => r.caught));
});

test('Die neuen Modi lassen den iso-Pfad unberührt', () => {
  // Kamera-/Halterungsparameter dürfen im iso-Modus keine Wirkung haben.
  // `hz` ist die Ausnahme: es ist im iso-Modus die Sensorrate.
  const base = { aMax: 30, vMax: 10, cRad: 0.5, sensor: 'iso' };
  const plain = rate({ ...base }, 200);
  assert.equal(rate({ ...base, ...SW.PERFECT, ...MOUNT_W }, 200), plain);
  const { hz, ...bestNoHz } = SW.BEST;
  assert.equal(rate({ ...base, ...bestNoHz }, 200), plain);
  assert.equal(rate({ ...base, ...SW.ZDEF, hz: SW.DEFAULTS.hz }, 200), plain);
  // Pixel-Strafe und Startausrichtung sind im iso-Modus mit holonomem
  // Antrieb wirkungslos (kein Sichtfeld, kein Heading im Regler).
  assert.equal(rate({ ...base, pxModel: 'on', inW: 640, hfov: 120 }, 200), plain);
  assert.equal(rate({ ...base, startTh: 90 }, 200), plain);
});

/* ---------------------------------------------------------------------
 *  Startpose des Autos (startDx / startDy / startTh)
 * ------------------------------------------------------------------ */

test('Startpose: Defaults reproduzieren die heutige Position unter dem Korb', () => {
  assert.equal(SW.DEFAULTS.startDx, 0);
  assert.equal(SW.DEFAULTS.startDy, 0);
  assert.equal(SW.DEFAULTS.startTh, 180);          // th = π wie bisher
  const base = { ...SW.WP.holo, ...CAM, ...REC };
  assert.equal(rate({ ...base, startDx: 0, startDy: 0, startTh: 180 }, 300),
               rate(base, 300));
});

test('Startpose: Versatz wirkt und wird aufs Feld geklemmt', () => {
  const base = { ...SW.WP.ack, ...CAM, ...REC, ...MOUNT_W };
  assert.notEqual(rate({ ...base, startDx: 3 }, 300), rate(base, 300));
  assert.notEqual(rate({ ...base, startDy: 3 }, 300), rate(base, 300));
  // +x zeigt Richtung Grundlinie: startDx zählt Richtung Feldmitte, der
  // Start wird bei x = −fx + 0,5 bzw. y = ±(fy − 0,5) geklemmt.
  const maxDx = SW.SCENE.hoop.x + SW.SCENE.fx - 0.5;
  assert.equal(rate({ ...base, startDx: 100 }, 200),
               rate({ ...base, startDx: maxDx }, 200));
  assert.equal(rate({ ...base, startDy: 100 }, 200),
               rate({ ...base, startDy: SW.SCENE.fy - 0.5 }, 200));
});

test('Startpose: die Ausrichtung bindet nur bei Ackermann bzw. mit Sichtfeld', () => {
  // holonom + iso: kein Sichtfeld, kein Heading im Regler ⇒ keine Wirkung.
  const iso = { ...SW.WP.holo, sensor: 'iso' };
  assert.equal(rate({ ...iso, startTh: 0 }, 200), rate({ ...iso, startTh: 180 }, 200));
  // Ackermann: das Heading steckt im Fahrradmodell ⇒ Wirkung. (0° und 180°
  // sind gleichwertig — das Fahrradmodell fährt auch rückwärts.)
  const ack = { ...SW.WP.ack, sensor: 'iso' };
  assert.equal(rate({ ...ack, startTh: 0 }, 300), rate({ ...ack, startTh: 180 }, 300));
  assert.notEqual(rate({ ...ack, startTh: 90 }, 300), rate({ ...ack, startTh: 180 }, 300));
});

/* ---------------------------------------------------------------------
 *  Pixel-Strafe für weites Sichtfeld (pxModel)
 * ------------------------------------------------------------------ */

test('Pixel-Strafe: f, px(d) und die Recall-Rampe folgen der Spezifikation', () => {
  const p = h => ({ ...SW.DEFAULTS, sensor: 'camera', pxModel: 'on', hfov: h, inW: 1024 });
  assert.ok(Math.abs(SW.pxFactor(p(68)) - 1) < 1e-12);      // Bezug Hauptkamera
  assert.ok(Math.abs(SW.pxFactor(p(106)) - 1.9674) < 1e-3); // Ultraweit ≈ halbe Pixel
  assert.equal(SW.pxFactor({ ...p(106), pxModel: 'off' }), 1);
  // px(d) ∝ 1/d, und σ_lat/σ_d skalieren mit f
  assert.ok(Math.abs(SW.pxOfDist(p(68), 5) - 2 * SW.pxOfDist(p(68), 10)) < 1e-9);
  const cp = SW.camParamsOf({ ...p(106), kLat: 0.1, kDepth: 0.15 });
  assert.ok(Math.abs(cp.kLat / 0.1 - SW.pxFactor(p(106))) < 1e-12);
  assert.ok(Math.abs(cp.kDepth / 0.15 - SW.pxFactor(p(106))) < 1e-12);
  // Rampe: 0 unter 8 px, 1 ab 16 px, linear dazwischen
  const dOf = (par, px) => SW.pxOfDist(par, 1) / px;         // px(d) = px(1)/d
  assert.equal(SW.pxRecallW(p(106), dOf(p(106), 4)), 0);
  assert.equal(SW.pxRecallW(p(106), dOf(p(106), 8)), 0);
  assert.equal(SW.pxRecallW(p(106), dOf(p(106), 16)), 1);
  assert.equal(SW.pxRecallW(p(106), dOf(p(106), 32)), 1);
  assert.ok(Math.abs(SW.pxRecallW(p(106), dOf(p(106), 12)) - 0.5) < 1e-9);
});

test('Pixel-Strafe: neutral für die Hauptkamera @1024, teuer für Ultraweit', () => {
  const base = { ...SW.WP.holo, ...CAM, ...REC, ...SW.ZDEF, tilt: 60, camH: 0.25 };
  // 68° @1024: der Ball bleibt bis 11,4 m über 16 px ⇒ im Arbeitsfenster
  // (≤ 6 m) ist die Strafe exakt wirkungslos, auch im RNG-Strom.
  assert.equal(rate({ ...base, hfov: 68, vfov: 53, pxModel: 'on' }, 500),
               rate({ ...base, hfov: 68, vfov: 53, pxModel: 'off' }, 500));
  // Ultraweit: σ ×1,97 und Recall-Verlust ab 5,8 m ⇒ die Quote muss fallen.
  const uwOff = rate({ ...base, hfov: 106, vfov: 81, tilt: 45, pxModel: 'off' }, 500);
  const uwOn = rate({ ...base, hfov: 106, vfov: 81, tilt: 45, pxModel: 'on' }, 500);
  assert.ok(uwOn < uwOff, `Pixel-Strafe muss kosten (${uwOn} < ${uwOff})`);
  // Kleinere Eingabe ⇒ kleinerer Ball ⇒ nie besser.
  assert.ok(rate({ ...base, hfov: 68, vfov: 53, pxModel: 'on', inW: 640 }, 500)
            <= rate({ ...base, hfov: 68, vfov: 53, pxModel: 'on', inW: 1024 }, 500));
});

/* ---------------------------------------------------------------------
 *  Experiment 'design'
 * ------------------------------------------------------------------ */

test('STAGES sind aufsteigend verschachtelt und enden bei BEST', () => {
  assert.deepEqual(Object.keys(SW.STAGES), ['ZDEF', 'ZZ1', 'ZZ2', 'ZZ3', 'ZZ4', 'BEST']);
  assert.deepEqual(SW.STAGES.ZDEF, SW.ZDEF);
  assert.deepEqual(SW.STAGES.BEST, SW.BEST);
  // Jede Stufe verschärft mindestens eine KPI und verschlechtert keine.
  const better = { recall: 1, precision: 1, kDepth: -1, kLat: -1, tAcq: -1, hz: 1 };
  const names = Object.keys(SW.STAGES);
  for (let i = 1; i < names.length; i++) {
    const a = SW.STAGES[names[i - 1]], b = SW.STAGES[names[i]];
    let sharper = 0;
    for (const k of Object.keys(SW.ZDEF)) {
      const d = (b[k] - a[k]) * Math.sign(better[k]);
      assert.ok(d >= 0, `${names[i]}.${k} darf sich nicht verschlechtern`);
      if (d > 0) sharper++;
    }
    assert.ok(sharper > 0, `${names[i]} muss mindestens eine KPI verschärfen`);
  }
});

test('runDesign liefert die Stufen A–D, Auswahl und kompakte Zeilen', () => {
  const d = SW.runDesign({}, 10, 12345, 'holo');
  const stages = new Set(d.rows.map(r => r.s));
  for (const s of ['A', 'B', 'C', 'D']) assert.ok(stages.has(s), `Stufe ${s} fehlt`);
  // Stufe A: das volle Startgitter, perfekter Detektor ohne Sichtfeldgrenze.
  const A = d.rows.filter(r => r.s === 'A');
  assert.equal(A.length,
    SW.DESIGN.startDx.length * SW.DESIGN.startDy.length * SW.DESIGN.startTh.length);
  assert.ok(A.every(r => r.hf === SW.OMNI.hfov && r.det === 'perfect'));
  // Stufe B: 3–4 Startposen × Ausrichtungen × Halterungsgitter.
  const mount = SW.DESIGN.fov.length * SW.DESIGN.tilt.length *
                SW.DESIGN.camH.length * SW.DESIGN.pan.length;
  assert.equal(d.rows.filter(r => r.s === 'B').length,
               d.topPos.length * SW.DESIGN.startTh.length * mount);
  // Stufe C: jede gewählte Konfiguration × jede Detektor-Stufe × mit/ohne Strafe.
  const C = d.rows.filter(r => r.s === 'C');
  assert.equal(C.length, d.cfgs.length * Object.keys(SW.STAGES).length * 2);
  assert.equal(C.filter(r => r.px === 1).length, C.length / 2);
  // Zeilen sind kompakt und vollständig.
  for (const r of d.rows) {
    assert.ok(r.r >= 0 && r.r <= 1 && r.n > 0);
    assert.ok(Object.keys(r).length <= 18, 'Zeilen sollen klein bleiben');
  }
  assert.equal(d.target, SW.TARGET);
  assert.deepEqual(d.rows.filter(r => r.s === 'D').map(r => r.seed).slice(0, 3),
                   SW.DESIGN.seeds);
});

test('Anker: Empfehlung holo erreicht 80 % ab ZZ3, mit Toleranz ab ZZ4', () => {
  // .okf/simulation/path-to-80-percent.md — Empfehlung: Hauptkamera 68°×53°,
  // 75° Neigung, Kamera 0,5 m, Start 0,5 m vor dem Korb, Ausrichtung 180°.
  const rec = { ...SW.WP.holo, ...CAM, ...SW.REC_EST, hfov: 68, vfov: 53,
                tilt: 75, camH: 0.5, startDx: 0.5, startDy: 0, startTh: 180 };
  const at = (st, px) => rate({ ...rec, ...SW.STAGES[st], pxModel: px || 'on' }, 2000);
  assert.equal(at('ZZ2'), 0.7595);        // reicht nicht
  assert.equal(at('ZZ3'), 0.829);        // minimale Stufe für 80 %
  assert.equal(at('ZZ4'), 0.912);        // Arbeitspunkt mit Reserve
  assert.ok(at('ZZ2') < 0.80 && at('ZZ3') >= 0.80);
  // Die Hauptkamera zahlt bei 1024 px Eingabe keine Pixel-Strafe …
  assert.equal(at('ZZ4', 'off'), at('ZZ4'));
  // … das Ultraweit-Objektiv an derselben Pose sehr wohl (≈ 11 Punkte).
  const uw = px => rate({ ...rec, ...SW.STAGES.ZZ4, hfov: 106, vfov: 81,
                          pxModel: px }, 2000);
  assert.equal(uw('off'), 0.806);
  assert.equal(uw('on'), 0.697);
  // Nur ZZ4 hält das Ziel über ±10° Neigung; ZZ3 nicht.
  for (const t of [65, 85]) {
    assert.ok(rate({ ...rec, ...SW.STAGES.ZZ4, tilt: t, pxModel: 'on' }, 1000) >= 0.80);
    assert.ok(rate({ ...rec, ...SW.STAGES.ZZ3, tilt: t, pxModel: 'on' }, 1000) < 0.80);
  }
});

test('Anker: ack — Startpose hebt nur die Decke, nicht die erreichbare Quote', () => {
  // Kinematische Decke der besten Startpose gegen die heutige (perfekter
  // Detektor, Sichtfeld wie in Stufe A: 179°×179°, Neigung 0°) …
  const perfect = { ...SW.WP.ack, ...CAM, ...SW.PERFECT, ...SW.REC_EST, ...SW.OMNI };
  assert.equal(rate({ ...perfect, startDx: 4, startDy: -1, startTh: 90 }, 2000), 0.832);
  assert.equal(rate({ ...perfect, startDx: 0, startDy: 0, startTh: 180 }, 2000), 0.684);
  // … aber mit der geplanten Endstufe ZZ4 ist die Vorwärtspose schlechter
  // als die heutige, und beide bleiben deutlich unter 80 %.
  const zz4 = { ...SW.WP.ack, ...CAM, ...SW.REC_EST, ...SW.STAGES.ZZ4, pxModel: 'on' };
  const heute = rate({ ...zz4, tilt: 60, camH: 0.25 }, 1000);
  const vorn = rate({ ...zz4, hfov: 106, vfov: 81, tilt: 75, pan: 'track',
                      startDx: 4, startDy: -1, startTh: 90 }, 1000);
  assert.equal(heute, 0.630);
  assert.equal(vorn, 0.574);
  assert.ok(heute < 0.80 && vorn < heute);
  // Kleinstes Antriebs-Inkrement, das 80 % mit ZZ4 öffnet: cRad 1,0 → 2,0 m.
  assert.ok(rate({ ...zz4, hfov: 106, vfov: 81, tilt: 75, pan: 'track',
    startDx: 4, startDy: -1, startTh: 90, cRad: 2.0 }, 1000) >= 0.80);
  assert.ok(rate({ ...zz4, hfov: 106, vfov: 81, tilt: 75, pan: 'track',
    startDx: 4, startDy: -1, startTh: 90, aMax: 30 }, 1000) < 0.80);
});

test('runExperiment design: dispatcht je Arbeitspunkt und ist reproduzierbar', () => {
  const a = SW.runExperiment('design', {}, 10, 12345, ['ack']);
  const b = SW.runExperiment('design', {}, 10, 12345, ['ack']);
  assert.equal(a.exp, 'design');
  assert.equal(a.design.length, 1);
  assert.equal(a.design[0].wp, 'ack');
  assert.ok(a.results.length > 100);
  assert.deepEqual(a.results.map(r => r.r), b.results.map(r => r.r));
});

/* ---------------------------------------------------------------------
 *  Ankerwerte des Findings (n = 1000, Seed 12345)
 * ------------------------------------------------------------------ */

test('Anker: Z-konforme Basis an der Z-Halterung (Gate 85 % verfehlt)', () => {
  const holoRef = rate({ ...SW.WP.holo, ...CAM, ...REF }, 1000);
  const holoRec = rate({ ...SW.WP.holo, ...CAM, ...REC }, 1000);
  assert.equal(holoRef, 0.140);
  assert.equal(holoRec, 0.199);
  assert.ok(holoRec < 0.85, 'Gate aus Abschnitt 4a ist deutlich verfehlt');
});

test('Anker: geometrische Decke — Z-Halterung bindet vor jedem KPI', () => {
  const perfect = { ...SW.WP.holo, ...CAM, ...SW.PERFECT, ...REC };
  const zMount = rate({ ...perfect, tilt: 0, pan: 'fixed', hfov: 68, vfov: 53 }, 1000);
  const wMount = rate({ ...perfect, ...MOUNT_W }, 1000);
  const omni = rate({ ...perfect, hfov: 179, vfov: 179, tilt: 0, pan: 'fixed' }, 1000);
  assert.equal(zMount, 0.514);      // perfekter Detektor, Z-Halterung
  assert.equal(wMount, 0.986);      // dieselbe Kamera, 60° geneigt
  assert.equal(omni, 0.998);        // ohne Sichtfeldgrenze
  assert.ok(zMount < 0.85 && wMount >= 0.85);
});

test('Anker: am Halterungs-Arbeitspunkt bindet die Erfassungslatenz Z6', () => {
  const b = { ...SW.WP.holo, ...CAM, ...MOUNT_W, ...REC };
  assert.equal(rate(b, 1000), 0.396);                   // tAcq 0,3 s (Z6 heute)
  assert.equal(rate({ ...b, tAcq: 0.15 }, 1000), 0.617); // halbierte Latenz
  assert.equal(rate({ ...b, tAcq: 0.75 }, 1000), 0.011); // Klippe
});
