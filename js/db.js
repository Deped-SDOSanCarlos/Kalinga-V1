// Kalinga data layer — IndexedDB in the browser, with portable JSON backups.
// Every store is plain JSON so a backup file can be moved to another device,
// another browser, or loaded into a server database later without conversion.

const DB_NAME = 'kalinga';
const DB_VERSION = 1;
export const SCHEMA_VERSION = 1;

export const STORES = {
  users:    { keyPath: 'id', indexes: [['username', 'username', { unique: true }]] },
  people:   { keyPath: 'id', indexes: [['type', 'type'], ['schoolId', 'schoolId']] },
  records:  { keyPath: 'id', indexes: [['personId', 'personId'], ['formId', 'formId']] },
  schools:  { keyPath: 'id', indexes: [] },
  settings: { keyPath: 'key', indexes: [] },
  audit:    { keyPath: 'id', indexes: [['at', 'at']] },
};

let dbPromise;
const cache = new Map(); // store name -> array (read cache, cleared on write)

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: cfg.keyPath });
        for (const [idx, key, opts] of cfg.indexes) store.createIndex(idx, key, opts || {});
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is open in another tab with an older version. Close other Kalinga tabs and reload.'));
  });
  return dbPromise;
}

const asPromise = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export const db = {
  async get(store, id) {
    const d = await open();
    return asPromise(d.transaction(store).objectStore(store).get(id));
  },
  async all(store) {
    if (cache.has(store)) return cache.get(store);
    const d = await open();
    const rows = await asPromise(d.transaction(store).objectStore(store).getAll());
    cache.set(store, rows);
    return rows;
  },
  async byIndex(store, index, value) {
    const d = await open();
    return asPromise(d.transaction(store).objectStore(store).index(index).getAll(value));
  },
  async put(store, obj) {
    const d = await open();
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).put(obj);
    await done(t);
    cache.delete(store);
    return obj;
  },
  async bulkPut(store, rows) {
    const d = await open();
    const t = d.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const r of rows) s.put(r);
    await done(t);
    cache.delete(store);
    return rows.length;
  },
  async del(store, id) {
    const d = await open();
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).delete(id);
    await done(t);
    cache.delete(store);
  },
  async clear(store) {
    const d = await open();
    const t = d.transaction(store, 'readwrite');
    t.objectStore(store).clear();
    await done(t);
    cache.delete(store);
  },
  async count(store) {
    const d = await open();
    return asPromise(d.transaction(store).objectStore(store).count());
  },
};

// ---------- settings (key/value) ----------
export async function getSetting(key, fallback = null) {
  const row = await db.get('settings', key);
  return row ? row.value : fallback;
}
export async function setSetting(key, value) {
  return db.put('settings', { key, value });
}

// ---------- backup / transfer ----------
export async function exportAll({ includeSecrets = false } = {}) {
  const out = { app: 'kalinga', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), stores: {} };
  for (const name of Object.keys(STORES)) {
    let rows = await db.all(name);
    if (name === 'settings' && !includeSecrets) rows = rows.filter((r) => r.key !== 'apiKey');
    out.stores[name] = rows;
  }
  return out;
}

export async function importAll(data, mode = 'merge') {
  if (!data || data.app !== 'kalinga' || !data.stores) throw new Error('This file is not a Kalinga backup.');
  if (data.schema > SCHEMA_VERSION) throw new Error('This backup was made by a newer version of Kalinga. Update the app first.');
  if (mode === 'replace' && !(data.stores.users || []).some((u) => u.role === 'admin' && u.active !== false)) {
    throw new Error('Replace was cancelled: the backup has no active administrator account, so you would be locked out.');
  }
  const summary = {};
  for (const name of Object.keys(STORES)) {
    let rows = Array.isArray(data.stores[name]) ? data.stores[name] : [];
    if (mode === 'replace') await db.clear(name);
    if (mode === 'merge' && name === 'users') {
      // usernames are unique: skip incoming users whose username belongs to a different local account
      const local = await db.all('users');
      rows = rows.filter((u) => !local.some((l) => l.username === u.username && l.id !== u.id));
    }
    if (mode === 'merge' && name === 'records') {
      // keep whichever copy of a record was edited most recently
      const local = new Map((await db.all('records')).map((r) => [r.id, r]));
      rows = rows.filter((r) => !local.has(r.id) || (r.updatedAt || '') >= (local.get(r.id).updatedAt || ''));
    }
    summary[name] = rows.length ? await db.bulkPut(name, rows) : 0;
  }
  return summary;
}

export async function wipeAll() {
  for (const name of Object.keys(STORES)) await db.clear(name);
}

// ---------- optional encryption for backups (AES-GCM, key from passphrase) ----------
const enc = new TextEncoder();
function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptJSON(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { app: 'kalinga', encrypted: true, schema: SCHEMA_VERSION, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}
export async function decryptJSON(wrapper, pass) {
  const key = await deriveKey(pass, fromB64(wrapper.salt));
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(wrapper.iv) }, key, fromB64(wrapper.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Wrong passphrase, or the backup file is damaged.');
  }
}

// ---------- audit trail ----------
export async function audit(user, action, detail = '') {
  return db.put('audit', { id: uid(), at: new Date().toISOString(), userId: user?.id || null, user: user?.fullName || 'system', action, detail });
}

// Ask the browser not to evict our data under storage pressure.
export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
