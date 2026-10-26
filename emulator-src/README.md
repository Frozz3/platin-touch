# Quelltext des DS-Emulators (DeSmuME, GPL-2.0)

So entsteht `vendor/platin_emu.js` und `vendor/platin_emu.wasm`:

1. `git clone https://github.com/44670/desmume-wasm` und `git checkout 1015846aa90741d22bd0e93286a7921e607685c2`
2. `git apply desmume-wasm-platin.patch` (im Ordner `desmume-wasm`)
3. zlib 1.3.1 daneben auspacken (`git clone -b v1.3.1 https://github.com/madler/zlib`)
4. Emscripten 3.1.x installieren (z. B. `sudo apt install emscripten` unter Ubuntu 24.04)
5. In diesem Ordner: `make -f build.mk DESMUME=../pfad/zu/desmume-wasm ZLIB=../pfad/zu/zlib -j4`

Inhalt:
- `platin_emu.cpp` – Schnittstelle zur Web-App (Bilder beider Bildschirme, Touch, Tasten, Ton, Speicher, Schnellstände, RAM-Zugriff für die Touch-Brücke)
- `desmume-wasm-platin.patch` – Korrekturen: Speicherpuffer wird beim Zurücksetzen nicht freigegeben, Schnellstände laden ohne Absturz, gekürzte ROMs werden mit 0xFF aufgefüllt
- `srclist.txt`, `build.mk` – Liste der Kern-Dateien und Bauregeln (Makefile)
