// Kalinga data layer — one central Supabase (PostgreSQL) database shared by
// every computer. Each document table is mirrored in memory and kept fresh with
// incremental syncs (only rows changed since the last sync are downloaded).
import { createClient } from '../vendor/supabase.mjs';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const SCHEMA_VERSION = 1;
export const configured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const sb = configured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

const DOC_STORES = ['people', 'records', 'schools'];
const PAGE = 1000; // Supabase returns at most 1000 rows per request
const FRESH_MS = 10000;

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export class ConflictError extends Error {}

function fail(error, what) {
  if (!error) return;
  if (/Failed to fetch|NetworkError|network/i.test(error.message || '')) throw new Error('Cannot reach the Kalinga database. Check your internet connection.');
  throw new Error(error.message || `Database error while ${what}.`);
}

// ---------- mirrored document stores ----------
const cache = Object.fromEntries(DOC_STORES.map((s) => [s, { rows: new Map(), cursor: '', syncedAt: 0, pending: null }]));
const toDoc = (row) => ({ ...row.doc, id: row.id, _v: row.updated_at });

async function sync(store, force = false) {
  const c = cache[store];
  if (!force && Date.now() - c.syncedAt < FRESH_MS) return c;
  if (c.pending) return c.pending;
  const cols = 'id, doc, deleted, updated_at';
  const apply = (rows) => {
    let advanced = false;
    for (const row of rows) {
      if (row.deleted) c.rows.delete(row.id); else c.rows.set(row.id, toDoc(row));
      if (row.updated_at > c.cursor) { c.cursor = row.updated_at; advanced = true; }
    }
    return advanced;
  };
  c.pending = (async () => {
    // Re-read the few seconds before the cursor: a save that committed slightly
    // late can carry a timestamp just before it. Repeat on each sync until that
    // window has been re-checked at least 30 s after we first reached it.
    if (c.cursor && !(c.lbCursor === c.cursor && c.lbDone)) {
      if (c.lbCursor !== c.cursor) { c.lbCursor = c.cursor; c.lbSince = Date.now(); }
      const since = new Date(Date.parse(c.cursor) - 5000).toISOString();
      for (let off = 0; ; off += PAGE) {
        const { data, error } = await sb.from(store).select(cols).gte('updated_at', since).lt('updated_at', c.cursor).order('updated_at').order('id').range(off, off + PAGE - 1);
        fail(error, `loading ${store}`);
        for (const row of data) { if (row.deleted) c.rows.delete(row.id); else c.rows.set(row.id, toDoc(row)); }
        if (data.length < PAGE) break;
      }
      c.lbDone = Date.now() - c.lbSince > 30000;
    }
    let after = false; // true once we must skip rows equal to the cursor
    for (;;) {
      let q = sb.from(store).select(cols).order('updated_at').order('id').limit(PAGE);
      if (c.cursor) q = after ? q.gt('updated_at', c.cursor) : q.gte('updated_at', c.cursor);
      const { data, error } = await q;
      fail(error, `loading ${store}`);
      const advanced = apply(data);
      if (data.length < PAGE) break;
      if (advanced) { after = false; continue; }
      // A full page sharing one timestamp: read the rest of that group, then move past it.
      for (let off = PAGE; ; off += PAGE) {
        const g = await sb.from(store).select(cols).eq('updated_at', c.cursor).order('id').range(off, off + PAGE - 1);
        fail(g.error, `loading ${store}`);
        apply(g.data);
        if (g.data.length < PAGE) break;
      }
      after = true;
    }
    c.syncedAt = Date.now();
    return c;
  })().finally(() => { c.pending = null; });
  return c.pending;
}

const strip = (obj) => { const { _v, ...doc } = obj; return doc; };

export const db = {
  async all(store) { return [...(await sync(store)).rows.values()]; },
  async get(store, id) { return (await sync(store)).rows.get(id) || null; },
  async byIndex(store, key, value) { return (await db.all(store)).filter((r) => r[key] === value); },
  async count(store) { return (await sync(store)).rows.size; },
  async refresh() { await Promise.all(DOC_STORES.map((s) => sync(s, true))); },

  // Saves one document. Existing documents are only overwritten if nobody else
  // changed them since they were loaded; otherwise a ConflictError is thrown.
  async put(store, obj) {
    const doc = strip(obj);
    let res;
    if (obj._v) {
      res = await sb.from(store).update({ doc }).eq('id', obj.id).eq('updated_at', obj._v).select('id, doc, updated_at');
      fail(res.error, `saving ${store}`);
      if (!res.data.length) {
        await sync(store, true);
        throw new ConflictError('Someone else changed this item while you were editing. Your copy was not saved — reopen it to see the latest version.');
      }
    } else {
      res = await sb.from(store).upsert({ id: obj.id, doc, deleted: false }).select('id, doc, updated_at');
      fail(res.error, `saving ${store}`);
    }
    const saved = toDoc(res.data[0]);
    cache[store].rows.set(saved.id, saved);
    return saved;
  },
  async bulkPut(store, rows, onProgress) {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ id: r.id, doc: strip(r), deleted: false }));
      const { error } = await sb.from(store).upsert(chunk);
      fail(error, `saving ${store}`);
      onProgress?.(Math.min(rows.length, i + 500), rows.length);
    }
    await sync(store, true);
    return rows.length;
  },
  async del(store, id) {
    const { error } = await sb.from(store).update({ deleted: true }).eq('id', id);
    fail(error, `deleting from ${store}`);
    cache[store].rows.delete(id);
  },
};

// ---------- settings (key/value) ----------
let settingsCache = null;
export async function loadSettings(force = false) {
  if (settingsCache && !force) return settingsCache;
  const { data, error } = await sb.from('settings').select('key, value');
  fail(error, 'loading settings');
  settingsCache = Object.fromEntries(data.map((r) => [r.key, r.value]));
  return settingsCache;
}
export async function getSetting(key, fallback = null) {
  const s = await loadSettings();
  return s[key] ?? fallback;
}
export async function setSetting(key, value) {
  const { error } = await sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() });
  fail(error, 'saving settings');
  if (settingsCache) settingsCache[key] = value;
}

// ---------- audit trail ----------
export async function audit(user, action, detail = '') {
  const { error } = await sb.from('audit').insert({ user_name: user?.fullName || '', action, detail: String(detail).slice(0, 2000) });
  if (error) console.warn('audit', error.message);
}
export async function readAudit(limit = 2000) {
  const { data, error } = await sb.from('audit').select('*').order('at', { ascending: false }).limit(limit);
  fail(error, 'loading the audit log');
  return data.map((r) => ({ id: r.id, at: r.at, user: r.user_name, action: r.action, detail: r.detail }));
}

// ---------- backup / transfer ----------
export async function exportAll({ includeSecrets = false } = {}) {
  await db.refresh();
  const settings = Object.entries(await loadSettings(true)).filter(([k]) => includeSecrets || k !== 'apiKey').map(([key, value]) => ({ key, value }));
  const out = { app: 'kalinga', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), stores: { settings } };
  for (const s of DOC_STORES) out.stores[s] = (await db.all(s)).map(strip);
  return out;
}

// Adds people, records, schools and settings from a backup into the central
// database. For records, the newer copy (by updatedAt) wins. User accounts are
// not imported — staff join with invite links instead.
export async function importAll(data, onProgress) {
  if (!data || data.app !== 'kalinga' || !data.stores) throw new Error('This file is not a Kalinga backup.');
  if (data.schema > SCHEMA_VERSION) throw new Error('This backup was made by a newer version of Kalinga.');
  const summary = {};
  for (const s of DOC_STORES) {
    let rows = Array.isArray(data.stores[s]) ? data.stores[s] : [];
    const local = new Map((await db.all(s)).map((r) => [r.id, r]));
    rows = rows.filter((r) => r && r.id && (!local.has(r.id) || (r.updatedAt || '') > (local.get(r.id).updatedAt || '')));
    summary[s] = rows.length ? await db.bulkPut(s, rows, (n, t) => onProgress?.(s, n, t)) : 0;
  }
  const current = await loadSettings(true);
  for (const { key, value } of data.stores.settings || []) {
    if (['lastBackupAt'].includes(key) || (current[key] != null && current[key] !== '')) continue;
    await setSetting(key, value);
  }
  return summary;
}

// Reads the database left in this browser by the earlier, device-only version of Kalinga.
export function readLegacyLocal() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const req = indexedDB.open('kalinga');
    req.onupgradeneeded = () => { req.transaction.abort(); };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const idb = req.result;
      const names = ['people', 'records', 'schools', 'settings'].filter((n) => idb.objectStoreNames.contains(n));
      if (!names.length) { idb.close(); return resolve(null); }
      const t = idb.transaction(names);
      const stores = {};
      for (const n of names) t.objectStore(n).getAll().onsuccess = (e) => { stores[n] = e.target.result; };
      t.oncomplete = () => { idb.close(); resolve((stores.people || []).length || (stores.records || []).length ? { app: 'kalinga', schema: 1, exportedAt: new Date().toISOString(), stores } : null); };
      t.onerror = () => { idb.close(); resolve(null); };
    };
  });
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
