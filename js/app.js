// Platin Touch – Start und Verdrahtung.

import * as store from './store.js';
import { Screens } from './screen.js';
import { Gestures, K } from './gestures.js';
import { Audio } from './audio.js';
import { Autopilot } from './autopilot.js';
import { MenuOverlay } from './menu-overlay.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const DEBUG = /debug/.test(location.search);
const nonFF = (b) => { let n = 0; for (const x of new Uint8Array(b)) if (x !== 255) n++; return n; };
const settings = store.loadSettings();
const save = () => store.saveSettings(settings);

let worker = null;
let status = { bridge: false };
let bridgeKnown = null;
let screens, gestures, audio, autopilot, overlay;
let ffOn = false;
let running = false;
let romInfo = '';
let currentRomId = '';

const emu = {
  post(msg, transfer) {
    if (worker) worker.postMessage(msg, transfer || []);
  },
};

// ---------- kleine Helfer ----------
let toastTimer = 0;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function setBoot(msg, { err = false, buttons = [], progress = null } = {}) {
  $('#boot').classList.remove('hidden');
  const p = $('#bootMsg');
  p.textContent = msg;
  p.className = err ? 'err' : '';
  const bar = $('#bootProgress');
  bar.classList.toggle('hidden', progress === null);
  if (progress !== null) bar.firstElementChild.style.width = Math.round(progress * 100) + '%';
  const box = $('#bootBtns');
  box.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (b.primary ? ' primary' : '');
    btn.textContent = b.label;
    btn.onclick = b.onClick;
    box.appendChild(btn);
  }
}
function hideBoot() {
  $('#boot').classList.add('hidden');
}

function pickFile(input) {
  return new Promise((res) => {
    input.value = '';
    input.onchange = () => res(input.files && input.files[0]);
    input.click();
  });
}

function download(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 3000);
}

// Antipp-Rückmeldung (Kreis; bei Menüs leuchtet die getroffene Zeile kurz auf)
function fx(x, y, row, miss = false) {
  const layer = $('#fx');
  if (row) {
    const r = document.createElement('div');
    r.className = 'rowflash';
    Object.assign(r.style, { left: row.x + 'px', top: row.y + 'px', width: row.w + 'px', height: row.h + 'px' });
    layer.appendChild(r);
    setTimeout(() => r.remove(), 400);
  }
  const d = document.createElement('div');
  d.className = 'ripple' + (miss ? ' miss' : '');
  d.style.left = x + 'px';
  d.style.top = y + 'px';
  layer.appendChild(d);
  setTimeout(() => d.remove(), 450);
}

// ---------- ROM ----------
function readHeader(u8) {
  const txt = (a, n) => String.fromCharCode(...u8.subarray(a, a + n)).replace(/\0+$/, '');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  return { title: txt(0, 12), code: txt(12, 4), used: u8.length >= 0x84 ? dv.getUint32(0x80, true) : 0 };
}

/** Füllbytes (0xFF) am Ende abschneiden: spart Speicher auf dem Handy */
function trimRom(buf) {
  const u8 = new Uint8Array(buf);
  const h = readHeader(u8);
  if (!h.used || h.used >= u8.length || h.used < 0x4000) return buf;
  const end = Math.min(u8.length, (h.used + 0xfff) & ~0xfff);
  for (let i = end; i < u8.length; i += 4093) if (u8[i] !== 0xff) return buf;
  return buf.slice(0, end);
}

/** Kennung der ROM-Version (Schnellstände passen nur zur selben ROM) */
function romId(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let h = 0x811c9dc5;
  const mix = (b) => { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; };
  for (let i = 0; i < 0x200 && i < u8.length; i++) mix(u8[i]);
  const ranges = [[dv.getUint32(0x20, true), dv.getUint32(0x2c, true)], [dv.getUint32(0x48, true), dv.getUint32(0x4c, true)], [dv.getUint32(0x50, true), dv.getUint32(0x54, true)]];
  for (const [o, n] of ranges) for (let i = o; i < o + n && i < u8.length; i++) mix(u8[i]);
  for (let i = 0; i < u8.length; i += 4093) mix(u8[i]);
  return h.toString(16) + '-' + u8.length.toString(16);
}

async function chooseRom() {
  const f = await pickFile($('#fileRom'));
  if (!f) return;
  setBoot('Lese ROM …', { progress: 0.1 });
  let buf = await f.arrayBuffer();
  const h = readHeader(new Uint8Array(buf));
  if (!/^[A-Z0-9]{4}$/.test(h.code)) {
    setBoot('Das ist keine DS-ROM (.nds). Bitte die selbst gebaute pokeplatinum.us.nds wählen.', { err: true, buttons: [{ label: 'ROM auswählen', primary: true, onClick: chooseRom }] });
    return;
  }
  buf = trimRom(buf);
  setBoot('Speichere ROM auf dem Gerät …', { progress: 0.5 });
  try {
    await store.put('rom', buf);
    await store.put('romName', f.name);
    await store.persist();
  } catch (e) {
    toast('ROM konnte nicht dauerhaft gespeichert werden – sie gilt nur für diese Sitzung.', 4000);
  }
  location.reload();
}

async function loadRomFromPc() {
  // Wenn die App vom eigenen PC (serve.js) kommt, liegt die ROM unter /__rom
  try {
    const head = await fetch('__rom', { method: 'HEAD', cache: 'no-store' });
    if (!head.ok) return null;
    const stamp = head.headers.get('X-Rom-Mtime') + ':' + head.headers.get('Content-Length');
    let old = null;
    try { old = localStorage.getItem('pt.romStamp'); } catch (e) {}
    const have = await store.get('rom');
    if (have && old === stamp) return have;
    setBoot('Lade ROM vom PC …', { progress: 0.2 });
    const r = await fetch('__rom', { cache: 'no-store' });
    const buf = trimRom(await r.arrayBuffer());
    await store.put('rom', buf);
    await store.put('romName', 'vom PC');
    try { localStorage.setItem('pt.romStamp', stamp); } catch (e) {}
    return buf;
  } catch (e) {
    return null;
  }
}

// ---------- Emulator ----------
function waitFor(type) {
  return new Promise((resolve, reject) => {
    const h = (e) => {
      if (e.data.type === type) {
        worker.removeEventListener('message', h);
        resolve(e.data);
      } else if (e.data.type === 'error') {
        worker.removeEventListener('message', h);
        reject(new Error(e.data.text));
      }
    };
    worker.addEventListener('message', h);
  });
}

function onWorker(e) {
  const m = e.data;
  switch (m.type) {
    case 'frame': screens.setFrame(m.buf); break;
    case 'audio': audio.push(m.pcm); break;
    case 'status':
      status = m.st;
      if (autopilot) autopilot.update(status);
      if (overlay) overlay.update(status);
      break;
    case 'menuPix': if (overlay) overlay.setPixels(m); break;
    case 'bridge':
      bridgeKnown = m.found;
      $('#romInfo').textContent = romInfo + (m.found ? ' · Touch-Brücke aktiv' : ' · ohne Touch-Brücke (unveränderte ROM)');
      if (!m.found) toast('Diese ROM hat keine Touch-Brücke: Tippen oben = A, Menüs per Wischen.', 4500);
      else if (m.version < 4 && settings.menus) toast('Ältere ROM: Auswahlmenüs bleiben oben. Für die Auswahl unten die neue ROM wählen (Mehr → Andere ROM wählen).', 6000);
      break;
    case 'sav':
      if (DEBUG) console.log('[sav]', m.data.byteLength, nonFF(m.data));
      store.put('sav', m.data).then(() => store.put('savTime', Date.now())).catch(() => toast('Spielstand konnte nicht gesichert werden!', 4000));
      break;
    case 'state':
      store.put('state-' + m.slot, m.data).then(() => {
        store.put('stateTime-' + m.slot, Date.now());
        store.put('stateRom-' + m.slot, currentRomId);
        if (m.slot !== 'auto') toast('Schnellstand gespeichert');
      });
      break;
    case 'stateLoaded': if (m.slot !== 'auto') toast('Schnellstand geladen'); break;
    case 'saveFile': download(new Uint8Array(m.data), 'pokeplatinum.sav'); break;
    case 'imported': toast('Spielstand übernommen – das Spiel startet neu'); break;
    case 'perf': showPerf(m); break;
    case 'error': toast('Fehler: ' + m.text, 4500); console.error(m); break;
    case 'log': console.log('[emu]', m.text); break;
  }
}

function showPerf(p) {
  if (DEBUG) console.log('[perf]', JSON.stringify(p));
  const el = $('#perf');
  if (!settings.perf) return;
  el.textContent = `${p.fps.toFixed(0)} fps · Emu ${p.emuMs.toFixed(1)} ms (max ${p.maxMs.toFixed(0)})\nausgelassen ${p.skipped} · zu langsam ${p.behind}`;
}

async function startGame(romBuf) {
  setBoot('Starte Spiel …', { progress: 0.8 });
  const [sav, savTime, auto, autoTime, name, autoRom] = await Promise.all([
    store.get('sav').catch(() => null),
    store.get('savTime').catch(() => 0),
    store.get('state-auto').catch(() => null),
    store.get('stateTime-auto').catch(() => 0),
    store.get('romName').catch(() => ''),
    store.get('stateRom-auto').catch(() => ''),
  ]);
  const h = readHeader(new Uint8Array(romBuf));
  currentRomId = romId(romBuf);
  romInfo = `${h.title} (${h.code})${name ? ' · ' + name : ''} · ${(romBuf.byteLength / 1048576).toFixed(0)} MB`;
  $('#romInfo').textContent = romInfo;
  if (h.code !== 'CPUE') toast('Hinweis: Das ist nicht Pokémon Platin (US). Die Touch-Hilfen sind für Platin gebaut.', 5000);

  // Die ROM an den Emulator abgeben (ohne Kopie: spart auf dem Handy ~100 MB; sie liegt ja in IndexedDB)
  emu.post({ type: 'load', rom: romBuf, sav: sav || null }, [romBuf]);
  await waitFor('loaded');
  if (settings.resume && auto && autoRom === currentRomId && (autoTime || 0) >= (savTime || 0)) {
    emu.post({ type: 'stateLoad', slot: 'auto', data: auto });
  }
  applySettings();
  hideBoot();
  run(true);
}

function run(on) {
  running = on;
  emu.post({ type: on ? 'start' : 'pause' });
  keepAwake(on);
}

// Bildschirm beim Spielen nicht abdunkeln (wo der Browser das kann)
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock && !document.hidden) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (e) {
    wakeLock = null;
  }
}

// ---------- Einstellungen ----------
function applySettings() {
  $('#app').classList.toggle('smooth', !!settings.smooth);
  $('#perf').classList.toggle('hidden', !settings.perf);
  audio.setVolume(settings.volume / 100);
  emu.post({ type: 'fps', mode: settings.fps });
  emu.post({ type: 'mute', on: settings.volume === 0 });
  emu.post({ type: 'menusBottom', on: !!settings.menus });
}

function openSheet() {
  $('#sheet').classList.remove('hidden');
  $('#sheetBack').classList.remove('hidden');
  $('#optRun').value = settings.run;
  $('#optPad').value = String(settings.pad);
  $('#optFF').value = String(settings.ff);
  $('#optFps').value = settings.fps;
  $('#optSmooth').checked = !!settings.smooth;
  $('#optVol').value = settings.volume;
  $('#optPerf').checked = !!settings.perf;
  $('#optResume').checked = !!settings.resume;
  $('#optMenus').checked = !!settings.menus;
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#sheetBack').classList.add('hidden');
}

function wireUi() {
  // Leiste: Knöpfe halten die Taste, solange der Finger darauf liegt (mind. ~4 Bilder)
  for (const b of $$('#bar .tb[data-key]')) {
    const mask = K[b.dataset.key];
    let t0 = 0, rel = 0;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio.unlock();
      clearTimeout(rel);
      t0 = performance.now();
      b.classList.add('down');
      gestures.holdButton(mask, true);
    });
    const up = () => {
      b.classList.remove('down');
      const left = Math.max(0, 80 - (performance.now() - t0));
      rel = setTimeout(() => gestures.holdButton(mask, false), left);
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }
  $('#bFF').addEventListener('click', () => {
    ffOn = !ffOn;
    $('#bFF').classList.toggle('on', ffOn);
    emu.post({ type: 'speed', speed: ffOn ? settings.ff : 1 });
    if (!ffOn) audio.clear();
  });
  $('#bGear').addEventListener('click', openSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#sheetBack').addEventListener('click', closeSheet);

  $('#optRun').addEventListener('change', (e) => { settings.run = e.target.value; save(); });
  $('#optPad').addEventListener('change', (e) => { settings.pad = +e.target.value; save(); screens.setPadSize(settings.pad); });
  $('#optFF').addEventListener('change', (e) => {
    settings.ff = +e.target.value; save();
    if (ffOn) emu.post({ type: 'speed', speed: settings.ff });
  });
  $('#optFps').addEventListener('change', (e) => { settings.fps = e.target.value; save(); applySettings(); });
  $('#optSmooth').addEventListener('change', (e) => { settings.smooth = e.target.checked; save(); applySettings(); });
  $('#optVol').addEventListener('input', (e) => { settings.volume = +e.target.value; save(); applySettings(); });
  $('#optPerf').addEventListener('change', (e) => { settings.perf = e.target.checked; save(); applySettings(); });
  $('#optResume').addEventListener('change', (e) => { settings.resume = e.target.checked; save(); });
  $('#optMenus').addEventListener('change', (e) => { settings.menus = e.target.checked; save(); applySettings(); });

  for (const b of $$('[data-press]')) {
    b.addEventListener('click', () => gestures.press(K[b.dataset.press], 6));
  }

  $('#stSave').addEventListener('click', () => { emu.post({ type: 'stateSave', slot: '1' }); closeSheet(); });
  $('#stLoad').addEventListener('click', async () => {
    const d = await store.get('state-1').catch(() => null);
    if (!d) return toast('Noch kein Schnellstand gespeichert');
    const rid = await store.get('stateRom-1').catch(() => '');
    if (rid && rid !== currentRomId) return toast('Dieser Schnellstand gehört zu einer anderen ROM-Version', 3500);
    emu.post({ type: 'stateLoad', slot: '1', data: d });
    closeSheet();
  });
  $('#savExport').addEventListener('click', () => emu.post({ type: 'exportSave' }));
  $('#savImport').addEventListener('click', async () => {
    const f = await pickFile($('#fileSav'));
    if (!f) return;
    if (!confirm('Den aktuellen Spielstand durch „' + f.name + '“ ersetzen? Das Spiel startet danach neu.')) return;
    const data = await f.arrayBuffer();
    await store.del('state-auto').catch(() => {});
    emu.post({ type: 'importSave', name: f.name, data }, [data]);
    closeSheet();
  });
  $('#romChange').addEventListener('click', async () => {
    if (!confirm('Andere ROM wählen? Der Spielstand bleibt erhalten.')) return;
    run(false);
    closeSheet();
    await store.del('state-auto').catch(() => {});
    chooseRom();
  });
  $('#emuReset').addEventListener('click', async () => {
    if (!confirm('Spiel neu starten? Nicht gespeicherter Fortschritt geht verloren.')) return;
    await store.del('state-auto').catch(() => {});
    emu.post({ type: 'reset' });
    closeSheet();
  });

  // App im Hintergrund: anhalten und Stand sichern (iOS beendet Seiten im Hintergrund gern)
  document.addEventListener('visibilitychange', () => {
    if (!worker || !running) return;
    if (document.hidden) {
      emu.post({ type: 'pause' });
      if (settings.resume) emu.post({ type: 'stateSave', slot: 'auto' });
    } else {
      audio.clear();
      emu.post({ type: 'start' });
      keepAwake(true);
    }
  });
  addEventListener('pagehide', () => {
    if (worker && running) emu.post({ type: 'flush' });
  });
}

// ---------- Start ----------
async function main() {
  screens = new Screens({ app: $('#app'), top: $('#top'), bot: $('#bot'), topWrap: $('#topWrap'), botWrap: $('#botWrap'), hinge: $('#hinge'), pad: $('#pad') });
  screens.setPadSize(+settings.pad);
  overlay = new MenuOverlay($('#menuOv'));
  audio = new Audio();
  await audio.init().catch(() => {});

  gestures = new Gestures({
    layer: $('#touch'),
    stick: $('#stick'),
    knob: $('#knob'),
    screens,
    emu,
    settings,
    status: () => status,
    overlay,
    fx,
    unlock: () => audio.unlock(),
    onFirstDrag: () => $('#app').classList.add('hint-done'),
  });
  autopilot = new Autopilot({ emu, gestures, toast });
  gestures.autopilot = autopilot;
  setInterval(() => { if (autopilot.active) autopilot.update(status); }, 100);
  wireUi();
  window.__pt = { emu, screens, gestures, audio, settings, autopilot, overlay, get status() { return status; } };

  setBoot('Lade Emulator …', { progress: 0.05 });
  try {
    worker = new Worker('js/emu-worker.js');
    worker.addEventListener('message', onWorker);
    worker.addEventListener('error', (e) => setBoot('Der Emulator konnte nicht starten: ' + (e.message || e), { err: true }));
    emu.post({ type: 'init', sampleRate: audio.sampleRate || 48000, debug: /debug/.test(location.search) });
    await waitFor('ready');
  } catch (e) {
    return setBoot('Der Emulator konnte nicht starten: ' + (e && e.message ? e.message : e), { err: true });
  }

  let rom = await loadRomFromPc();
  if (!rom) rom = await store.get('rom').catch(() => null);
  if (!rom) {
    setBoot('Wähle die ROM-Datei, die du aus dem Quellcode gebaut hast (pokeplatinum.us.nds). Sie bleibt nur auf diesem Gerät.', {
      buttons: [{ label: 'ROM auswählen', primary: true, onClick: chooseRom }],
    });
    return;
  }
  // Auf dem Handy braucht der Ton eine Berührung: ein Tipp startet das Spiel
  setBoot('Bereit.', {
    buttons: [{ label: 'Spielen', primary: true, onClick: () => { audio.unlock(); const r = rom; rom = null; if (r) startGame(r); } }],
  });
}

main();
