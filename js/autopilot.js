// Platin Touch – Person antippen: hinlaufen, hinschauen, ansprechen.
// Die ROM meldet über die Brücke die Kachel des Spielers und die Figuren samt Bildschirmposition.
// Der Weg wird schrittweise gesucht (erst die längere Achse, bei Hindernis die andere).

import { K } from './gestures.js';

const DIRS = { Up: [0, -1], Down: [0, 1], Left: [-1, 0], Right: [1, 0] };
const DIR_OF_GAME = ['Up', 'Down', 'Left', 'Right']; // Spiel: 0 = Norden, 1 = Süden, 2 = Westen, 3 = Osten

export class Autopilot {
  constructor({ emu, gestures, toast }) {
    this.emu = emu;
    this.gestures = gestures;
    this.toast = toast;
    this.job = null;
  }

  get active() {
    return !!this.job;
  }

  /** Figur unter dem Fingerpunkt (DS-Pixel oben) */
  npcAt(st, x, y) {
    if (!st || !st.field || !st.npcs) return null;
    let best = null, bestD = 1e9;
    for (const [sx, sy, tx, tz] of st.npcs) {
      // Figuren stehen auf dem Fußpunkt; der Körper reicht ca. 30 Pixel nach oben
      if (x < sx - 14 || x > sx + 14 || y < sy - 34 || y > sy + 8) continue;
      const d = Math.abs(x - sx) + Math.abs(y - (sy - 12));
      if (d < bestD) { bestD = d; best = { tx, tz, sx, sy }; }
    }
    return best;
  }

  start(st, npc) {
    this.stop();
    this.job = { tx: npc.tx, tz: npc.tz, t0: performance.now(), lastMove: performance.now(), lastPos: `${st.px},${st.pz}`, dir: null, tried: new Set(), phase: 'walk', blocked: 0 };
    this.update(st);
  }

  stop() {
    if (!this.job) return;
    this.job = null;
    this.gestures.autoMask = 0;
    this.gestures._sync();
  }

  _hold(dir) {
    this.gestures.autoMask = dir ? K[dir] : 0;
    this.gestures._sync();
  }

  /** wird bei jeder Statusänderung aufgerufen */
  update(st) {
    const j = this.job;
    if (!j) return;
    const now = performance.now();
    if (now - j.t0 > 9000) return this.stop();
    if (!st.bridge) return this.stop();
    if (!st.field) {
      // Oberwelt hat die Kontrolle abgegeben (Text, Kampf …): fertig
      if (j.phase === 'talk' || now - j.lastMove > 1500) this.stop();
      return;
    }
    const dx = j.tx - st.px, dz = j.tz - st.pz;
    const dist = Math.abs(dx) + Math.abs(dz);
    const pos = `${st.px},${st.pz}`;
    if (pos !== j.lastPos) {
      j.lastPos = pos;
      j.lastMove = now;
      j.tried.clear();
    }
    if (dist <= 1) {
      // daneben: erst den letzten Schritt zu Ende laufen lassen, dann hinschauen und ansprechen
      this._hold(null);
      if (j.phase === 'walk') {
        j.phase = 'arrive';
        j.arriveAt = now;
      } else if (j.phase === 'arrive' && now - j.arriveAt > 320) {
        j.phase = 'talk';
        const face = dx > 0 ? 'Right' : dx < 0 ? 'Left' : dz > 0 ? 'Down' : 'Up';
        const items = [];
        if (DIR_OF_GAME[st.pdir] !== face) items.push({ mask: K[face], frames: 4 });
        items.push({ mask: K.A, frames: 4 });
        this.emu.post({ type: 'queue', items });
        setTimeout(() => this.stop(), 700);
      }
      return;
    }
    if (dist === 0) return this.stop();
    // nächster Schritt: längere Achse zuerst, bei Stillstand die andere bzw. ausweichen
    const prefer = [];
    const ax = dx > 0 ? 'Right' : 'Left', az = dz > 0 ? 'Down' : 'Up';
    if (Math.abs(dx) >= Math.abs(dz)) { prefer.push(ax); if (dz) prefer.push(az); }
    else { prefer.push(az); if (dx) prefer.push(ax); }
    for (const d of ['Up', 'Down', 'Left', 'Right']) if (!prefer.includes(d)) prefer.push(d);
    if (now - j.lastMove > 450 && j.dir) {
      // seit einer Weile kein Fortschritt: diese Richtung ist versperrt
      j.tried.add(j.dir);
      j.lastMove = now;
      if (j.tried.size >= 3) return this.stop();
    }
    const next = prefer.find((d) => !j.tried.has(d)) || null;
    if (next !== j.dir) {
      j.dir = next;
      this._hold(next);
    }
  }
}
