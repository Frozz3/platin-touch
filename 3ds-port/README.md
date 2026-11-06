# Pokémon Platin auf dem 3DS – Änderungen

Neuer Ansatz (ab 6.11.2026): Platin läuft **nativ** auf dem New 3DS, ohne Emulator.

Basis ist der 3DS-Port aus [nativeplat / gen4recomp](https://github.com/sohamb117/gen4recomp)
(`games/platinum/3ds`, GPL-3.0-or-later), Stand `7dc5e22a`. Die eigenen Änderungen
liegen hier als Patches, bis es ein eigenes Repository für den Port gibt.

Anwenden:

```sh
git clone https://github.com/sohamb117/gen4recomp
cd gen4recomp
git checkout 7dc5e22a
git am /pfad/zu/3ds-port/patches/*.patch
```

Keine ROM-Daten in diesem Ordner: das Spiel liest die eigene Cartridge-Kopie
(`pokeplatinum.us.nds`, US Rev. 1) von der SD-Karte.

Live-Baufortschritt: [build-status.html](../build-status.html)
