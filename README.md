<div align="center">

# 🏀 rebounder

**An autonomous robot that catches basketballs — built from scratch, hardware to AI**

Real-time ball detection & trajectory estimation from noisy camera data →
an RC car that intercepts and collects the ball.

*Why chase your own rebounds?*

</div>

---

## What it is

A fully autonomous rebound assistant: watch the shot, predict where the ball
lands, drive there, catch it, bring it back. No cloud, no external tracking —
everything runs on-board.

## High-level architecture

```
camera ──► ball detection ──► trajectory estimation ──► catch-point prediction
                                                              │
              ESP32 radio bridge ◄── drive commands ◄────────┘
                       │
                autonomous RC car 🏎️
```

- **Perception** — real-time ball detection in noisy frames
- **Prediction** — trajectory estimation (least-squares fitting) from partial flight data
- **Strategy** — Monte-Carlo sweeps over catch-rate to pick intercept points,
  not just the theoretical landing spot
- **Control** — RC car + ESP32 radio bridge
- **Companion app** — Flutter tracking app for stats and debugging
- **Hardware** — custom mounting parts constructed in **FreeCAD with LLM-assisted
  sketches** (AI-generated geometry → parametric CAD → 3D print)


## Repo contents (public preview)

| Path | What it is |
|---|---|
| `src/engine.js` | Pure math engine (no DOM, runs in Node & browser): least-squares state estimation, crossing prediction, residual gate (maneuver detection), catch planning with bounce anticipation, a/v-limited actuator controller |
| `src/sensor.js` | Camera sensor model: FOV with tilt/pan, anisotropic noise, dropouts, false measurements, detection latency |
| `src/sim.js` | Simulation: ballistics, scenarios (normal/bounce/spring/float), sensor emulation, canvas rendering |
| `tools/sweep-basket.js` | Headless Monte-Carlo sweep: catch-rate over parameter configurations |
| `tools/golden-dart-*.js` | Golden-shot analysis tools: weighted fit, residual gate, catch planner, measurement covariance, ack travel time |
| `test/` | Node tests (`node --test`, zero dependencies), deterministic seeded RNG |
| `firmware/esp32-bridge/` | ESP32 radio bridge (Arduino): WiFi-AP + UDP → 2× 50 Hz RC-PWM, arming + failsafe |
| `hardware/halter-60/` | Parametric FreeCAD construction of a mounting part incl. technical drawing generator — constructed with LLM-assisted sketches |

Not public (yet): detector training, labeled datasets, app internals, build logs.

## Run it

```bash
# simulation in the browser
python3 -m http.server 8642   # open http://127.0.0.1:8642

# tests (Node >= 18, no dependencies)
node --test test/
```

## Status

Ongoing private build — this page is the public preview. Detailed build logs,
the perception stack, and the simulation engine stay private while the project
matures. Photos and videos as they become shareable.

## Why it's interesting

It's a small, honest version of a hard problem: perception → prediction →
autonomous action in the physical world, on a budget, fully self-built —
including the AI-assisted construction of its own hardware.

---
*Built by [Marvin Mouroum](https://github.com/marvinmouroum) — mechanical
engineer turned AI engineer.*
