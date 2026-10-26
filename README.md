# Platin Touch

Pokémon Platin (aus dem eigenen Decompile gebaut) im Browser spielen, auf dem iPhone im Hochformat
und mit Touch-Steuerung. Beide DS-Bildschirme stehen übereinander, darunter liegt eine Leiste mit Knöpfen.

**Dieser Ordner enthält kein Spiel.** Die App braucht die ROM-Datei `pokeplatinum-touch.nds`. Sie wird aus dem
Quellcode gebaut, auf dem Gerät ausgewählt und nur dort im Browser gespeichert. Hochgeladen wird sie nie.
Die ROM gehört nicht in ein öffentliches Repository (`.gitignore` schließt `*.nds` und `*.sav` aus).

## Steuerung

| Geste | Wirkung |
| --- | --- |
| Ziehen (oberer Bildschirm oder freie Fläche unten) | Laufen. Ein Stick erscheint dort, wo der Finger aufsetzt. Weit ziehen = rennen (ab den Laufschuhen) |
| Oben auf einen Menüeintrag tippen | Eintrag direkt auswählen (Startmenü, Ja/Nein, Listen, Hauptmenü, Pokéball bei der Starterwahl) |
| Oben auf eine Person tippen | hinlaufen, hinschauen und ansprechen |
| Oben sonst tippen | weiter / bestätigen (wie A). Im Kampf nur, wenn ein Text wartet |
| In einem Menü ziehen | Cursor bzw. Liste bewegen (wie Wischen am Handy), knapp über/unter einer Liste tippen = blättern |
| Unterer Bildschirm | wird direkt berührt: Kampfmenü, Beutel, Team, Pokétch, Tastatur … |
| **Zurück** | B (Menü schließen, abbrechen) |
| **Menü** | X (Startmenü) |
| **Item** | Y (registriertes Item, z. B. Fahrrad) |
| **Tempo** | schneller Vorlauf an/aus (2- bis 4-fach, unter „Mehr“ einstellbar) |
| **Mehr** | Einstellungen, Schnellspeichern/-laden, .sav-Export/-Import, Start/Select/L/R |

Am PC geht es auch mit der Tastatur: Pfeiltasten, X = A, Y/Z = B, S = X, A = Y, Q/W = L/R, Enter = Start.

## Spielstand

- **Im Spiel speichern** (Menü → SAVE) reicht. Der Spielstand wird kurz danach automatisch im Browser gesichert.
  Das erste Speichern dauert im Spiel etwa 20 Sekunden.
- **.sav exportieren/importieren** (unter „Mehr“): die Datei ist eine normale 512-KB-Speicherdatei und passt auch zu
  DeSmuME oder melonDS am PC. So lässt sich zwischen PC und Handy wechseln.
- **Schnellstand**: speichert den genauen Moment. Er gehört zur ROM-Version; nach einem Neubau der ROM passt er nicht mehr.
  Der Spielstand aus dem Spiel bleibt beim Laden eines Schnellstands erhalten.
- **Beim Öffnen weiterspielen**: Wenn die App in den Hintergrund geht, merkt sie sich den Moment und macht beim
  nächsten Öffnen dort weiter (nur, wenn seitdem nicht im Spiel gespeichert wurde).

Auf dem iPhone gehören die Daten zum Home-Bildschirm-Symbol. **Wer das Symbol löscht, löscht auch den Spielstand.**
Vorher also ab und zu die .sav exportieren.

## Aufs iPhone

### Variante A: über GitHub Pages (empfohlen, mit HTTPS und offline nutzbar)

1. Auf github.com ein neues Repository anlegen, z. B. `platin-touch` (öffentlich).
2. Den **Inhalt dieses Ordners** hochladen (ohne ROM und ohne `.sav`).
3. Im Repository: *Settings → Pages → Branch `main`, Ordner `/ (root)` → Save*. Nach ein bis zwei Minuten
   läuft die Seite unter `https://<dein-name>.github.io/platin-touch/`.
4. Die ROM `pokeplatinum-touch.nds` aufs iPhone bringen, z. B. in die iCloud Drive (Dateien-App).
5. Die Seite in Safari öffnen → Teilen → **Zum Home-Bildschirm**. Dann die App über das neue Symbol starten.
6. **ROM auswählen** und die Datei aus der Dateien-App wählen. Danach startet das Spiel mit **Spielen**.

### Variante B: vom eigenen PC im WLAN

1. Node.js installieren (https://nodejs.org), dann `START-PC.bat` doppelklicken.
2. Das Fenster zeigt die Adressen an: am PC `http://localhost:8080`, im WLAN z. B. `http://192.168.178.20:8080`.
3. Am iPhone (im selben WLAN) diese Adresse in Safari öffnen. Die ROM kommt automatisch vom PC
   (der Server sucht `..\pokeplatinum-touch.nds` bzw. `..\build\pokeplatinum.us.nds`).

Ohne HTTPS fehlt nur der Offline-Modus; spielen, speichern und Ton funktionieren. Den Server nur im eigenen WLAN
laufen lassen: er gibt die ROM an jedes Gerät im Netz heraus, das die Seite öffnet.

## ROM neu bauen

Die Touch-Hilfen stecken in einem kleinen Zusatz im Spiel („Touch-Brücke“, siehe `..\touch-mod\README.md`).
Mit einer normalen Platin-ROM läuft die App auch, dann aber nur mit den Grundfunktionen
(oben tippen = A, Menüs per Wischen, unten direkt berühren).

## Leistung

Die Leistungsanzeige (unter „Mehr“) zeigt Bildrate und Rechenzeit pro Bild. Wird das Handy warm oder ruckelt es,
hilft **Bildrate: 30 (Akku sparen)**. Den Stromsparmodus von iOS besser ausschalten, er bremst stark.

## Lizenzen

- DS-Emulator: DeSmuME (GPL-2.0), WebAssembly-Fassung nach 44670/desmume-wasm. Quelltext und Bauanleitung im Ordner `emulator-src/`.
- Die App selbst (HTML/CSS/JS) ist für den privaten Gebrauch geschrieben.
- Pokémon ist eine Marke von Nintendo, Creatures und GAME FREAK. Dieses Projekt enthält keine Spieldaten.
