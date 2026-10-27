// Platin Touch – Anordnung und Zeichnen der beiden DS-Bildschirme (hochkant übereinander).

const W = 256, H = 192;

export class Screens {
  constructor({ app, top, bot, topWrap, botWrap, hinge, pad }) {
    this.app = app;
    this.top = top;
    this.bot = bot;
    this.topWrap = topWrap;
    this.botWrap = botWrap;
    this.hinge = hinge;
    this.pad = pad;
    this.padSize = 1; // 0 = aus, 1 = normal, 2 = groß
    this.padRect = null;
    this.ctxTop = top.getContext('2d', { alpha: false });
    this.ctxBot = bot.getContext('2d', { alpha: false });
    this.frame = null;
    this.drawn = 0;
    this.topRect = { x: 0, y: 0, w: W, h: H };
    this.botRect = { x: 0, y: H, w: W, h: H };
    this.scale = 1;
    this.freeTop = 0; // freie Fläche unter dem Touchscreen
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
    const barH = 64 + ins.bottom;
    const gap = 10;
    const topY = ins.top + 6;
    const maxH = vh - barH - topY - 8;
    const maxW = vw - ins.left - ins.right;
    // Platz für das Steuerfeld unten freihalten; dafür werden die Bildschirme notfalls etwas kleiner
    // (höchstens auf 78 % der vollen Breite)
    const padMin = [0, 150, 220][this.padSize] || 0;
    const fullS = Math.min(maxW / W, (maxH - gap) / (2 * H));
    let s = Math.min(fullS, (maxH - gap - padMin) / (2 * H));
    s = Math.max(s, Math.min(fullS, (maxW / W) * 0.78));
    // auf ganze Gerätepixel runden (sauberere Kanten)
    const dpr = window.devicePixelRatio || 1;
    s = Math.floor(s * W * dpr) / (W * dpr);
    const w = W * s, h = H * s;
    const x = ins.left + (maxW - w) / 2;
    this.scale = s;
    this.topRect = { x, y: topY, w, h };
    this.botRect = { x, y: topY + h + gap, w, h };
    place(this.topWrap, this.topRect);
    place(this.botWrap, this.botRect);
    this.hinge.style.left = x + w * 0.3 + 'px';
    this.hinge.style.width = w * 0.4 + 'px';
    this.hinge.style.top = topY + h + gap / 2 - 2 + 'px';
    const freeY = this.botRect.y + h;
    this.freeTop = freeY;
    const padTop = freeY + 8, padBottom = vh - barH - 4;
    const padH = padBottom - padTop;
    if (this.padSize > 0 && padH >= 56) {
      this.padRect = { x: ins.left + 10, y: padTop, w: vw - ins.left - ins.right - 20, h: padH };
      place(this.pad, this.padRect);
      this.pad.style.display = '';
      this.pad.classList.toggle('small', padH < 110);
    } else {
      this.padRect = null;
      this.pad.style.display = 'none';
    }
  }

  setPadSize(n) {
    this.padSize = n;
    this.layout();
  }

  inPad(cx, cy) {
    const r = this.padRect;
    return !!r && cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
  }

  /** Bildschirmpunkt -> {screen: 0|1|-1, x, y} in DS-Pixeln (x 0..255, y 0..191) */
  hit(cx, cy) {
    for (const [i, r] of [[0, this.topRect], [1, this.botRect]]) {
      if (cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h) {
        return { screen: i, x: ((cx - r.x) / r.w) * W, y: ((cy - r.y) / r.h) * H };
      }
    }
    return { screen: -1, x: 0, y: 0 };
  }

  /** DS-Pixel des oberen Bildschirms -> Bildschirmpunkt */
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
    this.ctxBot.putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, n, n), W, H), 0, 0);
    this.drawn++;
  }
}

function place(el, r) {
  el.style.left = r.x + 'px';
  el.style.top = r.y + 'px';
  el.style.width = r.w + 'px';
  el.style.height = r.h + 'px';
}
