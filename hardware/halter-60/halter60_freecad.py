#!/usr/bin/env freecadcmd
# -*- coding: utf-8 -*-
"""
Telefonhalter 60° (Rebounder v3, RB3-HW-003) — FreeCAD-Modell + Druckdateien.

Derselbe Parametersatz wie drawing.py (Zeichnungsblatt) und halter-60.scad.
Erzeugt im Ordner dieser Datei:

  halter-60.FCStd            FreeCAD-Dokument: Holder, Stop, Adapter (falls Aufmaß vorliegt),
                             Baugruppe mit Telefon-Phantom, EVA-Auflage, optischer Achse
  halter-60-holder.stl       Druckteil 1: Keil mit Lippe, Basis, Langlöchern, Strap-Schlitzen, M3-Lochreihen
  halter-60-stop.stl         Druckteil 2: Anschlagklotz (4× drucken)
  halter-60-adapter.stl      Druckteil 3: Adapterplatte auf den vier Karosserie-Stiften (Clips) — nur wenn POSTS ausgefüllt ist
  halter-60-iso.svg          Isometrie der Baugruppe (TechDraw-Projektion, ohne GUI)

Aufruf (Terminal):
  /Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd halter60_freecad.py
Oder in FreeCAD: Makro › Makros… › diese Datei ausführen (öffnet das Dokument im Fenster).

75°-Variante (holonom): P["tilt"] = 75 setzen und neu ausführen.

Koordinaten wie im .scad: X quer zum Fahrzeug (+X = links in Fahrtrichtung), Y nach vorn, Z nach oben.
Rampenkoordinaten: u entlang der Rampe (0 = Fußpunkt an der Lippe, nach hinten-oben),
                   v normal zur Rampe (nach vorn-oben = Blickrichtung der Kamera).
"""
import math, os, sys

import FreeCAD as App
import Part

V = App.Vector
HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()

# ------------------------------------------------------------------ Parameter (mm, °) — identisch zu drawing.py
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
    stop_u=(20.0, 50.0), stop_len=8.0, stop_h=12.0, stop_t=3.0, stop_foot=7.0, stop_foot_t=3.0,
    stop_x=(73.5, 76.0, 78.5, 81.0), stop_hole_d=2.5, stop_index=2,   # Lochreihe M3; Baugruppe: Bohrung 78,5 ⇒ Fläche 74
    stop_stagger=6.0,          # Rev B: jede 2. Bohrung um +6 entlang u versetzt (Pitch 2,5 = Ø ⇒ sonst 0 mm Wand)
    cam_u=57.0, cam_x=58.0,                                     # Hauptobjektiv
)

# Karosserie-Stifte (Fotos Marvin, 2026-09-07): der KF10 MAX trägt die Karosserie auf VIER KURZEN STIFTEN mit
# Kugelkopf, je einer an den Enden eines Querbügels über dem vorderen und hinteren Dämpferturm. Jeder Stift hat
# EIN Querloch für den Original-Karosserieclip — keine Lochreihe, Höhe nicht verstellbar. Die Adapterplatte wird
# über die Stifte gesteckt, liegt auf den Bügelenden (bzw. auf Füßen) und wird mit den vier Clips gehalten;
# eine Buchse je Stift füllt den Raum bis unter das Querloch, damit der Clip die Platte klemmt.
# Erst nach Aufmaß (aufmass-kf10.pdf) ausfüllen. None ⇒ kein Adapter.
# Beispiel: dict(front_span=73, rear_span=84, pitch_y=230, post_d=5.5, hole_h=17.0, post_h=22.0, offset_y=0)
#   front_span / rear_span : Stiftmitte–Stiftmitte der vorderen bzw. hinteren Stifte (X)            Aufmaß ① ②
#   pitch_y                : vorderes zu hinterem Stift-Paar (Y)                                    Aufmaß ③
#   post_d                 : Loch in der Platte = Stift-Ø + 0,5 Spiel                              Aufmaß ④
#   hole_h                 : Mitte des Querlochs über der Bügel-Oberkante (Auflage der Platte)     Aufmaß 4a
#   post_h                 : Stifthöhe über der Bügel-Oberkante bis zum Kopf                       Aufmaß 4b
#   offset_y               : Halterfeld längs gegen die Stift-Mitte verschieben (Wahl, Start 0)     ⑰
POSTS = None
# Aufmass-Stand (Marvin): front_span 73 (2026-09-07), rear_span 84 (2026-09-07), pitch_y 252 (2026-09-10) —
# das Lochbild der Draufsicht ist damit komplett (bohrschablone_adapter.py, 1:1). Offen fuer die Hoehen des
# Adapters (Buchsen, Fuesse): post_d ④, hole_h 4a, post_h 4b, CHASSIS mount_top 13v/13h, obst ⑭. Sobald die
# da sind:  POSTS = dict(front_span=73.0, rear_span=84.0, pitch_y=252.0, post_d=④ + 0.5, hole_h=4a, post_h=4b, offset_y=0.0)
ADAPTER = dict(
    t=4.0,            # Plattendicke
    bar=22.0,         # Mindesttiefe (Y) der Querstege an den Stiften (wächst mit Fuß/Buchse)
    bar_margin=14.0,  # Überstand der Querstege über die Stiftmitte nach außen (X)
    spine_w=44.0,     # Breite des Längsholms zwischen Halterfeld und Querstegen
    slot=4.0,         # Langloch-Zugabe in Y für die Stifte (Aufmaß-Toleranz)
    hole_d=4.5,       # M4-Durchgang für die Halter-Langlöcher
    boss_d=None,      # Buchse um jeden Stift (Ø); None ⇒ post_d + 8
    boss_gap=1.0,     # Buchse endet so weit unter der Querloch-Mitte (Clip liegt auf der Buchse)
    foot_h=None,      # Füße unter der Platte je Achse; None ⇒ aus CHASSIS (Bügelhöhen ausgleichen + Mindestluft)
    foot_pad=6.0,     # Fuß ragt so weit über die Bügel-Auflage (mount) hinaus (je Seite)
    gap_min=8.0,      # Mindestluft Plattenunterseite zu Aufbauten (Dämpferkappen, Turm, Motor, Kabel)
    split=False,      # True ⇒ zwei Hälften (Trennung bei y = 0 unter dem Halter), wenn das Bett zu kurz ist
    bed=(220.0, 220.0),   # Creality Ender-3 Pro
)
# Aufmaß: RC-Plattform (KF10 MAX) als Hüllkörper, damit Halter + Adapter virtuell gegen Wanne/Aufbauten
# und eingefederte Reifen geprüft werden, bevor gedruckt wird. Koordinaten wie der Adapter: X quer,
# Y vorn, Ursprung = Mitte des Stift-Bildes, Z = 0 ist die Adapter-Oberseite (Halter-Basisunterseite).
# Alle Höhen wie auf dem Aufmaßblatt von der Tischplatte (Normallage). None ⇒ übersprungen. Beispiel:
#   CHASSIS = dict(
#       mount_top=(102.0, 110.0),   # Bügel-Oberkante über Tisch vorn / hinten (Auflage der Platte)   ⑬v ⑬h
#       obst=108.0,                 # höchster Punkt zwischen den Bügeln unter der Platte über Tisch  ⑭
#       floor=40.0,                 # Chassis-Unterseite über Tisch                                   ⑮
#       wheel_lift=25.0,            # Einfederweg ⑮ − ⑯: Reifen wandern um so viel nach oben (Prüflage = voll eingefedert)
#       wheel_d=105.0, wheel_w=50.0, track=260.0, wheelbase=275.0,     # ⑨ ⑩ ⑪ ⑫
#       tub=(130.0, 300.0),         # optional: Chassis-Breite X (⑤), Länge Y (③ + ⑥ + ⑦); fehlt ⇒ aus dem Stiftbild
#       tub_y=0.0,                  # optional: Mitte der Wanne in Y relativ zur Stift-Mitte ((⑥ − ⑦) / 2)
#       axle_y=0.0,                 # optional: Achsmitte relativ zur Stift-Mitte (Y); aus ⑧
#       mount=(12.0, 8.0),          # optional: Auflagefläche eines Bügelendes X × Y (Fußgrundriss)
#   )
# Blatt: aufmass-kf10.pdf (Blatt 1–4, Nummern ①…⑰ mit Umrechnung in diese Felder), Generator aufmass_kf10.py.
CHASSIS = None
MESH = dict(LinearDeflection=0.02, AngularDeflection=math.radians(5), Relative=False)

# ------------------------------------------------------------------ abgeleitete Geometrie
tilt = P["tilt"]; alpha = 90.0 - tilt
ca, sa = math.cos(math.radians(alpha)), math.sin(math.radians(alpha))
bt, fl, RL = P["base_t"], P["flange"], P["ramp_len"]
Ty, Tz = fl + RL * ca, bt                  # Fußpunkt der Rampe (y nach vorn, z nach oben)
Ry, Rz = fl, bt + RL * sa                  # Rampenoberkante hinten


def PU(u, v):
    """Rampen-Koordinaten (u, v) -> (y, z)."""
    return (Ty - u * ca + v * sa, Tz + u * sa + v * ca)


lip_t, lip_h = P["lip_t"], P["lip_h"]
lipOB = PU(-lip_t, lip_t * sa / ca)        # Lippe außen unten (auf der Basis)
lipOT = PU(-lip_t, lip_h)                  # Lippe außen oben
lipIT = PU(0.0, lip_h)                     # Lippe innen oben
BASE_Y = math.ceil(lipOT[0] + fl)          # Basislänge in Fahrtrichtung
mount_yc = (P["hole_y"], BASE_Y - P["hole_y"])
HX = P["base_x"] / 2
CAM = PU(P["cam_u"], P["foam_t"] + P["phone_t"])
PHTOP = PU(P["phone_w"], P["foam_t"] + P["phone_t"])[1]

# Rampen-Frame: lokal Y = -u (die Rampe hinunter), lokal Z = +v. Entspricht `ramp_frame()` im .scad.
RAMP = App.Placement(V(0, Ty, Tz), App.Rotation(V(1, 0, 0), -alpha))


def in_ramp(shape):
    s = shape.copy(); s.transformShape(RAMP.toMatrix()); return s


def slot_z(cx, cy, length_x, width, z0, h):
    """Langloch in der XY-Ebene (Achse Z): Länge entlang X, Breite (Ø) quer; Hull zweier Zylinder."""
    r = width / 2; d = (length_x - width) / 2
    body = Part.makeBox(2 * d, width, h, V(cx - d, cy - r, z0)) if d > 1e-6 else None
    cyls = [Part.makeCylinder(r, h, V(cx - d, cy, z0)), Part.makeCylinder(r, h, V(cx + d, cy, z0))]
    s = cyls[0].fuse(cyls[1])
    return s.fuse(body) if body else s


def slot_y(cx, cy, length_y, width, z0, h):
    """Langloch mit Länge entlang Y."""
    s = slot_z(0, 0, length_y, width, z0, h)
    s.rotate(V(0, 0, 0), V(0, 0, 1), 90); s.translate(V(cx, cy, 0)); return s


# ------------------------------------------------------------------ Halter
def make_holder():
    prof = [(0, 0), (BASE_Y, 0), (BASE_Y, bt), lipOB, lipOT, lipIT, (Ty, Tz), (Ry, Rz), (Ry, bt), (0, bt)]
    wire = Part.makePolygon([V(-HX, y, z) for y, z in prof] + [V(-HX, *prof[0])])
    body = Part.Face(wire).extrude(V(P["base_x"], 0, 0))
    tools = []
    for sx in (-P["mount_x"], P["mount_x"]):                       # M4-Langlöcher (Länge in Y)
        for yc in mount_yc:
            tools.append(slot_y(sx, yc, P["slot_l"], P["slot_w"], -1, bt + 2))
    for sx in P["strap_x"]:                                        # Strap-Schlitze (Länge in X)
        for yc in mount_yc:
            tools.append(slot_z(sx, yc, P["strap_slot"][0], P["strap_slot"][1], -1, bt + 2))
    for s in (-1, 1):                                              # M3-Lochreihen, Achse normal zur Rampe, Zickzack
        for su in P["stop_u"]:
            for i, hx in enumerate(P["stop_x"]):
                u = su + (i % 2) * P["stop_stagger"]
                c = Part.makeCylinder(P["stop_hole_d"] / 2, 20, V(s * hx, -u, -10))
                tools.append(in_ramp(c))
    body = body.cut(Part.makeCompound(tools)).removeSplitter()
    return body


# ------------------------------------------------------------------ Anschlagklotz (L-Profil)
# lokal: X nach außen (0 = Anschlagfläche zum Telefon), Y entlang u, Z = v (liegt auf der Rampe). Drucklage = so.
def make_stop():
    L, h, t, foot, ft = P["stop_len"], P["stop_h"], P["stop_t"], P["stop_foot"], P["stop_foot_t"]
    body = Part.makeBox(foot, L, ft).fuse(Part.makeBox(t, L, h))
    hole = Part.makeCylinder(1.6, ft + 2, V(4.5, L / 2, -1))
    head = Part.makeCylinder(3.0, 2.0, V(4.5, L / 2, ft - 0.6))    # flache Kopfsenkung
    return body.cut(Part.makeCompound([hole, head])).removeSplitter()


def place_stop(stop, side, su, face):
    """Anschlag in Fahrzeugkoordinaten: Seite ±1, Lochreihe u = su, Anschlagfläche bei |x| = face."""
    s = stop.copy()
    if side < 0:
        s = s.mirror(V(0, 0, 0), V(1, 0, 0))
    s.translate(V(side * face, -su - P["stop_len"] / 2, 0))
    return in_ramp(s)


# ------------------------------------------------------------------ Adapterplatte auf den Karosserie-Stiften
def mount_tops(ch):
    """Bügel-Oberkante vorn/hinten über Tisch; ein Wert gilt für beide Achsen."""
    mt = ch["mount_top"]
    return (float(mt), float(mt)) if isinstance(mt, (int, float)) else (float(mt[0]), float(mt[1]))


def adapter_geometry(posts, A, ch):
    """Abgeleitete Höhen (alle über Tisch): Plattenunterseite, Füße und Buchsen je Achse (vorn, hinten).
    Ohne Hüllkörper: Platte liegt direkt auf den Bügeln, keine Füße."""
    g = dict(A)
    if ch:
        mt_f, mt_r = mount_tops(ch)
        z_ref = max(mt_f, mt_r)
        if A["foot_h"] is not None:
            plate = z_ref + float(A["foot_h"])
        else:
            plate = max(z_ref, ch["obst"] + A["gap_min"])            # Luft zu den Aufbauten, Bügelhöhen ausgleichen
        g["feet"] = (plate - mt_f, plate - mt_r)
        g["plate_under"] = plate
        holes = (mt_f + posts["hole_h"], mt_r + posts["hole_h"])       # Querloch-Mitte über Tisch
        g["boss"] = tuple(h - A["boss_gap"] - (plate + A["t"]) for h in holes)
        g["tips"] = (mt_f + posts["post_h"], mt_r + posts["post_h"])
    else:
        g["feet"] = (0.0, 0.0); g["plate_under"] = None
        g["boss"] = (posts["hole_h"] - A["boss_gap"] - A["t"],) * 2
        g["tips"] = None
    g["boss_d"] = A["boss_d"] if A["boss_d"] else posts["post_d"] + 8.0
    return g


def make_adapter(posts, G):
    """G = adapter_geometry(...): Platte, Querstege, Längsholme, Füße (je Achse) und Buchsen um die Stifte."""
    t = G["t"]; half = posts["pitch_y"] / 2; oy = posts.get("offset_y", 0.0)
    d = posts["post_d"]                                              # Stiftloch (Spiel schon enthalten)
    bd = G["boss_d"]
    mx, my = G.get("mount", (12.0, 8.0))
    fx, fy = max(mx + 2 * G["foot_pad"], bd), max(my + 2 * G["foot_pad"] + G["slot"], bd + G["slot"])
    bar = max(G["bar"], fy, bd + G["slot"] + 2)
    # Halterfeld liegt bei y ∈ [oy - BASE_Y/2, oy + BASE_Y/2]; Stifte bei y = ±half.
    parts = [Part.makeBox(P["base_x"], BASE_Y, t, V(-HX, oy - BASE_Y / 2, 0))]
    for k, (sgn, span) in enumerate(((1, posts["front_span"]), (-1, posts["rear_span"]))):
        yc = sgn * half
        w = span + 2 * G["bar_margin"]
        parts.append(Part.makeBox(w, bar, t, V(-w / 2, yc - bar / 2, 0)))
        y_edge = oy + sgn * BASE_Y / 2
        y0, y1 = sorted((y_edge, yc))
        if y1 - y0 > 0.1:
            parts.append(Part.makeBox(G["spine_w"], y1 - y0, t, V(-G["spine_w"] / 2, y0, 0)))
        fh, bh = G["feet"][k], G["boss"][k]
        for sx in (-span / 2, span / 2):
            if fh > 1e-6:                                            # Fuß unter der Platte
                parts.append(Part.makeBox(fx, fy, fh, V(sx - fx / 2, yc - fy / 2, -fh)))
            if bh > 1e-6:                                            # Buchse bis unter das Querloch (Langloch-Hülle)
                parts.append(slot_y(sx, yc, bd + G["slot"], bd, t, bh))
    body = parts[0]
    for p in parts[1:]:
        body = body.fuse(p)
    tools = []
    for sx in (-P["mount_x"], P["mount_x"]):                       # M4 zum Halter (Halter-Langlöcher liegen darüber)
        for yc in mount_yc:
            tools.append(Part.makeCylinder(G["hole_d"] / 2, t + 2, V(sx, oy - BASE_Y / 2 + yc, -1)))
    for k, (sgn, span) in enumerate(((1, posts["front_span"]), (-1, posts["rear_span"]))):
        fh, bh = max(G["feet"][k], 0.0), max(G["boss"][k], 0.0)
        for sx in (-span / 2, span / 2):                             # Stiftlöcher durch Fuß, Platte und Buchse
            tools.append(slot_y(sx, sgn * half, d + G["slot"], d, -fh - 1, fh + t + bh + 2))
    body = body.cut(Part.makeCompound(tools)).removeSplitter()
    if G["split"]:
        bb = body.BoundBox
        hz = bb.ZLength + 2
        front = body.common(Part.makeBox(bb.XLength + 2, bb.YMax + 1, hz, V(bb.XMin - 1, 0, bb.ZMin - 1)))
        rear = body.common(Part.makeBox(bb.XLength + 2, -bb.YMin + 1, hz, V(bb.XMin - 1, bb.YMin - 1, bb.ZMin - 1)))
        return [("AdapterFront", front), ("AdapterRear", rear)]
    return [("Adapter", body)]


# ------------------------------------------------------------------ Chassis-Hüllkörper (Aufmaß, Prüfmodell)
def make_chassis(ch, posts, G):
    """Wanne/Aufbauten, vier Bügelenden mit Stiften und Reifen (voll eingefedert) in Adapter-Koordinaten;
    liefert (Liste[(Name, Shape)], Hindernisse). Alle Höhen in ch sind Tischhöhen; der Tisch liegt bei z_ground."""
    t = G["t"]; z_plate = -t                                         # Adapter-Unterseite (Platte)
    z_ground = z_plate - G["plate_under"]                            # Tisch
    z_floor, z_obst = z_ground + ch["floor"], z_ground + ch["obst"]
    mt = mount_tops(ch)
    half = posts["pitch_y"] / 2; mx, my = G.get("mount", (12.0, 8.0))
    spans = (posts["front_span"], posts["rear_span"])
    tw, tl = ch.get("tub", (max(spans) + 2 * G["bar_margin"] + 40.0, posts["pitch_y"] + 80.0))
    tub = Part.makeBox(tw, tl, z_obst - z_floor, V(-tw / 2, ch.get("tub_y", 0.0) - tl / 2, z_floor))
    fx = max(mx + 2 * G["foot_pad"], G["boss_d"]) + 2                # Fußgrundriss + 1 mm Rand
    fy = max(my + 2 * G["foot_pad"] + G["slot"], G["boss_d"] + G["slot"]) + 2
    mounts = []
    for k, (sgn, span) in enumerate(((1, spans[0]), (-1, spans[1]))):
        z_mount = z_ground + mt[k]
        for sx in (-span / 2, span / 2):
            yc = sgn * half; tag = f"{'F' if sgn > 0 else 'R'}{'L' if sx > 0 else 'R'}"
            mounts.append((f"C_Mount_{tag}", Part.makeBox(mx, my, z_mount - z_floor, V(sx - mx / 2, yc - my / 2, z_floor))))
            mounts.append((f"C_Post_{tag}", Part.makeCylinder((posts["post_d"] - 0.5) / 2, posts["post_h"], V(sx, yc, z_mount))))
            if z_obst > z_mount + 1e-6:      # Der Quader steht bis zum höchsten Hindernis; über den Bügelenden ist er frei
                tub = tub.cut(Part.makeBox(fx, fy, z_obst - z_mount + 1, V(sx - fx / 2, yc - fy / 2, z_mount)))
    parts = [("C_Tub", tub)] + mounts
    zc = z_ground + ch["wheel_d"] / 2 + ch["wheel_lift"]             # Radmitte in Prüflage
    ay = ch.get("axle_y", 0.0)                                       # Achsmitte relativ zur Post-Mitte
    wheels = []
    for sy in (ay + ch["wheelbase"] / 2, ay - ch["wheelbase"] / 2):
        for sx in (-1, 1):
            x0 = sx * ch["track"] / 2 - ch["wheel_w"] / 2
            wheels.append(Part.makeCylinder(ch["wheel_d"] / 2, ch["wheel_w"], V(x0, sy, zc), V(1, 0, 0)))
    parts += [(f"C_Wheel{i+1}", w) for i, w in enumerate(wheels)]
    parts.append(("C_Ground", Part.makeBox(ch["track"] + 120, ch["wheelbase"] + 240, 1,
                                           V(-(ch["track"] + 120) / 2, ay - (ch["wheelbase"] + 240) / 2, z_ground - 1))))
    return parts, Part.makeCompound([tub] + wheels)


# ------------------------------------------------------------------ Phantome (Baugruppe)
def make_phantoms():
    ft, pw, pt, pl = P["foam_t"], P["phone_w"], P["phone_t"], P["phone_len"]
    foam = in_ramp(Part.makeBox(pl, pw + 6, ft, V(-pl / 2, -(pw + 6), 0)))
    phone = in_ramp(Part.makeBox(pl, pw, pt, V(-pl / 2, -pw, ft)))
    lens = in_ramp(Part.makeCylinder(6, 1.5, V(P["cam_x"], -P["cam_u"], ft + pt)))
    axis = in_ramp(Part.makeCylinder(0.6, 150, V(P["cam_x"], -P["cam_u"], ft + pt)))
    return foam, phone, lens, axis


# ------------------------------------------------------------------ Vernetzung
def mesh_of(shape):
    """STL-Netz Fläche für Fläche (der Standard-Mesher scheitert am Gesamtkörper mit MEFISTO-Fehler),
    danach Punkte zusammenführen ⇒ geschlossenes Netz."""
    import Mesh, MeshPart
    m = Mesh.Mesh()
    for f in shape.Faces:
        m.addMesh(MeshPart.meshFromShape(Shape=f, **MESH))
    m.removeDuplicatedPoints()
    return m


# ------------------------------------------------------------------ Aufbau des Dokuments
def add(doc, name, shape, color=None):
    obj = doc.addObject("Part::Feature", name); obj.Shape = shape
    if App.GuiUp and color:
        obj.ViewObject.ShapeColor = color[:3]
        if len(color) > 3:
            obj.ViewObject.Transparency = int(color[3])
    return obj


def print_mass(name, shape, infill=0.15, rho=1.24):
    """grobe Filamentschätzung: 3 Wände à 0,4 mm als Vollmaterial, Rest mit Infill (PLA 1,24 g/cm³)."""
    shell = shape.Area * 1.2
    core = max(shape.Volume - shell, 0.0)
    g = rho * (shell + infill * core) / 1000.0
    bb = shape.BoundBox
    print(f"  {name:14s} {bb.XLength:6.1f} × {bb.YLength:6.1f} × {bb.ZLength:5.1f} mm   "
          f"V = {shape.Volume/1000:6.1f} cm³   ≈ {g:5.0f} g PLA bei {int(infill*100)} % Infill")


def main():
    doc = App.newDocument("halter60")
    print(f"Telefonhalter tilt={tilt:.0f}°  Rampe α={alpha:.0f}°  Basis {P['base_x']:.0f} × {BASE_Y} × {Rz:.1f}   "
          f"Objektiv z≈{CAM[1]:.1f}  Telefon-Oberkante z≈{PHTOP:.1f}")

    holder = make_holder(); stop = make_stop()
    assert holder.isValid() and stop.isValid(), "ungültige Geometrie"
    add(doc, "Holder", holder, (0.85, 0.85, 0.85))
    add(doc, "Stop", stop, (0.35, 0.35, 0.38))

    # Baugruppe
    grp = doc.addObject("App::DocumentObjectGroup", "Assembly")
    face = P["stop_x"][P["stop_index"]] - 4.5
    du = (P["stop_index"] % 2) * P["stop_stagger"]                 # gewählte Bohrung liegt in der versetzten Reihe?
    stops = [place_stop(stop, s, su + du, face) for s in (-1, 1) for su in P["stop_u"]]
    foam, phone, lens, axis = make_phantoms()
    objs = [add(doc, "A_Holder", holder, (0.85, 0.85, 0.85))]
    for i, st in enumerate(stops):
        objs.append(add(doc, f"A_Stop{i+1}", st, (0.35, 0.35, 0.38)))
    objs += [add(doc, "A_Foam", foam, (0.25, 0.3, 0.3, 40)), add(doc, "A_Phone", phone, (0.27, 0.51, 0.71, 45)),
             add(doc, "A_Lens", lens, (0.27, 0.51, 0.71)), add(doc, "A_Axis", axis, (0.82, 0.41, 0.12))]
    grp.addObjects(objs)

    # Prüfungen
    print("Prüfungen:")
    print(f"  Telefon ∩ Halter   = {holder.common(phone).Volume:8.3f} mm³  (soll 0)")
    print(f"  Telefon ∩ Anschläge= {sum(s.common(phone).Volume for s in stops):8.3f} mm³  (soll 0, Flächen berühren sich)")
    print(f"  Achse ∩ Halter     = {holder.common(axis).Volume:8.3f} mm³  (soll 0)")
    print(f"  Achse ∩ Anschläge  = {sum(s.common(axis).Volume for s in stops):8.3f} mm³  (soll 0)")
    gap = face - P["phone_len"] / 2
    print(f"  Anschlagfläche ±{face:.1f} gegen Telefon ±{P['phone_len']/2:.1f} ⇒ Spiel {gap:+.2f} mm je Seite")
    bed = ADAPTER["bed"]
    for name, sh in (("Holder", holder), ("Stop", stop)):
        bb = sh.BoundBox
        fits = bb.XLength <= bed[0] and bb.YLength <= bed[1]
        print(f"  {name} auf Bett {bed[0]:.0f}×{bed[1]:.0f}: {'passt' if fits else 'PASST NICHT'}")
    print("Druckteile:")
    print_mass("Holder", holder); print_mass("Stop (×4)", stop, infill=0.3)

    # Adapter (nur mit Aufmaß) — in der Baugruppe unter dem Halter, Stift-Mitte auf Halter-Mitte ausgerichtet
    adapter_parts = []
    A = adapter_geometry(POSTS, ADAPTER, CHASSIS) if POSTS else dict(ADAPTER, plate_under=None)
    if POSTS:
        if CHASSIS:
            A["mount"] = CHASSIS.get("mount", (12.0, 8.0))
        adapter_parts = make_adapter(POSTS, A)
        ff, fr = A["feet"]; bf, br = A["boss"]
        print(f"Adapter: Füße vorn {ff:.1f} / hinten {fr:.1f} mm, Buchsen vorn {bf:.1f} / hinten {br:.1f} mm "
              f"(Ø {A['boss_d']:.1f}), Plattenunterseite über Tisch "
              + (f"{A['plate_under']:.1f} mm" if A["plate_under"] is not None else "= Bügel (kein Hüllkörper)"))
        for name, bh in (("vorn", bf), ("hinten", br)):
            if bh < 0:
                print(f"  WARNUNG {name}: Querloch {-bh:.1f} mm unter der Plattenoberkante — Stift zu kurz für Platte + Fuß; "
                      "längere Karosserie-Stifte oder weniger Fuß (gap_min/foot_h).")
        if A["tips"]:
            for name, tip, bh in (("vorn", A["tips"][0], bf), ("hinten", A["tips"][1], br)):
                over = tip - (A["plate_under"] + A["t"] + max(bh, 0.0))
                print(f"  Stift {name} ragt {over:.1f} mm über die Buchse (Clip braucht ≈ 3)")
        shift = V(0, BASE_Y / 2 - POSTS.get("offset_y", 0.0), -A["t"])   # Adapter- → Baugruppen-Koordinaten
        aobjs = []
        for name, sh in adapter_parts:
            assert sh.isValid(), name
            add(doc, name, sh, (0.6, 0.7, 0.6)); print_mass(name, sh)
            a = sh.copy(); a.translate(shift); aobjs.append(add(doc, "A_" + name, a, (0.6, 0.7, 0.6)))
            bb = sh.BoundBox
            diag = (bb.XLength + bb.YLength) / math.sqrt(2)
            if bb.XLength <= bed[0] and bb.YLength <= bed[1]:
                print(f"  {name}: passt gerade aufs Bett")
            elif diag <= min(bed):
                print(f"  {name}: passt nur diagonal (45°) aufs Bett")
            else:
                print(f"  {name}: PASST NICHT — ADAPTER['split'] = True setzen")
        grp.addObjects(aobjs)
    else:
        print("Adapter: kein Aufmaß (POSTS = None) — Karosserie-Stifte am KF10 MAX nach aufmass-kf10.pdf messen, dann POSTS/CHASSIS füllen.")

    # Chassis-Hüllkörper (Aufmaß): virtuelle Freigangsprüfung vor dem Druck
    if CHASSIS and POSTS:
        shift = V(0, BASE_Y / 2 - POSTS.get("offset_y", 0.0), 0)
        parts, obstacles = make_chassis(CHASSIS, POSTS, A)
        cgrp = doc.addObject("App::DocumentObjectGroup", "Chassis")
        cobjs = []
        for name, sh in parts:
            sh.translate(shift)
            col = (0.55, 0.55, 0.55, 60) if name == "C_Ground" else (0.25, 0.25, 0.28, 30)
            cobjs.append(add(doc, name, sh, col))
        cgrp.addObjects(cobjs)
        obstacles.translate(shift)
        payload = Part.makeCompound([holder] + [doc.getObject("A_" + n).Shape for n, _ in adapter_parts])
        dist = payload.distToShape(obstacles)[0]
        inter = payload.common(obstacles).Volume
        print("Freigang (Prüflage: Räder voll eingefedert):")
        print(f"  Halter+Adapter ∩ Wanne/Reifen = {inter:8.1f} mm³  (soll 0)   kleinster Abstand = {dist:5.1f} mm")
        gap = A["plate_under"] - CHASSIS["obst"]
        print(f"  Luft Plattenunterseite–höchstes Hindernis = {gap:5.1f} mm (Soll ≥ {A['gap_min']:.0f})")
        z_lens = CAM[1] + A["t"] + A["plate_under"]
        print(f"  Objektiv über Boden ≈ {z_lens/1000:.3f} m (Sim rechnet mit 0,10–0,15 m)")
    elif CHASSIS:
        print("Chassis: braucht POSTS (Stift-Bild ist der Ursprung des Hüllkörpers).")
    else:
        print("Chassis: kein Hüllkörper (CHASSIS = None) — nach Aufmaß der RC-Plattform füllen.")

    # Speichern + Export
    doc.recompute()
    fcstd = os.path.join(HERE, "halter-60.FCStd"); doc.saveAs(fcstd)
    exports = [("halter-60-holder.stl", holder), ("halter-60-stop.stl", stop)]
    exports += [(f"halter-60-{n.lower()}.stl", s) for n, s in adapter_parts]
    for fn, sh in exports:
        m = mesh_of(sh)
        m.write(os.path.join(HERE, fn))
        ok = m.isSolid() and not m.hasNonManifolds()
        print(f"  {fn}: {m.CountFacets} Facetten, {'wasserdicht + mannigfaltig' if ok else 'FEHLER: ' + ('offen ' if not m.isSolid() else '') + ('nicht-mannigfaltig' if m.hasNonManifolds() else '')}")
    print("Geschrieben:", os.path.basename(fcstd), *[fn for fn, _ in exports])

    # Isometrie der Baugruppe als SVG (ohne GUI)
    try:
        import TechDraw
        comp = Part.makeCompound([holder] + stops + [phone, lens, axis])
        vis = {"stroke": "#1B2430", "stroke-width": "0.35", "fill": "none"}
        hid = {"stroke": "#9AA6B4", "stroke-width": "0.18", "stroke-dasharray": "1.5,1", "fill": "none"}
        svg = TechDraw.projectToSVG(comp, V(1, -1, 0.8), "ShowHiddenLines", 0.05, vis, vis, vis, hid, hid, hid)
        # projectToSVG liefert <g transform="scale(1,-1)">-Fragmente mit M/L/A-Pfaden für eine TechDraw-Seite
        # (dort Y nach unten). Für ein eigenständiges SVG einmal zurückspiegeln; Viewbox aus den
        # Start-/Endpunkten der Pfade (Bogenparameter ignorieren).
        import re
        num = r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?"
        xs, ys = [], []
        for d in re.findall(r'\sd="([^"]*)"', svg):
            n = [float(x) for x in re.findall(num, d)]
            if len(n) >= 4:
                xs += [n[0], n[-2]]; ys += [n[1], n[-1]]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        pad = 8
        w, h = x1 - x0 + 2 * pad, y1 - y0 + 2 * pad
        out = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0-pad:.1f} {y0-pad:.1f} {w:.1f} {h:.1f}" '
               f'width="{w*3:.0f}" height="{h*3:.0f}" role="img" '
               f'aria-label="Isometrie Telefonhalter {tilt:.0f}° mit Anschlägen, Telefon und optischer Achse">'
               f'<rect x="{x0-pad:.1f}" y="{y0-pad:.1f}" width="{w:.1f}" height="{h:.1f}" fill="#FCFCFA"/>'
               f'<g transform="scale(1,-1)">{svg}</g></svg>')
        with open(os.path.join(HERE, "halter-60-iso.svg"), "w", encoding="utf-8") as f:
            f.write(out)
        print("Geschrieben: halter-60-iso.svg")
    except Exception as e:  # TechDraw ist optional
        print("Isometrie übersprungen:", repr(e))
    return doc


_doc = main()
if App.GuiUp:
    # Im Fenster: nur die Baugruppe (und ggf. das Chassis) zeigen, Druckteile in Drucklage ausblenden,
    # Ansicht isometrisch einpassen und die Darstellung mit in die FCStd speichern.
    import FreeCADGui
    keep = set()
    for g in ("Assembly", "Chassis"):
        go = _doc.getObject(g)
        if go:
            keep.update(o.Name for o in go.Group); keep.add(g)
    for o in _doc.Objects:
        if o.Name not in keep and hasattr(o, "ViewObject") and o.ViewObject:
            o.ViewObject.Visibility = False
    gdoc = FreeCADGui.getDocument(_doc.Name)
    gdoc.activeView().viewIsometric()
    FreeCADGui.SendMsgToActiveView("ViewFit")
    _doc.save()
