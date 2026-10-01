/* =====================================================================
 *  sweep-basket — Headless-Monte-Carlo über das Basketball-Szenario
 * =====================================================================
 *  Repliziert die Sim-Wahrheit aus src/sim.js (Szenario 'basket') ohne
 *  DOM und misst die Fangquote pro Parameterkonfiguration. Muss bei
 *  Änderungen an sim.js (Szenario-Physik, Gate-Konstanten) nachgezogen
 *  werden — Konstanten und Ablauf sind 1:1 übernommen.
 *  Doku: .okf/simulation/basketball-parameter-ranges.md,
 *        .okf/simulation/basketball-sweep.md, sensor-model.md
 *
 *  Zwei Sensormodelle (Parameter `sensor`):
 *    'iso'    (Default) isotropes Rauschen N(0, noise²·I₃), feste Rate,
 *             allwissend — die bisherige Referenz.
 *    'camera' Kamera-Sensormodell aus src/sensor.js (Sichtfeld, Aussetzer,
 *             Fehlmessungen, anisotropes Rauschen, Erfassungslatenz).
 *
 *  Aufruf:  node tools/sweep-basket.js                 # Standard-OAT-Sweep
 *           node tools/sweep-basket.js --json          # Roh-Ergebnisse als JSON
 *           node tools/sweep-basket.js --sensor camera --n 1000 --seed 1
 *           node tools/sweep-basket.js --set recall=0.6 --set tilt=20
 *           node tools/sweep-basket.js --set gate=maha --set outlier=drop
 *           node tools/sweep-basket.js --set fit=weighted --set wCap=0.15
 *           node tools/sweep-basket.js --exp basis --n 1000 --json
 *           node tools/sweep-basket.js --exp mount --n 1000 --json
 *           node tools/sweep-basket.js --exp curves --n 200 --wp ack --json
 *           node tools/sweep-basket.js --exp loo --n 1000 --json
 *           node tools/sweep-basket.js --exp estimators --n 200 --json
 *           node tools/sweep-basket.js --exp profile --n 500 --json
 *           node tools/sweep-basket.js --exp design --n 1000 --wp ack --json
 * ===================================================================== */
'use strict';
const E = require('../src/engine.js');
const S = require('../src/sensor.js');

const G = 9.81, SUB = 1 / 480;
const SCENE = { fx: 14, fy: 7.5, hoop: { x: 14 - 1.575, y: 0, z: 3.05, r: 0.225 } };
/* actNoise: σ der AUTO-Positionsschätzung (externe Ortung, z. B. ArUco) —
 * 0 = Pose perfekt bekannt. Modelliert als Versatz von Planung UND Regelziel.
 * gateK/gateHits/minSamples: Residuen-Gate und Mindestzahl Messungen vor der
 * ersten Planung (Defaults = bisherige Konstanten GATE_K/GATE_HITS).
 * gate:    'rms'  Schwelle gateK·√(spur(cov)/3)+0,03 auf der euklidischen
 *                 Distanz (bisheriges Verhalten),
 *          'maha' Schwelle gateK direkt auf der Mahalanobis-Distanz
 *                 (gateK = 5 ⇒ 5σ in jeder Richtung, s. E.residualMaha).
 * outlier: 'reset' nach gateHits Ausreißern in Folge Puffer-Reset auf genau
 *                  diese Ausreißer (bisheriges Verhalten),
 *          'drop'  einzelne Ausreißer werden NICHT in den Puffer aufgenommen;
 *                  erst gateHits in Folge gelten als Modellbruch ⇒ Reset mit
 *                  den gesammelten Ausreißern als neuem Start.
 * wCap:    σ-Boden [m] für den gewichteten Fit (0 = aus). cov' = cov + wCap²·I₃
 *          begrenzt das Gewichtsverhältnis je Messung auf ≈ λmax/wCap² und
 *          dämpft damit die Verstärkung von Modellfehlern in die Tiefe.
 *          Wirkt NUR auf den Fit, nicht auf das Gate.
 * Kamera-Parameter (nur bei sensor:'camera') siehe src/sensor.js.
 * startDx/startDy/startTh: Startpose des AUTOS relativ zur bisherigen
 *          Position unter dem Korb. `startDx` zählt POSITIV RICHTUNG
 *          FELDMITTE (Welt-x nimmt ab, der Korb steht bei x = 12,425 m),
 *          `startDy` positiv in Welt-y (quer), beide in Metern und wie
 *          bisher aufs Feld geklemmt. `startTh` ist die Startausrichtung in
 *          GRAD im Weltsystem (0 = +x = Richtung Grundlinie hinter dem Korb,
 *          180 = Richtung Feldmitte = bisheriges Verhalten).
 * pxModel/inW: Pixel-Strafe für weites Sichtfeld, s. pxFactor() unten.
 *          'off' (Default) = bisheriges Verhalten. */
const DEFAULTS = {
  aMax: 14, vMax: 7, cRad: 0.35, hgt: 0.5, hz: 20, noise: 0.05, rest: 0.75,
  drive: 'holo', actNoise: 0,
  sensor: 'iso', fit: 'plain', gateK: 5, gateHits: 2, minSamples: 0,
  gate: 'rms', outlier: 'reset', wCap: 0,
  camH: 0.25, tilt: 0, hfov: 68, vfov: 53, pan: 'fixed',
  kLat: 0.10, kDepth: 0.15, recall: 0.80, dropMode: 'iid', burstLen: 3,
  precision: 0.95, maxRange: 12, tAcq: 0.3,
  startDx: 0, startDy: 0, startTh: 180, pxModel: 'off', inW: 1024
};
const ACK = { L: 0.25, steerMax: 0.56, steerRate: 8 };   // wie src/sim.js
const D2R = Math.PI / 180;

/* Deterministischer RNG (mulberry32) für reproduzierbare Sweeps */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ---------- Residuen-Gate als eigenständige Politik ----------
 * Zustandsbehaftet je Wurf (zählt Ausreißer in Folge und sammelt sie bei
 * outlier:'drop'). `feed(est, samples, meas)` entscheidet über eine neue
 * Messung und liefert:
 *   { action: 'accept' }                Messung an den Puffer anhängen
 *   { action: 'drop' }                  Messung verwerfen (nur outlier:'drop')
 *   { action: 'reset', samples: [...] } Puffer durch diese Liste ersetzen,
 *                                       danach die Messung anhängen
 * Mit gate:'rms' und outlier:'reset' ist das exakt die bisherige Logik.
 * Exportiert, damit die Node-Tests die Politik ohne Simulation prüfen können. */
function createGate(params) {
  const sigmaEff = Math.max(params.noise, 0.02);
  const maha = params.gate === 'maha';
  const drop = params.outlier === 'drop';
  const hits = params.gateHits;
  let residHits = 0, pending = [];
  /* σ für die Gate-Schwelle: iso = max(noise, 0.02); Kamera = 1D-RMS aus der
   * Messkovarianz √(spur/3) (wächst mit der Distanz), untere Schranke 0.02. */
  const sigmaOf = m => m.cov
    ? Math.max(0.02, Math.sqrt((m.cov[0][0] + m.cov[1][1] + m.cov[2][2]) / 3))
    : sigmaEff;
  const over = (est, m) => maha
    ? E.residualMaha(est, G, m, sigmaEff) > params.gateK
    : E.residual(est, G, m) > params.gateK * sigmaOf(m) + 0.03;
  return {
    sigmaOf,
    feed(est, samples, meas) {
      if (!(est && samples.length >= 3)) return { action: 'accept' };
      if (!over(est, meas)) { residHits = 0; pending = []; return { action: 'accept' }; }
      residHits++;
      if (residHits >= hits) {
        const buf = drop ? pending.slice(-(hits - 1))
                         : (hits > 1 ? samples.slice(-(hits - 1)) : []);
        residHits = 0; pending = [];
        return { action: 'reset', samples: buf };
      }
      if (drop) { pending.push(meas); return { action: 'drop' }; }
      return { action: 'accept' };
    }
  };
}

/* Kovarianz-Boden für den gewichteten Fit: cov' = cov + s²·I₃ (s = wCap).
 * Hebt den kleinsten Eigenwert an, ohne die Hauptachsen zu drehen ⇒ das
 * Gewichtsverhältnis je Messung bleibt endlich. Gibt bei s = 0 oder ohne
 * cov die Originalliste zurück (kein Kopieren, kein Drift). */
function floorCov(samples, s) {
  if (!(s > 0)) return samples;
  const q = s * s;
  return samples.map(m => m.cov ? Object.assign({}, m, {
    cov: [[m.cov[0][0] + q, m.cov[0][1], m.cov[0][2]],
          [m.cov[1][0], m.cov[1][1] + q, m.cov[1][2]],
          [m.cov[2][0], m.cov[2][1], m.cov[2][2] + q]]
  }) : m);
}

/* ---------- Pixel-Strafe für weites Sichtfeld (`pxModel: 'on'`) ----------
 * MODELLANNAHME, keine Messung. Sensor- und Eingabeauflösung sind für jedes
 * Objektiv gleich (ein Telefon, ein Bildstrom) — ein weiteres Sichtfeld
 * verteilt dieselben Pixel auf mehr Winkel. Bezug ist die Hauptkamera
 * (hfov 68°, Halbwinkel 34°):
 *
 *   f      = tan(hfov/2) / tan(34°)              Winkel je Pixel, relativ
 *   f_px   = (inW/2) / tan(hfov/2)               Brennweite in Pixeln
 *   px(d)  = f_px · 0,24 m / d                   Ball-Durchmesser in Pixeln
 *
 * Wirkung (nur im Kamera-Modus, nur bei pxModel 'on'):
 *   1. σ_lat  ×f  — der Zentrumsfehler ist ein PIXEL-Fehler; in Metern wird
 *                   er f-mal größer  ⇒  kLat · f.
 *   2. σ_d    ×f  — größenbasierte Tiefe: relativer Tiefenfehler = relativer
 *                   Durchmesser-Pixelfehler  ⇒  kDepth · f.
 *   3. recall_eff(d) = recall · clamp((px(d) − 8) / (16 − 8), 0, 1)
 *      Unter 8 px erkennt der Detektor nichts, ab 16 px voller Recall,
 *      linear dazwischen. Die Schwellen kommen aus dem Arbeitsfenster
 *      16–64 px des Profilings (.okf/app/detector-profiling.md: 8 px ⇒
 *      0–3 % Recall, 16 px ⇒ Beginn des Plateaus). Der lineare Übergang ist
 *      eine Glättung, keine gemessene Kurve.
 * Ergebnisse werden IMMER mit und ohne Strafe berichtet. */
const PX_REF = Math.tan(34 * D2R), PX_LO = 8, PX_HI = 16, BALL_D = 0.24;
const pxOn = p => p.pxModel === 'on' && p.sensor === 'camera';
const pxFactor = p => pxOn(p) ? Math.tan(p.hfov * D2R / 2) / PX_REF : 1;
const pxOfDist = (p, d) =>
  ((p.inW / 2) / Math.tan(p.hfov * D2R / 2)) * BALL_D / Math.max(d, 1e-6);
const pxRecallW = (p, d) => clamp((pxOfDist(p, d) - PX_LO) / (PX_HI - PX_LO), 0, 1);
/* Kamera-Parameter inkl. Pixel-Strafe auf σ_lat/σ_d (1. und 2. oben). */
function camParamsOf(p) {
  const f = pxFactor(p);
  return f === 1 ? p : { ...p, kLat: p.kLat * f, kDepth: p.kDepth * f };
}

/* Ein Wurf im Basketball-Szenario mit Detail-Ergebnis:
 * { caught, chance } — chance = Sim-Wahrheits-Position [x, y] der ERSTEN
 * Fangchance (erster absteigender H-Durchgang) oder null, falls der Ball
 * nie eine Chance bietet. Spiegelt sim.js.
 * `camIn` (optional): vorhandenes Kameraobjekt, dessen stats() über mehrere
 * Würfe aggregiert werden sollen (Experiment 'profile'). */
function simulateThrowInfo(params, rand, camIn) {
  const gauss = () => {
    const u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const hp = SCENE.hoop;
  const camMode = params.sensor === 'camera';
  const cam = camMode ? (camIn || S.createCamera(camParamsOf(params))) : null;
  const pxPenalty = pxOn(params);
  const weighted = params.fit === 'weighted';

  // newThrow (Zweig 'basket'), Aktuator startet unter dem Korb
  const dist = 4 + rand() * 4;
  const dir = Math.PI + (rand() * 2 - 1) * (Math.PI / 3);
  const sx = clamp(hp.x + Math.cos(dir) * dist, -SCENE.fx + 0.5, SCENE.fx - 0.5);
  const sy = clamp(hp.y + Math.sin(dir) * dist, -SCENE.fy + 0.5, SCENE.fy - 0.5);
  const ra = rand() * 2 * Math.PI;
  const tx = hp.x + Math.cos(ra) * hp.r, ty = hp.y + Math.sin(ra) * hp.r;
  const tof = 1.0 + rand() * 0.4;
  const ball = {
    p: [sx, sy, 2.0],
    v: [(tx - sx) / tof, (ty - sy) / tof, (hp.z - 2.0) / tof + 0.5 * G * tof]
  };
  /* Startpose des Autos: Default = unter dem Korb, feldeinwärts (th = π).
   * startDx zählt Richtung Feldmitte (Welt-x nimmt ab), startDy in Welt-y;
   * beides wie die Wurfposition aufs Feld geklemmt. */
  const act = {
    x: clamp(hp.x - params.startDx, -SCENE.fx + 0.5, SCENE.fx - 0.5),
    y: clamp(hp.y + params.startDy, -SCENE.fy + 0.5, SCENE.fy - 0.5),
    vx: 0, vy: 0, th: params.startTh * D2R, v: 0, delta: 0
  };
  const ack = params.drive === 'ack' ? { aMax: params.aMax, vMax: params.vMax, ...ACK } : null;
  let samples = [], est = null, impact = null, impactCmd = null;
  let simT = 0, sensorNext = 0, lastMeas = null;
  let hCrossed = false, rimmed = false, firstChance = null;
  const gate = createGate(params);
  // Erfassungslatenz zählt ab dem Rebound (Sim-Wahrheits-Event bei t = tof)
  if (cam) cam.reset({ t0: 0, tRebound: tof });

  /* Eine Messung in den Puffer: Residuen-Gate, Fit, Planung. */
  function integrate(meas) {
    const dec = gate.feed(est, samples, meas);
    if (dec.action === 'drop') return;            // Ausreißer, Puffer unberührt
    if (dec.action === 'reset') samples = dec.samples;
    samples.push(meas);
    lastMeas = meas;
    est = weighted ? E.estimateState(floorCov(samples, params.wCap), G, { weighted: true })
                   : E.estimateState(samples, G);
    // Auto-Pose nur verrauscht bekannt: Planung nutzt die Schätzung,
    // und das Regelziel verschiebt sich um den Posenfehler (das Fahrzeug
    // hält relativ zu seiner GESCHÄTZTEN Position auf den Zielpunkt zu).
    const pe = params.actNoise
      ? [gauss() * params.actNoise, gauss() * params.actNoise] : [0, 0];
    const actEst = Object.assign({}, act, { x: act.x + pe[0], y: act.y + pe[1] });
    impact = (est && samples.length >= params.minSamples) ? E.planCatch(est, actEst, simT,
      { g: G, rest: params.rest, hgt: params.hgt, vMax: params.vMax, aMax: params.aMax, field: [SCENE.fx, SCENE.fy],
        travelTime: ack ? (x, y) => E.ackTravelTime(actEst, x, y, ack) : null }) : null;
    impactCmd = impact ? Object.assign({}, impact, { x: impact.x - pe[0], y: impact.y - pe[1] }) : null;
  }

  /* Zielpunkt für pan:'track' — prädizierte Ballposition aus dem
   * Engine-Zustand, sonst die letzte Messung, sonst null (Kamera bleibt starr). */
  function aimPoint() {
    if (est) {
      const tau = simT - est.t0;
      return { x: est.p0[0] + est.v0[0] * tau,
               y: est.p0[1] + est.v0[1] * tau,
               z: est.p0[2] + est.v0[2] * tau - 0.5 * G * tau * tau };
    }
    return lastMeas ? { x: lastMeas.p[0], y: lastMeas.p[1], z: lastMeas.p[2] } : null;
  }

  while (simT < 30) {
    simT += SUB;

    if (!rimmed && simT >= tof) {
      rimmed = true;                             // Ringkontakt: zufälliger Rebound
      const s = params.rest * Math.hypot(ball.v[0], ball.v[1], ball.v[2]);
      const az = Math.atan2(-ball.p[1], -ball.p[0]) + (rand() * 2 - 1) * 1.2;
      const vz = s * (0.15 + 0.55 * rand());
      const vh = Math.sqrt(Math.max(0, s * s - vz * vz));
      ball.v = [Math.cos(az) * vh, Math.sin(az) * vh, vz];
    }
    ball.v[2] -= G * SUB;
    for (let k = 0; k < 3; k++) ball.p[k] += ball.v[k] * SUB;

    if (!hCrossed && ball.p[2] <= params.hgt && ball.v[2] < 0) {
      hCrossed = true;
      if (!firstChance) firstChance = [ball.p[0], ball.p[1]];
      if (Math.hypot(act.x - ball.p[0], act.y - ball.p[1]) <= params.cRad)
        return { caught: true, chance: firstChance };
    }
    if (ball.p[2] <= 0 && ball.v[2] < 0) {
      const vzPost = -params.rest * ball.v[2];
      const canClear = vzPost >= Math.sqrt(2 * G * Math.max(params.hgt, 0.05));
      if (canClear && E.inField(ball.p[0], ball.p[1], [SCENE.fx, SCENE.fy])) {
        ball.p[2] = 0; ball.v[2] = vzPost;
        hCrossed = false;
      } else return { caught: false, chance: firstChance };
    }

    if (cam) {
      // Kamera-Sensormodell: eigener Frame-Takt, Sichtfeld, Aussetzer.
      const meas = cam.sample({
        t: simT,
        ball: { x: ball.p[0], y: ball.p[1], z: ball.p[2],
                vx: ball.v[0], vy: ball.v[1], vz: ball.v[2] },
        robot: { x: act.x, y: act.y, th: act.th },
        aim: params.pan === 'track' ? aimPoint() : null,
        rand
      });
      /* Pixel-Strafe auf den Recall: zusätzlicher, unabhängiger Aussetzer mit
       * p = 1 − w(px(d)) ⇒ effektiver Recall = recall · w. Maßgeblich ist die
       * WAHRE Distanz Kamera→Ball (nicht die der Messung), weil der Detektor
       * am echten Ball scheitert; rand() wird nur gezogen, wenn 0 < w < 1. */
      let keep = true;
      if (meas && pxPenalty) {
        const w = pxRecallW(params, Math.hypot(
          ball.p[0] - act.x, ball.p[1] - act.y, ball.p[2] - params.camH));
        keep = w >= 1 ? true : (w > 0 && rand() < w);
      }
      if (meas && keep) integrate(meas);
    } else if (simT >= sensorNext) {
      sensorNext += 1 / params.hz;
      integrate({ t: simT, p: ball.p.map(c => c + gauss() * params.noise) });
    }

    if (ack) E.ackermannStep(act, impactCmd, ack, SUB);
    else E.actuatorStep(act, impactCmd, params.aMax, params.vMax, SUB);
    /* Kamera-Blickrichtung des holonomen Fahrzeugs: das Chassis dreht sich in
     * die Fahrtrichtung (Kamera starr nach vorn montiert); im Stand bleibt die
     * letzte Ausrichtung erhalten (Start: feldeinwärts, th = π). Bei 'ack'
     * liefert ackermannStep das echte Heading. */
    if (!ack) {
      const sp = Math.hypot(act.vx, act.vy);
      if (sp > 0.2) act.th = Math.atan2(act.vy, act.vx);
    }
  }
  return { caught: false, chance: firstChance };
}

const simulateThrow = (params, rand) => simulateThrowInfo(params, rand).caught;

function catchRate(overrides, n, seed) {
  const params = { ...DEFAULTS, ...overrides };
  const rand = rng(seed);
  let c = 0;
  for (let i = 0; i < n; i++) if (simulateThrow(params, rand)) c++;
  return c / n;
}

/* Detailergebnis eines Laufs: Fangquote + 95-%-Konfidenzintervall (Wald),
 * Anteil Würfe mit überhaupt einer Fangchance, optional Kamera-Betriebsprofil. */
function runCase(overrides, n, seed, opts) {
  const params = { ...DEFAULTS, ...overrides };
  const rand = rng(seed);
  const cam = (opts && opts.profile && params.sensor === 'camera')
    ? S.createCamera(camParamsOf(params)) : null;
  let caught = 0, chance = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateThrowInfo(params, rand, cam);
    if (r.caught) caught++;
    if (r.chance) chance++;
  }
  const rate = caught / n;
  const out = { caught, chance, rate, ci95: 1.96 * Math.sqrt(rate * (1 - rate) / n) };
  if (cam) out.stats = cam.stats();
  return out;
}

/* Fangzonen: Quote nur über Würfe, deren ERSTE Fangchance in der Zone liegt
 * (Bälle außerhalb ignoriert der Roboter). coverage = Zonen-Anteil aller Würfe. */
const ZONES = {
  all:   () => true,
  three: (x, y) => Math.hypot(x - SCENE.hoop.x, y - SCENE.hoop.y) <= 6.75, // FIBA-Dreierlinie (Bogenradius)
  half:  (x)    => x >= 0                                                  // Korb-Halbfeld
};

function catchRateZone(overrides, n, seed, zone) {
  const params = { ...DEFAULTS, ...overrides };
  const rand = rng(seed);
  const inZone = ZONES[zone] || ZONES.all;
  let inZ = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const r = simulateThrowInfo(params, rand);
    if (!r.chance || !inZone(r.chance[0], r.chance[1])) continue;
    inZ++;
    if (r.caught) c++;
  }
  return { rate: inZ ? c / inZ : 0, coverage: inZ / n };
}

/* ---------- Sweep-Definition ---------- */
const SWEEPS = {
  aMax:  [2, 4, 6, 8, 10, 14, 20, 30, 50],
  vMax:  [1.5, 2, 2.5, 3, 4, 5, 6, 7, 9, 12],
  cRad:  [0.15, 0.2, 0.25, 0.3, 0.35, 0.45, 0.6, 0.8, 1.0],
  hgt:   [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0, 1.5],
  hz:    [4, 6, 8, 10, 15, 20, 30, 60],
  noise: [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.3],
  rest:  [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.95]
};

/* ---------- Experimente (Abschnitt 4a des Detektor-Forschungsprogramms) ----------
 * Zwei Arbeitspunkte: optimistische Hardware (holo) und realistische (Ackermann). */
const WP = {
  holo: { aMax: 30, vMax: 10, cRad: 0.5, drive: 'holo' },
  ack:  { aMax: 12, vMax: 8,  cRad: 1.0, drive: 'ack' }
};
/* Kamera-Arbeitspunkt = Z-konforme Defaults aus src/sensor.js, hz = 15 (Z1). */
const CAM_BASE = { sensor: 'camera', hz: 15 };
const CURVES = {                      // Experiment 2: ein KPI nach dem anderen
  recall:    [0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  precision: [0.8, 0.9, 0.95, 0.98, 1.0],
  kDepth:    [0.02, 0.05, 0.1, 0.15, 0.2, 0.3],
  kLat:      [0.02, 0.05, 0.1, 0.2, 0.3],
  tAcq:      [0, 0.1, 0.2, 0.3, 0.5, 0.75, 1.0],
  hz:        [5, 10, 15, 20, 30],
  tilt:      [0, 10, 20, 30, 45, 60],
  pan:       ['fixed', 'track'],
  dropMode:  ['iid', 'burst']
};

/* Experiment 'mount' (Halterung / geometrische Decke): PERFEKTER Detektor —
 * alle KPIs außer der Geometrie abgeschaltet. Was dann noch fehlt, fehlt der
 * Halterung (Sichtfeld, Neigung, Schwenk), nicht dem Modell. `omni` ist die
 * Referenzzeile „Sichtfeld praktisch unbegrenzt“ = obere Schranke. */
const PERFECT = { recall: 1, precision: 1, kLat: 0.001, kDepth: 0.001, tAcq: 0 };
const MOUNT = {
  tilt: [0, 15, 30, 45, 60],
  pan:  ['fixed', 'track'],
  fov:  [{ hfov: 68, vfov: 53 },      // Hauptkamera 26 mm
         { hfov: 106, vfov: 81 },     // Ultraweitwinkel 13 mm (≈ 120° diagonal)
         { hfov: 120, vfov: 90 }],
  omni: { hfov: 179, vfov: 179, tilt: 0, pan: 'fixed' }
};

/* Experiment 'loo' (leave one out): alle KPIs auf Bestwert, einer auf
 * Z-Default ⇒ der Verlust je KPI, gemessen an der Decke statt am Boden.
 * Ergänzt die OAT-Kurven, die nur die Steigung AM Z-Punkt zeigen. */
const BEST = { recall: 1.0, precision: 1.0, kDepth: 0.02, kLat: 0.02, tAcq: 0, hz: 30 };
const ZDEF = { recall: 0.80, precision: 0.95, kDepth: 0.15, kLat: 0.10, tAcq: 0.3, hz: 15 };

/* Detektor-Stufen der Studie „Detektor-KPIs → Fangquote“ (Zwischenziele):
 * jede Stufe enthält alle vorherigen. ZE (Endziel) ist nicht enthalten —
 * BEST ist die obere Schranke. */
const STAGES = {
  ZDEF: { ...ZDEF },
  ZZ1:  { ...ZDEF, tAcq: 0.15 },
  ZZ2:  { ...ZDEF, tAcq: 0.15, precision: 0.98 },
  ZZ3:  { ...ZDEF, tAcq: 0.15, precision: 0.98, kDepth: 0.08 },
  ZZ4:  { ...ZDEF, tAcq: 0.15, precision: 0.98, kDepth: 0.08, recall: 0.90, hz: 20 },
  BEST: { ...BEST }
};
/* Empfohlener Schätzer aus dem Gitter (Residuen-Gate / Zustandsschätzung).
 * Im Modus 'design' der Default — mit `--set fit=…` überschreibbar. */
const REC_EST = { fit: 'weighted', gate: 'maha', outlier: 'drop', gateK: 10 };
/* Experiment 3: Schätzer-Varianten als VOLLSTÄNDIGES Gitter
 * fit × gate × outlier × gateK × minSamples (gateHits bleibt beim Default 2).
 * Achtung: `gateK` bedeutet je nach `gate` Verschiedenes — bei 'rms' das
 * Vielfache des 1D-RMS aus der Kovarianz, bei 'maha' das Vielfache von σ in
 * Residuen-Richtung. Die Referenz plain/rms/reset (gateK 5, minSamples 0)
 * ist als Kombination im Gitter enthalten. 2·2·2·6·4 = 192 Läufe je
 * Arbeitspunkt. */
const ESTIMATORS = {
  fit:        ['plain', 'weighted'],
  gate:       ['rms', 'maha'],
  outlier:    ['reset', 'drop'],
  gateK:      [3, 4, 5, 7, 10, 20],   // 20 ≈ Gate praktisch offen
  minSamples: [0, 2, 3, 5]
};
function estimatorGrid() {
  let combos = [{}];
  for (const [key, values] of Object.entries(ESTIMATORS)) {
    const next = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [key]: v });
    combos = next;
  }
  return combos;
}

/* ---------- Experiment 'design': Weg zur 80-%-Fangquote ----------
 * Freiheitsgrade: Startposition/-ausrichtung des Autos, Halterung (Objektiv,
 * Neigung, Höhe, Schwenk) und Detektor-Stufe. NICHT frei: die Antriebs-
 * hardware (WP.holo / WP.ack) und die Szenario-Physik.
 *   A  kinematische Decke je Startpose (perfekter Detektor, kein Sichtfeld-
 *      limit) über startDx × startDy × startTh
 *   B  Halterung × Start (perfekter Detektor) an den besten Startposen aus A
 *   B2 Schnellprobe INNERHALB der Deckenschar aus B mit einem realistischen
 *      Detektor (ZZ2, Pixel-Strafe an): die Decke allein trennt nicht — an
 *      ihr sind Dutzende Konfigurationen gleichauf, und wer den Ball erst
 *      spät ins Bild bekommt, verliert ihn mit echter Erfassungslatenz.
 *   C  Detektor-Stufen ZDEF/ZZ1–ZZ4/BEST an den 3 besten Konfigurationen aus
 *      B2 plus der heutigen Referenz, je mit und ohne Pixel-Strafe
 *      ⇒ minimale Stufe für 80 %
 *   D  Robustheit: 3 Seeds mit doppeltem n, Sensitivität ±10° Neigung,
 *      ±0,5 m Startversatz
 *   E  nur falls C mit Pixel-Strafe unter dem Ziel bleibt: kleinstes
 *      Antriebs-Inkrement (aMax, vMax, cRad — eines nach dem anderen),
 *      das 80 % ermöglicht.
 * Zeilen sind bewusst kompakt (die JSON-Datei soll klein bleiben):
 *   s Stufe · dx/dy/th Startpose · hf/vf/ti/ch/pan Halterung · det Detektor ·
 *   px Pixel-Strafe (0/1) · n/seed · r Quote · ci 95-%-Halbbreite. */
const TARGET = 0.80;
const DESIGN = {
  startDx: [0, 1, 2, 3, 4, 5, 6],      // + = Richtung Feldmitte
  startDy: [-3, -2, -1, 0, 1, 2, 3],   // Querversatz in Welt-y
  startTh: [0, 90, 180, 270],          // Startausrichtung [°], 180 = heute
  fov:     [{ hfov: 68, vfov: 53 }, { hfov: 106, vfov: 81 }],
  tilt:    [30, 45, 60, 75],
  camH:    [0.25, 0.5, 1.0],
  pan:     ['fixed', 'track'],
  seeds:   [12345, 777, 4242],
  screen:  { stage: 'ZZ2', band: 0.05, max: 40 },   // Stufe B2
  reach:   'ZZ4',        // realistisch geplante Endstufe des Detektorprogramms
  driveDet: ['perfect', 'BEST', 'ZZ4'],
  drive:   { aMax: [14, 16, 20, 24, 30], vMax: [9, 10, 12], cRad: [1.25, 1.5, 2.0] }
};
const OMNI = { hfov: 179, vfov: 179, tilt: 0, pan: 'fixed' };
/* Heutige Referenz: Start unter dem Korb, feldeinwärts, Halterungs-
 * Arbeitspunkt der Vorstudie (Hauptkamera 68°×53°, starr, 60°, 0,25 m). */
const REF_CFG = { dx: 0, dy: 0, th: 180, hf: 68, vf: 53, ti: 60, ch: 0.25, pan: 'fixed' };

function runDesign(base, nFin, seed, wp, sink) {
  const nPre = Math.max(5, Math.round(nFin * 0.3));
  const wpBase = { ...base, ...WP[wp], wp };
  /* CAM_BASE und der empfohlene Schätzer sind Vorgabe, `base` (CLI) gewinnt.
   * DEFAULTS sind mitgeführt, damit jede Ergebniszeile vollständig ist. */
  const P = extra => ({ ...DEFAULTS, ...CAM_BASE, ...REC_EST, ...wpBase, ...extra });
  const rows = [];
  const push = (s, p, det, n, sd) => {
    const r = runCase(p, n, sd);
    const rec = { s, dx: p.startDx, dy: p.startDy, th: p.startTh,
                  hf: p.hfov, vf: p.vfov, ti: p.tilt, ch: p.camH, pan: p.pan,
                  det, px: pxOn(p) ? 1 : 0, n, seed: sd,
                  aMax: p.aMax, vMax: p.vMax, cRad: p.cRad,
                  r: +r.rate.toFixed(4), ci: +r.ci95.toFixed(4) };
    rows.push(rec); if (sink) sink.push(rec);
    return rec;
  };
  const say = (r, tag) => console.error(
    `  [${r.s}] ${(tag || '').padEnd(26)} start ${r.dx}/${r.dy}/${r.th}°  ` +
    `${r.hf}°×${r.vf}° tilt ${r.ti}° h ${r.ch} ${r.pan}  ${r.det}` +
    `${r.px ? '+px' : ''} → ${(r.r * 100).toFixed(1)} % ±${(r.ci * 100).toFixed(1)}`);

  /* --- A: kinematische Decke je Startpose --------------------------------- */
  console.error(`\n[design/${wp}] Stufe A — kinematische Decke (n=${nPre})`);
  const A = [];
  for (const dx of DESIGN.startDx) for (const dy of DESIGN.startDy)
    for (const th of DESIGN.startTh)
      A.push(push('A', P({ ...PERFECT, ...OMNI,
        startDx: dx, startDy: dy, startTh: th }), 'perfect', nPre, seed));
  const byPos = new Map();
  for (const r of A) {
    const k = `${r.dx},${r.dy}`, b = byPos.get(k);
    if (!b || r.r > b.r) byPos.set(k, r);
  }
  const posRank = [...byPos.values()]
    .sort((a, b) => b.r - a.r || a.dx - b.dx || Math.abs(a.dy) - Math.abs(b.dy));
  const topPos = posRank.slice(0, 3);
  if (!topPos.some(r => r.dx === 0 && r.dy === 0)) topPos.push(byPos.get('0,0'));
  posRank.slice(0, 5).forEach(r => say(r, 'beste Startposen'));
  say(byPos.get('0,0'), 'heute (unter dem Korb)');

  /* --- B: Halterung × Start ---------------------------------------------- */
  console.error(`\n[design/${wp}] Stufe B — Halterung × Start (n=${nPre})`);
  const B = [];
  for (const pos of topPos) for (const th of DESIGN.startTh)
    for (const f of DESIGN.fov) for (const ti of DESIGN.tilt)
      for (const ch of DESIGN.camH) for (const pan of DESIGN.pan)
        B.push(push('B', P({ ...PERFECT, ...f, tilt: ti, camH: ch, pan,
          startDx: pos.dx, startDy: pos.dy, startTh: th }), 'perfect', nPre, seed));
  /* Bei Gleichstand die billigere Halterung: Hauptkamera vor Ultraweit,
   * starr vor Schwenk, niedriger Mast vor hohem, flacher Winkel vor steilem. */
  const cost = r => (r.hf > 68 ? 2 : 0) + (r.pan === 'track' ? 2 : 0) + r.ch + r.ti / 100;
  const bRank = B.slice().sort((a, b) => b.r - a.r || cost(a) - cost(b));
  const same = (a, b) => a.dx === b.dx && a.dy === b.dy && a.th === b.th &&
    a.hf === b.hf && a.ti === b.ti && a.ch === b.ch && a.pan === b.pan;
  say(bRank[0], 'höchste Decke');

  /* --- B2: Schnellprobe in der Deckenschar mit realistischem Detektor ----- */
  const band = bRank.filter(r => r.r >= bRank[0].r - DESIGN.screen.band)
                    .slice(0, DESIGN.screen.max);
  console.error(`\n[design/${wp}] Stufe B2 — Schnellprobe ${DESIGN.screen.stage}` +
    ` + Pixel-Strafe über ${band.length} Konfigurationen der Decke (n=${nPre})`);
  const screen = band.map(c => push('B2', P({ ...STAGES[DESIGN.screen.stage],
    hfov: c.hf, vfov: c.vf, tilt: c.ti, camH: c.ch, pan: c.pan,
    startDx: c.dx, startDy: c.dy, startTh: c.th, pxModel: 'on' }),
    DESIGN.screen.stage, nPre, seed))
    .sort((a, b) => b.r - a.r || cost(a) - cost(b));
  /* Drei Kandidaten mit Vielfalt: bester je Objektiv, dann der beste mit
   * einer ANDEREN Startpose als der Sieger — plus die heutige Referenz. */
  const picks = [];
  const addPick = r => { if (r && !picks.some(q => same(q, r))) picks.push(r); };
  for (const f of DESIGN.fov) addPick(screen.find(r => r.hf === f.hfov));
  addPick(screen.find(r => screen[0] &&
    (r.dx !== screen[0].dx || r.dy !== screen[0].dy || r.th !== screen[0].th)));
  const cfgs = picks.slice(0, 3);
  cfgs.push({ ...REF_CFG, ref: true });
  screen.slice(0, 5).forEach(r => say(r, 'Schnellprobe'));
  console.error('  Stufe C fährt: ' + cfgs.map(c =>
    `${c.dx}/${c.dy}/${c.th}° ${c.hf}° t${c.ti} h${c.ch} ${c.pan}${c.ref ? ' (Referenz)' : ''}`)
    .join('  |  '));

  /* --- C: Detektor-Stufen, mit und ohne Pixel-Strafe --------------------- */
  console.error(`\n[design/${wp}] Stufe C — Detektor-Stufen (n=${nFin})`);
  const minStage = [];
  for (const c of cfgs) {
    for (const px of ['off', 'on']) {
      let hit = null;
      for (const [name, kpi] of Object.entries(STAGES)) {
        const r = push('C', P({ ...kpi, hfov: c.hf, vfov: c.vf, tilt: c.ti,
          camH: c.ch, pan: c.pan, startDx: c.dx, startDy: c.dy, startTh: c.th,
          pxModel: px }), name, nFin, seed);
        say(r, name);
        if (!hit && r.r >= TARGET) hit = r;
      }
      minStage.push({ cfg: c, px, stage: hit ? hit.det : null,
                      rate: hit ? hit.r : null });
    }
  }

  /* --- D: Robustheit der finalen Konfiguration(en) ----------------------- */
  const order = Object.keys(STAGES);
  const finals = minStage.filter(m => m.px === 'on' && m.stage)
    .sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || b.rate - a.rate)
    .slice(0, 2);
  if (!finals.length) {
    /* Ziel mit Pixel-Strafe nirgends erreicht ⇒ die beste Konfiguration an
     * der Detektor-Decke bestätigen (dort liegt der Fehlbetrag). */
    const best = minStage.filter(m => m.px === 'on')
      .map(m => ({ ...m, stage: 'BEST',
        rate: rows.find(r => r.s === 'C' && r.det === 'BEST' && r.px === 1 &&
          same(r, m.cfg)).r }))
      .sort((a, b) => b.rate - a.rate);
    finals.push(best[0]);
  }
  console.error(`\n[design/${wp}] Stufe D — Robustheit (n=${2 * nFin}, 3 Seeds)`);
  for (const fin of finals) {
    const c = fin.cfg, kpi = STAGES[fin.stage];
    const cfgP = extra => P({ ...kpi, hfov: c.hf, vfov: c.vf, tilt: c.ti,
      camH: c.ch, pan: c.pan, startDx: c.dx, startDy: c.dy, startTh: c.th,
      pxModel: fin.px, ...extra });
    for (const sd of DESIGN.seeds) say(push('D', cfgP(), fin.stage, 2 * nFin, sd), `Seed ${sd}`);
    for (const d of [-10, 10])
      say(push('D', cfgP({ tilt: c.ti + d }), fin.stage, nFin, seed), `tilt ${d > 0 ? '+' : ''}${d}°`);
    for (const d of [-0.5, 0.5]) {
      say(push('D', cfgP({ startDx: c.dx + d }), fin.stage, nFin, seed), `dx ${d > 0 ? '+' : ''}${d} m`);
      say(push('D', cfgP({ startDy: c.dy + d }), fin.stage, nFin, seed), `dy ${d > 0 ? '+' : ''}${d} m`);
    }
  }

  /* --- E: kleinste Antriebsänderung, falls das Ziel unerreichbar bleibt --- */
  /* Stufe E läuft, wenn 80 % mit Pixel-Strafe nur über eine Detektor-Stufe
   * JENSEITS des geplanten Endziels (DESIGN.reach = ZZ4) erreichbar sind —
   * dann ist das Ziel praktisch verfehlt und die Frage lautet, welches
   * kleinste Antriebs-Inkrement es öffnet. Information für T2, keine
   * Entscheidung: die Antriebshardware ist im Auftrag NICHT frei. */
  const reachIdx = order.indexOf(DESIGN.reach);
  const feasible = minStage.some(m => m.px === 'on' && m.stage &&
    order.indexOf(m.stage) <= reachIdx);
  const stageE = [];
  if (!feasible) {
    console.error(`\n[design/${wp}] Stufe E — Antriebs-Inkremente (n=${nFin})`);
    const c = finals[0].cfg;
    for (const det of DESIGN.driveDet) {
      const kpi = det === 'perfect' ? PERFECT : STAGES[det];
      for (const [key, values] of Object.entries(DESIGN.drive))
        for (const v of values) {
          const r = push('E', P({ ...kpi, hfov: c.hf, vfov: c.vf, tilt: c.ti,
            camH: c.ch, pan: c.pan, startDx: c.dx, startDy: c.dy, startTh: c.th,
            pxModel: finals[0].px, [key]: v }), det, nFin, seed);
          r.drv = `${key}=${v}`;
          say(r, `${det} ${key}=${v}`);
          if (r.r >= TARGET) stageE.push({ det, key, value: v, rate: r.r });
        }
    }
  }

  return { wp, seed, nPre, nFin, target: TARGET,
           ceiling: { best: posRank[0], today: byPos.get('0,0') },
           topPos, cfgs, minStage, finals, stageE, rows };
}

function fmtCase(label, r) {
  return `  ${label.padEnd(34)} → ${(r.rate * 100).toFixed(1)} % ` +
         `±${(r.ci95 * 100).toFixed(1)}  (${r.caught} gefangen, ${r.chance} mit Chance)`;
}

const EXPERIMENTS = ['basis', 'mount', 'curves', 'loo', 'estimators', 'profile',
                     'design'];

function runExperiment(exp, base, n, seed, wps) {
  const out = { exp, n, seed, base, wp: wps, results: [] };
  if (exp === 'design') {
    out.stages = Object.keys(STAGES);
    out.design = wps.map(w => {
      const d = runDesign(base, n, seed, w, out.results);
      return { ...d, rows: undefined };          // Zeilen stehen in results
    });
    return out;
  }
  const add = (params, opts) => {
    const r = runCase(params, n, seed, opts);
    out.results.push({ params, ...r });
    console.error(fmtCase(labelOf(params), r));
    return r;
  };
  for (const w of wps) {
    const wpBase = { ...base, ...WP[w], wp: w };
    console.error(`\n[${exp}] Arbeitspunkt ${w}: ${JSON.stringify(WP[w])}  (n=${n}, seed=${seed})`);
    if (exp === 'basis') {
      add({ ...wpBase, sensor: 'iso' });
      add({ ...wpBase, ...CAM_BASE });
    } else if (exp === 'curves') {
      add({ ...wpBase, ...CAM_BASE });
      for (const [key, values] of Object.entries(CURVES)) {
        for (const v of values) add({ ...wpBase, ...CAM_BASE, [key]: v });
        console.error('');
      }
    } else if (exp === 'mount') {
      add({ ...wpBase, ...CAM_BASE, ...PERFECT, ...MOUNT.omni });
      console.error('');
      for (const f of MOUNT.fov) {
        for (const pan of MOUNT.pan) {
          for (const tilt of MOUNT.tilt)
            add({ ...wpBase, ...CAM_BASE, ...PERFECT, ...f, pan, tilt });
          console.error('');
        }
      }
    } else if (exp === 'loo') {
      add({ ...wpBase, ...CAM_BASE, ...ZDEF });
      add({ ...wpBase, ...CAM_BASE, ...BEST });
      for (const k of Object.keys(BEST))
        add({ ...wpBase, ...CAM_BASE, ...BEST, [k]: ZDEF[k] });
    } else if (exp === 'estimators') {
      for (const c of estimatorGrid()) add({ ...wpBase, ...CAM_BASE, ...c });
    } else if (exp === 'profile') {
      /* Ohne tilt-Override die Neigungsreihe, mit Override genau dieser
       * Arbeitspunkt (so lässt sich der Halterungs-Arbeitspunkt profilieren). */
      for (const tilt of (base.tilt === undefined ? [0, 15, 30] : [base.tilt])) {
        const r = add({ ...wpBase, ...CAM_BASE, tilt }, { profile: true });
        const s = r.stats;
        console.error(`      sichtbar ${(s.visibility * 100).toFixed(1)} %  ` +
          `Recall(beob.) ${(s.recallObs * 100).toFixed(1)} %  Fehlmess. ${(s.falseRate * 100).toFixed(1)} %  ` +
          `d̄ ${s.seen.d.mean.toFixed(2)} m (max ${s.seen.d.max.toFixed(1)})  ` +
          `Elev̄ ${s.seen.el.mean.toFixed(1)}°  v̄ ${s.seen.v.mean.toFixed(1)} m/s`);
      }
    }
  }
  return out;
}

const labelOf = p => {
  const keys = ['recall', 'precision', 'kDepth', 'kLat', 'tAcq', 'hz',
                'hfov', 'vfov', 'tilt', 'pan', 'camH',
                'startDx', 'startDy', 'startTh', 'pxModel', 'inW',
                'dropMode', 'fit', 'gate', 'outlier', 'wCap',
                'gateK', 'gateHits', 'minSamples'];
  const camDef = { ...DEFAULTS, ...CAM_BASE };
  const diff = keys.filter(k => p[k] !== undefined && p[k] !== camDef[k])
                   .map(k => `${k}=${p[k]}`);
  return `${p.wp}/${p.sensor}${diff.length ? ' ' + diff.join(' ') : ' (Basis)'}`;
};

/* ---------- CLI ---------- */
function parseArgv(argv) {
  const cli = { set: {}, json: false, exp: null, wp: null, n: null, seed: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') cli.json = true;
    else if (a === '--exp') cli.exp = argv[++i];
    else if (a === '--wp') cli.wp = argv[++i];
    else if (a === '--n') cli.n = parseInt(argv[++i], 10);
    else if (a === '--seed') cli.seed = parseInt(argv[++i], 10);
    else if (a === '--sensor') cli.set.sensor = argv[++i];
    else if (a === '--set') {
      const kv = argv[++i] || '', i0 = kv.indexOf('=');
      if (i0 > 0) cli.set[kv.slice(0, i0)] = coerce(kv.slice(i0 + 1));
    }
  }
  return cli;
}
function coerce(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v !== '' && !isNaN(Number(v)) ? Number(v) : v;
}

function main() {
  const cli = parseArgv(process.argv);
  const N = cli.n || parseInt(process.env.N || '600', 10);
  const SEED = cli.seed == null ? 12345 : cli.seed;
  const base = { ...(process.env.BASE ? JSON.parse(process.env.BASE) : {}), ...cli.set };

  if (cli.exp) {
    if (!EXPERIMENTS.includes(cli.exp)) {
      console.error(`Unbekanntes Experiment '${cli.exp}' (${EXPERIMENTS.join('|')})`);
      process.exit(1);
    }
    const wps = cli.wp ? [cli.wp] : Object.keys(WP);
    const t0 = Date.now();
    const out = runExperiment(cli.exp, base, N, SEED, wps);
    console.error(`\n${out.results.length} Läufe in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    // 'design' hat viele, sehr kleine Zeilen ⇒ ohne Einrückung ausgeben.
    if (cli.json) console.log(JSON.stringify(out, null, cli.exp === 'design' ? 0 : 1));
    return;
  }

  const out = { n: N, seed: SEED, defaults: DEFAULTS, base, results: {} };
  out.baseline = catchRate(base, N, SEED);
  console.error(`Basis ${JSON.stringify({ ...DEFAULTS, ...base })}`);
  console.error(`Baseline: ${(out.baseline * 100).toFixed(1)} %  (n=${N})\n`);
  for (const [key, values] of Object.entries(SWEEPS)) {
    out.results[key] = values.map(v => {
      const rate = catchRate({ ...base, [key]: v }, N, SEED);
      console.error(`  ${key} = ${String(v).padStart(5)}  →  ${(rate * 100).toFixed(1)} %`);
      return { value: v, rate };
    });
    console.error('');
  }
  if (cli.json) console.log(JSON.stringify(out, null, 1));
}

if (require.main === module) main();
module.exports = { simulateThrow, simulateThrowInfo, catchRate, catchRateZone, runCase,
                   createGate, floorCov, estimatorGrid, runExperiment, runDesign,
                   pxFactor, pxOfDist, pxRecallW, camParamsOf,
                   ZONES, DEFAULTS, SCENE, WP, CAM_BASE, CURVES, ESTIMATORS,
                   EXPERIMENTS, MOUNT, PERFECT, BEST, ZDEF, STAGES, REC_EST,
                   DESIGN, TARGET, OMNI };
