#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Zeichnungsgenerator Telefonhalter 60° (Rebounder v3, RB3-HW-003).

Erzeugt aus EINEM Parametersatz (derselbe wie in halter-60.scad):
  halter-60.svg   Zeichnungsblatt A3 quer, Maßstab 1:1, Projektionsmethode 1 (ISO 128)
  halter-60.html  dasselbe Blatt als lokale HTML-Seite mit Erläuterung

Aufruf:  python3 drawing.py          (nur Standardbibliothek)
PDF:     rsvg-convert -f pdf -o halter-60.pdf halter-60.svg
"""
from __future__ import annotations
import math, pathlib
from html import escape as esc

HERE = pathlib.Path(__file__).resolve().parent
DATE = "2026-09-06"

# ------------------------------------------------------------------ Parameter (mm, °)
P = dict(
    tilt=60.0,                 # Kamera-Elevation über der Horizontalen (Sim-Parameter `tilt`)
    phone_len=148.0,           # Testgerät iPhone 16 (147,6): lange Seite, quer zum Fahrzeug (X)
    phone_w=72.0,              # kurze Seite (71,6), liegt entlang der Rampe (u)
    phone_t=8.0,               # Dicke (7,8 ohne Hülle; mit Hülle ≈ 10)
    foam_t=5.0,                # EVA-Moosgummi
    base_t=4.0, base_x=170.0, flange=12.0,
    ramp_len=80.0, lip_h=15.0, lip_t=3.0,
    mount_x=78.0, slot_w=4.5, slot_l=9.0, hole_y=6.0,        # M4-Langlöcher, Mitte 6 vom Rand
    strap_x=(-55.0, 20.0), strap_slot=(22.0, 5.0),             # Klett-Straps 20 mm
    stop_u=(20.0, 50.0), stop_len=8.0, stop_h=12.0, stop_t=3.0, stop_foot=7.0,
    stop_x=(73.5, 76.0, 78.5, 81.0), stop_hole_d=2.5, stop_face=74.0,   # Lochreihe M3, Schraube 4,5 außen
    stop_stagger=6.0,          # Rev B: jede 2. Bohrung um +6 entlang u versetzt (Pitch 2,5 = Ø ⇒ sonst 0 mm Wand)
    cam_u=57.0, cam_x=58.0, cam_r=6.0, plateau=(34.0, 66.0, 50.0, 64.0),  # Hauptobjektiv + Kamera-Pill: X0,X1,u0,u1
    vfov=53.0, hfov=68.0,
)

# ------------------------------------------------------------------ abgeleitete Geometrie
tilt = P["tilt"]; alpha = 90.0 - tilt
ca, sa = math.cos(math.radians(alpha)), math.sin(math.radians(alpha))
bt, fl, RL = P["base_t"], P["flange"], P["ramp_len"]
Ty, Tz = fl + RL * ca, bt                  # Fußpunkt der Rampe (y nach vorn, z nach oben)
Ry, Rz = fl, bt + RL * sa                  # Rampenoberkante hinten

def PU(u, v):
    """Rampen-Koordinaten (u entlang der Rampe nach hinten-oben, v normal nach vorn-oben) -> (y, z)."""
    return (Ty - u * ca + v * sa, Tz + u * sa + v * ca)

lip_t, lip_h = P["lip_t"], P["lip_h"]
lipOB = PU(-lip_t, lip_t * sa / ca)        # Lippe außen unten (auf der Basis)
lipOT = PU(-lip_t, lip_h)                  # Lippe außen oben
lipIT = PU(0.0, lip_h)                     # Lippe innen oben
BASE_Y = math.ceil(lipOT[0] + fl)          # Basislänge in Fahrtrichtung
ft, pw, pt = P["foam_t"], P["phone_w"], P["phone_t"]
foam_u = pw + 6.0
foam = [PU(0, 0), PU(foam_u, 0), PU(foam_u, ft), PU(0, ft)]
phone = [PU(0, ft), PU(pw, ft), PU(pw, ft + pt), PU(0, ft + pt)]
CAM = PU(P["cam_u"], ft + pt)              # Objektiv auf der Rückseite
mount_yc = (P["hole_y"], BASE_Y - P["hole_y"])
HX = P["base_x"] / 2
pl = P["phone_len"] / 2
SEL_I = P["stop_x"].index(P["stop_face"] + 4.5)                  # gewählte Bohrung (Index in stop_x)
def usel(su):
    """u-Lage des montierten Anschlags: Bohrungen mit ungeradem Index liegen in der versetzten Reihe."""
    return su + (SEL_I % 2) * P["stop_stagger"]
sfc = P["stop_face"]

def fmt(v, d=1):
    s = f"{v:.{d}f}"
    if "." in s: s = s.rstrip("0").rstrip(".")
    return s.replace(".", ",")

# ------------------------------------------------------------------ SVG-Helfer
out: list[str] = []
def E(s): out.append(s)
def fpt(x): return f"{x:.2f}"

class View:
    """Lineare Abbildung Bauteil-Koordinaten -> Blatt (mm). kx/ky = ±1 (Spiegelung)."""
    def __init__(self, ox, oy, kx=1, ky=-1): self.ox, self.oy, self.kx, self.ky = ox, oy, kx, ky
    def to(self, p): return (self.ox + self.kx * p[0], self.oy + self.ky * p[1])

def line(a, b, cls="v"):
    E(f'<line class="{cls}" x1="{fpt(a[0])}" y1="{fpt(a[1])}" x2="{fpt(b[0])}" y2="{fpt(b[1])}"/>')

def poly(pts, cls="v", fill=None):
    d = " ".join(f"{fpt(x)},{fpt(y)}" for x, y in pts)
    f = f' fill="{fill}"' if fill else ""
    E(f'<polygon class="{cls}" points="{d}"{f}/>')

def rect(x, y, w, h, cls="v", rx=0):
    r = f' rx="{rx}"' if rx else ""
    E(f'<rect class="{cls}" x="{fpt(x)}" y="{fpt(y)}" width="{fpt(w)}" height="{fpt(h)}"{r}/>')

def circle(c, r, cls="v"):
    E(f'<circle class="{cls}" cx="{fpt(c[0])}" cy="{fpt(c[1])}" r="{fpt(r)}"/>')

def ellipse(c, rx, ry, cls="v"):
    E(f'<ellipse class="{cls}" cx="{fpt(c[0])}" cy="{fpt(c[1])}" rx="{fpt(rx)}" ry="{fpt(ry)}"/>')

def text(x, y, s, size=3.5, anchor="middle", rot=0.0, cls="tx", weight=None):
    tr = f' transform="rotate({rot:.1f} {fpt(x)} {fpt(y)})"' if abs(rot) > 0.01 else ""
    w = f' font-weight="{weight}"' if weight else ""
    E(f'<text class="{cls}" x="{fpt(x)}" y="{fpt(y)}" font-size="{size}" text-anchor="{anchor}"{w}{tr}>{esc(s)}</text>')

def arrow(tip, d, L=3.0, hw=0.6, cls="ar"):
    n = math.hypot(*d); ux, uy = d[0] / n, d[1] / n
    px, py = -uy, ux
    poly([tip, (tip[0] - L * ux + hw * px, tip[1] - L * uy + hw * py),
          (tip[0] - L * ux - hw * px, tip[1] - L * uy - hw * py)], cls)

def vsub(a, b): return (a[0] - b[0], a[1] - b[1])
def vadd(a, b): return (a[0] + b[0], a[1] + b[1])
def vmul(a, k): return (a[0] * k, a[1] * k)

def dim(view, p1, p2, off, label=None, gap=1.0, over=2.0):
    """Maß zwischen zwei Bauteilpunkten. off = Abstand der Maßlinie auf dem Blatt entlang der
    Linksnormalen von p1->p2 (Blattkoordinaten, y nach unten); Vorzeichen wählt die Seite."""
    a, b = view.to(p1), view.to(p2)
    d = vsub(b, a); L = math.hypot(*d)
    if L < 1e-6: return
    u = (d[0] / L, d[1] / L); n = (-u[1], u[0])
    sgn = 1 if off >= 0 else -1
    A, B = vadd(a, vmul(n, off)), vadd(b, vmul(n, off))
    line(vadd(a, vmul(n, sgn * gap)), vadd(a, vmul(n, off + sgn * over)), "t")
    line(vadd(b, vmul(n, sgn * gap)), vadd(b, vmul(n, off + sgn * over)), "t")
    if label is None: label = fmt(math.hypot(p2[0] - p1[0], p2[1] - p1[1]))
    if L >= 9:
        line(A, B, "t"); arrow(A, vmul(u, -1)); arrow(B, u)
    else:  # kurze Maße: Pfeile außen
        line(vadd(A, vmul(u, -5)), vadd(B, vmul(u, 5)), "t"); arrow(A, u); arrow(B, vmul(u, -1))
    t = u                                   # Text lesbar von unten / von rechts, über der Maßlinie
    if t[0] < -1e-6 or (abs(t[0]) < 1e-6 and t[1] > 0): t = vmul(t, -1)
    up = (t[1], -t[0])
    m = vadd(vmul(vadd(A, B), 0.5), vmul(up, 0.9))
    text(m[0], m[1], label, 3.5, "middle", math.degrees(math.atan2(t[1], t[0])))

def angle_dim(view, c, r, a1, a2, label, tsize=3.5, tang=None):
    """Winkelmaß um c (Bauteil-Koordinaten, Grad, mathematisch positiv a1 -> a2)."""
    def pt(a, rr=r): return view.to((c[0] + rr * math.cos(math.radians(a)), c[1] + rr * math.sin(math.radians(a))))
    p1, p2 = pt(a1), pt(a2)
    mid = pt((a1 + a2) / 2); cs = view.to(c)
    cross = (p1[0] - cs[0]) * (mid[1] - cs[1]) - (p1[1] - cs[1]) * (mid[0] - cs[0])
    sweep = 1 if cross > 0 else 0
    E(f'<path class="t" fill="none" d="M {fpt(p1[0])} {fpt(p1[1])} A {r} {r} 0 0 {sweep} {fpt(p2[0])} {fpt(p2[1])}"/>')
    arrow(p1, vsub(pt(a1 - 1), p1)); arrow(p2, vsub(pt(a2 + 1), p2))
    ta = (a1 + a2) / 2 if tang is None else tang
    rad = pt(ta, r + 2.2)
    text(rad[0], rad[1] + 1.2, label, tsize, "middle")

def leader(view, p, dx, dy, label, size=3.0, dot=False, cls="t"):
    a = view.to(p); k = (a[0] + dx, a[1] + dy)
    line(a, k, cls)
    if dot: circle(a, 0.5, "dot")
    else: arrow(a, vsub(a, k), 2.5, 0.5)
    sh = 6 if dx >= 0 else -6
    line(k, (k[0] + sh, k[1]), cls)
    text(k[0] + (1 if dx >= 0 else -1), k[1] - 0.9, label, size, "start" if dx >= 0 else "end")

def hidden_rect(view, x0, y0, x1, y1):
    a, b = view.to((x0, y0)), view.to((x1, y1))
    rect(min(a[0], b[0]), min(a[1], b[1]), abs(b[0] - a[0]), abs(b[1] - a[1]), "h")

def vrect(view, x0, y0, x1, y1, cls="v"):
    a, b = view.to((x0, y0)), view.to((x1, y1))
    rect(min(a[0], b[0]), min(a[1], b[1]), abs(b[0] - a[0]), abs(b[1] - a[1]), cls)

# ------------------------------------------------------------------ Blattaufteilung (A3 quer, 1:1)
W, Hh = 420.0, 297.0
FRAME = (20.0, 10.0, 410.0, 287.0)
YS0 = 96.0                     # gemeinsame Basislinie (Unterseite Halter) Vorderansicht + Schnitt
X0F = 140.0                    # X = 0 der Vorder- und Draufsicht
YT0 = 128.0                    # Draufsicht: hintere Kante (Y = 0)
XS0 = 262.0                    # Schnitt: vordere Kante (Y = BASE_Y) links
FRONT = View(X0F, YS0, 1, -1)              # (X, Z)
TOP = View(X0F, YT0, 1, +1)                # (X, Y)  vorn = unten (Methode 1)
SIDE = View(XS0 + BASE_Y, YS0, -1, -1)     # (Y, Z)  vorn = links (Ansicht von links)

E('<defs>')
E('<pattern id="hatch" patternUnits="userSpaceOnUse" width="2.4" height="2.4" patternTransform="rotate(45)">'
  '<line class="hl" x1="0" y1="0" x2="0" y2="2.4"/></pattern>')
E('<pattern id="hatch2" patternUnits="userSpaceOnUse" width="1.4" height="1.4" patternTransform="rotate(-45)">'
  '<line class="hl2" x1="0" y1="0" x2="0" y2="1.4"/></pattern>')
E('</defs>')
E(f'<rect class="paper" x="0" y="0" width="{W}" height="{Hh}"/>')
rect(*FRAME[:2], FRAME[2] - FRAME[0], FRAME[3] - FRAME[1], "frame")
for x in (85, 150, 215, 280, 345):
    line((x, 10), (x, 13), "t"); line((x, 284), (x, 287), "t")

# ================================================================== VORDERANSICHT (von vorn, Blick nach hinten)
text(X0F, YS0 - 76, "Ansicht von vorn", 5, "middle", cls="vt")
vrect(FRONT, -HX, 0, HX, bt)                                       # Basis
vrect(FRONT, -HX, bt, HX, lipOT[1])                                # Lippe außen
line(FRONT.to((-HX, lipIT[1])), FRONT.to((HX, lipIT[1])))          # Lippe Oberkante innen
line(FRONT.to((-HX, Rz)), FRONT.to((-pl, Rz)))                     # Rampenoberkante (außerhalb Telefon)
line(FRONT.to((pl, Rz)), FRONT.to((HX, Rz)))
line(FRONT.to((-HX, lipIT[1])), FRONT.to((-HX, Rz)))
line(FRONT.to((HX, lipIT[1])), FRONT.to((HX, Rz)))
vrect(FRONT, -pl, lipIT[1], pl, phone[2][1], "ph")                 # Telefon-Rückseite
plX0, plX1, plU0, plU1 = P["plateau"]
hidden_rect(FRONT, plX0, PU(plU0, ft + pt)[1], plX1, PU(plU1, ft + pt)[1])
ellipse(FRONT.to((P["cam_x"], CAM[1])), P["cam_r"], P["cam_r"] * sa, "ph")
circle(FRONT.to((P["cam_x"], CAM[1])), 0.5, "dot")
for sgn in (-1, 1):                                                # Anschläge: Wand + Fuß
    for su0 in P["stop_u"]:
        su = usel(su0)
        z0 = max(PU(su - P["stop_len"] / 2, 0)[1], lipIT[1]); z1 = PU(su + P["stop_len"] / 2, P["stop_h"])[1]
        vrect(FRONT, sgn * sfc, z0, sgn * (sfc + P["stop_t"]), z1)
        vrect(FRONT, sgn * (sfc + P["stop_t"]), z0, sgn * (sfc + P["stop_foot"]), PU(su + P["stop_len"] / 2, 3.0)[1])
for sx in P["strap_x"]:                                            # Straps (Phantom)
    for e in (-P["strap_slot"][0] / 2, P["strap_slot"][0] / 2):
        line(FRONT.to((sx + e, lipOT[1])), FRONT.to((sx + e, phone[2][1])), "ph2")
dim(FRONT, (-HX, 0), (HX, 0), 9)                                            # 170
dim(FRONT, (-pl, phone[2][1]), (pl, phone[2][1]), -4, f"({fmt(P['phone_len'], 0)})")
dim(FRONT, (-HX, 0), (-HX, bt), -7)                                         # 4
dim(FRONT, (-HX, 0), (-HX, lipIT[1]), -15, fmt(lipIT[1], 0))                 # 17
dim(FRONT, (-HX, 0), (-HX, Rz), -23, fmt(Rz, 0))                             # 44
dim(FRONT, (HX, 0), (HX, phone[2][1]), 8, f"({fmt(phone[2][1], 0)})")        # Telefon-Oberkante
leader(FRONT, (P["cam_x"] - P["cam_r"] * 0.7, CAM[1] + P["cam_r"] * sa * 0.7), 8, -16, "Hauptobjektiv, Kameraseite +X")
leader(FRONT, (P["strap_x"][0] - P["strap_slot"][0] / 2 + 1, phone[2][1] - 6), -14, -8, "Klett-Strap 20 (2×)")
leader(FRONT, (sfc + P["stop_t"], PU(usel(P["stop_u"][1]), P["stop_h"] / 2)[1]), 8, -20, "Anschlag (2× je Seite)")

# ================================================================== DRAUFSICHT (unter der Vorderansicht, vorn unten)
text(X0F - HX + 2, YT0 - 4, "Draufsicht", 5, "start", cls="vt")
vrect(TOP, -HX, 0, HX, BASE_Y)
line(TOP.to((-HX, Ry)), TOP.to((HX, Ry)))                        # Rückwand = Rampenoberkante
line(TOP.to((-HX, lipIT[0])), TOP.to((HX, lipIT[0])))            # Lippe innen oben
line(TOP.to((-HX, lipOT[0])), TOP.to((HX, lipOT[0])))            # Lippe außen oben
line(TOP.to((-HX, lipOB[0])), TOP.to((HX, lipOB[0])), "h")       # Lippe außen unten (verdeckt)
vrect(TOP, -pl, foam[1][0], pl, foam[2][0], "fm")                # Schaum-Stirnfläche oben
line(TOP.to((-pl, foam[2][0])), TOP.to((-pl, phone[1][0])), "fm"); line(TOP.to((pl, foam[2][0])), TOP.to((pl, phone[1][0])), "fm")
vrect(TOP, -pl, phone[1][0], pl, phone[2][0], "ph")               # Telefon-Stirnkante oben
vrect(TOP, -pl, phone[2][0], pl, phone[3][0], "ph")               # Telefon-Rückseite
hidden_rect(TOP, plX0, PU(plU0, ft + pt)[0], plX1, PU(plU1, ft + pt)[0])
ellipse(TOP.to((P["cam_x"], CAM[0])), P["cam_r"], P["cam_r"] * ca, "ph")
circle(TOP.to((P["cam_x"], CAM[0])), 0.5, "dot")
text(TOP.to((-22, 52))[0], TOP.to((-22, 52))[1], f"Telefon {fmt(P['phone_len'],0)}×{fmt(P['phone_w'],0)} (iPhone 16)", 3, "middle", cls="pht")
text(TOP.to((-22, 57))[0], TOP.to((-22, 57))[1], "Display liegt auf EVA, Rückseite oben", 2.6, "middle", cls="pht")
for sx in (-P["mount_x"], P["mount_x"]):                          # Langlöcher M4
    for yc in mount_yc:
        a = TOP.to((sx - P["slot_w"] / 2, yc - P["slot_l"] / 2))
        rect(a[0], a[1], P["slot_w"], P["slot_l"], "v", rx=P["slot_w"] / 2)
        line(TOP.to((sx - 5, yc)), TOP.to((sx + 5, yc)), "c"); line(TOP.to((sx, yc - 7)), TOP.to((sx, yc + 7)), "c")
for sx in P["strap_x"]:                                           # Strap-Schlitze + Straps
    for yc in mount_yc:
        a = TOP.to((sx - P["strap_slot"][0] / 2, yc - P["strap_slot"][1] / 2))
        rect(a[0], a[1], P["strap_slot"][0], P["strap_slot"][1], "v", rx=P["strap_slot"][1] / 2)
    for e in (-P["strap_slot"][0] / 2, P["strap_slot"][0] / 2):
        line(TOP.to((sx + e, mount_yc[0] + P["strap_slot"][1] / 2)), TOP.to((sx + e, mount_yc[1] - P["strap_slot"][1] / 2)), "ph2")
for sgn in (-1, 1):                                               # Lochreihen M3 (Zickzack) + Anschläge
    for su0 in P["stop_u"]:
        su = usel(su0)                                            # u-Lage des montierten Klotzes
        y0, y1 = PU(su + P["stop_len"] / 2, 0)[0], PU(su - P["stop_len"] / 2, 0)[0]
        for i, hx in enumerate(P["stop_x"]):
            if abs(hx - (sfc + 4.5)) > 0.1:
                yh = PU(su0 + (i % 2) * P["stop_stagger"], 0)[0]
                in_u = y0 <= yh <= y1
                under_foot = in_u and (hx - P["stop_hole_d"] / 2 >= sfc) and (hx + P["stop_hole_d"] / 2 <= sfc + P["stop_foot"])
                circle(TOP.to((sgn * hx, yh)), P["stop_hole_d"] / 2, "h" if under_foot else "v")
        vrect(TOP, sgn * sfc, y0, sgn * (sfc + P["stop_foot"]), y1)
        line(TOP.to((sgn * (sfc + P["stop_t"]), y0)), TOP.to((sgn * (sfc + P["stop_t"]), y1)))
        circle(TOP.to((sgn * (sfc + 4.5), PU(su, 0)[0])), 1.6, "h")      # Schraubenkopf im Fuß (verdeckt)
line(TOP.to((0, -4)), TOP.to((0, BASE_Y + 4)), "c")               # Mittellinie
cx = P["strap_x"][1]                                              # Schnittlinie A-A
line(TOP.to((cx, -8)), TOP.to((cx, BASE_Y + 5)), "cut")
for yy in (-8, BASE_Y + 5):
    a = TOP.to((cx, yy)); line(a, (a[0] - 6, a[1]), "t"); arrow((a[0] - 6, a[1]), (-1, 0), 3, 0.8)
    text(a[0] - 8, a[1] + 1.6, "A", 5, "end", weight="600")
yb = BASE_Y
chain = [-HX, -P["mount_x"], P["strap_x"][0], P["strap_x"][1], P["mount_x"], HX]
for i in range(len(chain) - 1):
    dim(TOP, (chain[i], yb), (chain[i + 1], yb), 12)
dim(TOP, (HX, 0), (HX, mount_yc[0]), -8)                                   # 6
dim(TOP, (HX, mount_yc[0]), (HX, mount_yc[1]), -8)                         # 92
dim(TOP, (HX, mount_yc[1]), (HX, yb), -8)                                  # 6
dim(TOP, (HX, 0), (HX, PU(P["stop_u"][0], 0)[0]), -16, fmt(PU(P["stop_u"][0], 0)[0], 0))   # Lochreihe 1
dim(TOP, (HX, 0), (HX, PU(P["stop_u"][1], 0)[0]), -24, fmt(PU(P["stop_u"][1], 0)[0], 0))   # Lochreihe 2
leader(TOP, (P["mount_x"] + P["slot_w"] / 2, mount_yc[0]), 7, -9, f"4× Langloch {fmt(P['slot_w'])}×{fmt(P['slot_l'])} (M4)")
leader(TOP, (P["strap_x"][0], mount_yc[1] + P["strap_slot"][1] / 2), -10, 8, f"4× Schlitz {fmt(P['strap_slot'][0])}×{fmt(P['strap_slot'][1])} (Strap)")
leader(TOP, (-P["stop_x"][0] - 1.25, PU(P["stop_u"][1], 0)[0]), -6, -5, f"16× Ø{fmt(P['stop_hole_d'])} (M3)")
leader(TOP, (0, foam[2][0] + 1.2), 30, -6, "EVA 5 (unter Telefon)", dot=True)
text(55, YT0 + BASE_Y + 21, f"Lochreihen: 16× Ø{fmt(P['stop_hole_d'])} selbstschneidend M3, Pitch 2,5 in X, im Zickzack (jede 2. Bohrung +{fmt(P['stop_stagger'],0)} entlang der Rampe, Wand ≥ 2,5).", 2.6, "start")
text(55, YT0 + BASE_Y + 24.4, f"Schraube 4,5 außerhalb der Anschlagfläche — Anschlagfläche ±{fmt(sfc)} für Telefon {fmt(P['phone_len'],0)}.", 2.6, "start")

# ================================================================== SCHNITT A-A (Ansicht von links, vorn = links)
text(XS0 + 8, YS0 - 78.5, "Schnitt A-A (von links)", 5, "start", cls="vt")
sf = (mount_yc[1] - P["strap_slot"][1] / 2, mount_yc[1] + P["strap_slot"][1] / 2)   # Front-Schlitz y
sr = (mount_yc[0] - P["strap_slot"][1] / 2, mount_yc[0] + P["strap_slot"][1] / 2)   # hinterer Schlitz y
main = [(sr[1], 0), (sf[0], 0), (sf[0], bt), lipOB, lipOT, lipIT, (Ty, Tz), (Ry, Rz), (Ry, bt), (sr[1], bt)]
for piece in (main, [(sf[1], 0), (BASE_Y, 0), (BASE_Y, bt), (sf[1], bt)], [(0, 0), (sr[0], 0), (sr[0], bt), (0, bt)]):
    poly([SIDE.to(p) for p in piece], "sec", "url(#hatch)")
poly([SIDE.to(p) for p in foam], "secf", "url(#hatch2)")
poly([SIDE.to(p) for p in phone], "phs")
dk = -3.0                                                          # Deck (Fremdteil) + Dämpfer
poly([SIDE.to((-8, dk)), SIDE.to((BASE_Y + 8, dk)), SIDE.to((BASE_Y + 8, dk - 2)), SIDE.to((-8, dk - 2))], "secf", "url(#hatch2)")
for yc in mount_yc:
    hidden_rect(SIDE, yc - P["slot_l"] / 2, 0, yc + P["slot_l"] / 2, bt)
    a = SIDE.to((yc + 3, 0)); rect(a[0], a[1], 6, 3, "h")
    line(SIDE.to((yc, dk - 6)), SIDE.to((yc, bt + 6)), "c")
strap = [(mount_yc[1], 0), (mount_yc[1], bt), lipOT, phone[3], phone[2], (Ry, Rz), (Ry, bt), (mount_yc[0], bt), (mount_yc[0], 0)]
E('<polyline class="strap" fill="none" points="' + " ".join(f"{fpt(x)},{fpt(y)}" for x, y in (SIDE.to(p) for p in strap)) + '"/>')
circle(SIDE.to(CAM), 1.0, "ax"); circle(SIDE.to(CAM), 0.35, "dot")
def ray(deg, L, cls):
    e = (CAM[0] + L * math.cos(math.radians(deg)), CAM[1] + L * math.sin(math.radians(deg)))
    line(SIDE.to(CAM), SIDE.to(e), cls); return e
AXL = 20.0
ax_end = ray(tilt, AXL, "ax")
arrow(SIDE.to(ax_end), vsub(SIDE.to(ax_end), SIDE.to(CAM)), 3.5, 0.8, "arx")
ray(tilt - P["vfov"] / 2, 40, "fov"); ray(tilt + P["vfov"] / 2, 40, "fov")
line(SIDE.to(CAM), SIDE.to((CAM[0] + 30, CAM[1])), "c")                       # Horizont-Bezug
angle_dim(SIDE, CAM, 14, 0, tilt, f"{fmt(tilt, 0)}°", 4.5, tang=13)
angle_dim(SIDE, CAM, 34, tilt - P["vfov"] / 2, tilt + P["vfov"] / 2, f"vFOV {fmt(P['vfov'], 0)}°", 3)
angle_dim(SIDE, (Ty, Tz), 19, 180 - alpha, 180, f"{fmt(alpha, 0)}°", 4)
dim(SIDE, (0, 0), (BASE_Y, 0), -22, fmt(BASE_Y, 0))                          # 104
dim(SIDE, (0, 0), (mount_yc[0], 0), -15)                                     # 6
dim(SIDE, (mount_yc[0], 0), (mount_yc[1], 0), -15)                           # 92
dim(SIDE, (mount_yc[1], 0), (BASE_Y, 0), -15)                                # 6
dim(SIDE, (0, 0), (0, bt), 7)                                                # 4
dim(SIDE, (0, 0), (0, Rz), 15, fmt(Rz, 0))                                   # 44
dim(SIDE, (0, 0), (0, CAM[1]), 23, f"(≈{fmt(CAM[1], 0)})")                    # Objektivhöhe
dim(SIDE, (0, 0), (0, phone[2][1]), 31, f"({fmt(phone[2][1], 0)})")           # Telefon-Oberkante
dim(SIDE, PU(0, 0), PU(0, lip_h), -9, fmt(lip_h, 0))                          # 15 (⊥ Rampe)
axm = (CAM[0] + AXL / 2 * math.cos(math.radians(tilt)), CAM[1] + AXL / 2 * math.sin(math.radians(tilt)))
leader(SIDE, axm, -30, -18, "optische Achse", 3.0, dot=True, cls="fov")
leader(SIDE, ((phone[1][0] + phone[2][0]) / 2 + 3, (phone[1][1] + phone[2][1]) / 2), 8, -8, "Telefon (iPhone 16), Display auf EVA", dot=True)
leader(SIDE, ((foam[1][0] + foam[2][0]) / 2, (foam[1][1] + foam[2][1]) / 2), 10, -3, "EVA 5", dot=True)
leader(SIDE, lipOT, -4, -12, "Lippe 3, ⊥ Rampe", dot=True)
leader(SIDE, (mount_yc[1] - 4, dk - 1.5), 6, 6, "M4×16 + Mutter (Dämpfer 3 optional)", dot=True)
leader(SIDE, (BASE_Y + 6, dk - 1), -4, 12, "Adapterplatte auf Karosserie-Stiften (Aufmaß)", dot=True)
spm = ((phone[3][0] + phone[2][0]) / 2 + 14, (phone[3][1] + phone[2][1]) / 2 - 8)   # Punkt auf der Rückseite
leader(SIDE, spm, -20, -6, "Klett-Strap (im Schnitt)", dot=True)
text(XS0 + 4, YS0 + 7.5, "vorn", 3, "start", cls="mut")
text(XS0 + BASE_Y - 4, YS0 + 7.5, "hinten", 3, "end", cls="mut")

# ================================================================== TABELLEN
TX, TY = 255.0, 134.0
def table(x, y, cols, rows, head, title, size=2.6, rh=4.4):
    text(x, y - 1.5, title, 4, "start", cls="vt", weight="600")
    wsum = sum(cols)
    rect(x, y, wsum, rh * (len(rows) + 1), "tb")
    line((x, y + rh), (x + wsum, y + rh), "v")
    cx_ = x
    for w_ in cols[:-1]:
        cx_ += w_; line((cx_, y), (cx_, y + rh * (len(rows) + 1)), "t")
    for r in range(1, len(rows)): line((x, y + rh * (r + 1)), (x + wsum, y + rh * (r + 1)), "t")
    def row(vals, yy, wgt=None):
        cx2 = x
        for v, w_ in zip(vals, cols):
            text(cx2 + 1.2, yy + rh - 1.3, v, size, "start", weight=wgt); cx2 += w_
    row(head, y, "600")
    for i, rv in enumerate(rows): row(rv, y + rh * (i + 1))
    return y + rh * (len(rows) + 1)

params = [
    ("Kamera-Elevation (tilt)", f"{fmt(tilt,0)}°", "Ackermann-MVP; 75° (holonom) = gleiche Datei, tilt=75"),
    ("Rampenwinkel α = 90° − tilt", f"{fmt(alpha,0)}°", "Telefonebene zur Basis"),
    ("Rampenlänge entlang u", fmt(RL, 0), "Auflage für kurze Seite ≤ 78; Keil massiv, Infill regelt Masse"),
    ("Telefon-Hüllmaß L×B×T", "138–153 × 67–78 × ≤12", "SE 2/3 … 17 Pro; Länge über Anschläge (Pitch 2,5)"),
    ("Gezeichnetes Testgerät", f"{fmt(P['phone_len'],0)} × {fmt(pw,0)} × {fmt(pt,0)}", "iPhone 16: 147,6 × 71,6 × 7,8 ohne Hülle → PROTOCOL.md §1"),
    ("Objektivhöhe über Basisunterseite", f"≈ {fmt(CAM[1],0)}", "+3 Dämpfer + Deckhöhe ⇒ Ziel 0,10–0,15 m über Boden"),
    ("Bohrbild Adapter (Langlöcher)", f"{fmt(2*P['mount_x'],0)} × {fmt(mount_yc[1]-mount_yc[0],0)}", "auf Adapterplatte (Karosserie-Stifte, Aufmaß), ±4,5 in Y einstellbar"),
    ("Masse Halter (FreeCAD, 310 cm³ Hülle)", "≈ 127 g", "PLA, 3 Wände, 15 % Infill; Telefon ≈ 170 g"),
]
yend = table(TX, TY, [46, 30, 79], params, ["Parameter", "Wert", "Bemerkung"], "Parameter (Quelle: drawing.py = halter60_freecad.py = halter-60.scad)")
bom = [
    ("1", "1", "Halter 60°, Druckteil PETG (halter-60-holder.stl aus halter60_freecad.py)"),
    ("2", "4", "Anschlagklotz, Druckteil (halter-60-stop.stl), Fuß 7 × Wand 3"),
    ("3", "1", f"EVA-Moosgummi 5 mm, {fmt(P['phone_len'],0)} × {fmt(foam_u,0)}, aufgeklebt"),
    ("4", "2", "Klett-Strap 20 mm, Länge ≥ 300"),
    ("5", "4", "M4×16 + Mutter (Halter → Adapterplatte; Dämpfer optional)"),
    ("6", "4", "M3×8, selbstschneidend in Ø 2,5 (Anschläge)"),
    ("7", "1", "Adapterplatte Karosserie-Stifte (halter-60-adapter.stl, nach Aufmaß) + 4 Original-Karosserieclips"),
]
table(TX, yend + 9, [10, 12, 133], bom, ["Pos", "Stk", "Bezeichnung"], "Stückliste")

# ================================================================== HINWEISE
NX, NY = 30.0, 259.0
text(NX, NY - 1.2, "Hinweise", 4, "start", cls="vt", weight="600")
notes = [
    "1  Display liegt auf der EVA-Auflage, Rückkamera zeigt nach vorn-oben. Kameraseite = +X (links in Fahrtrichtung). Kein Sichtfenster — Debug per Spiegelung.",
    f"2  Kamera-Elevation {fmt(tilt,0)}° ⇔ Rampe {fmt(alpha,0)}°. Sichtkegel vFOV 53° ({fmt(tilt-26.5)}°–{fmt(tilt+26.5)}°) bleibt frei; Ringstreben und Netz vorn unter 20° Elevation (Bildecken) halten.",
    f"3  Fangkorb-Check: Telefon-Oberkante ≈ {fmt(phone[2][1],0)} über Basis + 3 Dämpfer ⇒ Netzboden ≥ 60 über Deck statt 45 (Systemkonzept). Ringhöhe oder Netztiefe nachziehen.",
    "4  Straps tragen beim Beschleunigen (≤ 1,5 g, Telefon rutscht die Rampe hoch, ≈ 2 N). Querkräfte: Anschläge auf Lochreihe Pitch 2,5 (Zickzack, Rev B) ⇒ ≤ 1,25 Spiel je Seite.",
    f"5  Anbindung (Bohrbild {fmt(2*P['mount_x'],0)} × {fmt(mount_yc[1]-mount_yc[0],0)}, Langlöcher 4,5 × 9) auf Adapterplatte, die wie die Karosserie über die vier Stifte des KF10 MAX gesteckt und mit den Original-Clips gehalten wird (Buchsen bis unter das Querloch, Füße bei ungleichen Bügelhöhen); Lage nach Aufmaß aufmass-kf10.pdf in halter60_freecad.py (POSTS, CHASSIS).",
    "6  Abnahme: Probefahrt, Kamerabild auf Verwacklung prüfen (Bauanleitung 3.4); 20 Randtreffer aus 4 m mit Telefon (T4e). Druck: Basis auf dem Bett, keine Stützen.",
]
for i, n in enumerate(notes):
    text(NX, NY + 3.4 + i * 3.7, n, 2.6, "start")

# ================================================================== SCHRIFTFELD
BX, BY, BW, BH = 230.0, 232.0, 180.0, 55.0
rect(BX, BY, BW, BH, "tb")
line((BX, BY + 12), (BX + BW, BY + 12), "v")
line((BX, BY + 34), (BX + BW, BY + 34), "v")
line((BX + 108, BY), (BX + 108, BY + 34), "v")
text(BX + 3, BY + 5, "Projekt", 2.4, "start", cls="mut")
text(BX + 3, BY + 9.8, "Rebounder v3 — Fangroboter (ballistic-catch-sim)", 3.4, "start", weight="500")
text(BX + 3, BY + 17, "Benennung", 2.4, "start", cls="mut")
text(BX + 3, BY + 25, "Telefonhalter 60°", 7, "start", cls="vt", weight="700")
text(BX + 3, BY + 30.8, "Neigungshalter Smartphone, Kamera-Elevation 60°, Montage über Adapterplatte", 3, "start")
cells = [("Zeichnungs-Nr.", "RB3-HW-003"), ("Blatt", "1 / 1"), ("Maßstab", "1:1  (A3 quer)"), ("Datum", DATE),
         ("Status", "Konzept, Rev B — nicht freigegeben"), ("Gezeichnet", "Claude (Entwurf) für M. Mouroum")]
for i, (k, v) in enumerate(cells):
    yy = BY + 12 + i * 3.6 + 0.2
    text(BX + 110, yy + 2.6, k, 2.3, "start", cls="mut")
    text(BX + 132, yy + 2.6, v, 2.6, "start")
text(BX + 3, BY + 39, "Werkstoff / Verfahren", 2.4, "start", cls="mut")
text(BX + 3, BY + 43.5, "PETG, FDM 0,2 mm, 4 Wände, 20 % Infill", 3, "start")
text(BX + 3, BY + 48.5, "Allgemeintoleranz", 2.4, "start", cls="mut")
text(BX + 3, BY + 53, "ISO 2768-m · Maße in mm · druckroh", 3, "start")
text(BX + 70, BY + 39, "Bezüge", 2.4, "start", cls="mut")
text(BX + 70, BY + 43.5, ".okf/simulation/path-to-80-percent.md (Nachtrag)", 2.4, "start")
text(BX + 70, BY + 47.3, "ml/data/PROTOCOL.md §1 · build-guide.md Abschn. 3", 2.4, "start")
text(BX + 70, BY + 51.1, ".okf/business/open-questions.md (T4e)", 2.4, "start")
sx0, sy0 = BX + 165, BY + 47.5
text(sx0 - 9, sy0 - 7, "Projektionsmethode 1", 2.4, "start", cls="mut")
poly([(sx0 - 9, sy0 - 3), (sx0 - 3, sy0 - 4.5), (sx0 - 3, sy0 + 4.5), (sx0 - 9, sy0 + 3)], "v")
circle((sx0 + 6, sy0), 4.5, "v"); circle((sx0 + 6, sy0), 3.0, "v")
line((sx0 + 6, sy0 - 6), (sx0 + 6, sy0 + 6), "c"); line((sx0 - 11, sy0), (sx0 + 12, sy0), "c")

BODY = "\n".join(out)

# ------------------------------------------------------------------ Ausgabe: SVG (eigenständig, Druckfarben)
SVG_STYLE = """
  .paper{fill:#FCFCFA}
  .frame{fill:none;stroke:#1B2430;stroke-width:.7}
  .v{fill:none;stroke:#1B2430;stroke-width:.5;stroke-linejoin:round;stroke-linecap:round}
  .t{fill:none;stroke:#1B2430;stroke-width:.25;stroke-linecap:round}
  .h{fill:none;stroke:#1B2430;stroke-width:.25;stroke-dasharray:2 1}
  .c{fill:none;stroke:#1B2430;stroke-width:.25;stroke-dasharray:6 1 1 1}
  .cut{fill:none;stroke:#1B2430;stroke-width:.5;stroke-dasharray:8 1.5 1.5 1.5}
  .tb{fill:none;stroke:#1B2430;stroke-width:.5}
  .sec{stroke:#1B2430;stroke-width:.5;stroke-linejoin:round}
  .secf{stroke:#6B7684;stroke-width:.3;stroke-linejoin:round}
  .hl{stroke:#1B2430;stroke-width:.2;opacity:.75}
  .hl2{stroke:#6B7684;stroke-width:.15}
  .fm{fill:none;stroke:#6B7684;stroke-width:.3}
  .ph{fill:none;stroke:#3F6E9E;stroke-width:.35}
  .phs{fill:#3F6E9E;fill-opacity:.14;stroke:#3F6E9E;stroke-width:.35}
  .ph2{fill:none;stroke:#3F6E9E;stroke-width:.25;stroke-dasharray:3 1 .8 1;opacity:.75}
  .strap{stroke:#3F6E9E;stroke-width:.9;stroke-dasharray:2 1.2;opacity:.8;stroke-linejoin:round}
  .ax{fill:none;stroke:#E4762A;stroke-width:.5;stroke-dasharray:6 1.2 1.2 1.2 1.2 1.2}
  .arx{fill:#E4762A;stroke:none}
  .fov{fill:none;stroke:#E4762A;stroke-width:.25;stroke-dasharray:4 1 1 1 1 1;opacity:.85}
  .ar{fill:#1B2430;stroke:none}
  .dot{fill:#1B2430;stroke:none}
  text{font-family:Barlow,"Arial Narrow","Helvetica Neue",Arial,sans-serif;fill:#1B2430}
  .tx{fill:#1B2430} .vt{fill:#1B2430;letter-spacing:.02em} .mut{fill:#6B7684} .axt{fill:#E4762A} .pht{fill:#3F6E9E}
"""
svg_standalone = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{Hh}mm" viewBox="0 0 {W} {Hh}">\n'
                  f'<style>{SVG_STYLE}</style>\n{BODY}\n</svg>\n')
(HERE / "halter-60.svg").write_text(svg_standalone, encoding="utf-8")

# ------------------------------------------------------------------ Ausgabe: HTML (lokale Seite, Themes)
svg_inline = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {Hh}" role="img" '
              f'aria-label="Zeichnungsblatt Telefonhalter 60°: Ansicht von vorn, Draufsicht, Schnitt A-A mit optischer Achse 60°, Parameter, Stückliste, Schriftfeld">\n{BODY}\n</svg>')
page = (HERE / "page.template.html").read_text(encoding="utf-8")
repl = {
    "{{SVG}}": svg_inline, "{{DATE}}": DATE, "{{TILT}}": fmt(tilt, 0), "{{ALPHA}}": fmt(alpha, 0),
    "{{CAMH}}": fmt(CAM[1], 0), "{{PHTOP}}": fmt(phone[2][1], 0), "{{BASEY}}": fmt(BASE_Y, 0),
    "{{BASEX}}": fmt(P["base_x"], 0), "{{RZ}}": fmt(Rz, 0),
    "{{PHONE}}": f"{fmt(P['phone_len'],0)} × {fmt(pw,0)} × {fmt(pt,0)} mm",
    "{{FOVLO}}": fmt(tilt - P["vfov"] / 2), "{{FOVHI}}": fmt(tilt + P["vfov"] / 2),
}
for k, v in repl.items(): page = page.replace(k, v)
(HERE / "halter-60.html").write_text(page, encoding="utf-8")
print(f"BASE_Y={BASE_Y}  T=({Ty:.2f},{Tz:.2f})  R=({Ry:.2f},{Rz:.2f})  lipOT=({lipOT[0]:.2f},{lipOT[1]:.2f})  CAM=({CAM[0]:.2f},{CAM[1]:.2f})  phoneTop={phone[2][1]:.2f}")
print("written: halter-60.svg, halter-60.html")
