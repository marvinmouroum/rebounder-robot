// Telefonhalter 60° — Rebounder v3 (Zeichnung RB3-HW-003, Konzept Rev A, 2026-09-06)
// Parametrisches Modell. Parameter identisch zu drawing.py (Zeichnungsblatt).
//
// Koordinaten: X quer zum Fahrzeug (+X = links in Fahrtrichtung), Y nach vorn, Z nach oben.
// Rampenkoordinaten: u entlang der Rampe (0 = Fußpunkt an der Lippe, nach hinten-oben),
//                    v normal zur Rampe (nach vorn-oben = Blickrichtung der Kamera).
//
// Rendern:  openscad -D 'part="holder"' -o halter-60.stl halter-60.scad
//           openscad -D 'part="stop"'   -o anschlag.stl  halter-60.scad
//           openscad -D 'part="assembly"' halter-60.scad   (Vorschau mit Telefon)
// 75°-Variante (holonom): -D tilt=75

part = "assembly";   // ["holder", "stop", "assembly"]
show_phone = true;   // nur assembly
show_axis  = true;   // optische Achse als Stab (nur assembly)

/* [Kamera / Telefon] */
tilt      = 60;      // Kamera-Elevation über der Horizontalen (Sim-Parameter tilt)
phone_len = 148;     // lange Seite (X) — iPhone 16: 147,6
phone_w   = 72;      // kurze Seite (entlang u) — 71,6
phone_t   = 8;       // Dicke (7,8 ohne Hülle; mit Hülle ≈ 10)
foam_t    = 5;       // EVA-Moosgummi
cam_u     = 57;      // Hauptobjektiv: Abstand von der Unterkante entlang u
cam_x     = 58;      // Hauptobjektiv: X-Position (Kamera-Pill X 34..66)

/* [Halter] */
base_t    = 4;
base_x    = 170;
flange    = 12;      // Flansch vor der Lippe und hinter der Rampe
ramp_len  = 80;      // Rampenlänge entlang u
lip_h     = 15;      // Lippe über der Rampenfläche (senkrecht zur Rampe)
lip_t     = 3;

/* [Deckanbindung] */
mount_x   = 78;      // M4-Langlöcher bei ±mount_x
slot_w    = 4.5;
slot_l    = 9;       // Langloch in Y
hole_y    = 6;       // Mitte vom vorderen/hinteren Rand

/* [Straps] */
strap_x    = [-55, 20];
strap_slot = [22, 5];

/* [Anschläge] */
stop_u      = [20, 50];                 // zwei Reihen entlang u
stop_len    = 8;                        // Klotzlänge entlang u
stop_h      = 12;                       // Wandhöhe (v)
stop_t      = 3;                        // Wandstärke (X)
stop_foot   = 7;                        // Fußbreite nach außen (X), Schraube bei 4,5
stop_foot_t = 3;
stop_x      = [73.5, 76, 78.5, 81];     // Lochreihe: X der M3-Bohrung; Anschlagfläche = X − 4,5
stop_hole_d = 2.5;                      // M3 selbstschneidend
stop_index  = 2;                        // gewählte Bohrung in der Baugruppe (Telefon 148 -> Fläche 74)
stop_stagger = 6;                       // Rev B: jede 2. Bohrung um +6 entlang u versetzt (Pitch 2,5 = Ø, sonst 0 mm Wand)

$fn = 48;

// ---------------------------------------------------------------- abgeleitet
alpha = 90 - tilt;
ca = cos(alpha); sa = sin(alpha);
Ty = flange + ramp_len * ca;  Tz = base_t;          // Fußpunkt der Rampe
Ry = flange;                  Rz = base_t + ramp_len * sa;   // Rampenoberkante hinten
function PU(u, v) = [Ty - u * ca + v * sa, Tz + u * sa + v * ca];   // (u,v) -> (y,z)
lipOB = PU(-lip_t, lip_t * sa / ca);
lipOT = PU(-lip_t, lip_h);
lipIT = PU(0, lip_h);
base_y = ceil(lipOT[0] + flange);
mount_yc = [hole_y, base_y - hole_y];

echo(str("base_y=", base_y, "  Rampenoberkante z=", Rz, "  Objektiv z=", PU(cam_u, foam_t + phone_t)[1]));

// Seitenprofil (y,z), wird entlang X extrudiert
profile = [[0, 0], [base_y, 0], [base_y, base_t], lipOB, lipOT, lipIT, [Ty, Tz], [Ry, Rz], [Ry, base_t], [0, base_t]];

// Rampen-Frame: lokal Y = -u (zeigt die Rampe hinunter), lokal Z = +v
module ramp_frame() { translate([0, Ty, Tz]) rotate([-alpha, 0, 0]) children(); }

// ---------------------------------------------------------------- Halter
module holder() {
  difference() {
    rotate([90, 0, 90]) linear_extrude(height = base_x, center = true) polygon(profile);
    // M4-Langlöcher
    for (sx = [-mount_x, mount_x], yc = mount_yc)
      hull() for (dy = [-1, 1])
        translate([sx, yc + dy * (slot_l - slot_w) / 2, -1]) cylinder(d = slot_w, h = base_t + 2);
    // Strap-Schlitze (vorn im Flansch, hinten im Flansch)
    for (sx = strap_x, yc = mount_yc)
      hull() for (dx = [-1, 1])
        translate([sx + dx * (strap_slot[0] - strap_slot[1]) / 2, yc, -1]) cylinder(d = strap_slot[1], h = base_t + 2);
    // Lochreihen M3 für Anschläge (Achse normal zur Rampe), Zickzack: ungerade Indizes +stop_stagger
    for (s = [-1, 1], su = stop_u, i = [0 : len(stop_x) - 1])
      ramp_frame() translate([s * stop_x[i], -(su + (i % 2) * stop_stagger), 0]) cylinder(d = stop_hole_d, h = 20, center = true);
  }
}

// ---------------------------------------------------------------- Anschlagklotz (L-Profil)
// lokal: X nach außen (0 = Anschlagfläche zum Telefon), Y entlang u, Z = v (liegt auf der Rampe)
module stop() {
  difference() {
    union() {
      cube([stop_foot, stop_len, stop_foot_t]);           // Fuß
      cube([stop_t, stop_len, stop_h]);                   // Wand
    }
    translate([4.5, stop_len / 2, -1]) cylinder(d = 3.2, h = stop_foot_t + 2);   // M3 Durchgang
    translate([4.5, stop_len / 2, stop_foot_t - 0.6]) cylinder(d = 6, h = 2);     // Kopfsenkung flach
  }
}
module stop_flat() { stop(); }   // Drucklage: Fuß auf dem Bett

// ---------------------------------------------------------------- Baugruppe
module assembly() {
  color("Gainsboro") holder();
  face = stop_x[stop_index] - 4.5;
  du = (stop_index % 2) * stop_stagger;
  for (s = [-1, 1], su = stop_u)
    color("DimGray") ramp_frame() translate([0, -(su + du) - stop_len / 2, 0])
      mirror([s < 0 ? 1 : 0, 0, 0]) translate([face, 0, 0]) stop();
  if (show_phone) {
    color("DarkSlateGray", 0.5) ramp_frame() translate([-phone_len / 2, -(phone_w + 6), 0]) cube([phone_len, phone_w + 6, foam_t]);
    color("SteelBlue", 0.45)    ramp_frame() translate([-phone_len / 2, -phone_w, foam_t]) cube([phone_len, phone_w, phone_t]);
    color("SteelBlue")          ramp_frame() translate([cam_x, -cam_u, foam_t + phone_t]) cylinder(d = 12, h = 1.5);
  }
  if (show_axis)
    color("Chocolate") ramp_frame() translate([cam_x, -cam_u, foam_t + phone_t]) cylinder(d = 1.2, h = 150);
}

if (part == "holder") holder();
else if (part == "stop") stop_flat();
else assembly();
