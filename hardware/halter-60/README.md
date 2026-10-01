# Telefonhalter 60° (RB3-HW-003, Konzept Rev B)

Neigungshalter für das Smartphone auf dem KF10 MAX. Die Rückkamera schaut mit
**60° Elevation** feldeinwärts (Sim-Parameter `tilt`, Ackermann-MVP;
75° Zielwert holonom = gleiche Datei mit `tilt=75`). Telefon liegt mit dem
Display auf einer 5-mm-EVA-Auflage, Rückseite nach vorn-oben; Rampe 30° zur Basis.
Anbindung ans Auto über eine **Adapterplatte auf den vier Karosserie-Stiften** (kurze Stifte
mit Kugelkopf und je einem Querloch, Original-Clips; Rev B; die Deckverschraubung aus Rev A
entfällt, das Chassis hat kein ebenes Deck).

| Datei | Inhalt |
|---|---|
| `halter-60.html` | Zeichnungsblatt mit Erläuterung, Montagekonzept, offenen Checks, Stückliste (lokal öffnen) |
| `halter-60.svg` / `halter-60.pdf` | eigenständiges Blatt, A3 quer, Maßstab 1:1, Projektionsmethode 1 |
| `halter60_freecad.py` | **FreeCAD-Skript**: Halter, Anschlag, Adapter, Baugruppe; Kollisionsprüfung; schreibt FCStd, STL, Isometrie |
| `halter-60.FCStd` | FreeCAD-Dokument (Holder, Stop, Gruppe `Assembly` mit Telefon-Phantom und optischer Achse) |
| `halter-60-holder.stl`, `halter-60-stop.stl` | Druckdateien, wasserdicht geprüft; Halter 1×, Anschlag 4× |
| `halter-60-iso.svg` | Isometrie der Baugruppe (TechDraw-Projektion) |
| `halter-60.scad` | dasselbe Modell in OpenSCAD (nicht installiert, Referenz) |
| `drawing.py`, `page.template.html` | erzeugen SVG + HTML aus demselben Parametersatz (nur Standardbibliothek) |
| `aufmass-kf10.pdf` (`-1…-4.svg`) | **Aufmaßblatt KF10 MAX**, 4 × A4 quer: Draufsicht, Seiten-/Vorderansicht + Stift-Detail, Messblatt (Pflicht / später), Papiermaßstab 275 mm + Messen ohne Lineal; Nummern ①…⑰ → `POSTS`/`CHASSIS` |
| `aufmass_kf10.py` | Generator des Aufmaßblatts (nur Standardbibliothek) |
| `bohrschablone-adapter.pdf` (`-1.svg`, `-2.svg`) | **Bohrschablone Adapterplatte** (seit 2026-09-10, ③ = 252 gemessen): Blatt 1 A4 hoch **1:1** zum Aufkleben auf ein Brett — 4 Stiftlöcher (73 / 84 quer, 252 längs), 4 × M4 für den Halter (156 × 92), Mittellinien, Kontrollstrecken 100 / 200 mm, Diagonalen; Blatt 2 Koordinatentabelle (auch „vom Rand“ für ein Rechteck-Brett 170 × 276), Bohranleitung, offene Höhenmaße |
| `bohrschablone_adapter.py` | Generator der Bohrschablone (nur Standardbibliothek; Geometrie wie `make_adapter` im FreeCAD-Skript) |

```sh
/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd halter60_freecad.py   # FCStd + STL + Isometrie
python3 drawing.py                                                                 # SVG + HTML
rsvg-convert -f pdf -o halter-60.pdf halter-60.svg                                 # Druck-PDF
python3 aufmass_kf10.py && rsvg-convert -f pdf -o aufmass-kf10.pdf aufmass-kf10-{1,2,3,4}.svg   # Aufmaßblatt
python3 bohrschablone_adapter.py && rsvg-convert -f pdf -o bohrschablone-adapter.pdf bohrschablone-adapter-{1,2}.svg   # Bohrschablone 1:1 (Druck 100 %)
```

Parameter stehen als identischer Block in `drawing.py`, `halter60_freecad.py` und
`halter-60.scad`; Änderungen dort eintragen und beide Generatoren laufen lassen.
In der FreeCAD-Oberfläche: Makro › Makros… › `halter60_freecad.py` ausführen.

## Drucken (Ender-3 Pro, Cura)

- **Halter** 170 × 104 × 44 mm, ≈ 127 g PLA bei 15 % Infill, ≈ 10 h. Basis auf dem Bett,
  **keine Stützen** (Lippe hängt 30° über, M3-Bohrungen 30° schräg). Brim, 3–4 Wände,
  0,2 mm. PETG für den Betrieb, PLA für den ersten Passtest.
- **Anschlag** 4×, Fuß auf dem Bett, 30 % Infill. M3×8 selbstschneidend in Ø 2,5.
- Passtest mit iPhone 16: EVA 148 × 78 × 5 auf die Rampe kleben, Telefon Display nach
  unten, Kameraseite +X (Fahrzeug-links), Anschläge auf Bohrung 78,5 (Fläche ±74).
  Straps: Ende durch den Schlitz, auf sich selbst zurückkletten. 2 mm EVA auf die
  Lippeninnenseite (Lautstärke-/Action-Taste liegt dort an).

## Montage am KF10 MAX (Konzept, Aufmaß offen — Auto ist vor Ort)

KF10 MAX = KFPLAN KF10 („SPEED RACER 4X4"), 1:10-Truck: 365 × 288 × 153 mm, 1,5 kg,
Chassis-Wanne mit Akku/ESC/Motor, Getriebe mit Dämpferturm vorn und hinten. Karosserie auf
**vier kurzen Stiften mit Kugelkopf**, je einer an den Enden eines Querbügels über dem
Dämpferturm, mit **einem Querloch für den Original-Clip** (Fotos Marvin, 2026-09-07; keine
Lochreihe, Höhe nicht verstellbar). Kein öffentliches 3D-Modell.

**Adapterplatte statt Karosserie:** wird über die vier Stifte gesteckt, liegt auf den
Bügelenden, die Original-Clips halten sie; oben das Bohrbild 156 × 92 (M4) für den Halter.
Kein Bohren am Auto, vier Clips zum Abnehmen (Akkuwechsel), Bügel tragen Crash-Lasten;
Ring-Streben können mit auf die Platte. Zwei Zutaten rechnet das Skript aus dem Aufmaß:
**Buchsen** um die Stifte bis 1 mm unter das Querloch, damit der Clip die Platte klemmt
(`hole_h`), und **Füße** je Achse, wenn die Bügel vorn/hinten ungleich hoch sind oder
Dämpferkappen/Turm höher liegen als die Bügel (`ADAPTER["foot_h"]`, Mindestluft 8 mm).
Grenze: Platte + Fuß + Buchse müssen unter dem Querloch bleiben, sonst längere Stifte
(Standard-Ersatzteil). Objektiv ≈ 0,10–0,15 m über Boden (Sim-Annahme, wird nachgerechnet).

**Aufmaß** (Auto ist da; Blatt `aufmass-kf10.pdf`, Messschieber; ohne Lineal siehe Blatt 4).
Alle Höhen von der Tischplatte, Normallage, Akku eingelegt, Karosserie ab. Die Nummern des
Blatts und ihre Zielfelder:

| Nr | Maß | Zielfeld |
|---|---|---|
| **Pflicht für den Adapter** | | |
| ① ② ③ | `front_span`, `rear_span`, `pitch_y` (Stiftmitte–Stiftmitte) | `POSTS` |
| ④ | Stift-Ø am Schaft | `POSTS["post_d"]` = ④ + 0,5 |
| 4a 4b | Querloch-Mitte über Bügel-Oberkante, Stifthöhe über Bügel | `POSTS["hole_h"]`, `POSTS["post_h"]`; Buchse = 4a − 1 − 4 − Fuß |
| 13v 13h | Bügel-Oberkante vorn / hinten über Tisch | `CHASSIS["mount_top"]` = (13v, 13h); Füße gleichen die Differenz aus |
| ⑭ | höchster Punkt zwischen den Bügeln (± 85 quer) über Tisch | `CHASSIS["obst"]`; Platte ≥ ⑭ + 8 |
| **Später (Hüllkörper, Sim)** | | |
| ⑨ ⑩ ⑪ ⑫ | `wheel_d`, `wheel_w`, `track` (Radmitte–Radmitte), `wheelbase` | `CHASSIS` |
| ⑮ ⑯ | Chassis-Unterseite über Tisch, normal und voll eingedrückt | `floor`; `wheel_lift` = ⑮−⑯ |
| ⑤ ⑥ ⑦ ⑧ | optional: Chassis-Breite, Überstände, Achsversatz | `tub`, `tub_y`, `axle_y` (fehlen ⇒ aus dem Stiftbild) |
| ⑰ | `offset_y` ist Wahl, keine Messung (Halterfeld längs, Start 0) | `POSTS` |

Kontrollen ohne Zahl: Akkuwechsel und Bind-Taster mit aufgesetzter Platte (A, B), Ansatzpunkte
der Fangkorb-Streben in die Draufsicht zeichnen, Foto eines Stifts mit Clip von der Seite (C).

**Gemessen:** ① `front_span` 73 mm, ② `rear_span` 84 mm (hinten breiter als vorn), ⑩ `wheel_w` 50 mm
(2026-09-07); ③ `pitch_y` **252 mm** (2026-09-10, Stiftmitte vorn–hinten längs). Damit ist das **Lochbild der
Draufsicht komplett** — Bohrschablone `bohrschablone-adapter.pdf` (unten). Offen für die Höhen des Adapters
(Buchsen, Füße): ④ 4a 4b 13v 13h ⑭.
Maße über ≈ 150 mm ohne Lineal ⇒ Blatt 4: Papiermaßstab (Druck 100 %, Kontrollstrecke 100 mm
mit dem Messschieber prüfen), A4-Blatt als Endmaß (297 − Rest) oder Malerkrepp mit
100-mm-Zwischenmarke; gleiche Stiftkante zu gleicher Stiftkante ergibt direkt Mitte–Mitte.

Platte länger als ≈ 210 mm ⇒ `ADAPTER["split"] = True` (zwei Hälften, Fuge unter dem
Halter, der Halter verschraubt beide, dann ohne Dämpfer) — mit ③ = 252 ist das der Fall
(I-Form 170 × 276). Fallback und erster Weg: **4-mm-Sperrholz/Alu nach der Bohrschablone**
`bohrschablone-adapter.pdf` gebohrt (Blatt 1 in 100 % drucken, Kontrollstrecken prüfen,
aufkleben, acht Punkte ankörnen; Stiftlöcher erst nach ④, Buchsen/Distanzhülsen nach 4a). Photogrammetrie der Wanne (Polycam/KIRI/RealityScan) als
Referenznetz in FreeCAD, falls mehr als die Maße gebraucht wird.

## TODO: RC-Plattform als Prüfmodell

Bevor der Adapter gedruckt wird, soll der KF10 MAX als **Hüllkörper** im selben FreeCAD-Dokument
stehen: Wanne mit Aufbauten (Motor, Dämpferbrücken, Akku als ein Quader bis zum höchsten
Hindernis), die vier Bügelenden mit Stiften, die Reifen in voll eingefederter Lage und der Boden. Das Skript
hat dafür den Platzhalter `CHASSIS` (Feldliste mit Beispielwerten im Kommentar, Gruppe
`Chassis` im Dokument) und rechnet damit Freigang und Objektivhöhe:
Halter+Adapter gegen Wanne/Reifen (Schnittvolumen 0, kleinster Abstand in mm) und
Objektiv über Boden (Soll 0,10–0,15 m). Voraussetzung ist das Aufmaß aus dem Abschnitt
Montage; bis dahin `CHASSIS = None`. Ein echtes CAD-Modell des Autos gibt es nicht,
optional Photogrammetrie-Netz als Referenz dazulegen.

## Offen vor dem Bau

Netzboden von 45 auf ≥ 60 mm über Basis (Telefon-Oberkante ≈ 52 + Dämpfer); Stift-Aufmaß
(oben, Blatt `aufmass-kf10.pdf`) und Chassis-Hüllkörper; Abnahme mit Randtreffern (T4e); Testgerät iPhone 16
ist in `ml/data/PROTOCOL.md` §1 eingetragen.

Quellen: `.okf/simulation/path-to-80-percent.md` (Nachtrag Kamerahöhe/Neigung),
`.okf/app/detector-research-program.md` Abschnitt 6 Schritt 4, `.okf/hardware/build-guide.md`
Abschnitt 3 (Deckmontage überholt), `.okf/business/open-questions.md` T4e.
