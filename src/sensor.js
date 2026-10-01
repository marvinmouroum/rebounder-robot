/* =====================================================================
 *  catch-sensor — Kamera-Sensormodell (Detektor-KPIs → Messungen)
 * =====================================================================
 * Bildet einen kamerabasierten Ball-Detektor auf verrauschte, lückenhafte
 * Positionsmessungen ab. Ersetzt im Kamera-Modus das alte isotrope
 * Sensormodell (p_meas = p_true + N(0, σ²·I₃) bei fester Rate), das als
 * Referenz erhalten bleibt. Spezifikation:
 * .okf/app/detector-research-program.md, Abschnitt 4a
 * Doku: .okf/simulation/sensor-model.md
 *
 * Läuft im Browser (window.CatchSensor) und in Node (module.exports).
 * Keine Abhängigkeiten. Reine Funktionen; der RNG wird IMMER injiziert
 * (`rand()` ∈ [0,1)), Zustand steckt ausschließlich im Kameraobjekt.
 *
 * ---------------------------------------------------------------------
 *  API (das hier ist die Integrations-Referenz für sim.js/index.html)
 * ---------------------------------------------------------------------
 *  const cam = CatchSensor.createCamera(params)
 *
 *  params (Defaults = Z-konform, Winkel in GRAD):
 *    camH      0.25   Kamerahöhe über der Roboter-Grundfläche [m]
 *    tilt      0      Neigung [°], POSITIV = nach oben (Sweep 0–45)
 *    hfov      68     horizontales Sichtfeld [°]  (voll, nicht halb)
 *    vfov      53     vertikales Sichtfeld [°]
 *    pan       'fixed'  'fixed' = Blickrichtung starr = Fahrzeug-Heading th,
 *                       'track' = Gierwinkel auf `aim` (Neigung bleibt tilt)
 *    kLat      0.10   σ_lat = kLat · latRef, distanzunabhängig, quer zur Sichtlinie
 *    latRef    0.24   Referenzlänge für σ_lat [m] (Balldurchmesser)
 *    kDepth    0.15   σ_d = kDepth · d, entlang der Sichtlinie
 *    recall    0.80   Anteil erkannter Frames (Ball im Sichtfeld)
 *    dropMode  'iid'  'iid' = unabhängige Aussetzer, 'burst' = Markov-Kette
 *    burstLen  3      mittlere Aussetzerlänge [Frames] bei dropMode 'burst'
 *    precision 0.95   Anteil echter Messungen; mit 1−precision wird die
 *                     Messung durch einen Zufallspunkt im Sichtkegel ersetzt
 *    minRange  0.5    Distanzbereich der Fehlmessungen [m]
 *    maxRange  12
 *    tAcq      0.3    Erfassungslatenz nach dem Rebound [s]
 *    hz        15     Frame-Takt [Hz]
 *
 *  cam.reset(tRebound)  |  cam.reset({ t0, tRebound })
 *    Setzt Frame-Takt (Frames fällig ab t0, Default 0) und Aussetzer-Kette
 *    für einen neuen Wurf zurück. `tRebound` = Sim-Wahrheits-Zeitpunkt des
 *    Ringkontakts; vor tRebound + tAcq liefert sample() nichts. null/undef
 *    ⇒ keine Erfassungssperre. cam.stats() bleibt erhalten (Aggregation
 *    über viele Würfe); cam.resetStats() löscht sie.
 *
 *  cam.sample({ t, ball, robot, aim, rand }) → null | Messung
 *    t     Simulationszeit [s] (der Harness ruft je Substep auf, die Kamera
 *          entscheidet selbst, ob ein Frame fällig ist)
 *    ball  { x, y, z, vx?, vy?, vz? } Sim-Wahrheit (v nur für cam.stats())
 *    robot { x, y, th, z? } Pose; th = Blickrichtung bei pan 'fixed'
 *    aim   { x, y, z } prädizierte Ballposition für pan 'track' (optional;
 *          fehlt sie, fällt die Kamera auf th zurück)
 *    rand  RNG ∈ [0,1)
 *    null  = kein Frame fällig | vor tAcq | außerhalb Sichtfeld | Aussetzer
 *    Messung = { t, x, y, z, p:[x,y,z], cov, kind, d, az, el }
 *          cov  3×3-Kovarianz im WELTsystem (verschachtelte Zeilen-Arrays),
 *               = R·diag(σ_d², σ_lat², σ_lat²)·Rᵀ; auch bei Fehlmessungen
 *               gesetzt (Kovarianz an der gefälschten Position)
 *          kind 'true' | 'false' (Fehlmessung)
 *          d, az, el  Distanz [m] und Sichtwinkel [rad] der MESSUNG
 *          p    Bequemlichkeits-Alias [x, y, z] für den Messpuffer der Engine
 *
 *  cam.stats() → Betriebsprofil (Experiment 4), siehe unten
 *  cam.params() → aufgelöste Konfiguration (Winkel in rad)
 *
 *  Hilfsfunktionen (Low-Level, Winkel in RADIANT):
 *    cameraPose(pos, yaw, pitch) → { pos, yaw, pitch, e1, e2, e3 }
 *        e1 = Blickrichtung, e2 = horizontal quer, e3 = e1 × e2 (Kamera-Oben)
 *    viewAngles(pose, target)   → { d, az, el } | null
 *    inFov(pose, target, hfov, vfov) → boolean
 *    losFrame(camPos, target)   → { d, R }  Sichtlinien-Frame:
 *        R[i][j] = i-te WELT-Komponente des j-ten Basisvektors,
 *        Spalte 0 = Sichtlinie, Spalten 1/2 = zwei Querrichtungen
 *    rotateVec(R, v), rotateCov(R, diag3), worldCov(R, σ_d, σ_lat)
 *    gauss(rand)  Standardnormal (Box–Muller)
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatchSensor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const DEFAULTS = {
    camH: 0.25, tilt: 0, hfov: 68, vfov: 53, pan: 'fixed',
    kLat: 0.10, latRef: 0.24, kDepth: 0.15,
    recall: 0.80, dropMode: 'iid', burstLen: 3,
    precision: 0.95, minRange: 0.5, maxRange: 12,
    tAcq: 0.3, hz: 15
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const vec3 = p => Array.isArray(p) ? [p[0], p[1], p[2]]
                                     : [p.x, p.y, p.z === undefined ? 0 : p.z];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1],
                           a[2] * b[0] - a[0] * b[2],
                           a[0] * b[1] - a[1] * b[0]];

  /* Standardnormal, Box–Muller (cos-Zweig) — identisch zum Rest des Repos:
   * zwei Uniforme je Ziehung, damit Seeds vergleichbar bleiben. */
  function gauss(rand) {
    const u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /* Kamera-Basis: e1 Blickrichtung (yaw/pitch), e2 horizontal quer,
   * e3 = e1 × e2 = Kamera-Oben. Rechtshändig und orthonormal. */
  function cameraPose(pos, yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const e1 = [cp * cy, cp * sy, sp];
    const e2 = [-sy, cy, 0];
    const e3 = [-sp * cy, -sp * sy, cp];
    return { pos: [pos[0], pos[1], pos[2]], yaw, pitch, e1, e2, e3 };
  }

  /* Azimut/Elevation des Ziels IM KAMERA-FRAME (rad) plus Distanz.
   * az = atan2(quer, vorwärts), el = atan2(oben, √(vorwärts² + quer²)). */
  function viewAngles(pose, target) {
    const p = vec3(target);
    const rel = [p[0] - pose.pos[0], p[1] - pose.pos[1], p[2] - pose.pos[2]];
    const d = Math.hypot(rel[0], rel[1], rel[2]);
    if (!(d > 1e-9)) return null;
    const a = dot(rel, pose.e1), b = dot(rel, pose.e2), c = dot(rel, pose.e3);
    return { d, az: Math.atan2(b, a), el: Math.atan2(c, Math.hypot(a, b)) };
  }

  /* Sichtfeldtest: |az| ≤ hfov/2, |el| ≤ vfov/2, d > 0 (hfov/vfov in rad). */
  function inFov(pose, target, hfov, vfov) {
    const va = viewAngles(pose, target);
    if (!va) return false;
    return Math.abs(va.az) <= hfov / 2 && Math.abs(va.el) <= vfov / 2;
  }

  /* Sichtlinien-Frame zum Ziel: Spalte 0 = Einheitsvektor Kamera→Ziel,
   * Spalten 1/2 = zwei orthonormale Querrichtungen (deterministisch). */
  function losFrame(camPos, target) {
    const c = vec3(camPos), p = vec3(target);
    const rel = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    const d = Math.hypot(rel[0], rel[1], rel[2]);
    if (!(d > 1e-9)) return null;
    const e1 = [rel[0] / d, rel[1] / d, rel[2] / d];
    const helper = Math.abs(e1[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let e2 = cross(e1, helper);
    const n2 = Math.hypot(e2[0], e2[1], e2[2]);
    e2 = [e2[0] / n2, e2[1] / n2, e2[2] / n2];
    const e3 = cross(e1, e2);
    return { d, R: [[e1[0], e2[0], e3[0]],
                    [e1[1], e2[1], e3[1]],
                    [e1[2], e2[2], e3[2]]] };
  }

  const rotateVec = (R, v) => [
    R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
    R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
    R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2]
  ];

  /* C = R·diag(d)·Rᵀ — symmetrisch nach Konstruktion. */
  function rotateCov(R, d) {
    const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++)
      for (let j = i; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += R[i][k] * d[k] * R[j][k];
        C[i][j] = s; C[j][i] = s;
      }
    return C;
  }

  const worldCov = (R, sd, sLat) => rotateCov(R, [sd * sd, sLat * sLat, sLat * sLat]);

  /* ---------- Betriebsprofil (Experiment 4) ---------- */
  function acc(lo, w, n) {
    return { n: 0, sum: 0, min: Infinity, max: -Infinity, lo, w, bins: new Array(n).fill(0) };
  }
  function put(a, v) {
    a.n++; a.sum += v;
    if (v < a.min) a.min = v;
    if (v > a.max) a.max = v;
    // erster/letzter Bin = Unter-/Überlauf
    a.bins[clamp(Math.floor((v - a.lo) / a.w), 0, a.bins.length - 1)]++;
  }
  const snap = a => ({
    n: a.n, mean: a.n ? a.sum / a.n : 0,
    min: a.n ? a.min : 0, max: a.n ? a.max : 0,
    lo: a.lo, w: a.w, bins: a.bins.slice()
  });
  function freshStats() {
    return {
      framesDue: 0, preAcq: 0, outOfFov: 0, inFov: 0,
      dropped: 0, falseMeas: 0, emitted: 0,
      // "all" = jeder fällige Frame nach tAcq (unabhängig vom Sichtfeld),
      // "seen" = nur Frames mit Ball im Sichtfeld.
      all: { d: acc(0, 1, 16), v: acc(0, 1, 16), el: acc(-30, 5, 24) },
      seen: { d: acc(0, 1, 16), v: acc(0, 1, 16), el: acc(-30, 5, 24) }
    };
  }

  /* ---------- Kamera-Factory ---------- */
  function createCamera(params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const cfg = {
      camH: +p.camH,
      tilt: +p.tilt * D2R, hfov: +p.hfov * D2R, vfov: +p.vfov * D2R,
      pan: p.pan === 'track' ? 'track' : 'fixed',
      kLat: +p.kLat, latRef: +p.latRef, kDepth: +p.kDepth,
      recall: clamp(+p.recall, 0, 1),
      dropMode: p.dropMode === 'burst' ? 'burst' : 'iid',
      burstLen: Math.max(1, +p.burstLen),
      precision: clamp(+p.precision, 0, 1),
      minRange: +p.minRange, maxRange: +p.maxRange,
      tAcq: +p.tAcq, hz: +p.hz
    };
    /* Aussetzer als 2-Zustands-Markov-Kette (dropMode 'burst'):
     *   q = P(Aussetzer → Sicht)   = 1 / burstLen  ⇒ mittlere Länge burstLen
     *   pD = P(Sicht → Aussetzer)  = q·(1−recall)/recall
     * ⇒ stationär P(Aussetzer) = pD/(pD+q) = 1 − recall, der Langzeit-Recall
     * bleibt also exakt `recall`. Die Kette startet nach reset() im
     * Sicht-Zustand (leichter Bias zugunsten der ersten Frames eines Wurfs). */
    const q = 1 / cfg.burstLen;
    const pD = cfg.recall > 0 ? q * (1 - cfg.recall) / cfg.recall : 1;
    const dt = 1 / cfg.hz;

    const st = { t0: 0, next: 0, tRebound: null, dropped: false, stats: freshStats() };

    function reset(o) {
      const opt = (typeof o === 'number') ? { tRebound: o } : (o || {});
      st.t0 = opt.t0 == null ? 0 : +opt.t0;
      st.next = st.t0;
      st.tRebound = opt.tRebound == null ? null : +opt.tRebound;
      st.dropped = false;
      return cam;
    }

    function poseOf(robot, aim) {
      const pos = [robot.x, robot.y, (robot.z || 0) + cfg.camH];
      let yaw = robot.th || 0;
      if (cfg.pan === 'track' && aim) {
        const a = vec3(aim);
        const dx = a[0] - pos[0], dy = a[1] - pos[1];
        if (Math.hypot(dx, dy) > 1e-6) yaw = Math.atan2(dy, dx);
      }
      return cameraPose(pos, yaw, cfg.tilt);
    }

    function dropNow(rand) {
      if (cfg.recall >= 1) return false;
      if (cfg.recall <= 0) return true;
      if (cfg.dropMode === 'burst') {
        if (rand() < (st.dropped ? q : pD)) st.dropped = !st.dropped;
        return st.dropped;
      }
      return rand() >= cfg.recall;                       // iid
    }

    /* Fehlmessung: gleichverteilt in Azimut/Elevation innerhalb des
     * Sichtkegels, Distanz gleichverteilt in [minRange, maxRange]. */
    function fakePoint(pose, rand) {
      const az = (rand() * 2 - 1) * cfg.hfov / 2;
      const el = (rand() * 2 - 1) * cfg.vfov / 2;
      const d = cfg.minRange + rand() * (cfg.maxRange - cfg.minRange);
      const ce = Math.cos(el), se = Math.sin(el);
      const k1 = d * ce * Math.cos(az), k2 = d * ce * Math.sin(az), k3 = d * se;
      return [pose.pos[0] + k1 * pose.e1[0] + k2 * pose.e2[0] + k3 * pose.e3[0],
              pose.pos[1] + k1 * pose.e1[1] + k2 * pose.e2[1] + k3 * pose.e3[1],
              pose.pos[2] + k1 * pose.e1[2] + k2 * pose.e2[2] + k3 * pose.e3[2]];
    }

    /* Betriebsprofil: Distanz, Ballgeschwindigkeit und WELT-Elevation
     * (über der Horizontalen, unabhängig von tilt — Grundlage für die
     * Halterungs-Neigung) je Frame protokollieren. */
    function record(bucket, pose, ball, d) {
      put(bucket.d, d);
      if (ball.vx !== undefined)
        put(bucket.v, Math.hypot(ball.vx, ball.vy || 0, ball.vz || 0));
      const dx = ball.x - pose.pos[0], dy = ball.y - pose.pos[1];
      put(bucket.el, Math.atan2(ball.z - pose.pos[2], Math.hypot(dx, dy)) * R2D);
    }

    function sample(o) {
      const t = +o.t, rand = o.rand || Math.random, S = st.stats;
      if (t < st.next - 1e-9) return null;               // kein Frame fällig
      st.next += dt;
      if (st.next <= t) st.next = t + dt;                // Aufholen nach Zeitsprung
      S.framesDue++;
      if (st.tRebound != null && t < st.tRebound + cfg.tAcq) { S.preAcq++; return null; }

      const pose = poseOf(o.robot, o.aim);
      const ball = o.ball;
      const va = viewAngles(pose, ball);
      if (!va) { S.outOfFov++; return null; }
      record(S.all, pose, ball, va.d);
      if (Math.abs(va.az) > cfg.hfov / 2 || Math.abs(va.el) > cfg.vfov / 2) {
        S.outOfFov++; return null;                       // Ball außerhalb des Sichtfelds
      }
      S.inFov++;
      record(S.seen, pose, ball, va.d);

      if (dropNow(rand)) { S.dropped++; return null; }   // Aussetzer (Recall)

      let kind = 'true', target = vec3(ball);
      if (cfg.precision < 1 && rand() < 1 - cfg.precision) {
        kind = 'false'; S.falseMeas++;
        target = fakePoint(pose, rand);
      }
      const lf = losFrame(pose.pos, target);
      const sd = cfg.kDepth * lf.d, sLat = cfg.kLat * cfg.latRef;
      const w = rotateVec(lf.R, [gauss(rand) * sd, gauss(rand) * sLat, gauss(rand) * sLat]);
      const x = target[0] + w[0], y = target[1] + w[1], z = target[2] + w[2];
      const vm = kind === 'true' ? va : viewAngles(pose, target);
      S.emitted++;
      return { t, x, y, z, p: [x, y, z], cov: worldCov(lf.R, sd, sLat), kind,
               d: vm.d, az: vm.az, el: vm.el };
    }

    function stats() {
      const S = st.stats;
      return {
        framesDue: S.framesDue, preAcq: S.preAcq, outOfFov: S.outOfFov,
        inFov: S.inFov, dropped: S.dropped, falseMeas: S.falseMeas, emitted: S.emitted,
        visibility: S.framesDue - S.preAcq ? S.inFov / (S.framesDue - S.preAcq) : 0,
        recallObs: S.inFov ? (S.inFov - S.dropped) / S.inFov : 0,
        falseRate: S.emitted ? S.falseMeas / S.emitted : 0,
        all: { d: snap(S.all.d), v: snap(S.all.v), el: snap(S.all.el) },
        seen: { d: snap(S.seen.d), v: snap(S.seen.v), el: snap(S.seen.el) }
      };
    }

    const cam = {
      sample, reset, stats,
      resetStats: () => { st.stats = freshStats(); return cam; },
      params: () => Object.assign({}, cfg),
      pose: (robot, aim) => poseOf(robot, aim)
    };
    return cam;
  }

  return { createCamera, cameraPose, viewAngles, inFov, losFrame,
           rotateVec, rotateCov, worldCov, gauss, DEFAULTS, D2R, R2D };
});
