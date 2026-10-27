// Platin Touch – Emulator-Thread (Web Worker).
// Hier läuft der DS-Kern (DeSmuME als WebAssembly). Die Seite selbst bleibt dadurch frei für
// Touch-Eingaben und das Zeichnen. Nachrichten:
//   Seite -> Worker: init, start, pause, keys, press, queue, touch, touchTap, tap, speed, fps, volume, menusBottom,
//                    stateSave, stateLoad, exportSave, importSave, reset, flush
//   Worker -> Seite: ready, started, frame, audio, status, menuPix, sav, state, saveFile, error, log
'use strict';

self.Module = undefined;
importScripts('../vendor/platin_emu.js');

const FRAME_MS = 1000 / 59.8261;
const SAMPLE_RATE_DEFAULT = 48000;

// Tastenbits (wie pt_runFrame)
const K = { Right: 1, Left: 2, Down: 4, Up: 8, Select: 16, Start: 32, B: 64, A: 128, Y: 256, X: 512, L: 1024, R: 2048 };

let M = null;
let running = false;
let romLoaded = false;
let sampleRate = SAMPLE_RATE_DEFAULT;
let speed = 1; // Vorlauf-Faktor
let fpsMode = 'auto'; // 'auto' | '60' | '30'
let muted = false;
let debug = false;

// Eingaben
let heldKeys = 0; // vom Stick / gehaltenen Knöpfen
let pulses = []; // [{mask, frames}] – kurze Tastendrücke (nacheinander)
let pulseNow = null;
let pulseGap = 0;
let touchOn = false, touchX = 0, touchY = 0;
let tapFrames = 0, tapX = 0, tapY = 0; // kurzes Antippen des Touchscreens (einige Bilder lang)

// Brücke ins Spiel
let bridgeOff = -1; // Offset im Hauptspeicher
let bridgeTried = 0;
let ramBase = 0;
let menusBottom = false; // Einstellung: Auswahlmenüs unten anzeigen
let ownActive = false; // die App zeigt gerade ein Menü unten an
let pixHash = -1;
let freeStart = -1; // Bild, seit dem die Oberwelt ohne Unterbrechung läuft

// Batteriespeicher
let savDirtyAt = 0;
let savDirty = false;

// Takt
let nextAt = 0;
let frameNo = 0;
let lastDrawn = 0;
let timer = 0;
const perf = { emu: 0, n: 0, drawn: 0, skipped: 0, behind: 0, maxEmu: 0, t0: 0 };

function post(msg, transfer) { self.postMessage(msg, transfer || []); }
function log(s) { post({ type: 'log', text: String(s) }); }

async function init(opts) {
  sampleRate = opts.sampleRate || SAMPLE_RATE_DEFAULT;
  debug = !!opts.debug;
  M = await PlatinEmu({
    locateFile: (p) => '../vendor/' + p,
    print: (s) => { if (opts.debug) log(s); },
    printErr: (s) => { if (opts.debug) log('! ' + s); },
  });
  M._pt_init();
  M._pt_setSampleRate(sampleRate);
  post({ type: 'ready' });
}

function loadRom(rom, sav) {
  const bytes = new Uint8Array(rom);
  if (sav && sav.byteLength > 0) {
    const s = new Uint8Array(sav);
    const p = M._pt_savPtr(s.length);
    M.HEAPU8.set(s, p);
  }
  const p = M._pt_romBuffer(bytes.length);
  M.HEAPU8.set(bytes, p);
  const r = M._pt_loadRom(bytes.length);
  if (r !== 0) throw new Error('ROM konnte nicht geladen werden (' + r + ')');
  romLoaded = true;
  ramBase = M._pt_mainRam();
  bridgeOff = -1;
  bridgeTried = 0;
  frameNo = 0;
  M._pt_savChanged();
}

// ---------- Brücke ----------
const MAGIC0 = 0x31425450, MAGIC1 = 0x48435554;
function findBridge() {
  const u32 = new Uint32Array(M.HEAPU8.buffer, ramBase, (4 * 1024 * 1024) >> 2);
  for (let i = 0; i < u32.length - 1; i++) {
    if (u32[i] === MAGIC0 && u32[i + 1] === MAGIC1) return i * 4;
  }
  return -1;
}
function b8(o) { return M.HEAPU8[ramBase + bridgeOff + o]; }
function b16s(o) { const v = M.HEAPU8[ramBase + bridgeOff + o] | (M.HEAPU8[ramBase + bridgeOff + o + 1] << 8); return v & 0x8000 ? v - 0x10000 : v; }
function b16(o) { return M.HEAPU8[ramBase + bridgeOff + o] | (M.HEAPU8[ramBase + bridgeOff + o + 1] << 8); }
function b32(o) { const a = ramBase + bridgeOff + o, h = M.HEAPU8; return (h[a] | (h[a + 1] << 8) | (h[a + 2] << 16) | (h[a + 3] << 24)) >>> 0; }
function bridgeValid() {
  return bridgeOff >= 0 && b32(0) === MAGIC0 && b32(4) === MAGIC1;
}

let lastStatusKey = '';
function readStatus() {
  if (!bridgeValid()) return { bridge: false };
  const frame = b32(12);
  const menuFrame = b32(28);
  return {
    bridge: true,
    version: b16(8),
    frame,
    menuActive: (frame - menuFrame) >>> 0 <= 2,
    menuKind: b8(26),
    menuScreen: b8(27),
    menuX: b16s(32), menuY: b16s(34), menuW: b16(36), menuH: b16(38),
    menuRows: b8(40), menuCols: b8(41), menuCursor: b8(42), menuRowH: b8(43),
    listPos: b16(44), listCount: b16(46), itemY0: b16s(48),
    dispSelect: b8(54),
    tapAck: b8(24), tapResult: b8(25),
    noTapA: ((frame - b32(72)) | 0) <= 0,
    textActive: (frame - b32(76)) >>> 0 <= 3,
    textWaiting: (frame - b32(80)) >>> 0 <= 3,
    battle: (frame - b32(84)) >>> 0 <= 3,
    ...fieldStatus(frame),
    ...ownStatus(frame),
    ...bottomStatus(frame),
  };
}

// Läuft gerade die Oberwelt (unten nur der Pokétch)? Dann braucht die App den Touchscreen nicht zu zeigen.
function bottomStatus(frame) {
  if (b16(8) < 4) return { bottomKnown: false };
  const sinceFree = (frame - b32(88)) >>> 0;
  const free = sinceFree <= 2;
  if (!free) freeStart = -1;
  else if (freeStart < 0) freeStart = frame;
  return { bottomKnown: true, bottomFree: free, sinceFree: Math.min(sinceFree, 99999), freeFor: free ? frame - freeStart : 0, fieldSeen: b32(96) !== 0 };
}

// Menü, das die App unten anzeigt (Brücke ab Version 4)
function ownStatus(frame) {
  if (b16(8) < 4 || b16(10) < 316) return { own: false };
  const own = (frame - b32(268)) >>> 0 <= 2 && (frame - b32(28)) >>> 0 <= 2;
  if (!own) return { own: false };
  return { own: true, tilesW: b8(276), tilesH: b8(277), menuStyle: b8(279), labelX: b8(280), bgIndex: b8(281), itemX0: b16s(50), colW: b16(52) };
}

// Pixel und Farben des Menüfensters an die Seite schicken (nur bei Änderung)
function postMenuPixels(st) {
  const addr = b32(272);
  const len = st.tilesW * st.tilesH * 32;
  const off = addr - 0x02000000;
  if (off < 0 || len <= 0 || off + len > 4 * 1024 * 1024) return;
  const h = M.HEAPU8;
  const a = ramBase + off;
  let hash = 2166136261;
  for (let i = 0; i < len; i += 2) hash = Math.imul(hash ^ h[a + i] ^ (h[a + i + 1] << 8), 16777619);
  for (let i = 0; i < 32; i++) hash = Math.imul(hash ^ b8(284 + i), 16777619);
  hash = (hash ^ (st.tilesW << 8) ^ st.tilesH ^ (st.labelX << 16) ^ (st.menuStyle << 24)) >>> 0;
  if (hash === pixHash) return;
  pixHash = hash;
  const pix = h.slice(a, a + len);
  const pal = new Uint16Array(16);
  for (let i = 0; i < 16; i++) pal[i] = b16(284 + i * 2);
  post({ type: 'menuPix', pix, pal, hash }, [pix.buffer, pal.buffer]);
}

function writeAppFlags() {
  if (!bridgeValid()) return;
  const a = ramBase + bridgeOff + 20;
  const on = menusBottom || ownActive;
  M.HEAPU8[a] = (M.HEAPU8[a] & ~2) | (on ? 2 : 0);
}

function fieldStatus(frame) {
  if (b16(10) < 268) return { field: false };
  const field = (frame - b32(96)) >>> 0 <= 2;
  if (!field) return { field: false };
  const n = Math.min(20, b8(105));
  const npcs = [];
  for (let i = 0; i < n; i++) {
    const o = 108 + i * 8;
    npcs.push([b16s(o), b16s(o + 2), b16s(o + 4), b16s(o + 6)]);
  }
  return { field: true, px: b16s(100), pz: b16s(102), pdir: b8(104), npcs };
}

function sendTap(x, y, screen) {
  if (!bridgeValid()) {
    // Ohne Brücke (unveränderte ROM): Antippen oben = A
    if (screen === 0) pulses.push({ mask: K.A, frames: 4 });
    return;
  }
  const a = ramBase + bridgeOff;
  const h = M.HEAPU8;
  h[a + 20] |= 1; // Tippen ohne Menü = A
  h[a + 17] = Math.max(0, Math.min(255, x | 0));
  h[a + 18] = Math.max(0, Math.min(191, y | 0));
  h[a + 19] = screen ? 1 : 0;
  h[a + 16] = (h[a + 16] + 1) & 255;
}

// ---------- Takt ----------
function currentKeys() {
  let k = heldKeys;
  if (pulseNow) {
    if (pulseNow.frames > 0) {
      k |= pulseNow.mask;
      pulseNow.frames--;
    } else {
      pulseNow = null;
      pulseGap = 2; // kurze Pause zwischen zwei Drücken
    }
  } else if (pulseGap > 0) {
    pulseGap--;
  } else if (pulses.length) {
    pulseNow = pulses.shift();
    k |= pulseNow.mask;
    pulseNow.frames--;
  }
  return k;
}

function runOne(draw) {
  const keys = currentKeys();
  writeAppFlags();
  const t = performance.now();
  let tOn = touchOn, tX = touchX, tY = touchY;
  if (!tOn && tapFrames > 0) { tapFrames--; tOn = true; tX = tapX; tY = tapY; }
  M._pt_runFrame(draw ? 1 : 0, keys, tOn ? 1 : 0, tX, tY);
  const dt = performance.now() - t;
  perf.emu += dt;
  perf.n++;
  if (dt > perf.maxEmu) perf.maxEmu = dt;
  frameNo++;

  // Ton
  const want = Math.round(sampleRate / 59.8261) + 2;
  const n = M._pt_audio(want);
  if (n > 0 && !muted && speed === 1) {
    const p = M._pt_audioBuf() >> 1;
    const pcm = new Int16Array(n * 2);
    pcm.set(M.HEAP16.subarray(p, p + n * 2));
    post({ type: 'audio', pcm }, [pcm.buffer]);
  }

  // Brücke suchen (sie entsteht erst nach dem Start des Spiels)
  if (bridgeOff < 0 && frameNo % 30 === 5 && bridgeTried < 200) {
    bridgeTried++;
    bridgeOff = findBridge();
    if (bridgeOff >= 0) post({ type: 'bridge', found: true, version: b16(8) });
    else if (bridgeTried === 20) post({ type: 'bridge', found: false });
  }

  // Batteriespeicher: nach dem Speichern im Spiel kurz warten, dann sichern
  if (frameNo % 15 === 0) {
    if (M._pt_savChanged()) {
      if (debug && !savDirty) log('sav: Änderung bei Bild ' + frameNo);
      savDirty = true;
      savDirtyAt = frameNo;
    } else if (savDirty && frameNo - savDirtyAt > 60) {
      savDirty = false;
      postSav();
    }
  }
}

function postSav() {
  const n = M._pt_savSize();
  if (n <= 0) return;
  const p = M._pt_savPtr(0);
  const copy = new Uint8Array(n);
  copy.set(M.HEAPU8.subarray(p, p + n));
  post({ type: 'sav', data: copy.buffer }, [copy.buffer]);
}

function postFrame() {
  const p = M._pt_frame();
  const buf = new Uint8ClampedArray(256 * 384 * 4);
  buf.set(M.HEAPU8.subarray(p, p + buf.length));
  post({ type: 'frame', buf }, [buf.buffer]);
}

function tick() {
  timer = 0;
  if (!running) return;
  const now = performance.now();
  if (nextAt === 0) nextAt = now;
  // weit zurück (z. B. nach dem Zurückholen der App): nicht aufholen
  if (now - nextAt > 250) { nextAt = now; perf.behind++; }

  let frames = 0;
  const maxFrames = speed > 1 ? speed : 3;
  while (now >= nextAt && frames < maxFrames) {
    nextAt += FRAME_MS / speed;
    frames++;
    const late = performance.now() - nextAt > FRAME_MS * 0.5;
    let draw;
    if (speed > 1) draw = frames === maxFrames || performance.now() + FRAME_MS / speed > nextAt + FRAME_MS;
    else if (fpsMode === '30') draw = frameNo % 2 === 0;
    else if (fpsMode === '60') draw = true;
    else draw = !late || frameNo - lastDrawn >= 2; // automatisch: höchstens jedes 2. Bild auslassen
    if (speed > 1 && frames < maxFrames) draw = false;
    runOne(draw);
    if (draw) {
      lastDrawn = frameNo;
      perf.drawn++;
      postFrame();
    } else perf.skipped++;
  }

  const st = readStatus();
  ownActive = !!st.own;
  if (st.own) postMenuPixels(st);
  else pixHash = -1;
  const key = JSON.stringify(st);
  if (key !== lastStatusKey) {
    lastStatusKey = key;
    post({ type: 'status', st });
  }

  if (now - perf.t0 > 1000) {
    const secs = (now - perf.t0) / 1000;
    post({ type: 'perf', fps: perf.drawn / secs, emuFps: perf.n / secs, emuMs: perf.n ? perf.emu / perf.n : 0, maxMs: perf.maxEmu, skipped: perf.skipped, behind: perf.behind });
    perf.emu = perf.n = perf.drawn = perf.skipped = perf.maxEmu = 0;
    perf.t0 = now;
  }

  const wait = Math.max(0, nextAt - performance.now());
  timer = setTimeout(tick, wait > 2 ? wait - 1 : 0);
}

function start() {
  if (!romLoaded || running) return;
  running = true;
  nextAt = 0;
  perf.t0 = performance.now();
  tick();
}
function pause() {
  running = false;
  if (timer) clearTimeout(timer);
  timer = 0;
  if (savDirty || (M && romLoaded && M._pt_savChanged())) { savDirty = false; postSav(); }
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init': await init(m); break;
      case 'load': loadRom(m.rom, m.sav); post({ type: 'loaded' }); break;
      case 'start': start(); break;
      case 'pause': pause(); break;
      case 'keys': heldKeys = m.keys | 0; break;
      case 'press': pulses.push({ mask: m.mask, frames: m.frames || 6 }); break;
      case 'queue': for (const q of m.items) pulses.push({ mask: q.mask, frames: q.frames || 3 }); break;
      case 'clearQueue': pulses = []; pulseNow = null; break;
      case 'touch': touchOn = !!m.on; touchX = m.x | 0; touchY = m.y | 0; break;
      case 'touchTap': tapFrames = m.frames || 6; tapX = m.x | 0; tapY = m.y | 0; break;
      case 'tap': sendTap(m.x, m.y, m.screen); break;
      case 'speed': speed = Math.max(1, m.speed | 0); nextAt = 0; break;
      case 'fps': fpsMode = m.mode; break;
      case 'mute': muted = !!m.on; break;
      case 'menusBottom': menusBottom = !!m.on; break;
      case 'flush': if (romLoaded) postSav(); break;
      case 'stateSave': {
        const n = M._pt_stateSave();
        if (n <= 0) throw new Error('Schnellspeichern fehlgeschlagen');
        const p = M._pt_stateBuf();
        const copy = new Uint8Array(n);
        copy.set(M.HEAPU8.subarray(p, p + n));
        post({ type: 'state', slot: m.slot, data: copy.buffer }, [copy.buffer]);
        break;
      }
      case 'stateLoad': {
        // Der Schnellstand enthält auch den Batteriespeicher von damals. Damit ein späteres
        // Speichern im Spiel nicht verloren geht, bleibt der aktuelle Batteriespeicher erhalten.
        let keep = null;
        const sn = M._pt_savSize();
        if (sn > 0) {
          const sp = M._pt_savPtr(0);
          keep = M.HEAPU8.slice(sp, sp + sn);
          let used = false;
          for (let i = 0; i < keep.length - 200; i += 61) if (keep[i] !== 0xff) { used = true; break; }
          if (!used) keep = null; // noch nie gespeichert: Stand aus dem Schnellstand übernehmen
        }
        const b = new Uint8Array(m.data);
        const p = M._malloc(b.length);
        M.HEAPU8.set(b, p);
        const r = M._pt_stateLoad(p, b.length);
        M._free(p);
        if (r !== 0) throw new Error('Schnellstand passt nicht zu dieser ROM');
        if (keep && M._pt_savSize() === keep.length) {
          M.HEAPU8.set(keep, M._pt_savPtr(0));
        }
        M._pt_savChanged();
        savDirty = false;
        bridgeOff = -1; bridgeTried = 0;
        post({ type: 'stateLoaded', slot: m.slot });
        break;
      }
      case 'exportSave': {
        const path = '/export.sav';
        if (M._pt_exportSave(allocStr(path)) !== 0) throw new Error('Export fehlgeschlagen');
        const data = M.FS.readFile(path);
        M.FS.unlink(path);
        post({ type: 'saveFile', data: data.buffer }, [data.buffer]);
        break;
      }
      case 'importSave': {
        const ext = /\.(dsv|duc|dss)$/i.test(m.name || '') ? m.name.slice(-4).toLowerCase() : '.sav';
        const path = '/import' + ext;
        M.FS.writeFile(path, new Uint8Array(m.data));
        const r = M._pt_importSave(allocStr(path));
        M.FS.unlink(path);
        if (r !== 0) throw new Error('Diese Datei ist kein passender Spielstand');
        bridgeOff = -1; bridgeTried = 0;
        postSav();
        post({ type: 'imported' });
        break;
      }
      case 'reset': M._pt_reset(); bridgeOff = -1; bridgeTried = 0; break;
    }
  } catch (err) {
    post({ type: 'error', where: m.type, text: err && err.message ? err.message : String(err) });
  }
};

let strPtr = 0;
function allocStr(s) {
  if (strPtr) M._free(strPtr);
  const bytes = new TextEncoder().encode(s + '\0');
  strPtr = M._malloc(bytes.length);
  M.HEAPU8.set(bytes, strPtr);
  return strPtr;
}
