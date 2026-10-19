// Accounts, roles and sessions. Passwords are never stored — only a salted
// PBKDF2-SHA256 hash.
import { db, uid, audit } from './db.js';

export const ROLES = {
  admin:   { label: 'Administrator / Developer', short: 'Admin' },
  doctor:  { label: 'Physician', short: 'Doctor' },
  dentist: { label: 'Dentist', short: 'Dentist' },
  nurse:   { label: 'Nurse', short: 'Nurse' },
};

const PERMS = {
  admin:   ['records.write', 'records.sign.medical', 'records.sign.dental', 'records.delete', 'records.unlock', 'people.write', 'people.delete', 'users.manage', 'settings.manage', 'data.export', 'data.import', 'audit.view', 'ai.use'],
  doctor:  ['records.write', 'records.sign.medical', 'people.write', 'data.export', 'ai.use'],
  dentist: ['records.write', 'records.sign.dental', 'people.write', 'data.export', 'ai.use'],
  nurse:   ['records.write', 'people.write', 'data.export', 'ai.use'],
};

export const can = (user, perm) => !!user && (PERMS[user.role] || []).includes(perm);

const ITER = 210000;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));

async function pbkdf2(password, saltHex, iterations = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(saltHex), iterations, hash: 'SHA-256' }, key, 256);
  return hex(bits);
}

export async function hashPassword(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, iter: ITER, hash: await pbkdf2(password, salt) };
}

function sameHash(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passwordProblem(pw) {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  return '';
}

export async function createUser({ username, fullName, role, password, license = '', position = '' }, actor) {
  username = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new Error('Username: 3–32 letters, numbers, dot, dash or underscore.');
  if (!ROLES[role]) throw new Error('Unknown role.');
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const existing = await db.byIndex('users', 'username', username);
  if (existing.length) throw new Error('That username is already taken.');
  const user = { id: uid(), username, fullName: fullName.trim(), role, license: license.trim(), position: position.trim(), active: true, createdAt: new Date().toISOString(), ...(await hashPassword(password)) };
  await db.put('users', user);
  await audit(actor || user, 'user.create', `${user.username} (${ROLES[role].label})`);
  return user;
}

export async function setPassword(user, password, actor) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  Object.assign(user, await hashPassword(password), { mustChange: actor && actor.id !== user.id });
  await db.put('users', user);
  await audit(actor || user, 'user.password', user.username);
}

// ---------- session ----------
const SESSION_KEY = 'kalinga.session';
const SESSION_HOURS = 10;
let failures = 0;
let lockedUntil = 0;

export async function login(username, password) {
  if (Date.now() < lockedUntil) throw new Error(`Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`);
  const [user] = await db.byIndex('users', 'username', username.trim().toLowerCase());
  const ok = user && user.active !== false && sameHash(await pbkdf2(password, user.salt, user.iter || ITER), user.hash);
  if (!ok) {
    failures++;
    if (failures >= 5) { lockedUntil = Date.now() + 30000; failures = 0; }
    throw new Error('Incorrect username or password.');
  }
  failures = 0;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ uid: user.id, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  user.lastLogin = new Date().toISOString();
  await db.put('users', user);
  await audit(user, 'auth.login');
  return user;
}

export async function currentUser() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (!s || s.exp < Date.now()) return null;
    const user = await db.get('users', s.uid);
    return user && user.active !== false ? user : null;
  } catch {
    return null;
  }
}

export async function logout(user) {
  if (user) await audit(user, 'auth.logout');
  sessionStorage.removeItem(SESSION_KEY);
}
