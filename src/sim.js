/* =====================================================================
 *  catch-sim — Simulation, Szenarien, Rendering, UI
 * =====================================================================
 *  Nutzt ausschließlich CatchEngine (src/engine.js) für die Mathematik.
 *  Die "Sim-Wahrheit" (Objektdynamik, Szenario-Events, Sensorrauschen)
 *  ist dem Algorithmus unbekannt — er sieht nur die Messungen.
 *  Doku: .okf/simulation/ (OKF-Bundle).
 *
 *  Zwei Sensormodelle (Umschalter "Modell" in der Sensor-Karte):
 *    'iso'    isotropes Rauschen N(0, noise²·I₃) bei fester Rate (Default,
 *             bisheriges Verhalten, Referenzlinie aller alten Sweeps).
 *    'camera' Kamera-Sensormodell aus src/sensor.js (Sichtfeld, Aussetzer,
 *             Fehlmessungen, anisotropes Rauschen, Erfassungslatenz).
 *  Sensorpfad, Gate-σ, Heading-Regel und Fit sind 1:1 zum Headless-Harness
 *  tools/sweep-basket.js (simulateThrowInfo) — beide Seiten müssen bei
 *  Änderungen gemeinsam nachgezogen werden.
 * ===================================================================== */
(function () {
  'use strict';
  const E = window.CatchEngine;
  const S = window.CatchSensor;

  const G = 9.81;
  const GATE_K = 5;          // Residuen-Schwelle = GATE_K·σ + Floor
  const GATE_HITS = 2;       // so viele Ausreißer in Folge lösen Reset aus

  const cv = document.getElementById('cv'), ctx = cv.getContext('2d');
  /* Szenen: Halbausdehnung fx/fy in m (Sim-Wahrheit UND Planergrenze),
   * dazu Darstellungsmaßstab. "court" = FIBA-Basketballfeld 28 × 15 m,
   * Ringmitte 1,575 m vor der Grundlinie auf 3,05 m, Ringradius 0,225 m,
   * Brett 1,8 m breit, Unterkante 2,90 m / Oberkante 3,95 m. */
  const SCENES = {
    square: { fx: 9, fy: 9, scale: 34, cyOff: 120 },
    court: {
      fx: 14, fy: 7.5, scale: 25, cyOff: 70,
      hoop: { x: 14 - 1.575, y: 0, z: 3.05, r: 0.225, boardZ: [2.90, 3.95], boardW: 0.9 }
    }
  };
  const sceneFor = sc => sc === 'basket' ? SCENES.court : SCENES.square;
  const CX = cv.width / 2;
  let scene = SCENES.square, SCALE = scene.scale, CY = cv.height / 2 + scene.cyOff;

  const $ = id => document.getElementById(id);
  /* Kamera-Parameter (tilt … vfov) wirken nur im Modus 'camera'; jede
   * Änderung markiert das Kameraobjekt als veraltet (camDirty). */
  const UNIT = {
    aMax: ' m/s²', vMax: ' m/s', cRad: ' m', hgt: ' m', hz: ' Hz', noise: ' m', rest: '',
    tilt: '°', recall: '', precision: '', kDepth: '', kLat: '', tAcq: ' s', camH: ' m'
  };
  const CAM_KEYS = ['hz', 'tilt', 'recall', 'precision', 'kDepth', 'kLat', 'tAcq', 'camH', 'hfov', 'vfov'];
  const params = {
    aMax: 14, vMax: 7, cRad: 0.35, hgt: 0.5, hz: 20, noise: 0.05, rest: 0.75,
    tilt: 0, recall: 0.80, precision: 0.95, kDepth: 0.15, kLat: 0.10, tAcq: 0.3, camH: 0.25,
    hfov: 68, vfov: 53
  };
  let cam = null, camDirty = true;          // Kameraobjekt (src/sensor.js)
  for (const key of Object.keys(UNIT)) {
    const el = $(key), out = $(key + 'V');
    const upd = () => {
      params[key] = parseFloat(el.value);
      out.textContent = el.value + UNIT[key];
      if (CAM_KEYS.indexOf(key) >= 0) camDirty = true;
    };
    el.addEventListener('input', upd); upd();
  }
  for (const key of ['hfov', 'vfov']) {     // Zahlenfelder ohne Ausgabe
    const el = $(key);
    const upd = () => {
      const v = parseFloat(el.value);
      if (isFinite(v) && v > 0 && v < 180) { params[key] = v; camDirty = true; }
    };
    el.addEventListener('input', upd); upd();
  }

  let scenario = 'normal';
  /* Sensormodell, Kamera-Schwenkpolitik und Fit-Variante */
  let sensorMode = 'iso', panMode = 'fixed', fitWeighted = false;
  let gateOn = true;
  /* Antrieb: 'holo' = holonomer Punktmassen-Regler, 'ack' = Ackermann
   * (kinematisches Fahrradmodell, Maße ~ 1:12-RC-Car mit Fangring). */
  let drive = 'holo';
  const ACK = { L: 0.25, steerMax: 0.56, steerRate: 8 };   // 32° Lenkwinkel, ~460°/s
  const ackOpts = () => ({ aMax: params.aMax, vMax: params.vMax, ...ACK });
  let ball, act, samples, est, impact, trail, simT, sensorNext, phase, resultAt;
  let residHits, gateResets, ev;
  let lastMeas, measLog, tReb;
  let paused = false, catches = 0, throws = 0;

  function gauss() { // Box–Muller
    const u = 1 - Math.random(), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const sigmaEff = () => Math.max(params.noise, 0.02);
  /* σ für die Gate-Schwelle wie im Harness: iso = max(noise, 0.02);
   * Kamera = 1D-RMS aus der Messkovarianz √(spur/3), untere Schranke 0.02. */
  const sigmaOf = m => m.cov
    ? Math.max(0.02, Math.sqrt((m.cov[0][0] + m.cov[1][1] + m.cov[2][2]) / 3))
    : sigmaEff();

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /* Kameraobjekt aus den aktuellen Reglerwerten neu bauen und auf den
   * laufenden Wurf setzen (Frame-Takt ab jetzt, Erfassungssperre bis
   * tReb + tAcq). Wird beim Wurfstart und nach jeder Parameteränderung
   * aufgerufen — cam.stats() gilt dadurch immer für den laufenden Wurf. */
  function makeCam() {
    cam = S.createCamera({
      camH: params.camH, tilt: params.tilt, hfov: params.hfov, vfov: params.vfov,
      pan: panMode, kLat: params.kLat, kDepth: params.kDepth,
      recall: params.recall, precision: params.precision,
      tAcq: params.tAcq, hz: params.hz
    });
    cam.reset({ t0: simT, tRebound: tReb });
    camDirty = false;
  }

  /* Zielpunkt für pan:'track' — prädizierte Ballposition aus dem
   * Engine-Zustand, sonst die letzte Messung, sonst null (Kamera bleibt
   * starr). Identisch zu aimPoint() im Sweep-Harness. */
  function aimPoint() {
    if (est) {
      const tau = simT - est.t0;
      return { x: est.p0[0] + est.v0[0] * tau,
               y: est.p0[1] + est.v0[1] * tau,
               z: est.p0[2] + est.v0[2] * tau - 0.5 * G * tau * tau };
    }
    return lastMeas ? { x: lastMeas.p[0], y: lastMeas.p[1], z: lastMeas.p[2] } : null;
  }

  function newThrow() {
    // Startposition: Feldmitte; Basketball: unter dem Korb (Rebounder-Position),
    // Ackermann-Fahrzeug schaut feldeinwärts
    const home = scene.hoop || { x: 0, y: 0 };
    act = { x: home.x, y: home.y, vx: 0, vy: 0,
            th: scene.hoop ? Math.PI : 0, v: 0, delta: 0 };
    samples = []; est = null; impact = null; trail = [];
    simT = 0; sensorNext = 0; phase = 'flight'; resultAt = null;
    residHits = 0; gateResets = 0;
    lastMeas = null; measLog = [];
    ev = { hCrossed: false };

    if (scenario === 'basket') {
      // Wurf aus 4–8 m Ringdistanz (Abwurfhöhe 2 m) auf einen zufälligen
      // Punkt des Ringrands; Bogen so gewählt, dass er den Ring exakt
      // zum Zeitpunkt tof trifft (dort: Sim-Wahrheits-Event "Rebound").
      const hp = scene.hoop;
      const dist = 4 + Math.random() * 4;
      const dir = Math.PI + (Math.random() * 2 - 1) * (Math.PI / 3); // feldeinwärts
      const sx = clamp(hp.x + Math.cos(dir) * dist, -scene.fx + 0.5, scene.fx - 0.5);
      const sy = clamp(hp.y + Math.sin(dir) * dist, -scene.fy + 0.5, scene.fy - 0.5);
      const ra = Math.random() * 2 * Math.PI;
      const tx = hp.x + Math.cos(ra) * hp.r, ty = hp.y + Math.sin(ra) * hp.r;
      const tof = 1.0 + Math.random() * 0.4;
      ball = {
        p: [sx, sy, 2.0],
        v: [(tx - sx) / tof, (ty - sy) / tof, (hp.z - 2.0) / tof + 0.5 * G * tof],
        mode: 'fly'
      };
      ev.rimAt = tof; ev.rimmed = false;
    } else {
      const ang = Math.random() * 2 * Math.PI;
      const sx = Math.cos(ang) * scene.fx * 0.95, sy = Math.sin(ang) * scene.fy * 0.95;
      const tx = (Math.random() * 2 - 1) * scene.fx * 0.55, ty = (Math.random() * 2 - 1) * scene.fy * 0.55;
      const vz = 7 + Math.random() * 5;
      const tof = 2 * vz / G;
      ball = { p: [sx, sy, 0.2], v: [(tx - sx) / tof, (ty - sy) / tof, vz], mode: 'fly' };
      if (scenario === 'kick') { ev.kickAt = tof * (0.35 + 0.2 * Math.random()); ev.kicked = false; }
      if (scenario === 'hover') {
        ev.freezeAt = tof * (0.40 + 0.15 * Math.random());
        ev.hoverDur = 1.2 + 1.0 * Math.random();
        ev.frozen = false;
      }
    }
    /* Bezugszeitpunkt der Erfassungslatenz tAcq: im Basketball-Szenario der
     * Ringkontakt (Sim-Wahrheit, im Harness `tof`), in allen Szenarien ohne
     * Rebound der Wurfstart (t = 0) — dort sperrt tAcq also die ersten
     * tAcq Sekunden des Flugs. */
    tReb = scenario === 'basket' ? ev.rimAt : 0;
    if (sensorMode === 'camera') makeCam();
    throws++;
  }

  function endThrow(caught) {
    phase = caught ? 'caught' : 'missed';
    if (caught) catches++;
    resultAt = performance.now();
  }

  function physics(dt) {
    if (phase !== 'flight') return;
    simT += dt;

    /* ---- Sim-Wahrheit: Objektdynamik (dem Algorithmus unbekannt) ---- */
    if (ball.mode === 'hover') {
      if (simT >= ev.hoverEnd) ball.mode = 'fly';        // Schweben endet: freier Fall
    } else if (ball.mode === 'fly') {
      if (scenario === 'kick' && !ev.kicked && simT >= ev.kickAt) {
        ev.kicked = true;                                // Stoß: neue Horizontalrichtung
        const vz = ball.v[2];
        const tRem = (vz + Math.sqrt(vz * vz + 2 * G * Math.max(0, ball.p[2]))) / G;
        const tx = (Math.random() * 2 - 1) * scene.fx * 0.6, ty = (Math.random() * 2 - 1) * scene.fy * 0.6;
        ball.v[0] = (tx - ball.p[0]) / tRem;
        ball.v[1] = (ty - ball.p[1]) / tRem;
      }
      if (scenario === 'basket' && !ev.rimmed && simT >= ev.rimAt) {
        ev.rimmed = true;                                // Ringkontakt: zufälliger Rebound
        // Energieverlust wie am Boden (Restitution e); Richtung feldeinwärts
        // gestreut (±69°), Abgang flach bis steil nach oben.
        const s = params.rest * Math.hypot(ball.v[0], ball.v[1], ball.v[2]);
        const az = Math.atan2(-ball.p[1], -ball.p[0]) + (Math.random() * 2 - 1) * 1.2;
        const vz = s * (0.15 + 0.55 * Math.random());
        const vh = Math.sqrt(Math.max(0, s * s - vz * vz));
        ball.v = [Math.cos(az) * vh, Math.sin(az) * vh, vz];
      }
      if (scenario === 'hover' && !ev.frozen && simT >= ev.freezeAt) {
        ev.frozen = true; ball.mode = 'hover';
        ball.v = [0, 0, 0]; ev.hoverEnd = simT + ev.hoverDur;
      } else {
        ball.v[2] -= G * dt;
        for (let k = 0; k < 3; k++) ball.p[k] += ball.v[k] * dt;
        // Fangebene liegt auf Aktuatorhöhe z = H, nicht am Boden
        const bouncy = scenario === 'bounce' || scenario === 'basket';
        if (!ev.hCrossed && ball.p[2] <= params.hgt && ball.v[2] < 0) {
          ev.hCrossed = true;
          const hit = Math.hypot(act.x - ball.p[0], act.y - ball.p[1]) <= params.cRad;
          if (hit) endThrow(true);
          else if (!bouncy) endThrow(false);
        }
        if (phase === 'flight' && ball.p[2] <= 0 && ball.v[2] < 0) {
          // Springende Szenarien: Abpraller ⇒ nächste Fangchance beim Wiederhochkommen
          const vzPost = -params.rest * ball.v[2];
          const canClear = vzPost >= Math.sqrt(2 * G * Math.max(params.hgt, 0.05));
          const inField = E.inField(ball.p[0], ball.p[1], [scene.fx, scene.fy]);
          if (bouncy && canClear && inField) {
            ball.p[2] = 0; ball.v[2] = vzPost;
            ev.hCrossed = false;                 // neuer Bogen ⇒ neue Fangchance
          } else endThrow(false);                // springt nicht mehr über H / im Aus
        }
      }
    }
    if (phase !== 'flight') return;
    trail.push([...ball.p]);

    /* ---- Sensor + Schätzung ---- */
    if (sensorMode === 'camera') {
      // Kamera-Sensormodell: eigener Frame-Takt, Sichtfeld, Aussetzer,
      // Fehlmessungen — die Kamera entscheidet je Substep selbst.
      if (camDirty) makeCam();
      const meas = cam.sample({
        t: simT,
        ball: { x: ball.p[0], y: ball.p[1], z: ball.p[2],
                vx: ball.v[0], vy: ball.v[1], vz: ball.v[2] },
        robot: { x: act.x, y: act.y, th: act.th },
        aim: panMode === 'track' ? aimPoint() : null,
        rand: Math.random
      });
      if (meas) integrate(meas);
    } else if (simT >= sensorNext) {
      sensorNext += 1 / params.hz;
      integrate({ t: simT, p: ball.p.map(c => c + gauss() * params.noise) });
    }

    if (drive === 'ack') E.ackermannStep(act, impact, ackOpts(), dt);
    else E.actuatorStep(act, impact, params.aMax, params.vMax, dt);
    /* Kamera-Blickrichtung des holonomen Fahrzeugs: das Chassis dreht sich in
     * die Fahrtrichtung (Kamera starr nach vorn montiert); im Stand bleibt die
     * letzte Ausrichtung erhalten. Bei 'ack' liefert ackermannStep das echte
     * Heading. Regel identisch zum Sweep-Harness. */
    if (drive !== 'ack') {
      const sp = Math.hypot(act.vx, act.vy);
      if (sp > 0.2) act.th = Math.atan2(act.vy, act.vx);
    }
  }

  /* Eine Messung in den Puffer: Residuen-Gate, Fit, Planung.
   * Spiegelt integrate() im Sweep-Harness (dort zusätzlich actNoise,
   * gateK/gateHits/minSamples als Parameter; hier feste Konstanten). */
  function integrate(meas) {
    // Residuen-Gate: Modellbruch ⇒ Puffer auf die Ausreißer zurücksetzen
    if (gateOn && est && samples.length >= 3) {
      const thr = GATE_K * sigmaOf(meas) + 0.03;
      residHits = E.residual(est, G, meas) > thr ? residHits + 1 : 0;
      if (residHits >= GATE_HITS) {
        samples = samples.slice(-(GATE_HITS - 1));   // nur die vorigen Ausreißer behalten
        residHits = 0; gateResets++;
      }
    }
    samples.push(meas);
    lastMeas = meas;
    measLog.push(meas);                              // nur fürs Rendering
    if (measLog.length > 400) measLog.shift();

    // Zustand fitten, dann erste erreichbare Fangchance wählen
    est = fitWeighted ? E.estimateState(samples, G, { weighted: true })
                      : E.estimateState(samples, G);
    impact = est ? E.planCatch(est, act, simT,
      { g: G, rest: params.rest, hgt: params.hgt, vMax: params.vMax, aMax: params.aMax, field: [scene.fx, scene.fy],
        travelTime: drive === 'ack' ? (x, y) => E.ackTravelTime(act, x, y, ackOpts()) : null }) : null;
  }

  /* ---------- Zeichnen (isometrische Projektion) ---------- */
  const C30 = Math.cos(Math.PI / 6), S30 = Math.sin(Math.PI / 6);
  function proj(x, y, z) {
    return [CX + (x - y) * C30 * SCALE, CY + (x + y) * S30 * SCALE - z * SCALE];
  }
  function line(a, b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  function circleAt(px, s, fill) {
    ctx.beginPath(); ctx.arc(px[0], px[1], s, 0, 2 * Math.PI);
    ctx.fillStyle = fill; ctx.fill();
  }
  function groundEllipse(x, y, rMeters, stroke, fill, z = 0) {
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = i / 40 * 2 * Math.PI;
      const p = proj(x + Math.cos(a) * rMeters, y + Math.sin(a) * rMeters, z);
      i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
    }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  /* Sichtkegel der Kamera: waagerechter Keil (hfov) auf Kamerahöhe —
   * die Entsprechung der Draufsicht in der isometrischen Projektion — plus
   * senkrechter Keil (vfov um die Neigung) in der Blickebene als Ersatz für
   * die fehlende Seitenansicht. Grün, solange der Ball im Sichtfeld ist. */
  function drawFov() {
    if (sensorMode !== 'camera' || !cam) return;
    const cp = cam.params();
    const pose = cam.pose({ x: act.x, y: act.y, th: act.th },
                          panMode === 'track' ? aimPoint() : null);
    const seen = S.inFov(pose, { x: ball.p[0], y: ball.p[1], z: ball.p[2] }, cp.hfov, cp.vfov);
    const col = seen ? '61,220,132' : '138,151,168';
    const R = Math.min(cp.maxRange, 12), o = proj(pose.pos[0], pose.pos[1], pose.pos[2]);
    const wedge = (n, dir, fill) => {
      ctx.beginPath(); ctx.moveTo(o[0], o[1]);
      for (let i = 0; i <= n; i++) {
        const d = dir((i / n - 0.5));
        const q = proj(pose.pos[0] + d[0] * R, pose.pos[1] + d[1] * R,
                       Math.max(0, pose.pos[2] + d[2] * R));
        ctx.lineTo(q[0], q[1]);
      }
      ctx.closePath();
      ctx.fillStyle = `rgba(${col},${fill})`; ctx.fill();
      ctx.strokeStyle = `rgba(${col},0.4)`; ctx.lineWidth = 1; ctx.stroke();
    };
    wedge(24, u => {                        // waagerecht: Azimut yaw ± hfov/2
      const a = pose.yaw + u * cp.hfov, ce = Math.cos(cp.tilt);
      return [ce * Math.cos(a), ce * Math.sin(a), Math.sin(cp.tilt)];
    }, 0.10);
    wedge(12, u => {                        // senkrecht: Elevation tilt ± vfov/2
      const e = cp.tilt + u * cp.vfov;
      return [Math.cos(e) * Math.cos(pose.yaw), Math.cos(e) * Math.sin(pose.yaw), Math.sin(e)];
    }, 0.06);
  }

  /* 1σ-Ellipse des x/y-Blocks der Messkovarianz (Eigenzerlegung der
   * symmetrischen 2×2-Matrix), gezeichnet auf Messhöhe. */
  function covEllipse(m) {
    const a = m.cov[0][0], b = m.cov[0][1], c = m.cov[1][1];
    const tr = a + c, disc = Math.sqrt(Math.max(0, tr * tr / 4 - (a * c - b * b)));
    const r1 = Math.sqrt(Math.max(0, tr / 2 + disc)), r2 = Math.sqrt(Math.max(0, tr / 2 - disc));
    const th = 0.5 * Math.atan2(2 * b, a - c), ct = Math.cos(th), st = Math.sin(th);
    ctx.beginPath();
    for (let i = 0; i <= 32; i++) {
      const u = i / 32 * 2 * Math.PI, ux = r1 * Math.cos(u), uy = r2 * Math.sin(u);
      const q = proj(m.p[0] + ux * ct - uy * st, m.p[1] + ux * st + uy * ct, Math.max(0, m.p[2]));
      i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(77,163,255,0.55)'; ctx.lineWidth = 1; ctx.stroke();
  }

  /* Messmarker: echte Messungen als kleine Punkte, Fehlmessungen als rotes ✕
   * (auch die vom Gate wieder verworfenen bleiben sichtbar). */
  function drawMeas() {
    for (const m of measLog) {
      const q = proj(m.p[0], m.p[1], Math.max(0, m.p[2]));
      if (m.kind === 'false') {
        ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 1.5;
        line([q[0] - 5, q[1] - 5], [q[0] + 5, q[1] + 5]);
        line([q[0] - 5, q[1] + 5], [q[0] + 5, q[1] - 5]);
      } else circleAt(q, 2, 'rgba(77,163,255,0.8)');
    }
    if (lastMeas && lastMeas.cov) covEllipse(lastMeas);
  }

  function draw() {
    ctx.clearRect(0, 0, cv.width, cv.height);

    // Bodengitter (symmetrisch von der Feldmitte aus) + Umriss
    const FX = scene.fx, FY = scene.fy;
    ctx.lineWidth = 1; ctx.strokeStyle = '#1d2430';
    for (let i = 0; i <= FX; i += 1.5) {
      line(proj(i, -FY, 0), proj(i, FY, 0));
      if (i) line(proj(-i, -FY, 0), proj(-i, FY, 0));
    }
    for (let j = 0; j <= FY; j += 1.5) {
      line(proj(-FX, j, 0), proj(FX, j, 0));
      if (j) line(proj(-FX, -j, 0), proj(FX, -j, 0));
    }
    ctx.strokeStyle = '#324055'; ctx.lineWidth = 1.5;
    line(proj(-FX, -FY, 0), proj(FX, -FY, 0));
    line(proj(FX, -FY, 0), proj(FX, FY, 0));
    line(proj(FX, FY, 0), proj(-FX, FY, 0));
    line(proj(-FX, FY, 0), proj(-FX, -FY, 0));

    // Basketball-Szene: Mittellinie, Mittelkreis (r = 1,8 m), Korbanlage
    if (scene.hoop) {
      const hp = scene.hoop;
      ctx.strokeStyle = '#324055'; ctx.lineWidth = 1.5;
      line(proj(0, -FY, 0), proj(0, FY, 0));
      groundEllipse(0, 0, 1.8, '#324055', null);
      const bx = hp.x + 0.375;                     // Brettebene 1,2 m vor der Grundlinie
      ctx.strokeStyle = '#8a97a8'; ctx.lineWidth = 2;
      line(proj(bx, 0, 0), proj(bx, 0, hp.boardZ[1]));                       // Stütze
      line(proj(bx, -hp.boardW, hp.boardZ[0]), proj(bx, -hp.boardW, hp.boardZ[1]));
      line(proj(bx, hp.boardW, hp.boardZ[0]), proj(bx, hp.boardW, hp.boardZ[1]));
      line(proj(bx, -hp.boardW, hp.boardZ[0]), proj(bx, hp.boardW, hp.boardZ[0]));
      line(proj(bx, -hp.boardW, hp.boardZ[1]), proj(bx, hp.boardW, hp.boardZ[1]));
      line(proj(bx, 0, hp.z), proj(hp.x, 0, hp.z));                          // Ausleger
      groundEllipse(hp.x, hp.y, hp.r, '#ff7a45', null, hp.z);                // Ring 3,05 m
      ctx.strokeStyle = 'rgba(255,122,69,0.3)'; ctx.lineWidth = 1;
      line(proj(hp.x, hp.y, hp.z), proj(hp.x, hp.y, 0));                     // Lot
    }

    drawFov();

    // Prognosepfad inkl. antizipierter Abpraller + gewählte Fangchance
    if (est && impact) {
      ctx.setLineDash([6, 5]); ctx.strokeStyle = '#5f6f85'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      {
        const tauNow = Math.max(0, simT - est.t0);
        let px = est.p0[0] + est.v0[0] * tauNow, py = est.p0[1] + est.v0[1] * tauNow;
        let pz = est.p0[2] + est.v0[2] * tauNow - 0.5 * G * tauNow * tauNow;
        let vx = est.v0[0], vy = est.v0[1], vz = est.v0[2] - G * tauNow;
        const span = Math.max(0.05, impact.tImpact - simT), dtd = span / 120;
        for (let i = 0; i <= 120; i++) {
          const q = proj(px, py, Math.max(0, pz));
          i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
          vz -= G * dtd; px += vx * dtd; py += vy * dtd; pz += vz * dtd;
          if (pz <= 0 && vz < 0) { pz = 0; vz = -params.rest * vz; }   // Abpraller
        }
      }
      ctx.stroke(); ctx.setLineDash([]);
      const ip = proj(impact.x, impact.y, params.hgt);
      if (params.hgt > 0) {                    // Lot von der Fangebene zum Boden
        ctx.strokeStyle = 'rgba(255,179,71,0.35)'; ctx.lineWidth = 1;
        line(ip, proj(impact.x, impact.y, 0));
      }
      ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 2;
      line([ip[0] - 7, ip[1] - 7], [ip[0] + 7, ip[1] + 7]);
      line([ip[0] - 7, ip[1] + 7], [ip[0] + 7, ip[1] - 7]);
    }

    // Flugspur
    if (trail.length > 1) {
      ctx.strokeStyle = 'rgba(219,228,240,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      trail.forEach((p, i) => { const q = proj(p[0], p[1], p[2]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
      ctx.stroke();
    }

    drawMeas();

    // Aktuator: Bodenscheibe + Fangkorb auf Höhe H
    const caught = phase === 'caught';
    const actCol = caught ? '#3ddc84' : '#4da3ff';
    groundEllipse(act.x, act.y, params.cRad, actCol,
      caught ? 'rgba(61,220,132,0.25)' : 'rgba(77,163,255,0.18)');
    if (params.hgt > 0) {
      groundEllipse(act.x, act.y, params.cRad,
        caught ? 'rgba(61,220,132,0.6)' : 'rgba(77,163,255,0.55)', null, params.hgt);
      ctx.strokeStyle = 'rgba(77,163,255,0.35)'; ctx.lineWidth = 1;
      line(proj(act.x, act.y, 0), proj(act.x, act.y, params.hgt));
    }
    circleAt(proj(act.x, act.y, 0), 7, actCol);
    if (drive === 'ack') {                     // Chassis + Fahrtrichtung
      const c = Math.cos(act.th), s = Math.sin(act.th);
      const hl = ACK.L / 2 + 0.06, hw = 0.09;
      ctx.strokeStyle = actCol; ctx.lineWidth = 1.5;
      ctx.beginPath();
      [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].forEach(([lx, ly], i) => {
        const p = proj(act.x + lx * c - ly * s, act.y + lx * s + ly * c, 0);
        i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
      });
      ctx.closePath(); ctx.stroke();
      line(proj(act.x, act.y, 0), proj(act.x + (hl + 0.12) * c, act.y + (hl + 0.12) * s, 0));
    }

    // Objekt: Schatten + Ball
    groundEllipse(ball.p[0], ball.p[1], 0.15, null, 'rgba(0,0,0,0.5)');
    const bp = proj(ball.p[0], ball.p[1], Math.max(0, ball.p[2]));
    circleAt(bp, 6, phase === 'missed' ? '#ff5d5d' : '#f2f6fb');

    /* ---- Telemetrie ---- */
    $('sModel').textContent = impact ? (impact.bounce > 0 ? 'Sprung #' + impact.bounce : 'Direkt') : '–';
    $('sGate').textContent = gateOn ? gateResets : '– (aus)';
    $('sSamples').textContent = samples.length;
    $('sVel').textContent = est ? Math.hypot(...est.v0).toFixed(2) + ' m/s' : '–';
    $('sImpact').textContent = impact ? `(${impact.x.toFixed(2)}, ${impact.y.toFixed(2)})` : '–';
    const tRem = impact ? Math.max(0, impact.tImpact - simT) : null;
    $('sTimpact').textContent = tRem !== null ? tRem.toFixed(2) + ' s' : '–';
    if (impact) {
      const tTravel = E.minTravelTime(Math.hypot(impact.x - act.x, impact.y - act.y), params.vMax, params.aMax);
      $('sTravel').textContent = tTravel.toFixed(2) + ' s';
    } else $('sTravel').textContent = '–';
    // Kamera-Betriebsprofil des LAUFENDEN Wurfs (cam.stats() wird je Wurf neu)
    if (sensorMode === 'camera' && cam) {
      const s = cam.stats();
      $('sVis').textContent = `${(s.visibility * 100).toFixed(0)} % (${s.inFov}/${s.framesDue})`;
      $('sRecall').textContent = s.inFov ? (s.recallObs * 100).toFixed(0) + ' %' : '–';
      $('sFalse').textContent = `${s.falseMeas} (${(s.falseRate * 100).toFixed(0)} %)`;
      $('sPreAcq').textContent = String(s.preAcq);
    }
    $('sScore').textContent = `${catches} / ${throws}`;

    const st = $('status');
    const unreach = impact && impact.feasible === false;
    if (phase === 'caught') { st.textContent = '✓ GEFANGEN'; st.className = 'caught'; }
    else if (phase === 'missed') { st.textContent = '✗ VERFEHLT'; st.className = 'missed'; }
    else if (unreach) { st.textContent = '⚠ KEINE CHANCE ERREICHBAR'; st.className = 'unreach'; }
    else if (paused) { st.textContent = '⏸ PAUSE'; st.className = 'flight'; }
    else if (ball.mode === 'hover') { st.textContent = '● OBJEKT SCHWEBT'; st.className = 'flight'; }
    else if (scenario === 'basket' && !ev.rimmed) { st.textContent = '● WURF AUF DEN KORB'; st.className = 'flight'; }
    else if (impact && impact.bounce > 0) { st.textContent = '● WARTE AUF ABPRALLER #' + impact.bounce; st.className = 'flight'; }
    else { st.textContent = '● OBJEKT IM FLUG'; st.className = 'flight'; }
  }

  /* ---------- Hauptschleife & UI ---------- */
  let lastFrame = performance.now();
  function frame(now) {
    const elapsed = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    if (!paused) {
      const SUB = 1 / 480;                     // feste Physik-Substeps
      let acc = elapsed;
      while (acc > 0) { physics(Math.min(SUB, acc)); acc -= SUB; }
      if (resultAt && now - resultAt > 2200) newThrow();   // Auto-Restart
    }
    draw();
    requestAnimationFrame(frame);
  }

  $('btnNew').addEventListener('click', newThrow);
  $('btnPause').addEventListener('click', () => {
    paused = !paused;
    $('btnPause').textContent = paused ? 'Weiter' : 'Pause';
  });
  document.querySelectorAll('.scenBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.scenBtn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      scenario = btn.dataset.sc;
      scene = sceneFor(scenario); SCALE = scene.scale; CY = cv.height / 2 + scene.cyOff;
      catches = 0; throws = 0;          // Quote pro Konfiguration
      newThrow();
    });
  });
  $('btnDrive').addEventListener('click', () => {
    drive = drive === 'holo' ? 'ack' : 'holo';
    $('btnDrive').textContent = drive === 'holo' ? 'Holonom' : 'Ackermann';
    catches = 0; throws = 0;
    newThrow();
  });
  $('btnGate').addEventListener('click', () => {
    gateOn = !gateOn;
    $('btnGate').textContent = gateOn ? 'AN' : 'AUS';
    $('btnGate').className = gateOn ? 'on' : 'off';
    catches = 0; throws = 0;
    newThrow();
  });
  $('btnSensor').addEventListener('click', () => {
    sensorMode = sensorMode === 'iso' ? 'camera' : 'iso';
    $('btnSensor').textContent = sensorMode === 'iso' ? 'iso' : 'Kamera';
    $('btnSensor').className = sensorMode === 'iso' ? 'secondary' : 'secondary cam';
    $('camBox').hidden = sensorMode !== 'camera';
    $('camStats').hidden = sensorMode !== 'camera';
    $('rowNoise').hidden = sensorMode === 'camera';   // σ gilt nur im Modus iso
    camDirty = true;
    catches = 0; throws = 0;
    newThrow();
  });
  $('btnPan').addEventListener('click', () => {
    panMode = panMode === 'fixed' ? 'track' : 'fixed';
    $('btnPan').textContent = panMode === 'fixed' ? 'starr' : 'Ball';
    camDirty = true;
    catches = 0; throws = 0;
    newThrow();
  });
  $('btnFit').addEventListener('click', () => {
    fitWeighted = !fitWeighted;
    $('btnFit').textContent = fitWeighted ? 'gewichtet' : 'plain';
    catches = 0; throws = 0;
    newThrow();
  });

  newThrow();
  requestAnimationFrame(frame);
})();
