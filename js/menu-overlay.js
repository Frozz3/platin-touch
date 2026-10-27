// Platin Touch – Auswahlmenüs auf dem unteren Bildschirm.
// Das Spiel blendet ein Auswahlmenü (Startmenü, Ja/Nein, Listen …) oben aus und beschreibt es in der
// Touch-Brücke (Lage, Zeilen, Cursor, Pixel des Fensters). Hier wird es unten als Knöpfe im Stil der
// Platin-Touchscreen-Knöpfe gezeichnet. Antippen eines Knopfs schickt ein Antippen an die Stelle der
// (unsichtbaren) Zeile oben; so wählt das Spiel selbst den Eintrag aus.

const W = 256, H = 192;

// Hintergrund wie beim Ja/Nein-Touchscreen des Spiels
const BG = [123, 132, 255];
const BAND = [[57, 66, 222], [74, 82, 231], [90, 99, 239], [107, 115, 247], BG];

// Knopfvorlage (48 x 30), abgemalt vom Ja-Knopf des Spiels:
// a = durchsichtig, b/c/d = grauer Rahmen, e = dunkle Oberkante, f = Rand, g = Füllung, h/i = Glanz
const TPL = [
  'aaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbaaaaa',
  'aaabbcddddddddddddddddddddddddddddddddddddcbbaaa',
  'aabcddddddddddddddddddddddddddddddddddddddddcbaa',
  'abcddcbeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeebcddcba',
  'abddcefggggggggggggggggggggggggggggggggggfecddba',
  'bcdceghhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhgecdcb',
  'bddbfhhhiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiihhhfbddb',
  'bddehhiihhgggggggggggggggggggggggggggghhiihheddb',
  'bddfhihgggggggggggggggggggggggggggggggggghihfddb',
  'bddfhhgggggggggggggggggggggggggggggggggggghhfddb',
  'bddfhgggggggggggggggggggggggggggggggggggggghfddb',
  'bddfhgggggggggggggggggggggggggggggggggggggghfddb',
  'bddfghgggggggggggggggggggggggggggggggggggghgfddb',
  'bcdcfhgggggggggggggggggggggggggggggggggggghfcdcb',
  'abddfghgggggggggggggggggggggggggggggggggghgfddba',
  'abcdcfghhgggggggggggggggggggggggggggggghhgfcdcba',
  'aabcdcffghhhhhhhhhhhhhhhhhhhhhhhhhhhhhhgffcdcbaa',
  'aaabbcccffffffffffffffffffffffffffffffffcccbbaaa',
  'aaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbaaaaa',
];
const TPL_W = 48, TPL_H = TPL.length;
const TPL_TOP = 11; // Zeilen 0..10 oben, Zeile 11 wird gestreckt, die letzten 7 unten
const TPL_MID = 11;
const TPL_BOTTOM = 7;
const TPL_SIDE = 10;

const FRAME = { b: [148, 148, 148], c: [181, 181, 181], d: [214, 214, 214] };
const THEMES = {
  red: { e: [90, 49, 49], f: [165, 66, 66], g: [255, 90, 90], h: [255, 156, 156], i: [255, 206, 206], text: [123, 49, 49] },
  blue: { e: [49, 66, 90], f: [57, 90, 140], g: [74, 156, 222], h: [156, 189, 255], i: [206, 222, 255], text: [49, 82, 123] },
  white: { e: [74, 82, 115], f: [132, 140, 173], g: [239, 243, 255], h: [255, 255, 255], i: [255, 255, 255], text: null },
  gold: { e: [123, 90, 16], f: [206, 156, 33], g: [255, 222, 107], h: [255, 239, 173], i: [255, 251, 222], text: null },
};

export class MenuOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = this.ctx.createImageData(W, H);
    this.active = false;
    this.pix = null; // Pixel des Fensters (4 bpp)
    this.pal = null;
    this.pixHash = -1;
    this.st = null;
    this.buttons = [];
    this.pressed = null; // Knopf unter dem Finger
    this.key = '';
  }

  setPixels(m) {
    this.pix = m.pix;
    this.pal = m.pal;
    this.pixHash = m.hash;
    this.key = '';
    if (this.st) this.update(this.st);
  }

  /** Status vom Emulator; zeigt/versteckt das Menü. Rückgabe: aktiv? */
  update(st) {
    const on = !!(st && st.bridge && st.own && this.pix && this.pix.length === st.tilesW * st.tilesH * 32);
    this.st = st;
    if (on !== this.active) {
      this.active = on;
      this.canvas.style.display = on ? '' : 'none';
      if (!on) this.pressed = null;
      this.key = '';
    }
    if (!on) return false;
    const key = [this.pixHash, st.menuRows, st.menuCols, st.menuCursor, st.listPos, st.listCount, st.menuStyle, st.menuX, st.menuY, this.pressed && this.pressed.id].join(',');
    if (key !== this.key) {
      this.key = key;
      this._layout();
      this._draw();
    }
    return true;
  }

  setPressed(btn) {
    if ((btn && btn.id) === (this.pressed && this.pressed.id)) return;
    this.pressed = btn;
    if (this.st) {
      this.key = '';
      this.update(this.st);
    }
  }

  /** Knopf an einer Stelle des unteren Bildschirms (DS-Pixel) */
  hit(x, y) {
    for (const b of this.buttons) {
      if (b.disabled) continue;
      if (x >= b.x - 2 && x < b.x + b.w + 2 && y >= b.y - 2 && y < b.y + b.h + 2) return b;
    }
    return null;
  }

  /** Stelle oben, an die ein Antippen dieses Knopfs geschickt wird */
  target(b) {
    const st = this.st;
    if (b.kind === 'up') return { x: st.menuX + Math.min(16, st.menuW / 2), y: st.itemY0 - 2 };
    if (b.kind === 'down') return { x: st.menuX + Math.min(16, st.menuW / 2), y: st.menuY + st.menuH + 4 };
    const rowH = st.menuRowH || 16;
    let x = st.menuX + st.menuW / 2;
    if (st.menuCols > 1) {
      const cw = st.colW || st.menuW / st.menuCols;
      x = st.menuX + b.col * cw + Math.min(cw / 2, 24);
    }
    return { x, y: st.itemY0 + b.row * rowH + (rowH >> 1) };
  }

  // ---------- Aufbau ----------
  _layout() {
    const st = this.st;
    const rows = Math.max(1, st.menuRows), cols = Math.max(1, st.menuCols);
    const rowH = st.menuRowH || 16;
    const yesNo = st.menuStyle === 1;
    const isList = st.menuKind === 2;
    const scroll = isList && st.listCount > rows;
    const colWpx = cols > 1 ? st.colW || Math.floor((st.tilesW * 8) / cols) : st.tilesW * 8;

    // Beschriftungen aus dem Fenster schneiden
    this.colors = this._textColors();
    const labels = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const y0 = st.itemY0 - st.menuY + r * rowH;
        const x0 = c * colWpx + (st.labelX || 0);
        const x1 = cols > 1 ? (c + 1) * colWpx : st.tilesW * 8;
        labels.push(this._label(x0, y0, x1, y0 + rowH));
      }
    }
    const maxLabel = Math.max(16, ...labels.map((l) => l.w));
    // gemeinsamer Schriftbereich aller Zeilen (damit alle Beschriftungen gleich hoch sitzen)
    let gTop = 99, gBot = 0;
    for (const l of labels) if (l.w) { gTop = Math.min(gTop, l.y0 - l.rowTop); gBot = Math.max(gBot, l.y0 - l.rowTop + l.h); }
    this.glyph = gBot > gTop ? { top: gTop, h: gBot - gTop } : { top: 0, h: rowH };

    const areaX = 8, areaY = 6, areaW = W - 16 - (scroll ? 40 : 0), areaH = H - 12;
    const gapX = 6;
    const gapY = rows > 6 ? 2 : rows > 4 ? 4 : 8;
    let bh = Math.floor((areaH - gapY * (rows - 1)) / rows);
    bh = Math.max(Math.min(bh, yesNo ? 36 : 32), Math.min(rowH + 4, 20));
    const colArea = Math.floor((areaW - gapX * (cols - 1)) / cols);
    let bw = cols > 1 ? colArea : Math.min(colArea, Math.max(maxLabel + 40, yesNo ? 120 : 136));
    bw = Math.max(bw, 40);
    const blockW = bw * cols + gapX * (cols - 1);
    const blockH = bh * rows + gapY * (rows - 1);
    const bx = areaX + Math.floor((areaW - blockW) / 2);
    const by = areaY + Math.floor((areaH - blockH) / 2);

    const buttons = [];
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const pos = c * rows + r;
        const theme = yesNo ? (r === 0 ? 'red' : 'blue') : 'white';
        buttons.push({
          id: 'r' + pos, kind: 'row', row: r, col: c, pos,
          x: bx + c * (bw + gapX), y: by + r * (bh + gapY), w: bw, h: bh,
          theme, label: labels[pos], center: yesNo || cols > 1,
          cursor: !yesNo && pos === st.menuCursor,
        });
      }
    }
    if (scroll) {
      const ax = W - 8 - 34, ah = Math.max(24, Math.min(56, Math.floor((blockH - 6) / 2)));
      buttons.push({ id: 'up', kind: 'up', x: ax, y: by, w: 34, h: ah, theme: 'white', disabled: st.listPos <= 0 });
      buttons.push({ id: 'down', kind: 'down', x: ax, y: by + blockH - ah, w: 34, h: ah, theme: 'white', disabled: st.listPos + rows >= st.listCount });
    }
    this.buttons = buttons;
  }

  // Schriftfarbe (die dunklere der beiden häufigsten Farben außer dem Hintergrund) und Schatten
  _textColors() {
    const n = new Array(16).fill(0);
    const p = this.pix;
    for (let i = 0; i < p.length; i++) {
      n[p[i] & 15]++;
      n[p[i] >> 4]++;
    }
    n[this.st.bgIndex] = -1;
    n[0] = -1;
    const order = n.map((v, i) => [v, i]).filter((a) => a[0] > 0).sort((a, b) => b[0] - a[0]);
    let fg = order[0] ? order[0][1] : 1, shadow = order[1] ? order[1][1] : 2;
    if (this.pal && luma(bgr555(this.pal[fg])) > luma(bgr555(this.pal[shadow]))) [fg, shadow] = [shadow, fg];
    return { fg, shadow };
  }

  _px(x, y) {
    const st = this.st;
    if (x < 0 || y < 0 || x >= st.tilesW * 8 || y >= st.tilesH * 8) return st.bgIndex;
    const tile = (y >> 3) * st.tilesW + (x >> 3);
    const v = this.pix[tile * 32 + (y & 7) * 4 + ((x & 7) >> 1)];
    return x & 1 ? v >> 4 : v & 15;
  }

  /** Ausschnitt des Fensters, auf die benutzten Pixel zugeschnitten */
  _label(x0, y0, x1, y1) {
    const bg = this.st.bgIndex;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = this._px(x, y);
        if (c !== bg && c !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { w: 0, h: 0, x0, y0, rowTop: y0, rowH: y1 - y0 };
    return { x0: minX, y0: minY, w: maxX - minX + 1, h: maxY - minY + 1, rowTop: y0, rowH: y1 - y0, offX: minX - x0 };
  }

  // ---------- Zeichnen ----------
  _draw() {
    const d = this.img.data;
    // Hintergrund mit Streifen oben und unten
    for (let y = 0; y < H; y++) {
      const c = bandColor(y);
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    for (const b of this.buttons) this._button(b);
    this.ctx.putImageData(this.img, 0, 0);
  }

  _button(b) {
    const pressed = this.pressed && this.pressed.id === b.id;
    let theme = THEMES[b.theme];
    if (b.cursor || pressed) theme = b.theme === 'white' ? THEMES.gold : theme;
    const dy = pressed ? 1 : 0;
    const d = this.img.data;
    for (let y = 0; y < b.h; y++) {
      const sy = y < TPL_TOP ? y : y >= b.h - TPL_BOTTOM ? TPL_H - (b.h - y) : TPL_MID;
      const row = TPL[Math.max(0, Math.min(TPL_H - 1, sy))];
      for (let x = 0; x < b.w; x++) {
        const sx = x < TPL_SIDE ? x : x >= b.w - TPL_SIDE ? TPL_W - (b.w - x) : 24;
        let ch = row[sx];
        if (ch === 'a') continue;
        if (pressed && (ch === 'h' || ch === 'i')) ch = 'g';
        const c = FRAME[ch] || theme[ch];
        const px = b.x + x, py = b.y + y + (FRAME[ch] ? 0 : dy);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const o = (py * W + px) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
      }
    }
    if (b.kind === 'row') this._drawLabel(b, theme, dy);
    else this._arrow(b, b.kind === 'up', dy);
  }

  _drawLabel(b, theme, dy) {
    const L = b.label;
    if (!L || !L.w) return;
    const { fg, shadow } = this.colors;
    const pal = this.pal;
    const bg = this.st.bgIndex;
    const innerX = b.x + 7, innerW = b.w - 14;
    // waagerecht: Ja/Nein und Spalten mittig, sonst links mit etwas Abstand
    let tx = b.center ? b.x + Math.floor((b.w - L.w) / 2) : innerX + 5 + Math.min(L.offX || 0, 8);
    if (tx + L.w > innerX + innerW) tx = Math.max(innerX, innerX + innerW - L.w);
    // senkrecht: gemeinsamer Schriftbereich mittig im Knopf
    const G = this.glyph;
    const ty = b.y + Math.floor((b.h - G.h) / 2) + 1 + dy + (L.y0 - L.rowTop - G.top);
    const d = this.img.data;
    for (let y = 0; y < L.h; y++) {
      const py = ty + y;
      if (py < b.y + 3 || py >= b.y + b.h - 3) continue;
      for (let x = 0; x < L.w; x++) {
        const c = this._px(L.x0 + x, L.y0 + y);
        if (c === bg || c === 0) continue;
        let rgb;
        if (theme.text) {
          if (c !== fg) continue; // farbige Knöpfe: Schrift ohne Schatten wie im Spiel
          rgb = theme.text;
        } else {
          rgb = bgr555(pal[c]);
          if (c === shadow && theme === THEMES.gold) rgb = [255, 247, 206];
        }
        const px = tx + x;
        if (px < innerX || px >= innerX + innerW) continue;
        const o = (py * W + px) * 4;
        d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2];
      }
    }
  }

  _arrow(b, up, dy) {
    const d = this.img.data;
    const cx = b.x + (b.w >> 1), cy = b.y + (b.h >> 1) + dy;
    const col = b.disabled ? [170, 176, 200] : [49, 66, 90];
    for (let i = 0; i < 6; i++) {
      const y = up ? cy - 3 + i : cy + 2 - i;
      for (let x = cx - i - 1; x <= cx + i; x++) {
        const o = (y * W + x) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2];
      }
    }
  }
}

function bandColor(y) {
  const yy = y < 96 ? y : H - 1 - y;
  if (yy >= 32) return BG;
  const band = yy >> 3, inBand = yy & 7;
  if (band === 3 && inBand === 7) return BAND[3];
  // je Streifen: 6 Zeilen Farbe, dann eine hellere Linie und eine Zeile in der Streifenfarbe
  if (inBand === 6) return BAND[band + 1];
  return BAND[band];
}

function luma(c) {
  return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
}

function bgr555(v) {
  const r = v & 31, g = (v >> 5) & 31, b = (v >> 10) & 31;
  return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2)];
}
