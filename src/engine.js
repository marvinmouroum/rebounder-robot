/* =====================================================================
 *  catch-engine — reiner mathematischer Kern (keine Grafik, kein DOM)
 * =====================================================================
 * Modell: Objekt ohne Antrieb im homogenen Schwerefeld g (z nach oben):
 *     p(t) = p0 + v0·t + ½·a·t²   mit  a = (0, 0, −g)
 *
 * Läuft im Browser (window.CatchEngine) und in Node (module.exports).
 * Vollständige Herleitung: .okf/engine/ (OKF-Bundle).
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CatchEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* (0a) Lineares Gleichungssystem A·x = b (n×n) per Gauß mit Teilpivot.
   *      Eingaben werden nicht verändert; null bei singulärer/schlecht
   *      konditionierter Matrix (Pivot ≤ 1e-12 · größtes Matrixelement). */
  function solveLinear(A, b) {
    const n = b.length;
    if (!A || A.length !== n) return null;
    const M = new Array(n);
    let scale = 0;
    for (let i = 0; i < n; i++) {
      if (!A[i] || A[i].length !== n) return null;
      const row = new Array(n + 1);
      for (let j = 0; j < n; j++) {
        const v = A[i][j];
        if (!isFinite(v)) return null;
        row[j] = v;
        const a = Math.abs(v);
        if (a > scale) scale = a;
      }
      if (!isFinite(b[i])) return null;
      row[n] = b[i];
      M[i] = row;
    }
    const eps = 1e-12 * (scale > 0 ? scale : 1);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++)
        if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) <= eps) return null;
      if (piv !== c) { const tmp = M[piv]; M[piv] = M[c]; M[c] = tmp; }
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        if (f === 0) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
      if (!isFinite(x[r])) return null;
    }
    return x;
  }

  /* (0b) Inverse einer 3×3-Matrix (verschachteltes Array) per Adjunkte.
   *      null bei Singularität (|det| ≤ 1e-12 · max|mᵢⱼ|³) oder ungültiger
   *      Form — Aufrufer entscheiden dann über ihren Fallback. */
  function invert3(m) {
    if (!m || m.length !== 3) return null;
    for (let i = 0; i < 3; i++) {
      if (!m[i] || m[i].length !== 3) return null;
      for (let j = 0; j < 3; j++) if (!isFinite(m[i][j])) return null;
    }
    const [[a, b, c], [d, e, f], [h, k, l]] = m;
    const A =  (e * l - f * k), B = -(d * l - f * h), C =  (d * k - e * h);
    const det = a * A + b * B + c * C;
    let s = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) s = Math.max(s, Math.abs(m[i][j]));
    if (!isFinite(det) || Math.abs(det) <= 1e-12 * s * s * s) return null;
    return [
      [A / det, -(b * l - c * k) / det,  (b * f - c * e) / det],
      [B / det,  (a * l - c * h) / det, -(a * f - c * d) / det],
      [C / det, -(a * k - b * h) / det,  (a * e - b * d) / det]
    ];
  }

  /* Position einer Messung: bevorzugt p = [x, y, z], alternativ {x, y, z}. */
  function samplePos(s) {
    return s.p ? [s.p[0], s.p[1], s.p[2]] : [s.x, s.y, s.z];
  }

  /* (1w) Gewichteter Fit (GLS): minimiert Σ rᵢᵀ·Wᵢ·rᵢ mit Wᵢ = covᵢ⁻¹
   *      (Messkovarianz im Weltsystem). Gleiches Messmodell wie (1) —
   *      qᵢ = pᵢ − ½·a·tᵢ² = p0 + v0·tᵢ mit tᵢ relativ zu t0 = samples[0].t.
   *      Hᵢ = [I₃, tᵢ·I₃] ⇒ Normalgleichungen (Σ Hᵢᵀ Wᵢ Hᵢ)·θ = Σ Hᵢᵀ Wᵢ qᵢ
   *      mit θ = [p0, v0] (6×6). Ohne/mit ungültiger cov gilt Wᵢ = I₃.
   *      null ⇒ Normalmatrix singulär, Aufrufer fällt auf (1) zurück. */
  function estimateStateWeighted(samples, g) {
    const t0 = samples[0].t;
    const A = [], b = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 6; i++) A.push([0, 0, 0, 0, 0, 0]);
    for (const s of samples) {
      const t = s.t - t0;
      const q = samplePos(s);
      q[2] += 0.5 * g * t * t;
      const W = (s.cov ? invert3(s.cov) : null) || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      for (let r = 0; r < 3; r++) {
        let wq = 0;
        for (let c = 0; c < 3; c++) {
          const w = W[r][c];
          A[r][c] += w; A[r][c + 3] += t * w;
          A[r + 3][c] += t * w; A[r + 3][c + 3] += t * t * w;
          wq += w * q[c];
        }
        b[r] += wq; b[r + 3] += t * wq;
      }
    }
    const th = solveLinear(A, b);
    if (!th) return null;
    return { t0, p0: [th[0], th[1], th[2]], v0: [th[3], th[4], th[5]] };
  }

  /* Messungen auf {t, p}-Form bringen — gibt das Original zurück, wenn
   * ohnehin schon alle Samples ein p tragen (kein Kopieren, kein Drift). */
  function withP(samples) {
    for (const s of samples) if (!s.p) return samples.map(
      x => x.p ? x : { t: x.t, p: [x.x, x.y, x.z] });
    return samples;
  }

  /* (1) Least-Squares-Fit über n ≥ 2 verrauschte Messungen (tᵢ, pᵢ).
   *     Da g bekannt ist, wird der quadratische Anteil abgezogen:
   *         qᵢ := pᵢ − ½·a·tᵢ²  ⇒  qᵢ = p0 + v0·tᵢ   (linear!)
   *     Pro Achse gewöhnliche lineare Regression ⇒ p0, v0.
   *     Mit g = 0 ist dasselbe ein Konstantgeschwindigkeits-Fit.
   *     opts.weighted === true ⇒ gewichtete Variante (1w); scheitert die,
   *     läuft unverändert der ungewichtete Pfad. Ohne opts ist der
   *     Codepfad bit-identisch zur Fassung vor der Erweiterung. */
  function estimateState(samples, g, opts) {
    const n = samples.length;
    if (n < 2) return null;
    if (opts && opts.weighted === true) {
      const w = estimateStateWeighted(samples, g);
      if (w) return w;
      samples = withP(samples);           // Fallback: ungewichteter Fit
    }
    const t0 = samples[0].t;
    let St = 0, Stt = 0;
    const Sq = [0, 0, 0], Stq = [0, 0, 0];
    for (const s of samples) {
      const t = s.t - t0;
      St += t; Stt += t * t;
      const q = [s.p[0], s.p[1], s.p[2] + 0.5 * g * t * t];
      for (let k = 0; k < 3; k++) { Sq[k] += q[k]; Stq[k] += t * q[k]; }
    }
    const det = n * Stt - St * St;
    if (Math.abs(det) < 1e-12) return null;
    const p0 = [0, 0, 0], v0 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      v0[k] = (n * Stq[k] - St * Sq[k]) / det;
      p0[k] = (Sq[k] - v0[k] * St) / n;
    }
    return { t0, p0, v0 };
  }

  /* (2) Durchgang durch die Fangebene z = zCatch (Aktuatorhöhe H):
   *         τ = (vz + √(vz² + 2·g·(z0 − zCatch))) / g   (positive Wurzel) */
  function predictImpact(state, g, zCatch) {
    const z0 = state.p0[2], vz = state.v0[2];
    const disc = vz * vz + 2 * g * (z0 - zCatch);
    if (disc < 0) return null;
    const tau = (vz + Math.sqrt(disc)) / g;
    return {
      x: state.p0[0] + state.v0[0] * tau,
      y: state.p0[1] + state.v0[1] * tau,
      tImpact: state.t0 + tau
    };
  }

  /* (3) Zeitoptimales 1D-Bang-Bang-Profil über Distanz d (Start/Ende in Ruhe):
   *         dreieckig:    t = 2·√(d/aMax)          falls d ≤ vMax²/aMax
   *         trapezförmig: t = vMax/aMax + d/vMax    sonst */
  function minTravelTime(d, vMax, aMax) {
    if (d <= 0) return 0;
    return d <= vMax * vMax / aMax ? 2 * Math.sqrt(d / aMax)
                                   : vMax / aMax + d / vMax;
  }

  /* (4) Regler in der Ebene: Sollgeschwindigkeit Richtung Ziel mit
   *     Bremsweg-Begrenzung |v_des| = min(vMax, √(2·aMax·d)),
   *     Beschleunigung auf aMax geklemmt, Geschwindigkeit auf vMax.
   *     Austauschstelle für einen eigenen Path-Planner. */
  function actuatorStep(act, target, aMax, vMax, dt) {
    let vdx = 0, vdy = 0;
    if (target) {
      const dx = target.x - act.x, dy = target.y - act.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-6) {
        const vAllow = Math.min(vMax, Math.sqrt(2 * aMax * d));
        vdx = dx / d * vAllow; vdy = dy / d * vAllow;
      }
    }
    let ax = (vdx - act.vx) / dt, ay = (vdy - act.vy) / dt;
    const a = Math.hypot(ax, ay);
    if (a > aMax) { ax *= aMax / a; ay *= aMax / a; }
    act.vx += ax * dt; act.vy += ay * dt;
    const v = Math.hypot(act.vx, act.vy);
    if (v > vMax) { act.vx *= vMax / v; act.vy *= vMax / v; }
    act.x += act.vx * dt; act.y += act.vy * dt;
  }

  function wrapAngle(a) {
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  /* (4b) Ackermann-Regler (kinematisches Fahrradmodell, nicht-holonom):
   *         ẋ = v·cosθ,  ẏ = v·sinθ,  θ̇ = v/L·tanδ
   *     Pure Pursuit auf den Zielpunkt (Krümmung κ = 2·sinα/ld), Rückwärts-
   *     fahren erlaubt (Ziel hinter dem Fahrzeug ⇒ Richtung umkehren).
   *     Grenzen: |δ| ≤ steerMax mit Lenkrate steerRate, |dv/dt| ≤ aMax,
   *     |v| ≤ vMax, Traktionskreis in Kurven (v²·κ ≤ aMax).
   *     car: { x, y, th, v, delta }  ·  o: { aMax, vMax, L, steerMax, steerRate } */
  function ackermannStep(car, target, o, dt) {
    let vDes = 0, deltaDes = 0;
    if (target) {
      const dx = target.x - car.x, dy = target.y - car.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-4) {
        let dir = 1, al = wrapAngle(Math.atan2(dy, dx) - car.th);
        if (Math.abs(al) > Math.PI / 2) { dir = -1; al = wrapAngle(al - Math.PI); }
        deltaDes = Math.atan2(2 * o.L * Math.sin(al), Math.max(d, o.L)) * dir;
        deltaDes = Math.max(-o.steerMax, Math.min(o.steerMax, deltaDes));
        let v = Math.min(o.vMax, Math.sqrt(2 * o.aMax * d));   // Bremsweg-Grenze
        v *= Math.max(0.25, Math.cos(al));                     // Querfehler ⇒ langsamer
        const kappa = Math.abs(Math.tan(deltaDes)) / o.L;      // Traktionskreis
        if (kappa > 1e-6) v = Math.min(v, Math.sqrt(o.aMax / kappa));
        vDes = dir * v;
      }
    }
    const dd = deltaDes - car.delta;
    car.delta += Math.max(-o.steerRate * dt, Math.min(o.steerRate * dt, dd));
    const dv = vDes - car.v;
    car.v += Math.max(-o.aMax * dt, Math.min(o.aMax * dt, dv));
    car.x += car.v * Math.cos(car.th) * dt;
    car.y += car.v * Math.sin(car.th) * dt;
    car.th = wrapAngle(car.th + car.v / o.L * Math.tan(car.delta) * dt);
  }

  /* (4c) Fahrzeitschätzung für Ackermann: 1D-Bang-Bang plus Dreh-Malus —
   *     Restwinkel (vorwärts oder rückwärts, was näher liegt) geteilt durch
   *     die Referenz-Gierrate ω = √(aMax·tan(steerMax)/L) (Vollausschlag am
   *     Traktionslimit). Konservativ genug für die Chancen-Auswahl. */
  function ackTravelTime(car, x, y, o) {
    const dx = x - car.x, dy = y - car.y, d = Math.hypot(dx, dy);
    let al = Math.abs(wrapAngle(Math.atan2(dy, dx) - car.th));
    if (al > Math.PI / 2) al = Math.PI - al;
    const om = Math.sqrt(o.aMax * Math.tan(o.steerMax) / o.L);
    return minTravelTime(d, o.vMax, o.aMax) + al / om;
  }

  /* (5) Residuum einer Messung gegen die Modellprognose — Grundlage des
   *     Residuen-Gates: mehrfach in Folge > k·σ ⇒ Modellbruch (Stoß,
   *     Einfrieren, Aufprall) ⇒ Messpuffer zurücksetzen, neu anlernen. */
  function residual(state, g, sample) {
    const tau = sample.t - state.t0;
    const px = state.p0[0] + state.v0[0] * tau;
    const py = state.p0[1] + state.v0[1] * tau;
    const pz = state.p0[2] + state.v0[2] * tau - 0.5 * g * tau * tau;
    return Math.hypot(sample.p[0] - px, sample.p[1] - py, sample.p[2] - pz);
  }

  /* (5b) Residuum in EINHEITEN DER MESSUNSICHERHEIT (Mahalanobis-Distanz):
   *          dM = √(rᵀ·cov⁻¹·r),   r = p_meas − p_pred(t_meas)
   *     Bei anisotroper Messkovarianz (Kamera: Zentimeter quer zur Sichtlinie,
   *     Dezimeter bis Meter in der Tiefe) misst das die Abweichung richtungs-
   *     gerecht: `gateK = 5` heißt dann 5σ in JEDER Richtung, während die
   *     euklidische Schwelle aus `residual` quer viel zu lax und in der Tiefe
   *     zu streng ist. Für r ~ N(0, cov) ist dM² ~ χ²₃ (Mittel 3).
   *     Fallback (keine/ungültige/singuläre cov, nicht positiv definit):
   *     euklidische Distanz geteilt durch σ — `sigma` (4. Argument), sonst
   *     `sample.sigma`, sonst 1 (⇒ dann identisch zu `residual`). */
  function residualMaha(state, g, sample, sigma) {
    const tau = sample.t - state.t0;
    const p = samplePos(sample);
    const r = [
      p[0] - (state.p0[0] + state.v0[0] * tau),
      p[1] - (state.p0[1] + state.v0[1] * tau),
      p[2] - (state.p0[2] + state.v0[2] * tau - 0.5 * g * tau * tau)
    ];
    const W = sample.cov ? invert3(sample.cov) : null;
    if (W) {
      let s = 0;
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 3; j++) s += r[i] * W[i][j] * r[j];
      if (isFinite(s) && s >= 0) return Math.sqrt(s);
    }
    const sd = sigma > 0 ? sigma : (sample.sigma > 0 ? sample.sigma : 1);
    return Math.hypot(r[0], r[1], r[2]) / sd;
  }

  /* Feldtest: o.field ist die Halbbreite — Zahl (quadratisch) oder
   * [fx, fy] (rechteckig, Halbausdehnung je Achse). null = unbegrenzt. */
  function inField(x, y, f) {
    if (f == null) return true;
    const fx = Array.isArray(f) ? f[0] : f, fy = Array.isArray(f) ? f[1] : f;
    return Math.abs(x) <= fx && Math.abs(y) <= fy;
  }

  /* (6) Abpraller-Antizipation: Kaskade der Fangchancen aus dem
   *     geschätzten Zustand. Chance 0 = H-Durchgang des aktuellen Bogens,
   *     danach pro Bodenaufprall ein Abpraller mit vz' = −e·vz⁻
   *     (Restitution e als bekannt angenommen). Gewählt wird die ERSTE
   *     Chance, die der Aktuator rechtzeitig erreicht:
   *         minTravelTime(d) ≤ t_Chance − now.
   *     Chancen außerhalb des Feldes (o.field, s. inField) werden verworfen;
   *     ist keine erreichbar, wird die späteste als Notziel zurückgegeben. */
  function planCatch(state, act, now, o) {
    const g = o.g, e = o.rest, H = o.hgt;
    const arcs = [];
    let tArc = state.t0, p = [...state.p0], v = [...state.v0];
    for (let k = 0; k < 6; k++) {
      const discH = v[2] * v[2] + 2 * g * (p[2] - H);
      if (discH >= 0) {
        const tauH = (v[2] + Math.sqrt(discH)) / g;     // absteigender H-Durchgang
        const cx = p[0] + v[0] * tauH, cy = p[1] + v[1] * tauH;
        if (inField(cx, cy, o.field))
          arcs.push({ x: cx, y: cy, t: tArc + tauH, bounce: k });
      } else if (k > 0) break;                          // Bogen erreicht H nicht mehr
      const disc0 = v[2] * v[2] + 2 * g * p[2];
      if (disc0 < 0) break;
      const tau0 = (v[2] + Math.sqrt(disc0)) / g;       // Bodenaufprall dieses Bogens
      p = [p[0] + v[0] * tau0, p[1] + v[1] * tau0, 0];
      v = [v[0], v[1], e * (g * tau0 - v[2])];          // Abpraller: vz' = −e·vz⁻
      tArc += tau0;
      if (!inField(p[0], p[1], o.field)) break;
      if (v[2] < Math.sqrt(2 * g * Math.max(H, 0.05))) break; // springt nicht mehr über H
    }
    if (!arcs.length) return null;
    // Fahrzeit: Standard = holonomes Bang-Bang; o.travelTime(x, y) erlaubt
    // fahrzeugspezifische Schätzer (z. B. ackTravelTime für Ackermann).
    const tt = o.travelTime
      ? a => o.travelTime(a.x, a.y)
      : a => minTravelTime(Math.hypot(a.x - act.x, a.y - act.y), o.vMax, o.aMax);
    for (const a of arcs)
      if (tt(a) <= a.t - now)
        return { x: a.x, y: a.y, tImpact: a.t, bounce: a.bounce, feasible: true };
    const a = arcs[arcs.length - 1];
    return { x: a.x, y: a.y, tImpact: a.t, bounce: a.bounce, feasible: false };
  }

  return { estimateState, predictImpact, minTravelTime, actuatorStep,
           ackermannStep, ackTravelTime, wrapAngle, residual, residualMaha,
           planCatch, inField, invert3, solveLinear };
});
