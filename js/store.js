// Platin Touch – Ablage im Browser (IndexedDB für große Dateien, localStorage für Einstellungen).
// Alles bleibt auf dem Gerät; nichts wird hochgeladen.

const DB_NAME = 'platin-touch';
const STORE = 'kv';
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function get(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function put(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function del(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Bittet den Browser, die Daten nicht bei Platzmangel zu löschen
export async function persist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) {}
  return false;
}

const DEFAULTS = { pad: 1, menus: true, run: 'drag', ff: 3, fps: 'auto', smooth: false, volume: 80, perf: false, resume: true };

export function loadSettings() {
  try {
    return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem('pt.settings') || '{}'));
  } catch (e) {
    return Object.assign({}, DEFAULTS);
  }
}

export function saveSettings(s) {
  try {
    localStorage.setItem('pt.settings', JSON.stringify(s));
  } catch (e) {}
}
