#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Aufmaßblatt KF10 MAX für die Adapterplatte des Telefonhalters 60° (RB3-HW-003).

Schematische Zeichnung des 1:10-Trucks (NICHT maßstäblich) mit nummerierten Maßpfeilen. Die
Nummern ①…⑰ sind dieselben wie im Messblatt; die Werte gehen als POSTS / CHASSIS in
halter60_freecad.py (Formeln stehen in der Tabelle).

Karosserie-Anbindung laut Fotos (Marvin, 2026-09-07): vier kurze Karosserie-Stifte mit Kugelkopf
an den Enden eines Querbügels über dem vorderen und hinteren Dämpferturm, je ein Querloch für den
Original-Clip. Die Adapterplatte wird über die Stifte gesteckt, liegt auf den Bügelenden (bzw. auf
Füßen) und wird mit den Clips gehalten; eine Buchse je Stift füllt bis unter das Querloch.

  aufmass-kf10-1.svg   Blatt 1: Draufsicht (vorn links)
  aufmass-kf10-2.svg   Blatt 2: Seitenansicht, Vorderansicht, Stift-Detail
  aufmass-kf10-3.svg   Blatt 3: Messblatt (Pflicht für den Adapter / später für Hüllkörper und Sim)
  aufmass-kf10-4.svg   Blatt 4: Papiermaßstab 275 mm (Druck 100 %) + Messen ohne Lineal

Aufruf:  python3 aufmass_kf10.py                      (nur Standardbibliothek)
PDF:     rsvg-convert -f pdf -o aufmass-kf10.pdf aufmass-kf10-{1,2,3,4}.svg
"""
from __future__ import annotations
import math, pathlib
from html import escape as esc

HERE = pathlib.Path(__file__).resolve().parent
DATE = "2026-09-10"
W, H = 297.0, 210.0                     # A4 quer, Einheit mm

BLUE, GREEN, GREY = "#1d4ed8", "#15803d", "#6b7280"      # POSTS / CHASSIS / Wahl+Info

# Bereits gemessene Werte (Marvin, 2026-09-07: ① ② ⑩; 2026-09-10: ③) — erscheinen vorausgefuellt im Messblatt.
# Das Lochbild der Draufsicht ist damit komplett (Bohrschablone: bohrschablone_adapter.py).
MEASURED = {1: "73", 2: "84", 3: "252", 10: "50"}

# ------------------------------------------------------------------ Schema-Fahrzeug (Platzhalterwerte, nur Proportion)
# Koordinaten wie im Skript: X quer (+X Fahrzeug-links), Y vorn, Z hoch, Ursprung Mitte Stift-Bild, Tisch z = 0.
V = dict(
    tub_x=120.0, tub_y0=-150.0, tub_y1=120.0,       # Chassis-Wanne quer / hinten / vorn
    z_floor=40.0, z_wall=75.0,                      # Chassis-Unterseite, Wannenoberkante
    gear=((85.0, 145.0), (-145.0, -85.0)), z_gear=95.0,     # Getriebe/Dämpferturm-Blöcke vorn / hinten (Y-Bereich)
    motor=(-45.0, -10.0), z_motor=90.0,
    batt=(-140.0, -60.0),
    post_f=(36.5, 126.0), post_r=(42.0, 126.0),     # Stifte: (x, |y|) der Stiftmitten vorn (73) / hinten (84); pitch_y 252 (gemessen)
    z_br=(102.0, 110.0), br_t=3.0, br_w=8.0,        # Bügel-Oberkante vorn / hinten über Tisch, Bügeldicke, Bügelbreite (Y)
    post_d=5.5, post_h=22.0, hole_h=17.0,           # Stift Ø, Höhe über Bügel, Querloch-Mitte über Bügel
    cap=((14.0, 108.0),),                           # Dämpferkappen: (Abstand von Stiftmitte nach innen, Oberkante)
    plate_t=4.0, bar=22.0, bar_margin=14.0, gap_min=8.0, foot_pad=6.0, boss_d=13.5,
    wheel_d=105.0, wheel_w=50.0, track=246.0, wheelbase=275.0, lift=25.0,
    holder=(170.0, 104.0),
)
Z_REF = max(V["z_br"])
Z_OBST = V["cap"][0][1]
Z_PLATE = max(Z_REF, Z_OBST + V["gap_min"])                       # Plattenunterseite über Tisch
FEET = tuple(Z_PLATE - z for z in V["z_br"])                        # Füße vorn / hinten
BOSS = tuple(z + V["hole_h"] - 1.0 - (Z_PLATE + V["plate_t"]) for z in V["z_br"])   # Buchsenhöhe vorn / hinten


class Sheet:
    def __init__(self, title: str, sub: str, blatt: str, legend: bool = True):
        self.o: list[str] = []
        self.title, self.sub, self.blatt, self.legend = title, sub, blatt, legend

    # ---- Grundelemente
    def E(self, s: str): self.o.append(s)

    def line(self, a, b, cls="v", color=None, dash=None, w=None):
        st = []
        if color: st.append(f"stroke:{color}")
        if dash: st.append(f"stroke-dasharray:{dash}")
        if w: st.append(f"stroke-width:{w}")
        style = f' style="{";".join(st)}"' if st else ""
        self.E(f'<line class="{cls}" x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}"{style}/>')

    def rect(self, x0, y0, x1, y1, cls="v", rx=0.0, color=None, fill=None, dash=None):
        x, y = min(x0, x1), min(y0, y1)
        st = []
        if color: st.append(f"stroke:{color}")
        if fill: st.append(f"fill:{fill}")
        if dash: st.append(f"stroke-dasharray:{dash}")
        style = f' style="{";".join(st)}"' if st else ""
        self.E(f'<rect class="{cls}" x="{x:.2f}" y="{y:.2f}" width="{abs(x1-x0):.2f}" height="{abs(y1-y0):.2f}" rx="{rx}"{style}/>')

    def circle(self, c, r, cls="v", color=None, fill=None):
        st = []
        if color: st.append(f"stroke:{color}")
        if fill: st.append(f"fill:{fill}")
        style = f' style="{";".join(st)}"' if st else ""
        self.E(f'<circle class="{cls}" cx="{c[0]:.2f}" cy="{c[1]:.2f}" r="{r:.2f}"{style}/>')

    def poly(self, pts, cls="v", fill=None):
        d = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        style = f' style="fill:{fill}"' if fill else ""
        self.E(f'<polygon class="{cls}" points="{d}"{style}/>')

    def text(self, x, y, s, size=2.8, anchor="middle", color="#111", weight=None, rot=0.0, family=None, italic=False):
        st = f"font-size:{size}px;fill:{color}"
        if weight: st += f";font-weight:{weight}"
        if family: st += f";font-family:{family}"
        if italic: st += ";font-style:italic"
        tr = f' transform="rotate({rot:.1f} {x:.2f} {y:.2f})"' if rot else ""
        self.E(f'<text x="{x:.2f}" y="{y:.2f}" text-anchor="{anchor}" style="{st}"{tr}>{esc(s)}</text>')

    def arrow(self, tip, d, color, L=2.4, hw=0.7):
        n = math.hypot(*d); dx, dy = d[0] / n, d[1] / n
        bx, by = tip[0] - dx * L, tip[1] - dy * L
        self.poly([tip, (bx - dy * hw, by + dx * hw), (bx + dy * hw, by - dx * hw)], cls="ar", fill=color)

    # ---- Nummernplakette + Text
    def badge(self, c, num, color, r=2.3):
        self.circle(c, r, cls="bd", color=color, fill="#fff")
        self.text(c[0], c[1] + 0.95, str(num), size=2.6 if len(str(num)) < 3 else 2.1, color=color, weight="bold")

    def tag(self, x, y, num, label, color, anchor="middle", size=2.8):
        """Plakette links, Text rechts; (x, y) = Textgrundlinie, anchor bezieht sich auf die Gesamtbreite."""
        tw = 0.52 * size * len(label) + 5.4
        x0 = {"middle": x - tw / 2, "start": x, "end": x - tw}[anchor]
        if num is not None:
            self.badge((x0 + 2.3, y - 1.0), num, color)
            self.text(x0 + 5.4, y, label, size=size, anchor="start", color=color)
        else:
            self.text(x0, y, label, size=size, anchor="start", color=color)
        return x0, x0 + tw

    # ---- Maßlinien
    def _ext(self, a, b, color):
        self.line(a, b, cls="e", color=color)

    def hdim(self, x1, x2, y, num, label, color, feats=(), above=True, tdx=0.0):
        for fx, fy in feats:
            self._ext((fx, fy), (fx, y + (1.5 if y > fy else -1.5)), color)
        x1, x2 = sorted((x1, x2))
        self.line((x1, y), (x2, y), cls="d", color=color)
        if x2 - x1 >= 9:
            self.arrow((x1, y), (-1, 0), color); self.arrow((x2, y), (1, 0), color)
        else:                                            # Pfeile außen
            self.arrow((x1, y), (1, 0), color); self.arrow((x2, y), (-1, 0), color)
            self.line((x1 - 5, y), (x1, y), cls="d", color=color); self.line((x2, y), (x2 + 5, y), cls="d", color=color)
        ty = y - 1.6 if above else y + 3.7
        self.tag((x1 + x2) / 2 + tdx, ty, num, label, color)

    def vdim(self, y1, y2, x, num, label, color, feats=(), side="right", tdy=0.0, label_y=None):
        for fx, fy in feats:
            self._ext((fx, fy), (x + (1.5 if x > fx else -1.5), fy), color)
        y1, y2 = sorted((y1, y2))
        self.line((x, y1), (x, y2), cls="d", color=color)
        if y2 - y1 >= 9:
            self.arrow((x, y1), (0, -1), color); self.arrow((x, y2), (0, 1), color)
        else:
            self.arrow((x, y1), (0, 1), color); self.arrow((x, y2), (0, -1), color)
            self.line((x, y1 - 5), (x, y1), cls="d", color=color); self.line((x, y2), (x, y2 + 5), cls="d", color=color)
        ym = label_y if label_y is not None else (y1 + y2) / 2 + 1.0 + tdy
        if side == "right":
            self.tag(x + 2.2, ym, num, label, color, anchor="start")
        else:
            self.tag(x - 2.2, ym, num, label, color, anchor="end")

    def leader(self, p, q, color=GREY, dot=True):
        self.line(p, q, cls="e", color=color)
        if dot: self.circle(p, 0.5, cls="bd", color=color, fill=color)

    # ---- Blattrahmen
    def frame(self):
        self.rect(5, 5, W - 5, H - 5, cls="fr")
        self.text(8, 10.2, self.title, size=4.2, anchor="start", weight="bold")
        self.text(8, 14.6, self.sub, size=2.6, anchor="start", color="#444")
        self.text(W - 8, 10.2, f"KF10 MAX · Aufmaß Adapterplatte · {self.blatt}", size=3.0, anchor="end")
        self.text(W - 8, 14.6, f"RB3-HW-003 Rev B · {DATE} · nicht maßstäblich", size=2.4, anchor="end", color="#444")
        if not self.legend:
            return
        for i, (c, t) in enumerate(((BLUE, "POSTS (Stifte → Adapterplatte)"), (GREEN, "CHASSIS (Hüllkörper, Freigang)"), (GREY, "Wahl / Info"))):
            x = 8 + i * 66
            self.rect(x, H - 11.6, x + 5, H - 8.6, cls="bd", color=c, fill=c)
            self.text(x + 7, H - 8.9, t, size=2.5, anchor="start", color="#333")

    def svg(self) -> str:
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}">\n'
                '<style>\n'
                'text{font-family:Helvetica,Arial,"Liberation Sans",sans-serif;fill:#111}\n'
                '.fr{fill:#fff;stroke:#222;stroke-width:0.4}\n'
                '.v{fill:none;stroke:#111;stroke-width:0.35;stroke-linejoin:round}\n'
                '.f{fill:#f3f3f3;stroke:#111;stroke-width:0.35;stroke-linejoin:round}\n'
                '.m{fill:#e2e2e2;stroke:#111;stroke-width:0.35;stroke-linejoin:round}\n'
                '.p{fill:#3a3a3a;stroke:#111;stroke-width:0.3}\n'
                '.w{fill:#d6d6d6;stroke:#111;stroke-width:0.35}\n'
                '.w2{fill:#d6d6d6;fill-opacity:0.5;stroke:#111;stroke-width:0.35}\n'
                '.i{fill:none;stroke:#555;stroke-width:0.25}\n'
                '.h{fill:none;stroke:#333;stroke-width:0.25;stroke-dasharray:1.6 1}\n'
                '.g{fill:none;stroke:#8a8a8a;stroke-width:0.3;stroke-dasharray:1.4 0.9}\n'
                '.e{fill:none;stroke-width:0.18}\n'
                '.d{fill:none;stroke-width:0.32}\n'
                '.ar{stroke:none}\n'
                '.bd{stroke-width:0.4}\n'
                '.tb{fill:none;stroke:#333;stroke-width:0.25}\n'
                '.th{fill:#e9eef7;stroke:#333;stroke-width:0.25}\n'
                '.ts{fill:#f4f4f4;stroke:#333;stroke-width:0.25}\n'
                '.gr{fill:none;stroke:#333;stroke-width:0.5}\n'
                '</style>\n')
        return head + "\n".join(self.o) + "\n</svg>\n"


def posts():
    """Stiftmitten (x, y) in Fahrzeugkoordinaten: vorn links, vorn rechts, hinten links, hinten rechts."""
    fx, fy = V["post_f"]; rx, ry = V["post_r"]
    return [(fx, fy), (-fx, fy), (rx, -ry), (-rx, -ry)]


# ================================================================== Blatt 1: Draufsicht
def sheet1() -> Sheet:
    s = Sheet("Blatt 1 — Draufsicht (vorn links, Fahrzeug-links unten)",
              "Auto auf ebenem Tisch, Normallage, Akku eingelegt, Karosserie ab. Alle Maße Stiftmitte–Stiftmitte in mm. "
              "Ansatzpunkte für die Fangkorb-Streben hier einzeichnen (Kontrolle C).", "Blatt 1/4")
    s.frame()
    S = 0.5; CX, CY = 150.0, 108.0
    def T(x, y): return (CX - S * y, CY + S * x)          # Fahrzeug (x quer, y vorn) → Blatt
    def TR(x0, y0, x1, y1, **kw):
        a, b = T(x0, y0), T(x1, y1); s.rect(a[0], a[1], b[0], b[1], **kw)

    half = V["tub_x"] / 2
    # Räder + Achsen
    for sy in (V["wheelbase"] / 2, -V["wheelbase"] / 2):
        for sx in (V["track"] / 2, -V["track"] / 2):
            TR(sx - V["wheel_w"] / 2, sy - V["wheel_d"] / 2, sx + V["wheel_w"] / 2, sy + V["wheel_d"] / 2, cls="w", rx=2.5)
        s.line(T(-V["track"] / 2, sy), T(V["track"] / 2, sy), cls="h")
    # Chassis-Wanne, Getriebe/Türme, Motor, Akku
    TR(-half, V["tub_y0"], half, V["tub_y1"], cls="f", rx=3)
    for ya, yb in V["gear"]:
        TR(-38, ya, 38, yb, cls="i")
        tx, ty = T(0, (ya + yb) / 2); s.text(tx + 0.8, ty, "Getriebe + Dämpferturm", size=2.0, color="#555", rot=-90)
    TR(-20, V["motor"][0], 20, V["motor"][1], cls="i"); s.text(*T(0.8 / S, sum(V["motor"]) / 2), "Motor", size=2.1, color="#555", rot=-90)
    TR(-25, V["batt"][0], 25, V["batt"][1], cls="h"); s.text(*T(0.8 / S, sum(V["batt"]) / 2), "Akku", size=2.1, color="#555")
    # Querbügel mit Stiften
    for (px, py) in (V["post_f"], (V["post_r"][0], -V["post_r"][1])):
        TR(-(px + 5), py - V["br_w"] / 2, px + 5, py + V["br_w"] / 2, cls="m", rx=1.0)
    # Adapterplatte (Konzept) grau gestrichelt
    for (px, py) in (V["post_f"], (V["post_r"][0], -V["post_r"][1])):
        TR(-(px + V["bar_margin"]), py - V["bar"] / 2, px + V["bar_margin"], py + V["bar"] / 2, cls="g")
    TR(-22, -V["post_r"][1], 22, V["post_f"][1], cls="g")
    hx, hy = V["holder"]
    TR(-hx / 2, -hy / 2, hx / 2, hy / 2, cls="g")
    s.text(CX, T(-hx / 2, 0)[1] - 1.6, f"Halter-Grundfläche {hx:g} × {hy:g} (Rev B), Adapterplatte grau gestrichelt", size=2.2, color=GREY)
    # Stifte
    pts = []
    for (x, y) in posts():
        c = T(x, y); pts.append(c)
        s.circle(c, S * V["post_d"] / 2 + 0.9, cls="p")
        s.circle(c, 0.6, cls="v", fill="#fff")
    fL, fR, rL, rR = pts[1], pts[0], pts[3], pts[2]      # oben/unten auf dem Blatt
    s.leader(fR, (fR[0] + 9, T(half, 0)[1] + 5.0), "#555")
    s.text(fR[0] + 10, T(half, 0)[1] + 5.8, "Karosserie-Stift (1 Querloch, Clip)", size=2.1, anchor="start", color="#555")
    s.text(T(0, V["post_f"][1])[0], T(-half, 0)[1] - 5.0, "Querbügel", size=2.0, color="#555")
    # Ursprung
    s.circle((CX, CY), 1.0, cls="v"); s.line((CX - 4, CY), (CX + 4, CY), cls="i"); s.line((CX, CY - 4), (CX, CY + 4), cls="i")
    s.text(CX, CY - 5.5, "Stift-Mitte = Ursprung", size=2.1, color="#555")
    # ⑰ offset_y
    s.line((CX, CY + 3.5), (CX + 10, CY + 3.5), cls="d", color=GREY); s.arrow((CX + 10, CY + 3.5), (1, 0), GREY); s.arrow((CX, CY + 3.5), (-1, 0), GREY)
    s.leader((CX + 5, CY + 3.5), (CX + 5, CY + 45.5), GREY, dot=False)
    s.tag(CX, CY + 49.5, 17, "offset_y: Halterfeld längs verschieben (Wahl, Start 0)", GREY, size=2.5)

    # ---- Maße
    s.vdim(fL[1], fR[1], 66, 1, "front_span = 73", BLUE, feats=[fL, fR], side="left")
    s.vdim(rL[1], rR[1], 240, 2, "rear_span = 84", BLUE, feats=[rL, rR], side="right")
    s.hdim(fL[0], rL[0], 26, 3, "pitch_y = 252", BLUE, feats=[fL, rL])
    tubTL, tubBL = T(-half, V["tub_y1"]), T(half, V["tub_y1"])
    tubTR = T(-half, V["tub_y0"])
    s.vdim(tubTL[1], tubBL[1], 54, 5, "B  (optional)", GREEN, feats=[tubTL, tubBL], side="left", tdy=-12)
    s.hdim(tubTL[0], fL[0], 70, 6, "d_f (opt.)", GREEN, feats=[tubTL, fL])
    s.hdim(rL[0], tubTR[0], 70, 7, "d_r (opt.)", GREEN, feats=[rL, tubTR])
    wa, wb = T(-V["track"] / 2 - V["wheel_w"] / 2, -V["wheelbase"] / 2), T(-V["track"] / 2 + V["wheel_w"] / 2, -V["wheelbase"] / 2)
    wx = T(0, -V["wheelbase"] / 2 - V["wheel_d"] / 2)[0]
    s.vdim(wa[1], wb[1], 252, 10, "wheel_w = 50", GREEN, feats=[(wx, wa[1]), (wx, wb[1])], side="right")
    # Fahrtrichtung, Achsen
    s.line((60, 190), (40, 190), cls="d", color="#111"); s.arrow((40, 190), (-1, 0), "#111")
    s.text(62, 191, "vorn (+Y)", size=2.6, anchor="start")
    s.line((30, 170), (30, 184), cls="d", color="#111"); s.arrow((30, 184), (0, 1), "#111")
    s.text(32, 179, "+X Fahrzeug-links (Kameraseite)", size=2.4, anchor="start", color="#333")
    s.text(W - 8, 191, "C: Ansatzpunkte der Fangkorb-Streben hier markieren", size=2.5, anchor="end", color=GREY)
    return s


# ================================================================== Blatt 2: Seite, Front, Stift-Detail
def sheet2() -> Sheet:
    s = Sheet("Blatt 2 — Seitenansicht, Vorderansicht, Stift-Detail",
              "Höhen ⑬ ⑭ ⑮ ⑯ immer von der Tischplatte aus messen (Messschieber senkrecht, Tiefenmaß). "
              "Normallage = Auto steht frei, Akku eingelegt. Grau gestrichelt = Adapter (Platte, Füße, Buchsen).", "Blatt 2/4")
    s.frame()
    S = 0.42
    pd, ph, hh = V["post_d"], V["post_h"], V["hole_h"]
    brw, brt = V["br_w"], V["br_t"]
    # ---------- Seitenansicht (von Fahrzeug-links, vorn links)
    CX, GY = 150.0, 88.0
    def Sd(y, z): return (CX - S * y, GY - S * z)
    def SR(y0, z0, y1, z1, **kw):
        a, b = Sd(y0, z0), Sd(y1, z1); s.rect(a[0], a[1], b[0], b[1], **kw)
    s.text(8, 22, "Seitenansicht", size=3.2, anchor="start", weight="bold")
    s.line((58, GY), (232, GY), cls="gr"); s.text(58, GY + 3.2, "Tisch", size=2.3, anchor="start", color="#333")
    # Chassis: Wanne, Getriebe/Türme, Motor, Akku
    SR(V["tub_y0"], V["z_floor"], V["tub_y1"], V["z_wall"], cls="f")
    for ya, yb in V["gear"]:
        SR(ya, V["z_wall"], yb, V["z_gear"], cls="f")
    SR(V["motor"][0], V["z_wall"], V["motor"][1], V["z_motor"], cls="f")
    SR(V["batt"][0], V["z_floor"] + 5, V["batt"][1], V["z_wall"] - 5, cls="h")
    s.text(*Sd(sum(V["batt"]) / 2, 57), "Akku", size=2.1, color="#555")
    s.text(*Sd(sum(V["motor"]) / 2, 81.5), "Motor", size=1.9, color="#555")
    zl = V["z_floor"] - V["lift"]
    s.line(Sd(V["tub_y0"] - 5, zl), Sd(V["tub_y1"] + 5, zl), cls="h", color=GREEN)
    s.text(Sd(-15, 0)[0], Sd(0, zl)[1] - 1.2, "Chassis-Unterseite bei voll eingedrücktem Fahrwerk", size=2.1, color=GREEN)
    # Bügel (auf Turm-Stützen), Stifte mit Querloch, Dämpferkappen
    ys = (V["post_f"][1], -V["post_r"][1])
    for k, py in enumerate(ys):
        zb = V["z_br"][k]
        SR(py - brw / 2, V["z_gear"], py + brw / 2, zb - brt, cls="m")            # Stütze Turm → Bügel
        SR(py - brw / 2 - 3, zb - brt, py + brw / 2 + 3, zb, cls="m")             # Bügel (Endstück im Schnitt)
        SR(py - pd / 2, zb, py + pd / 2, zb + ph - pd / 2, cls="p")               # Stift
        s.circle(Sd(py, zb + ph - pd / 2), S * pd / 2, cls="p")                     # Kugelkopf
        s.circle(Sd(py, zb + hh), 0.55, cls="v", fill="#fff")                        # Querloch
        for dist, zc in V["cap"]:                                                  # Dämpferkappe innen neben dem Stift
            yc = py - dist if py > 0 else py + dist
            SR(yc - 5, V["z_gear"], yc + 5, zc, cls="f")
    s.text(Sd(ys[1] + V["cap"][0][0] - 6, 0)[0], Sd(0, V["z_gear"] + 2.5)[1], "Dämpferkappe (⑭)", size=1.9, anchor="start", color="#555")
    # Adapter: Füße, Platte, Buchsen (grau gestrichelt)
    for k, py in enumerate(ys):
        if FEET[k] > 0.05:
            SR(py - 9, V["z_br"][k], py + 9, Z_PLATE, cls="g")
        if BOSS[k] > 0.05:
            SR(py - V["boss_d"] / 2, Z_PLATE + V["plate_t"], py + V["boss_d"] / 2, Z_PLATE + V["plate_t"] + BOSS[k], cls="g")
        # Clip auf der Buchse (im Querloch)
        a, b = Sd(py - 7, V["z_br"][k] + hh), Sd(py + 7, V["z_br"][k] + hh)
        s.line(a, b, cls="v", w=0.6); s.circle(Sd(py + 9, V["z_br"][k] + hh), 1.2, cls="v")
    SR(-(V["post_r"][1] + V["bar"] / 2), Z_PLATE, V["post_f"][1] + V["bar"] / 2, Z_PLATE + V["plate_t"], cls="g")
    s.text(Sd(15, 0)[0], Sd(0, Z_PLATE + V["plate_t"])[1] - 1.6, "Adapterplatte (Konzept), liegt auf Füßen / Bügeln", size=2.1, color=GREY)
    s.leader(Sd(ys[0] + 9, (V["z_br"][0] + Z_PLATE) / 2), (Sd(ys[0] + 30, 0)[0], Sd(0, (V["z_br"][0] + Z_PLATE) / 2)[1] + 4.5), GREY)
    s.text(Sd(ys[0] + 31, 0)[0], Sd(0, (V["z_br"][0] + Z_PLATE) / 2)[1] + 5.3, "Fuß vorn", size=2.1, anchor="end", color=GREY)
    s.leader(Sd(ys[1] - 9, V["z_br"][1] + hh), (Sd(ys[1] - 22, 0)[0], Sd(0, V["z_br"][1] + hh + 10)[1]), "#111")
    s.text(Sd(ys[1] - 23, 0)[0], Sd(0, V["z_br"][1] + hh + 10)[1] + 0.8, "Clip auf Buchse", size=2.1, anchor="start")
    s.leader(Sd(ys[0] + brw / 2 + 3, V["z_br"][0] - brt / 2), (Sd(ys[0] + 26, 0)[0], Sd(0, V["z_br"][0] - 12)[1]), "#555")
    s.text(Sd(ys[0] + 27, 0)[0], Sd(0, V["z_br"][0] - 12)[1] + 0.8, "Bügel", size=2.0, anchor="end", color="#555")
    # Räder (halbtransparent, damit Stifte und Bügel dahinter sichtbar bleiben)
    for sy in (V["wheelbase"] / 2, -V["wheelbase"] / 2):
        c = Sd(sy, V["wheel_d"] / 2)
        s.circle(c, S * V["wheel_d"] / 2, cls="w2"); s.circle(c, 2.2, cls="v", fill="#fff")
        s.line((c[0] - 3.2, c[1]), (c[0] + 3.2, c[1]), cls="i"); s.line((c[0], c[1] - 3.2), (c[0], c[1] + 3.2), cls="i")
    s.text(Sd(V["wheelbase"] / 2, 0)[0], Sd(0, V["wheel_d"] / 2)[1] - 4.5, "Achse", size=2.1, color="#555")
    # Maße Seite
    cf, cr = Sd(V["wheelbase"] / 2, V["wheel_d"] / 2), Sd(-V["wheelbase"] / 2, V["wheel_d"] / 2)
    s.hdim(cf[0], cr[0], GY + 12, 12, "wheelbase", GREEN, feats=[cf, cr], above=False)
    wt = Sd(V["wheelbase"] / 2, V["wheel_d"])
    s.vdim(GY, wt[1], 62, 9, "wheel_d", GREEN, feats=[(wt[0] - S * V["wheel_d"] / 2, wt[1])], side="left")
    bf = Sd(ys[0] + brw / 2 + 3, V["z_br"][0])
    s.vdim(GY, bf[1], 48, "13v", "H_Bügel vorn", GREEN, feats=[bf], side="left", label_y=bf[1] - 2.2)
    pf = Sd(ys[0], V["z_br"][0] + ph)
    s.hdim(cf[0], pf[0], 21, 8, "e_f (opt.)", GREEN, feats=[cf, Sd(ys[0], V["z_br"][0])], tdx=-11)
    # Höhen rechts: höchste Linie innen, Beschriftung über dem eigenen Linienende
    capr = Sd(ys[1] + V["cap"][0][0] + 5, Z_OBST)
    s.vdim(GY, capr[1], 238, 14, "H_Hind", GREEN, feats=[capr], side="right", label_y=capr[1] - 2.2)
    br = Sd(ys[1] - brw / 2 - 3, V["z_br"][1])
    s.vdim(GY, br[1], 250, "13h", "H_Bügel hinten", GREEN, feats=[br], side="right", label_y=br[1] + 3.6 + 2.0)
    fl = Sd(V["tub_y0"], V["z_floor"])
    s.vdim(GY, fl[1], 262, 15, "H_Boden", GREEN, feats=[fl], side="right", label_y=fl[1] - 2.2)
    ll = Sd(V["tub_y0"] - 5, zl)
    s.vdim(GY, ll[1], 274, 16, "H_Boden'", GREEN, feats=[ll], side="left", label_y=95.5)
    s.text(271.8, 99.2, "(Fahrwerk voll eingedrückt)", size=2.2, anchor="end", color=GREEN)
    # Hinweis Füße
    s.text(189, 27.8, "Platte waagerecht auf dem höheren Bügel; Füße gleichen 13v/13h aus und halten ≥ 8 mm Luft zu ⑭",
           size=2.2, anchor="end", color=GREEN)
    s.line((78, 104), (64, 104), cls="d", color="#111"); s.arrow((64, 104), (-1, 0), "#111"); s.text(80, 105, "vorn", size=2.5, anchor="start")

    # ---------- Vorderansicht
    FX, FG = 75.0, 182.0
    def F(x, z): return (FX + S * x, FG - S * z)
    def FR(x0, z0, x1, z1, **kw):
        a, b = F(x0, z0), F(x1, z1); s.rect(a[0], a[1], b[0], b[1], **kw)
    s.text(8, 110, "Vorderansicht (Blick von vorn)", size=3.2, anchor="start", weight="bold")
    s.line((10, FG), (140, FG), cls="gr")
    for sx in (V["track"] / 2, -V["track"] / 2):
        FR(sx - V["wheel_w"] / 2, 0, sx + V["wheel_w"] / 2, V["wheel_d"], cls="w", rx=2.5)
        s.line(F(sx, 0), F(sx, V["wheel_d"]), cls="h")
    half = V["tub_x"] / 2
    FR(-half, V["z_floor"], half, V["z_wall"], cls="f")
    FR(-38, V["z_wall"], 38, V["z_gear"], cls="f")
    xf, zb = V["post_f"][0], V["z_br"][0]
    FR(-(xf + 5), zb - brt, xf + 5, zb, cls="m")                                  # Querbügel vorn
    FR(-30, V["z_gear"], 30, zb - brt, cls="m")                                   # Turm-Stütze
    for sx in (xf, -xf):
        FR(sx - pd / 2, zb, sx + pd / 2, zb + ph - pd / 2, cls="p"); s.circle(F(sx, zb + ph - pd / 2), S * pd / 2, cls="p")
        s.circle(F(sx, zb + hh), 0.55, cls="v", fill="#fff")
        if FEET[0] > 0.05:
            FR(sx - 9, zb, sx + 9, Z_PLATE, cls="g")
        if BOSS[0] > 0.05:
            FR(sx - V["boss_d"] / 2, Z_PLATE + V["plate_t"], sx + V["boss_d"] / 2, Z_PLATE + V["plate_t"] + BOSS[0], cls="g")
    FR(-(xf + V["bar_margin"]), Z_PLATE, xf + V["bar_margin"], Z_PLATE + V["plate_t"], cls="g")
    cl, cr2 = F(-V["track"] / 2, V["wheel_d"] / 2), F(V["track"] / 2, V["wheel_d"] / 2)
    s.hdim(cl[0], cr2[0], FG + 10, 11, "track  (Radmitte–Radmitte)", GREEN, feats=[cl, cr2], above=False)
    wa, wb = F(V["track"] / 2 - V["wheel_w"] / 2, V["wheel_d"]), F(V["track"] / 2 + V["wheel_w"] / 2, V["wheel_d"])
    s.hdim(wa[0], wb[0], 132, 10, "wheel_w = 50", GREEN, feats=[wa, wb])
    pa, pb = F(-xf, zb + ph), F(xf, zb + ph)
    s.hdim(pa[0], pb[0], 117, 1, "front_span = 73 (wie Blatt 1)", BLUE, feats=[pa, pb])
    ta, tb = F(-half, V["z_floor"]), F(half, V["z_floor"])
    s.hdim(ta[0], tb[0], FG + 4.5, 5, "B (opt.)", GREEN, feats=[ta, tb], above=False)

    # ---------- Stift-Detail (Schnitt durch die Stiftmitte)
    K = 1.6; DX, DZ = 222.0, 200.0; zb = 0.0                                       # lokal: z = 0 Bügel-Oberkante
    def D(u, z): return (DX + K * u, DZ - K * (z + 6.0))
    def DR(u0, z0, u1, z1, **kw):
        a, b = D(u0, z0), D(u1, z1); s.rect(a[0], a[1], b[0], b[1], **kw)
    s.text(160, 110, "Stift-Detail", size=3.2, anchor="start", weight="bold")
    s.text(160, 114, "Schnitt durch die Stiftmitte: Bügelende, Stift mit Querloch, Platte, Buchse, Clip", size=2.3, anchor="start", color="#444")
    plate0 = FEET[0]; bossH = BOSS[0]                                             # Beispiel: vorderer Stift
    DR(-16, -6, 16, -brt, cls="m"); DR(-9, -brt, 9, 0, cls="m")                   # Turm-Stütze, Bügel
    s.text(D(18, -3)[0], D(0, -3)[1] + 0.9, "Bügelende (Auflage)", size=2.1, anchor="start", color="#555")
    DR(-pd / 2, 0, pd / 2, ph - pd / 2, cls="p"); s.circle(D(0, ph - pd / 2), K * pd / 2, cls="p")
    s.circle(D(0, hh), K * 1.0, cls="v", fill="#fff")                               # Querloch
    if plate0 > 0.05:
        DR(-9, 0, 9, plate0, cls="g")                                              # Fuß
    DR(-26, plate0, 26, plate0 + V["plate_t"], cls="g")                           # Platte
    DR(-V["boss_d"] / 2, plate0 + V["plate_t"], V["boss_d"] / 2, plate0 + V["plate_t"] + bossH, cls="g")   # Buchse
    s.line(D(-8, hh), D(8, hh), cls="v", w=0.7); s.circle(D(10.2, hh), 1.6, cls="v")   # Clip
    # Maße Detail
    s.hdim(D(-pd / 2, 0)[0], D(pd / 2, 0)[0], D(0, ph + 4)[1], 4, "Stift-Ø", BLUE, feats=[D(-pd / 2, ph - pd / 2), D(pd / 2, ph - pd / 2)])
    h0, h1 = D(pd / 2 + 1, 0), D(pd / 2 + 1, hh)
    s.vdim(h0[1], h1[1], D(0, 0)[0] + 22, "4a", "Querloch über Bügel", GREY, feats=[D(pd / 2, 0), D(1.0, hh)], side="right", label_y=h1[1] + 1.0)
    t1 = D(0, ph)
    s.vdim(h0[1], t1[1], D(0, 0)[0] + 32, "4b", "Stifthöhe", GREY, feats=[D(0, ph)], side="right", label_y=t1[1] - 1.0)
    # Beschriftung links mit Leitlinien
    s.leader(D(-8, hh), (186, 141), "#111"); s.text(185, 141.8, "Original-Clip im Querloch, liegt auf der Buchse", size=2.2, anchor="end")
    s.leader(D(-V["boss_d"] / 2, plate0 + V["plate_t"] + bossH / 2), (186, 150), GREY)
    s.text(185, 150.8, "Buchse (Adapter): bis 1 mm unter das Querloch", size=2.2, anchor="end", color=GREY)
    s.leader(D(-26, plate0 + V["plate_t"] / 2), (186, 159), GREY); s.text(185, 159.8, "Adapterplatte 4 mm, Loch = ④ + 0,5", size=2.2, anchor="end", color=GREY)
    if plate0 > 0.05:
        s.leader(D(-9, plate0 / 2), (186, 168), GREY); s.text(185, 168.8, "Fuß: gleicht 13v/13h aus, hält Luft zu ⑭", size=2.2, anchor="end", color=GREY)
    s.leader(D(-9, -1.5), (186, 177), GREEN); s.tag(185, 177.8, 13, "Bügel-Oberkante → H_Bügel über Tisch (vorn, hinten)", GREEN, anchor="end", size=2.3)
    s.leader(D(-pd / 2, 3), (186, 186), "#111"); s.text(185, 186.8, "Karosserie-Stift mit Kugelkopf (einer von vier)", size=2.2, anchor="end")
    return s


# ================================================================== Blatt 3: Messblatt
# (Nr, Farbe, Maß, So messen (Zeilen), Skript/Formel (Zeilen)); Gruppenzeilen als String
ROWS = [
    "Pflicht für den Adapter — damit läuft das Skript und die Platte kommt als STL",
    (1, BLUE, "front_span", ["Vordere Stifte, Mitte–Mitte quer. Messschieber außen–außen minus ④."], ["POSTS front_span"]),
    (2, BLUE, "rear_span", ["Hintere Stifte, ebenso."], ["POSTS rear_span"]),
    (3, BLUE, "pitch_y", ["Vorderer zu hinterem Stift, Mitte–Mitte längs. Ohne Lineal: Blatt 4", "(A4-Blatt 297 − Rest, Krepp + 100-mm-Schritt oder Papiermaßstab)."], ["POSTS pitch_y"]),
    (4, BLUE, "Stift-Ø", ["Stift-Durchmesser am Schaft (nicht am Kopf), Messschieber."], ["POSTS post_d = ④ + 0,5"]),
    ("4a", BLUE, "Querloch", ["Mitte des Querlochs über der Bügel-Oberkante (Tiefenmaß vom", "Kopf: 4b minus Abstand Kopf–Loch)."], ["POSTS hole_h", "Buchse = 4a − 1 − 4 − Fuß"]),
    ("4b", BLUE, "Stifthöhe", ["Stift über Bügel-Oberkante bis zum Kugelkopf (Tiefenmaß)."], ["POSTS post_h (Kontrolle: Clip braucht", "≈ 3 mm Stift über der Buchse)"]),
    ("13v", GREEN, "H_Bügel v", ["Bügel-Oberkante vorn über Tisch (Auflage der Platte), Normallage."], ["CHASSIS mount_top = (13v, 13h)"]),
    ("13h", GREEN, "H_Bügel h", ["Bügel-Oberkante hinten über Tisch. Ungleich ⇒ Füße gleichen aus."], ["Füße = max(13v, 13h, ⑭ + 8) − 13v/13h"]),
    (14, GREEN, "H_Hind", ["Höchster Punkt zwischen den Bügeln innerhalb ± 85 mm quer über Tisch:", "Dämpferkappen, Turm, Motor, Kabel."], ["CHASSIS obst"]),
    "Später, für Hüllkörper und Simulation — Auto steht ja da, aber nicht heute nötig",
    (9, GREEN, "wheel_d", ["Reifen-Außendurchmesser (Lineal/Blatt 4 über die Radmitte)."], ["CHASSIS wheel_d"]),
    (10, GREEN, "wheel_w", ["Reifenbreite, Messschieber an der breitesten Stelle."], ["CHASSIS wheel_w"]),
    (11, GREEN, "track", ["Radmitte–Radmitte quer = außen–außen über beide Reifen minus ⑩."], ["CHASSIS track"]),
    (12, GREEN, "wheelbase", ["Achsmitte–Achsmitte längs (gleiche Nabenkante vorn und hinten)."], ["CHASSIS wheelbase"]),
    (15, GREEN, "H_Boden", ["Chassis-Unterseite über Tisch, Normallage, Akku eingelegt."], ["CHASSIS floor"]),
    (16, GREEN, "H_Boden'", ["Wie ⑮, Auto mit beiden Händen voll eingedrückt (Fahrwerk am Anschlag)."], ["wheel_lift = ⑮ − ⑯"]),
    (5, GREEN, "B", ["Optional: Chassis-Breite an der breitesten Stelle unter der Platte."], ["CHASSIS tub[0]  (fehlt ⇒ aus Stiftbild)"]),
    (6, GREEN, "d_f / d_r", ["Optional: Chassis-Vorderkante vor dem vorderen Stift (⑥), Hinterkante", "hinter dem hinteren Stift (⑦)."], ["tub[1] = ③ + ⑥ + ⑦;  tub_y = (⑥ − ⑦)/2"]),
    (8, GREEN, "e_f", ["Optional: vordere Achsmitte vor dem vorderen Stift (negativ = dahinter)."], ["axle_y = (⑧ − e_r)/2, e_r = ⑫ − ③ − ⑧"]),
    (17, GREY, "offset_y", ["Keine Messung: Halterfeld längs gegen die Stift-Mitte, 0 = mittig."], ["POSTS offset_y (Wahl, Start 0)"]),
]
CHECKS = [
    ("A", "Akku mit aufgesetzter Platte wechselbar (Klett lösen, herausziehen)?  ☐ ja  ☐ nein  — sonst offset_y oder Plattenform anpassen"),
    ("B", "Bind-Taster und Empfänger-Stecker mit aufgesetzter Platte erreichbar?  ☐ ja  ☐ nein"),
    ("C", "Ansatzpunkte der Fangkorb-Streben auf Blatt 1 einzeichnen. Foto eines Stifts mit Clip von der Seite, Lineal oder Messschieber im Bild."),
]


def sheet3() -> Sheet:
    s = Sheet("Blatt 3 — Messblatt",
              "Werte in mm eintragen, Nummern wie auf Blatt 1 und 2; bereits gemessene Werte stehen grau im Feld. "
              "Rechte Spalte: Zielfeld in halter60_freecad.py (POSTS / CHASSIS).", "Blatt 3/4", legend=False)
    s.frame()
    cols = [8, 17, 44, 158, 184, W - 8]          # Nr | Maß | So messen | Wert | Skript
    heads = ["Nr", "Maß", "So messen", "Wert [mm]", "Skript / Umrechnung"]
    y = 19.0; hh = 5.6
    s.rect(cols[0], y, cols[-1], y + hh, cls="th")
    for i, t in enumerate(heads):
        s.text(cols[i] + 1.5, y + 4.0, t, size=2.7, anchor="start", weight="bold")
    y += hh
    rh, gh = 6.6, 4.8
    for row in ROWS:
        if isinstance(row, str):
            s.rect(cols[0], y, cols[-1], y + gh, cls="ts")
            s.text(cols[0] + 1.5, y + 3.4, row, size=2.5, anchor="start", weight="bold", color="#333")
            y += gh
            continue
        num, color, name, how, script = row
        s.rect(cols[0], y, cols[-1], y + rh, cls="tb")
        s.badge((cols[0] + 4.5, y + rh / 2), num, color, r=2.3)
        s.text(cols[1] + 1.5, y + rh / 2 + 0.9, name, size=2.6, anchor="start", color=color, weight="bold", family="Menlo,Consolas,monospace")
        for k, ln in enumerate(how):
            yy = y + (rh / 2 + 0.9 if len(how) == 1 else 2.8 + k * 2.9)
            s.text(cols[2] + 1.5, yy, ln, size=2.25, anchor="start")
        s.rect(cols[3] + 2, y + 1.0, cols[4] - 2, y + rh - 1.0, cls="tb")       # Schreibfeld
        val = MEASURED.get(num if isinstance(num, int) else None)
        if val:
            s.text((cols[3] + cols[4]) / 2, y + rh / 2 + 1.0, val, size=3.0, color="#888", weight="bold")
        for k, ln in enumerate(script):
            yy = y + (rh / 2 + 0.9 if len(script) == 1 else 2.8 + k * 2.9)
            s.text(cols[4] + 1.5, yy, ln, size=2.2, anchor="start", family="Menlo,Consolas,monospace", color="#222")
        for x in cols[1:-1]:                                   # Spaltenlinien nur in Datenzeilen (Gruppenzeilen bleiben frei)
            s.line((x, y), (x, y + rh), cls="tb")
        y += rh
    for x in cols[1:-1]:
        s.line((x, 19), (x, 19 + hh), cls="tb")
    y += 3.5
    s.text(cols[0], y + 2.8, "Kontrollen ohne Zahl", size=2.9, anchor="start", weight="bold"); y += 5.2
    for k, t in CHECKS:
        s.badge((cols[0] + 4.5, y + 1.6), k, GREY, r=2.3)
        s.text(cols[0] + 9, y + 2.6, t, size=2.4, anchor="start"); y += 4.9
    return s


# ================================================================== Blatt 4: Papiermaßstab + Messen ohne Lineal
def ruler(s: Sheet, x0: float, y_edge: float, length: float, y_cut: float):
    """Maßstab mit Messkante oben (y_edge): Striche hängen nach unten, Zahlen darunter; Schnittlinien oben/unten."""
    s.line((x0 - 6, y_edge), (x0 + length + 6, y_edge), cls="gr")
    s.line((x0 - 6, y_cut), (x0 + length + 6, y_cut), cls="h")
    s.line((x0, y_edge - 4), (x0, y_cut + 3), cls="h")                 # Schnitt an der 0
    for mm in range(0, int(length) + 1):
        h = 6.0 if mm % 10 == 0 else 4.0 if mm % 5 == 0 else 2.2
        wdt = 0.3 if mm % 10 == 0 else 0.18
        s.line((x0 + mm, y_edge), (x0 + mm, y_edge + h), cls="v", w=wdt)
        if mm % 10 == 0:
            s.text(x0 + mm, y_edge + 9.2, str(mm), size=2.6, weight="bold" if mm % 50 == 0 else None)
    s.text(x0 + length + 3, y_edge + 9.2, "mm", size=2.4, anchor="start", color="#444")
    s.text(x0 - 1, y_edge - 1.2, "← an der 0 abschneiden, dann liegt 0 an der Kante", size=2.0, anchor="start", color="#555")
    s.text(x0 + length + 5, y_cut - 1.0, "Schnittlinie", size=2.0, anchor="end", color="#555")


def sheet4() -> Sheet:
    s = Sheet("Blatt 4 — Papiermaßstab und Messen ohne Lineal",
              "Nur bei Druck in tatsächlicher Größe (100 %, keine Seitenanpassung) millimetergenau. "
              "Vor dem Gebrauch die Kontrollstrecke mit dem Messschieber prüfen.", "Blatt 4/4", legend=False)
    s.frame()
    L = 275.0
    ruler(s, 10.0, 24.0, L, 44.0)
    ruler(s, 10.0, 52.0, L, 72.0)
    s.text(8, 20.2, "Zwei Streifen zum Ausschneiden (Messkante = dicke Linie oben; Striche 1 / 5 / 10 mm).", size=2.6, anchor="start", color="#444")
    y = 84.0
    s.text(8, y - 3.2, "Kontrollstrecke: Messschieber-Spitzen außen an die beiden Marken, Anzeige muss 100,0 ± 0,3 mm sein. "
                       "Sonst Druck auf 100 % stellen und neu drucken.", size=2.6, anchor="start", color="#444")
    x0 = 60.0
    for x in (x0, x0 + 100.0):
        s.line((x, y), (x, y + 8), cls="v", w=0.3)
    s.line((x0, y + 4), (x0 + 100, y + 4), cls="d", color=BLUE)
    s.arrow((x0, y + 4), (-1, 0), BLUE); s.arrow((x0 + 100, y + 4), (1, 0), BLUE)
    s.text(x0 + 50, y + 2.6, "100,0 mm", size=2.8, color=BLUE, weight="bold")
    s.line((x0 + 150, y), (x0 + 150, y + 8), cls="v", w=0.3)
    s.line((x0 + 100, y + 4), (x0 + 150, y + 4), cls="d", color=GREY)
    s.arrow((x0 + 150, y + 4), (1, 0), GREY)
    s.text(x0 + 125, y + 2.6, "+50 = 150,0", size=2.4, color=GREY)
    y = 104.0
    s.text(8, y, "Ohne Drucker: Strecken über 150 mm mit dem Messschieber allein", size=3.4, anchor="start", weight="bold")
    steps = [
        ("A", "A4-Blatt als Endmaß (297,0 × 210,0 mm; Kopierpapier hält ± 0,5 mm).",
              "Blatt längs an die Stifte legen, kurze Kante bündig an die vordere Kante des vorderen Stifts. Die vordere Kante des",
              "hinteren Stifts auf dem Blattrand markieren. Rest von der Marke bis zum Blattende mit dem Messschieber messen: Maß = 297 − Rest.",
              "Genauso für Spur (⑪, außen–außen minus ⑩) und Radstand (⑫, gleiche Nabenkante); für Breiten die 210-mm-Kante nehmen."),
        ("B", "Malerkrepp als Maßband.",
              "Kreppstreifen längs auf das Chassis kleben, beide Stiftkanten (vorn und hinten, jeweils die vordere) mit spitzem Stift auf",
              "das Krepp übertragen, Streifen abziehen und flach auf den Tisch kleben. Messschieber auf genau 100,0 mm stellen, von der",
              "ersten Marke aus eine Zwischenmarke setzen, Rest zur zweiten Marke messen: Maß = 100 + Rest (bei > 250 mm zweimal 100)."),
        ("C", "Kontrolle unabhängig von der Länge: die beiden Diagonalen des Stiftbilds (vorn-links → hinten-rechts, vorn-rechts →",
              "hinten-links) mit Methode A oder B messen; sie müssen gleich sein. Mit ① = 73 und ② = 84 gilt außerdem",
              "③ = √(Diagonale² − 78,5²), das ist die Gegenprobe für pitch_y.", "", ""),
    ]
    y += 6.5
    for k, *lines in steps:
        s.badge((12.5, y + 1.2), k, GREY, r=2.4)
        s.text(17.5, y + 2.2, lines[0], size=2.7, anchor="start", weight="bold")
        yy = y + 6.4
        for ln in lines[1:]:
            if ln:
                s.text(17.5, yy, ln, size=2.5, anchor="start"); yy += 3.8
        y = yy + 3.2
    s.text(8, H - 9, "Toleranzbudget: das Langloch in der Platte gibt ± 2 mm längs, das Stiftloch ± 0,25 mm quer. "
                     "1 mm Messfehler bei ③ ist unkritisch, bei ① ② ④ nicht.", size=2.5, anchor="start", color="#444")
    return s


def main():
    for i, fn in enumerate((sheet1, sheet2, sheet3, sheet4), start=1):
        out = HERE / f"aufmass-kf10-{i}.svg"
        out.write_text(fn().svg(), encoding="utf-8")
        print("wrote", out.name)


if __name__ == "__main__":
    main()
