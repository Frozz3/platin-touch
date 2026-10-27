// Platin Touch – Anordnung und Zeichnen der beiden DS-Bildschirme.
//
// Aufbau (Hochformat):
//   oben       der obere DS-Bildschirm in voller Breite
//   Mitte      Lauffläche (Ziehen = laufen, Tippen = sprechen/weiter)
//   unten      der Touchscreen; er fährt von unten herein, wenn er gebraucht wird
//              (Kampf, Auswahl, Beutel …), und verschwindet draußen wieder
//   ganz unten die Leiste mit den Knöpfen

const W = 256, H = 192;

export class Screens {
  constructor({ app, top, bot, topWrap, botWrap, pad }) {
    this.app = app;
    this.top = top;
    this.bot = bot;
    this.topWrap = topWrap;
    this.botWrap = botWrap;
    this.pad = pad;
    this.ctxTop = top.getContext('2d', { alpha: false });
    this.ctxBot = bot.getContext('2d', { alpha: false });
    this.frame = null;
    this.drawn = 0;
    this.topRect = { x: 0, y: 0, w: W, h: H };
    this.botRect = { x: 0, y: H, w: W, h: H };
    this.walkRect = null;
    this.bottomShown = true;
    this.onChange = null;
    this.scale = 1;
    this._probe = document.createElement('div');
    this._probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(this._probe);
    addEventListener('resize', () => this.layout());
    addEventListener('orientationchange', () => setTimeout(() => this.layout(), 250));
    this.layout();
    const loop = () => {
      if (this.frame) {
        this._draw(this.frame);
        this.frame = null;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  insets() {
    const cs = getComputedStyle(this._probe);
    return {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
  }

  layout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const ins = this.insets();
    const barH = 68 + ins.bottom;
    const topY = ins.top;
    const maxW = vw - ins.left - ins.right;
    const availH = vh - barH - topY;
    // volle Breite; nur wenn beide Bildschirme sonst nicht übereinander passen, etwas kleiner
    let s = maxW / W;
    let w = maxW;
    if (2 * H * s + 6 > availH) {
      const dpr = window.devicePixelRatio || 1;
      s = Math.floor(((availH - 6) / (2 * H)) * W * dpr) / (W * dpr);
      w = W * s;
    }
    const h = H * s;
    const x = ins.left + (maxW - w) / 2;
    this.scale = s;
    this.vh = vh;
    this.barH = barH;
    this.topRect = { x, y: topY, w, h };
    this.botRect = { x, y: vh - barH - h - 2, w, h };
    place(this.topWrap, this.topRect);
    place(this.botWrap, this.botRect);
    this.app.classList.toggle('full', w >= vw - 1);
    this.app.style.setProperty('--bot-hide', h + barH + 24 + 'px');
    this._placeWalk();
  }

  _placeWalk() {
    const vw = window.innerWidth;
    const ins = this.insets();
    const y0 = this.topRect.y + this.topRect.h + 2;
    const y1 = this.bottomShown ? this.botRect.y - 2 : this.vh - this.barH;
    const h = y1 - y0;
    this.walkRect = h > 24 ? { x: ins.left, y: y0, w: vw - ins.left - ins.right, h } : null;
    if (this.walkRect) {
      place(this.pad, this.walkRect);
      this.pad.style.display = '';
      this.pad.classList.toggle('small', h < 120);
      this.pad.classList.toggle('tiny', h < 70);
    } else {
      this.pad.style.display = 'none';
    }
  }

  /** Touchscreen ein-/ausblenden */
  setBottom(show) {
    show = !!show;
    if (show === this.bottomShown) return;
    this.bottomShown = show;
    if (show) this.flushBottom();
    this.app.classList.toggle('bot-hidden', !show);
    this._placeWalk();
    this.onChange?.(show);
  }

  inPad(cx, cy) {
    const r = this.walkRect;
    return !!r && cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
  }

  /** Bildschirmpunkt -> {screen: 0|1|-1, x, y} in DS-Pixeln (x 0..255, y 0..191) */
  hit(cx, cy) {
    const list = this.bottomShown ? [[1, this.botRect], [0, this.topRect]] : [[0, this.topRect]];
    for (const [i, r] of list) {
      if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
        return { screen: i, x: ((cx - r.x) / r.w) * W, y: ((cy - r.y) / r.h) * H };
      }
    }
    return { screen: -1, x: 0, y: 0 };
  }

  /** DS-Pixel eines Bildschirms -> Bildschirmpunkt */
  toClient(screen, x, y) {
    const r = screen === 0 ? this.topRect : this.botRect;
    return { x: r.x + (x / W) * r.w, y: r.y + (y / H) * r.h };
  }

  setFrame(buf) {
    this.frame = buf;
  }

  _draw(buf) {
    const n = W * H * 4;
    this.ctxTop.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, 0, n), W, H), 0, 0);
    if (this.bottomShown) this.ctxBot.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, n, n), W, H), 0, 0);
    else this._lastBot = buf; // beim Einblenden sofort das aktuelle Bild zeigen
    this.drawn++;
  }

  flushBottom() {
    if (this._lastBot) {
      const n = W * H * 4;
      this.ctxBot.putImageData(new ImageData(new Uint8ClampedArray(this._lastBot.buffer, n, n), W, H), 0, 0);
      this._lastBot = null;
    }
  }
}

function place(el, r) {
  el.style.left = r.x + 'px';
  el.style.top = r.y + 'px';
  el.style.width = r.w + 'px';
  el.style.height = r.h + 'px';
}
