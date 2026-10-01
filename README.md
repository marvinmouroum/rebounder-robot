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
