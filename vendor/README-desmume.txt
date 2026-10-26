platin_emu.js / platin_emu.wasm
-------------------------------
Nintendo-DS-Emulator DeSmuME, als WebAssembly gebaut (Emscripten 3.1.6, -O3).

Grundlage: DeSmuME-wasm von 44670 (https://github.com/44670/desmume-wasm, Stand 1015846),
das auf DeSmuME (https://desmume.org) beruht. Die Web-Schnittstelle (platin_emu.cpp) ist neu
geschrieben; kleine Korrekturen am Kern stehen in emulator-src/desmume-wasm-platin.patch.

DeSmuME ist freie Software unter der GNU General Public License, Version 2 oder später.
Den vollständigen Quelltext dieser Fassung findest du im Ordner emulator-src/ (Bauanleitung dort)
zusammen mit den oben genannten Repositories. Lizenztext: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
