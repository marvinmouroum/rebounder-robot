#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bohrschablone Adapterplatte (RB3-HW-003 Rev B) fuer den KF10 MAX — Maßstab 1:1 zum Auflegen auf ein Brett.

Das Lochbild der Draufsicht ist seit dem Aufmass vom 2026-09-10 komplett (① 73, ② 84, ③ 252):
  - vier Stiftloecher an den Karosserie-Stiften (vorn ±36,5 | +126; hinten ±42 | −126),
  - vier M4-Durchgaenge fuer den Halter (±78 | ±46, Lochbild 156 × 92 wie halter60_freecad.py).
Koordinaten wie in den Skripten: X quer (+X = Fahrzeug-links = Kameraseite), Y nach vorn,
Ursprung = Mitte des Stift-Bildes. Auf dem Blatt: vorn oben, Fahrzeug-links links.

  bohrschablone-adapter-1.svg   Blatt 1: Schablone 1:1 (A4 hoch, Druck 100 %, Kontrollstrecken 100 / 200 mm)
  bohrschablone-adapter-2.svg   Blatt 2: Masse, Koordinatentabelle, Bohranleitung, offene Hoehenmasse (A4 quer)

Aufruf:  python3 bohrschablone_adapter.py                       (nur Standardbibliothek)
PDF:     rsvg-convert -f pdf -o bohrschablone-adapter.pdf bohrschablone-adapter-1.svg bohrschablone-adapter-2.svg
"""
from __future__ import annotations
import math, pathlib
from html import escape as esc

HERE = pathlib.Path(__file__).resolve().parent
DATE = "2026-09-10"
BLUE, GREEN, GREY, RED = "#1d4ed8", "#15803d", "#6b7280", "#b91c1c"

# ------------------------------------------------------------------ Geometrie (mm) — gemessen bzw. aus den Skripten
FRONT_SPAN, REAR_SPAN, PITCH = 73.0, 84.0, 252.0        # ① ② ③ (Marvin 2026-09-07 / 2026-09-10)
POST_D_NOMINAL = 6.0                                    # nur Zeichnungs-Ø; wirklich bohren: ④ + 0,5
SLOT = 4.0                                              # Langloch-Zugabe laengs (ADAPTER["slot"])
BASE_X, BASE_Y = 170.0, 104.0                           # Halter-Grundflaeche (P["base_x"], BASE_Y)
MOUNT_X, HOLE_Y, HOLE_D = 78.0, 6.0, 4.5                # M4-Langloecher im Halter: x = ±78, y = ±(52 − 6) = ±46
BAR_MARGIN, BAR, SPINE_W = 14.0, 24.0, 44.0             # Querstege ueber Stiftmitte hinaus, Stegtiefe, Laengsholm
PLATE_T = 4.0

HALF = PITCH / 2
POSTS = [("Stift vorn links", FRONT_SPAN / 2, HALF), ("Stift vorn rechts", -FRONT_SPAN / 2, HALF),
         ("Stift hinten links", REAR_SPAN / 2, -HALF), ("Stift hinten rechts", -REAR_SPAN / 2, -HALF)]
MY = BASE_Y / 2 - HOLE_Y
M4 = [("M4 vorn links", MOUNT_X, MY), ("M4 vorn rechts", -MOUNT_X, MY),
      ("M4 hinten links", MOUNT_X, -MY), ("M4 hinten rechts", -MOUNT_X, -MY)]
RECT_X, RECT_Y = BASE_X, PITCH + BAR                    # Rechteck-Variante des Bretts (170 × 276)
DIAG = math.hypot((FRONT_SPAN + REAR_SPAN) / 2, PITCH)  # Diagonale des Stiftbilds (Kontrolle)


class Sheet:
    def __init__(self, W: float, H: float):
        self.W, self.H = W, H
        self.o: list[str] = []

    def E(self, s): self.o.append(s)

    def line(self, a, b, cls="v", color=None, dash=None, w=None):
        st = [f"stroke:{color}" if color else "", f"stroke-dasharray:{dash}" if dash else "", f"stroke-width:{w}" if w else ""]
        st = [x for x in st if x]
        style = f' style="{";".join(st)}"' if st else ""
        self.E(f'<line class="{cls}" x1="{a[0]:.3f}" y1="{a[1]:.3f}" x2="{b[0]:.3f}" y2="{b[1]:.3f}"{style}/>')

    def rect(self, x0, y0, x1, y1, cls="v", rx=0.0, color=None, fill=None, dash=None):
        x, y = min(x0, x1), min(y0, y1)
        st = [f"stroke:{color}" if color else "", f"fill:{fill}" if fill else "", f"stroke-dasharray:{dash}" if dash else ""]
        st = [s for s in st if s]
        style = f' style="{";".join(st)}"' if st else ""
        self.E(f'<rect class="{cls}" x="{x:.3f}" y="{y:.3f}" width="{abs(x1-x0):.3f}" height="{abs(y1-y0):.3f}" rx="{rx}"{style}/>')

    def circle(self, c, r, cls="v", color=None, fill=None, dash=None):
        st = [f"stroke:{color}" if color else "", f"fill:{fill}" if fill else "", f"stroke-dasharray:{dash}" if dash else ""]
        st = [s for s in st if s]
        style = f' style="{";".join(st)}"' if st else ""
        self.E(f'<circle class="{cls}" cx="{c[0]:.3f}" cy="{c[1]:.3f}" r="{r:.3f}"{style}/>')

    def poly(self, pts, cls="v", fill=None, closed=True):
        d = " ".join(f"{x:.3f},{y:.3f}" for x, y in pts)
        style = f' style="fill:{fill}"' if fill else ""
        tag = "polygon" if closed else "polyline"
        self.E(f'<{tag} class="{cls}" points="{d}"{style}/>')

    def text(self, x, y, s, size=2.8, anchor="middle", color="#111", weight=None, rot=0.0, family=None):
        st = f"font-size:{size}px;fill:{color}"
        if weight: st += f";font-weight:{weight}"
        if family: st += f";font-family:{family}"
        tr = f' transform="rotate({rot:.1f} {x:.3f} {y:.3f})"' if rot else ""
        self.E(f'<text x="{x:.3f}" y="{y:.3f}" text-anchor="{anchor}" style="{st}"{tr}>{esc(s)}</text>')

    def arrow(self, tip, d, color, L=2.4, hw=0.7):
        n = math.hypot(*d); dx, dy = d[0] / n, d[1] / n
        bx, by = tip[0] - dx * L, tip[1] - dy * L
        self.poly([tip, (bx - dy * hw, by + dx * hw), (bx + dy * hw, by - dx * hw)], cls="ar", fill=color)

    def badge(self, c, num, color, r=2.3):
        self.circle(c, r, cls="bd", color=color, fill="#fff")
        self.text(c[0], c[1] + 0.95, str(num), size=2.6 if len(str(num)) < 3 else 2.1, color=color, weight="bold")

    def hdim(self, x1, x2, y, label, color, feats=(), above=True, size=2.8, weight="bold"):
        for fx, fy in feats:
            self.line((fx, fy), (fx, y + (1.5 if y > fy else -1.5)), cls="e", color=color)
        x1, x2 = sorted((x1, x2))
        self.line((x1, y), (x2, y), cls="d", color=color)
        self.arrow((x1, y), (-1, 0), color); self.arrow((x2, y), (1, 0), color)
        self.text((x1 + x2) / 2, y - 1.4 if above else y + 3.6, label, size=size, color=color, weight=weight)

    def vdim(self, y1, y2, x, label, color, feats=(), side="right", size=2.8, weight="bold"):
        for fx, fy in feats:
            self.line((fx, fy), (x + (1.5 if x > fx else -1.5), fy), cls="e", color=color)
        y1, y2 = sorted((y1, y2))
        self.line((x, y1), (x, y2), cls="d", color=color)
        self.arrow((x, y1), (0, -1), color); self.arrow((x, y2), (0, 1), color)
        ym = (y1 + y2) / 2
        if side == "right":
            self.text(x + 1.4, ym, label, size=size, color=color, weight=weight, rot=-90)
        else:
            self.text(x - 1.4, ym, label, size=size, color=color, weight=weight, rot=-90)

    def svg(self) -> str:
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.W}mm" height="{self.H}mm" viewBox="0 0 {self.W} {self.H}">\n'
                '<style>\n'
                'text{font-family:Helvetica,Arial,"Liberation Sans",sans-serif;fill:#111}\n'
                '.fr{fill:#fff;stroke:#222;stroke-width:0.4}\n'
                '.v{fill:none;stroke:#111;stroke-width:0.35;stroke-linejoin:round}\n'
                '.o{fill:none;stroke:#111;stroke-width:0.5;stroke-linejoin:round}\n'
                '.g{fill:none;stroke:#8a8a8a;stroke-width:0.3;stroke-dasharray:2 1.2}\n'
                '.c{fill:none;stroke:#555;stroke-width:0.22;stroke-dasharray:6 1.2 1.2 1.2}\n'
                '.x{fill:none;stroke:#111;stroke-width:0.22}\n'
                '.e{fill:none;stroke-width:0.18}\n'
                '.d{fill:none;stroke-width:0.32}\n'
                '.ar{stroke:none}\n'
                '.bd{stroke-width:0.4}\n'
                '.tb{fill:none;stroke:#333;stroke-width:0.25}\n'
                '.th{fill:#e9eef7;stroke:#333;stroke-width:0.25}\n'
                '.ts{fill:#f4f4f4;stroke:#333;stroke-width:0.25}\n'
                '.k{fill:none;stroke:#111;stroke-width:0.5}\n'
                '</style>\n')
        return head + "\n".join(self.o) + "\n</svg>\n"


def outline_points(scale=1.0):
    """I-Form der Adapterplatte (wie make_adapter: Halterfeld + Laengsholme + Querstege) im Uhrzeigersinn,
    Fahrzeugkoordinaten (x, y)."""
    hx, hy = BASE_X / 2, BASE_Y / 2
    fw, rw = FRONT_SPAN / 2 + BAR_MARGIN, REAR_SPAN / 2 + BAR_MARGIN
    sw = SPINE_W / 2
    yf0, yf1 = HALF - BAR / 2, HALF + BAR / 2
    yr0, yr1 = -HALF + BAR / 2, -HALF - BAR / 2
    pts = [(-fw, yf1), (fw, yf1), (fw, yf0), (sw, yf0), (sw, hy), (hx, hy), (hx, -hy), (sw, -hy), (sw, yr0), (rw, yr0),
           (rw, yr1), (-rw, yr1), (-rw, yr0), (-sw, yr0), (-sw, -hy), (-hx, -hy), (-hx, hy), (-sw, hy), (-sw, yf0), (-fw, yf0)]
    return [(x * scale, y * scale) for x, y in pts]


# ================================================================== Blatt 1: Schablone 1:1
def sheet1() -> Sheet:
    W, H = 210.0, 297.0
    s = Sheet(W, H)
    CX, CY = W / 2, H / 2
    def T(x, y): return (CX - x, CY - y)                       # Fahrzeug (x quer, +X links; y vorn) -> Blatt
    s.rect(0, 0, W, H, cls="fr", color="#fff")

    # Plattenumriss (I-Form, wie das FreeCAD-Skript) und Rechteck-Variante
    s.poly([T(x, y) for x, y in outline_points()], cls="o")
    s.rect(*T(RECT_X / 2, RECT_Y / 2), *T(-RECT_X / 2, -RECT_Y / 2), cls="g", rx=3)
    # Halterfeld (Basis 170 × 104) leicht markiert
    s.rect(*T(BASE_X / 2, BASE_Y / 2), *T(-BASE_X / 2, -BASE_Y / 2), cls="x", dash="1 1")

    # Mittellinien (Strich-Punkt) und Ursprung
    s.line(T(RECT_X / 2 + 6, 0), T(-RECT_X / 2 - 6, 0), cls="c")
    s.line(T(0, RECT_Y / 2 + 6), T(0, -RECT_Y / 2 - 6), cls="c")
    s.circle(T(0, 0), 1.2, cls="v"); s.circle(T(0, 0), 0.35, cls="v", fill="#111")
    s.text(T(0, 0)[0] + 2.2, T(0, 0)[1] - 2.2, "Ursprung = Mitte Stiftbild", size=2.2, anchor="start", color="#555")

    # Kontrollstrecken: 200 mm laengs auf der Mittellinie, 100 mm quer
    for y in (100.0, -100.0):
        p = T(0, y); s.line((p[0] - 5, p[1]), (p[0] + 5, p[1]), cls="k")
    s.text(T(0, 100)[0] + 6.5, T(0, 100)[1] + 1.0, "Kontrolle: Strich zu Strich 200,0 mm (±0,3)", size=2.4, anchor="start", color=RED)
    yq = -22.0
    for x in (50.0, -50.0):
        p = T(x, yq); s.line((p[0], p[1] - 5), (p[0], p[1] + 5), cls="k")
    s.text(T(0, yq)[0], T(0, yq)[1] - 6.2, "Kontrolle: Strich zu Strich 100,0 mm (±0,3)", size=2.4, color=RED)
    s.text(T(0, yq)[0], T(0, yq)[1] + 8.5, "stimmt eine Strecke nicht: Druck auf 100 % / „tatsächliche Größe“ stellen, neu drucken", size=2.1, color=RED)

    # Stiftloecher: Koernerpunkt, Kreuz, Nenn-Ø (④ + 0,5), Langloch (+4 laengs) gestrichelt
    for name, x, y in POSTS:
        c = T(x, y)
        s.line((c[0] - 9, c[1]), (c[0] + 9, c[1]), cls="x"); s.line((c[0], c[1] - 9), (c[0], c[1] + 9), cls="x")
        s.circle(c, POST_D_NOMINAL / 2, cls="v", color=BLUE)
        r = POST_D_NOMINAL / 2
        s.rect(c[0] - r, c[1] - SLOT / 2, c[0] + r, c[1] + SLOT / 2, cls="g", color=BLUE)            # Langloch-Zugabe
        for dy in (-SLOT / 2, SLOT / 2):
            s.E(f'<path class="g" style="stroke:{BLUE}" d="M {c[0]-r:.3f} {c[1]+dy:.3f} A {r:.3f} {r:.3f} 0 0 {1 if dy>0 else 0} {c[0]+r:.3f} {c[1]+dy:.3f}"/>')
        s.circle(c, 0.35, cls="v", fill="#111")
        sx = 1 if x < 0 else -1                                    # Beschriftung nach aussen, ausserhalb des Kreuzes
        s.text(c[0] + sx * 10.5, c[1] - 4.2, "Stift", size=2.3, anchor="start" if sx > 0 else "end", color=BLUE, weight="bold")
        s.text(c[0] + sx * 10.5, c[1] - 0.9, "Ø = ④ + 0,5", size=2.1, anchor="start" if sx > 0 else "end", color=BLUE)
        s.text(c[0] + sx * 10.5, c[1] + 2.2, "Langloch +4 längs", size=1.9, anchor="start" if sx > 0 else "end", color=BLUE)

    # M4-Loecher fuer den Halter (Beschriftung nach innen, im freien Halterfeld)
    for name, x, y in M4:
        c = T(x, y)
        s.line((c[0] - 7, c[1]), (c[0] + 7, c[1]), cls="x"); s.line((c[0], c[1] - 7), (c[0], c[1] + 7), cls="x")
        s.circle(c, HOLE_D / 2, cls="v", color=GREEN); s.circle(c, 0.35, cls="v", fill="#111")
        sx = 1 if x > 0 else -1
        s.text(c[0] + sx * 8.5, c[1] + 0.9, "M4 Ø 4,5", size=2.2, anchor="start" if sx > 0 else "end", color=GREEN, weight="bold")

    # Masse (blau = Stifte, gruen = Halter)
    fl, fr_ = T(FRONT_SPAN / 2, HALF), T(-FRONT_SPAN / 2, HALF)
    rl, rr = T(REAR_SPAN / 2, -HALF), T(-REAR_SPAN / 2, -HALF)
    s.hdim(fl[0], fr_[0], fl[1] + 18.0, f"① front_span {FRONT_SPAN:g}", BLUE, feats=[fl, fr_], above=False)
    s.hdim(rl[0], rr[0], rl[1] - 18.0, f"② rear_span {REAR_SPAN:g}", BLUE, feats=[rl, rr], above=True)
    xr = T(-RECT_X / 2, 0)[0] + 9.0                               # rechter Rand
    for c in (fr_, rr):                                           # Hilfslinien erst hinter der Stift-Beschriftung
        s.line((c[0] + 9.0, c[1]), (c[0] + 10.0, c[1]), cls="e", color=BLUE)
    s.vdim(fr_[1], rr[1], xr, f"③ pitch_y {PITCH:g}", BLUE, feats=[(fr_[0] + 34.0, fr_[1]), (rr[0] + 34.0, rr[1])], side="right")
    m_fl, m_fr = T(MOUNT_X, MY), T(-MOUNT_X, MY)
    m_rl = T(MOUNT_X, -MY)
    s.hdim(m_fl[0], m_fr[0], m_fl[1] - 6.5, f"Halter-Lochbild {2*MOUNT_X:g}", GREEN, feats=[m_fl, m_fr], above=True)
    xl = T(RECT_X / 2, 0)[0] - 9.0                                # linker Rand
    s.vdim(m_fl[1], m_rl[1], xl, f"Halter-Lochbild {2*MY:g}", GREEN, feats=[m_fl, m_rl], side="left")
    # Diagonale als Kontrolle (eine Linie, duenn)
    s.line(fl, rr, cls="e", color=GREY); s.line(fr_, rl, cls="e", color=GREY)
    s.text(T(-30, 60)[0] + 2.8, T(-30, 60)[1] + 0.9, f"Diagonalen {DIAG:.1f} mm, beide gleich", size=2.1, color=GREY, rot=-72.7)

    # Orientierung
    s.text(CX, fl[1] - 3.2, "VORN (+Y)  ▲", size=3.0, weight="bold")
    s.text(T(BASE_X / 2, 0)[0] + 3.2, CY, "Fahrzeug-links (+X) · Kameraseite des Halters", size=2.3, anchor="middle", color="#333", rot=-90)
    s.text(T(-BASE_X / 2, 0)[0] - 3.2, CY, "Fahrzeug-rechts", size=2.3, anchor="middle", color="#333", rot=-90)
    # Umriss-Legende (im Halterfeld, unten)
    ly = T(0, -BASE_Y / 2)[1] - 12.5
    s.line((CX - 60, ly), (CX - 50, ly), cls="o"); s.text(CX - 48, ly + 1.0, "I-Form wie Druckteil (Adapter aus FreeCAD)", size=2.2, anchor="start")
    s.line((CX - 60, ly + 4.2), (CX - 50, ly + 4.2), cls="g"); s.text(CX - 48, ly + 5.2, f"Rechteck {RECT_X:g} × {RECT_Y:g} (Brett-Variante, reicht — Kontrolle A: Akkuwechsel)", size=2.2, anchor="start")
    s.line((CX - 60, ly + 8.4), (CX - 50, ly + 8.4), cls="x", dash="1 1"); s.text(CX - 48, ly + 9.4, f"Halter-Grundfläche {BASE_X:g} × {BASE_Y:g}", size=2.2, anchor="start")

    # Kopf-/Fusszeile in den Raendern
    s.text(6, 4.6, "Bohrschablone Adapterplatte · KF10 MAX · Maßstab 1:1 · DRUCK 100 % (tatsächliche Größe, keine Anpassung)", size=2.5, anchor="start", weight="bold")
    s.text(W - 6, 4.6, f"RB3-HW-003 Rev B · {DATE} · Blatt 1/2", size=2.3, anchor="end", color="#444")
    s.text(6, H - 2.4, "Blatt auf das Brett kleben, 8 Mittelpunkte durch das Papier ankörnen · Stiftlöcher erst nach Messung von ④ bohren · Anleitung Blatt 2",
           size=2.2, anchor="start", color="#444")
    return s


# ================================================================== Blatt 2: Masse, Tabelle, Anleitung
def sheet2() -> Sheet:
    W, H = 297.0, 210.0
    s = Sheet(W, H)
    s.rect(5, 5, W - 5, H - 5, cls="fr")
    s.text(8, 10.2, "Blatt 2 — Maße, Koordinaten, Bohranleitung", size=4.2, anchor="start", weight="bold")
    s.text(8, 14.6, "Zeichnung nicht maßstäblich (Blatt 1 ist die Schablone). Koordinaten: X quer (+X Fahrzeug-links), Y nach vorn, Ursprung Mitte Stiftbild; "
                    "„vom Rand“ = Rechteck-Brett 170 × 276, linke vordere Ecke.", size=2.5, anchor="start", color="#444")
    s.text(W - 8, 10.2, "KF10 MAX · Adapterplatte · Blatt 2/2", size=3.0, anchor="end")
    s.text(W - 8, 14.6, f"RB3-HW-003 Rev B · {DATE}", size=2.4, anchor="end", color="#444")

    # ---------- Schema (Massstab 0,42), vorn oben
    K = 0.42; CX, CY = 62.0, 110.0
    def T(x, y): return (CX - K * x, CY - K * y)
    s.poly([T(x, y) for x, y in outline_points()], cls="o")
    s.rect(*T(RECT_X / 2, RECT_Y / 2), *T(-RECT_X / 2, -RECT_Y / 2), cls="g", rx=1.5)
    s.line(T(RECT_X / 2 + 10, 0), T(-RECT_X / 2 - 10, 0), cls="c"); s.line(T(0, RECT_Y / 2 + 8), T(0, -RECT_Y / 2 - 8), cls="c")
    for name, x, y in POSTS:
        c = T(x, y); s.circle(c, 1.6, cls="v", color=BLUE); s.circle(c, 0.3, cls="v", fill="#111")
    for name, x, y in M4:
        c = T(x, y); s.circle(c, 1.2, cls="v", color=GREEN); s.circle(c, 0.3, cls="v", fill="#111")
    fl, fr_ = T(FRONT_SPAN / 2, HALF), T(-FRONT_SPAN / 2, HALF)
    rl, rr = T(REAR_SPAN / 2, -HALF), T(-REAR_SPAN / 2, -HALF)
    s.hdim(fl[0], fr_[0], fl[1] - 9.0, "① 73", BLUE, feats=[fl, fr_], size=2.6)
    s.hdim(rl[0], rr[0], rl[1] + 9.0, "② 84", BLUE, feats=[rl, rr], above=False, size=2.6)
    s.vdim(fr_[1], rr[1], T(-RECT_X / 2, 0)[0] + 7.0, "③ 252", BLUE, feats=[fr_, rr], side="right", size=2.6)
    m_fl, m_fr, m_rl = T(MOUNT_X, MY), T(-MOUNT_X, MY), T(MOUNT_X, -MY)
    s.hdim(m_fl[0], m_fr[0], m_fl[1] - 4.5, "156", GREEN, feats=[m_fl, m_fr], size=2.4)
    s.vdim(m_fl[1], m_rl[1], T(RECT_X / 2, 0)[0] - 7.0, "92", GREEN, feats=[m_fl, m_rl], side="left", size=2.4)
    e0, e1 = T(RECT_X / 2, RECT_Y / 2), T(-RECT_X / 2, RECT_Y / 2)
    s.hdim(e0[0], e1[0], e0[1] - 15.5, "170 (Brett)", GREY, feats=[e0, e1], size=2.4)
    e2 = T(-RECT_X / 2, -RECT_Y / 2)
    s.vdim(e1[1], e2[1], T(-RECT_X / 2, 0)[0] + 16.0, "276 (Brett)", GREY, feats=[e1, e2], side="right", size=2.4)
    s.text(CX, T(0, RECT_Y / 2)[1] - 24.0, "vorn ▲", size=2.6, weight="bold")
    s.text(T(BASE_X / 2, 0)[0] - 2.0, CY + 30, "Fahrzeug-links (+X)", size=2.1, color="#333", rot=-90)

    # ---------- Koordinatentabelle
    x0 = 122.0; y = 20.0
    cols = [x0, x0 + 36, x0 + 48, x0 + 60, x0 + 83, x0 + 106, W - 8]
    heads = ["Loch", "X", "Y", "vom Rand links", "vom Rand vorn", "Ø bohren"]
    s.rect(cols[0], y, cols[-1], y + 5.4, cls="th")
    for i, t in enumerate(heads):
        s.text(cols[i] + 1.2, y + 3.9, t, size=2.4, anchor="start", weight="bold")
    y += 5.4
    rows = []
    for name, x, yy in POSTS:
        rows.append((name, x, yy, "④ + 0,5, dann Langloch +2/+2 längs", BLUE))
    for name, x, yy in M4:
        rows.append((name, x, yy, "4,5 (M4 Durchgang)", GREEN))
    for name, x, yy, d, col in rows:
        s.rect(cols[0], y, cols[-1], y + 5.2, cls="tb")
        s.text(cols[0] + 1.2, y + 3.7, name, size=2.3, anchor="start", color=col, weight="bold")
        for i, v in enumerate((x, yy, RECT_X / 2 - x, RECT_Y / 2 - yy)):
            s.text(cols[i + 1] + 1.2, y + 3.7, f"{v:+.1f}" if i < 2 else f"{v:.1f}", size=2.3, anchor="start", family="Menlo,Consolas,monospace")
        s.text(cols[5] + 1.2, y + 3.7, d, size=2.1, anchor="start")
        for cx in cols[1:-1]:
            s.line((cx, y), (cx, y + 5.2), cls="tb")
        y += 5.2
    for cx in cols[1:-1]:
        s.line((cx, 20.0), (cx, 25.4), cls="tb")
    y += 2.5
    s.text(cols[0], y + 2.4, f"Kontrolle: Diagonalen des Stiftbilds vorn-links→hinten-rechts und vorn-rechts→hinten-links je {DIAG:.1f} mm; "
                             f"M4-Diagonalen je {math.hypot(2*MOUNT_X, 2*MY):.1f} mm.", size=2.2, anchor="start", color="#444")
    y += 7.0

    # ---------- Bohranleitung
    s.text(cols[0], y + 2.6, "So bohren", size=3.2, anchor="start", weight="bold"); y += 6.0
    steps = [
        ("1", "Blatt 1 in tatsächlicher Größe drucken (100 %, keine Seitenanpassung); beide Kontrollstrecken mit Messschieber",
              "oder Maßband prüfen: 100,0 und 200,0 mm (±0,3). Sonst neu drucken."),
        ("2", "Brett zuschneiden: Rechteck 170 × 276 (4 mm Sperrholz oder Alu) oder I-Form wie das Druckteil. Blatt mit Krepp",
              "aufkleben, Mittellinien auf die Brettmitte ausrichten (Rechteck: 85 mm von links, 138 mm von vorn)."),
        ("3", "Alle acht Mittelpunkte durch das Papier ankörnen (Körner oder Nagel), Blatt abnehmen, Punkte nachprüfen:",
              f"Stifte vorn 73 / hinten 84 quer, 252 längs, Diagonalen {DIAG:.1f}; M4 156 × 92."),
        ("4", "M4-Löcher: 2 mm vorbohren, dann Ø 4,5. Der Halter hat darüber Langlöcher (±2 mm längs), etwas Spiel ist unkritisch."),
        ("5", "Stiftlöcher: ERST ④ (Stift-Ø am Schaft) messen, dann 2 mm vorbohren und Ø = ④ + 0,5 bohren; anschließend je 2 mm",
              "nach vorn und hinten zum Langloch feilen (Aufmaß-Toleranz längs, quer bleibt eng). Platte probeweise aufstecken."),
        ("6", "Höhe: die Platte liegt auf den Bügelenden, der Clip kommt ins Querloch (4a über dem Bügel). Zwischen Platte (4 mm)",
              "und Querloch bleibt 4a − 4 mm Luft — dort je Stift eine Distanzhülse/Buchse (oder Beilagscheiben) bis 1 mm unter",
              "das Querloch, sonst klemmt der Clip nicht. Sind 13v und 13h ungleich: Fuß unter der niedrigeren Seite."),
        ("7", "Halter mit 4 × M4 (Senkkopf von unten oder Mutter) auf die Platte, Telefon-Kameraseite nach Fahrzeug-links."),
    ]
    for num, *lines in steps:
        s.badge((cols[0] + 2.4, y + 1.3), num, GREY, r=2.2)
        for k, ln in enumerate(lines):
            s.text(cols[0] + 6.5, y + 2.3 + k * 3.3, ln, size=2.25, anchor="start")
        y += 3.3 * len(lines) + 1.6
    y += 1.5
    s.text(cols[0], y + 2.6, "Noch zu messen (für Buchsen, Füße und das Druckteil)", size=3.0, anchor="start", weight="bold"); y += 5.6
    open_ = [("4", BLUE, "Stift-Ø am Schaft → Bohr-Ø der Stiftlöcher = ④ + 0,5"),
             ("4a", BLUE, "Querloch-Mitte über Bügel-Oberkante → Buchsenhöhe = 4a − 1 − 4 − Fuß"),
             ("4b", BLUE, "Stifthöhe über Bügel → Kontrolle: ≈ 3 mm Stift über der Buchse für den Clip"),
             ("13v", GREEN, "Bügel-Oberkante vorn über Tisch"), ("13h", GREEN, "Bügel-Oberkante hinten über Tisch → Differenz = Fuß"),
             ("14", GREEN, "höchster Punkt zwischen den Bügeln (±85 quer) → Platte ≥ ⑭ + 8 mm")]
    for num, col, txt in open_:
        s.badge((cols[0] + 2.4, y + 1.2), num, col, r=2.2)
        s.text(cols[0] + 6.5, y + 2.2, txt, size=2.25, anchor="start"); y += 4.4
    s.text(8, H - 8.5, "Gemessen: ① 73, ② 84, ⑩ 50 (2026-09-07), ③ 252 (2026-09-10). Werte gehen als POSTS in halter60_freecad.py; das Skript rechnet Buchsen, Füße und die STL, "
                       "sobald ④ 4a 4b 13v 13h ⑭ da sind.", size=2.3, anchor="start", color="#444")
    return s


def main():
    for i, fn in enumerate((sheet1, sheet2), start=1):
        out = HERE / f"bohrschablone-adapter-{i}.svg"
        out.write_text(fn().svg(), encoding="utf-8")
        print("wrote", out.name)


if __name__ == "__main__":
    main()
