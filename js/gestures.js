// Platin Touch – Gesten.
//  - Unterer Bildschirm: wird direkt als DS-Touchscreen weitergegeben (Kampf, Pokétch, Tastatur …),
//    außer ein Auswahlmenü wird dort angezeigt (menu-overlay.js): dann wählen die Knöpfe aus
//  - Oberer Bildschirm und freie Fläche:
//      Ziehen  = Laufen (schwebender Stick, weit ziehen = rennen)
//      Ziehen in einem Menü = Liste/Cursor bewegen (wie Wischen am Handy)
//      Tippen  = Menüeintrag wählen / Text weiter / ansprechen (A)

export const K = { Right: 1, Left: 2, Down: 4, Up: 8, Select: 16, Start: 32, B: 64, A: 128, Y: 256, X: 512, L: 1024, R: 2048 };

const SLOP = 10; // ab hier ist es Ziehen statt Tippen
const DEAD = 12; // Totzone des Sticks
const RADIUS = 56; // Stick-Radius; weiter ziehen schiebt den Mittelpunkt mit
const RUN_AT = 44; // ab hier wird gerannt ("weit ziehen")
const TAP_MS = 550;

export class Gestures {
  constructor(o) {
    Object.assign(this, o); // layer, stick, knob, screens, emu, status(), settings, fx, onFirstDrag
    this.ptr = new Map();
    this.dsId = null;
    this.stickId = null;
    this.stickMask = 0;
    this.buttonMask = 0;
    this.autoMask = 0; // vom Autopiloten (Person antippen)
    this.sentKeys = -1;
    const l = this.layer;
    l.addEventListener('pointerdown', (e) => this._down(e));
    l.addEventListener('pointermove', (e) => this._move(e));
    l.addEventListener('pointerup', (e) => this._up(e, false));
    l.addEventListener('pointercancel', (e) => this._up(e, true));
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    this._keyboard();
  }

  // ---------- Tasten an den Emulator ----------
  _sync() {
    const k = this.stickMask | this.buttonMask | this.autoMask;
    if (k !== this.sentKeys) {
      this.sentKeys = k;
      this.emu.post({ type: 'keys', keys: k });
    }
  }
  holdButton(mask, on) {
    if (on) this.buttonMask |= mask;
    else this.buttonMask &= ~mask;
    this._sync();
  }
  press(mask, frames = 6) {
    this.emu.post({ type: 'press', mask, frames });
  }

  // ---------- Zeiger ----------
  _down(e) {
    e.preventDefault();
    this.unlock?.();
    this.autopilot?.stop();
    this.layer.setPointerCapture?.(e.pointerId);
    const h = this.screens.hit(e.clientX, e.clientY);
    const g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), mode: 'pending', samples: [], ax: 0, ay: 0, dir: null, screen: h.screen };
    const st = this.status();
    // Oberwelt (Spieler kann frei laufen): auf dem unteren Bildschirm Ziehen = laufen,
    // kurz tippen bzw. still halten = Pokétch berühren
    const walkBottom = h.screen === 1 && this.settings.walkBottom !== false && st.bridge && st.field && !st.menuActive && !st.textActive && !st.battle;
    if (h.screen === 1 && this.overlay?.active) {
      // Auswahlmenü unten: Knopf drücken, beim Loslassen auswählen
      g.mode = 'ov';
      g.btn = this.overlay.hit(h.x, h.y);
      this.overlay.setPressed(g.btn);
    } else if (walkBottom && this.dsId === null) {
      g.bottom = { x: h.x, y: h.y };
      g.holdTimer = setTimeout(() => {
        if (g.mode !== 'pending' || this.dsId !== null || !this.ptr.has(g.id)) return;
        g.mode = 'ds';
        this.dsId = g.id;
        const r = this.screens.botRect;
        this.emu.post({ type: 'touch', on: true, x: clamp(((g.x - r.x) / r.w) * 256, 0, 255), y: clamp(((g.y - r.y) / r.h) * 192, 0, 191) });
      }, 350);
    } else if (h.screen === 1 && this.dsId === null) {
      g.mode = 'ds';
      this.dsId = e.pointerId;
      this.emu.post({ type: 'touch', on: true, x: h.x, y: h.y });
    }
    this.ptr.set(e.pointerId, g);
  }

  _move(e) {
    const g = this.ptr.get(e.pointerId);
    if (!g) return;
    e.preventDefault();
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    g.x = e.clientX;
    g.y = e.clientY;
    g.samples.push({ t: performance.now(), x: g.x, y: g.y });
    if (g.samples.length > 8) g.samples.shift();

    if (g.mode === 'ov' && Math.hypot(g.x - g.x0, g.y - g.y0) >= SLOP * 1.5) {
      // Wischen über die Knöpfe: Cursor bzw. Liste bewegen (wie oben)
      this.overlay.setPressed(null);
      g.mode = 'scroll';
      g.ay = g.y - g.y0;
      g.ax = 0;
      this._scroll(g, 0, 0);
      return;
    }
    if (g.mode === 'ov') {
      const h = this.screens.hit(g.x, g.y);
      const b = h.screen === 1 && this.overlay.active ? this.overlay.hit(h.x, h.y) : null;
      // Finger vom Knopf gezogen: nicht auswählen
      this.overlay.setPressed(b && g.btn && b.id === g.btn.id ? b : null);
      return;
    }

    if (g.mode === 'ds') {
      const r = this.screens.botRect;
      const x = clamp(((g.x - r.x) / r.w) * 256, 0, 255);
      const y = clamp(((g.y - r.y) / r.h) * 192, 0, 191);
      this.emu.post({ type: 'touch', on: true, x, y });
      return;
    }

    if (g.mode === 'pending') {
      if (Math.hypot(g.x - g.x0, g.y - g.y0) < SLOP) return;
      this.onFirstDrag?.();
      const st = this.status();
      if (st.bridge && st.menuActive && st.menuScreen === 0) {
        g.mode = 'scroll';
        // die ersten Pixel (bis zur Ziehschwelle) mitzählen; _scroll addiert gleich noch dx/dy
        g.ax = g.x - g.x0 - dx;
        g.ay = g.y - g.y0 - dy;
      } else if (this.stickId === null) {
        g.mode = 'stick';
        this.stickId = g.id;
        g.ox = g.x0;
        g.oy = g.y0;
        this._showStick(g.ox, g.oy);
      } else {
        g.mode = 'none';
      }
    }

    if (g.mode === 'stick') this._stick(g);
    else if (g.mode === 'scroll') this._scroll(g, dx, dy);
  }

  _up(e, cancel) {
    const g = this.ptr.get(e.pointerId);
    if (!g) return;
    this.ptr.delete(e.pointerId);
    if (g.holdTimer) clearTimeout(g.holdTimer);
    if (g.bottom && g.mode === 'pending') {
      // kurz auf den unteren Bildschirm getippt (Oberwelt): als Berührung weitergeben
      if (!cancel) this.emu.post({ type: 'touchTap', x: g.bottom.x, y: g.bottom.y, frames: 6 });
      return;
    }
    if (g.mode === 'ov') {
      const b = this.overlay.pressed;
      this.overlay.setPressed(null);
      if (!cancel && b && g.btn && b.id === g.btn.id && this.overlay.active) {
        const t = this.overlay.target(b);
        this.emu.post({ type: 'tap', x: t.x, y: t.y, screen: 0 });
      }
      return;
    }
    if (g.mode === 'ds') {
      this.dsId = null;
      this.emu.post({ type: 'touch', on: false, x: 0, y: 0 });
      return;
    }
    if (g.mode === 'stick') {
      this.stickId = null;
      this.stickMask = 0;
      this._sync();
      this._hideStick();
      return;
    }
    if (cancel) return;
    if (g.mode === 'pending' && performance.now() - g.t0 < TAP_MS) {
      this._tap(g.x0, g.y0);
      return;
    }
    if (g.mode === 'scroll') this._fling(g);
  }

  _tap(cx, cy) {
    const h = this.screens.hit(cx, cy);
    const st = this.status();
    if (h.screen === 0 && this.overlay?.active) {
      // Das Menü ist unten zu sehen; oben ist an seiner Stelle nichts mehr
      this.fx(cx, cy, null, true);
    } else if (h.screen === 0) {
      // Person angetippt: hinlaufen und ansprechen
      const npc = this.autopilot && st.bridge && st.field && !st.menuActive && !st.textActive ? this.autopilot.npcAt(st, h.x, h.y) : null;
      if (npc) {
        this.autopilot.start(st, npc);
        const p = this.screens.toClient(0, npc.sx, npc.sy - 12);
        this.fx(p.x, p.y, null);
        return;
      }
      this.emu.post({ type: 'tap', x: h.x, y: h.y, screen: 0 });
      this.fx(cx, cy, st.bridge && st.menuActive && st.menuScreen === 0 ? this._rowOf(st, h) : null);
    } else if (h.screen === -1) {
      // freie Fläche: wie A, aber nicht bei offenem Menü (sonst würde der markierte Eintrag gewählt),
      // nicht im Kampfmenü (nur wenn ein Text wartet) und nicht in der Namenseingabe
      // Im Steuerfeld bestätigt Tippen auch einen markierten Menüeintrag (wie die A-Taste).
      const inPad = this.screens.inPad(cx, cy);
      const blocked = st.bridge && ((st.menuActive && !inPad) || st.noTapA || (st.battle && !st.textWaiting));
      if (!blocked) {
        this.press(K.A, 5);
        this.fx(cx, cy, null);
      } else {
        this.fx(cx, cy, null, true);
      }
    }
  }

  /** Zeile des Menüs unter dem Finger (nur für die Anzeige) */
  _rowOf(st, h) {
    const rowH = st.menuRowH || 16;
    if (h.x < st.menuX - 6 || h.x > st.menuX + st.menuW + 6 || h.y < st.itemY0 || h.y > st.menuY + st.menuH + 6) return null;
    const row = Math.floor((h.y - st.itemY0) / rowH);
    if (row < 0 || row >= st.menuRows) return null;
    let x = st.menuX, w = st.menuW;
    if (st.menuCols > 1) {
      const cw = st.menuW / st.menuCols;
      const col = clamp(Math.floor((h.x - st.menuX) / cw), 0, st.menuCols - 1);
      x = st.menuX + col * cw;
      w = cw;
    }
    const a = this.screens.toClient(0, x, st.itemY0 + row * rowH);
    const b = this.screens.toClient(0, x + w, st.itemY0 + (row + 1) * rowH);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  }

  // ---------- Stick ----------
  _showStick(x, y) {
    this.screens.pad?.classList.toggle('active', this.screens.inPad(x, y));
    this.stick.style.transform = `translate(${x}px,${y}px)`;
    this.knob.style.transform = 'translate(0px,0px)';
    this.stick.classList.add('show');
  }
  _hideStick() {
    this.screens.pad?.classList.remove('active');
    this.stick.classList.remove('show', 'run');
  }
  _stick(g) {
    let vx = g.x - g.ox, vy = g.y - g.oy;
    let len = Math.hypot(vx, vy);
    if (len > RADIUS) {
      const k = (len - RADIUS) / len;
      g.ox += vx * k;
      g.oy += vy * k;
      this.stick.style.transform = `translate(${g.ox}px,${g.oy}px)`;
      vx *= RADIUS / len;
      vy *= RADIUS / len;
      len = RADIUS;
    }
    this.knob.style.transform = `translate(${vx}px,${vy}px)`;
    let dir = null;
    if (len >= DEAD) {
      const ax = Math.abs(vx), ay = Math.abs(vy);
      const horiz = g.dir === 'Left' || g.dir === 'Right';
      const vert = g.dir === 'Up' || g.dir === 'Down';
      let useX;
      if (horiz) useX = ax * 1.25 >= ay;
      else if (vert) useX = ax > ay * 1.25;
      else useX = ax >= ay;
      dir = useX ? (vx < 0 ? 'Left' : 'Right') : vy < 0 ? 'Up' : 'Down';
    }
    g.dir = dir;
    const runMode = this.settings.run;
    const run = !!dir && (runMode === 'always' || (runMode === 'drag' && len >= RUN_AT));
    this.stick.classList.toggle('run', run);
    this.stickMask = (dir ? K[dir] : 0) | (run ? K.B : 0);
    this._sync();
  }

  // ---------- Wischen in Menüs ----------
  _step() {
    const st = this.status();
    const rowH = (st.menuRowH || 16) * this.screens.scale;
    return { y: Math.min(30, Math.max(18, rowH * 0.7)), x: Math.max(30, rowH * 2) };
  }
  _scroll(g, dx, dy) {
    const step = this._step();
    g.ax += dx;
    g.ay += dy;
    const items = [];
    // Finger nach oben = Liste rückt nach oben = Cursor nach unten
    while (Math.abs(g.ay) >= step.y) {
      items.push({ mask: g.ay < 0 ? K.Down : K.Up, frames: 2 });
      g.ay -= Math.sign(g.ay) * step.y;
    }
    while (Math.abs(g.ax) >= step.x) {
      items.push({ mask: g.ax < 0 ? K.Right : K.Left, frames: 2 });
      g.ax -= Math.sign(g.ax) * step.x;
    }
    if (items.length) this.emu.post({ type: 'queue', items });
  }
  _fling(g) {
    const s = g.samples;
    if (s.length < 2) return;
    const a = s[0], b = s[s.length - 1];
    const dt = b.t - a.t;
    if (dt < 10 || performance.now() - b.t > 120) return;
    const vy = (b.y - a.y) / dt;
    if (Math.abs(vy) < 0.6) return;
    const n = Math.min(10, Math.floor((Math.abs(vy) * 220) / this._step().y));
    const items = [];
    for (let i = 0; i < n; i++) items.push({ mask: vy < 0 ? K.Down : K.Up, frames: 2 });
    if (items.length) this.emu.post({ type: 'queue', items });
  }

  // ---------- Tastatur (zum Testen am PC) ----------
  _keyboard() {
    const map = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', x: 'A', y: 'B', z: 'B', s: 'X', a: 'Y', q: 'L', w: 'R', Enter: 'Start', Shift: 'Select' };
    addEventListener('keydown', (e) => {
      const k = map[e.key];
      if (!k || e.repeat) return;
      this.holdButton(K[k], true);
      e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      const k = map[e.key];
      if (k) this.holdButton(K[k], false);
    });
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
