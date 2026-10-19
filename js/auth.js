// Accounts, roles, invites and sessions — backed by Supabase Auth. Roles are
// stored in the profiles table and enforced by the database (row-level
// security + triggers in supabase/schema.sql); checks here only shape the UI.
import { sb, audit } from './db.js';

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

export function passwordProblem(pw) {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Password must contain letters and numbers.';
  return '';
}

const check = (error) => {
  if (!error) return;
  const m = error.message || String(error);
  if (/Invalid login credentials/i.test(m)) throw new Error('Incorrect email or password.');
  if (/Email not confirmed/i.test(m)) throw new Error('This email is not confirmed yet. Ask the administrator to turn off "Confirm email" in Supabase, or confirm it from your inbox.');
  if (/Failed to fetch|NetworkError/i.test(m)) throw new Error('Cannot reach the Kalinga database. Check your internet connection.');
  throw new Error(m);
};

const fromRow = (r) => r && ({
  id: r.id, email: r.email, fullName: r.full_name, role: r.role, license: r.license || '', position: r.position || '',
  active: r.active, mustChange: r.must_change, lastLogin: r.last_login, createdAt: r.created_at,
});

export async function systemStatus() {
  const { data, error } = await sb.rpc('kalinga_status');
  check(error);
  return data;
}

// Returns { user } for active staff, { pending: email } for a signed-in account
// with no Kalinga profile, { inactive } for disabled accounts, or null.
export async function currentSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  check(error);
  if (!data) return { pending: session.user.email };
  if (!data.active) return { inactive: true };
  return { user: fromRow(data) };
}

export async function currentUser() {
  return (await currentSession())?.user || null;
}

export async function login(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  check(error);
  const s = await currentSession();
  if (s?.user) {
    await sb.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', s.user.id);
    await audit(s.user, 'auth.login');
  }
  return s;
}

export async function logout(user) {
  if (user) await audit(user, 'auth.logout');
  await sb.auth.signOut();
}

// Creates the sign-in for a new person, or signs in if the email already has one.
async function signUpOrIn(email, password) {
  email = email.trim().toLowerCase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error && /already registered|already exists/i.test(error.message)) {
    const r = await sb.auth.signInWithPassword({ email, password });
    check(r.error);
    return;
  }
  check(error);
  if (!data.session) throw new Error('Supabase is asking for email confirmation. In Supabase → Authentication → Sign In / Providers → Email, turn off "Confirm email", then try again.');
}

export async function setupFirstAdmin({ email, password, fullName }) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  await signUpOrIn(email, password);
  const { error } = await sb.rpc('claim_first_admin', { full_name: fullName.trim() });
  check(error);
  return currentUser();
}

export async function joinWithInvite(token, { email, password, fullName, license, position }) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  await signUpOrIn(email, password);
  const { error } = await sb.rpc('redeem_invite', { invite: token, full_name: fullName.trim(), license: (license || '').trim(), job: (position || '').trim() });
  check(error);
  return currentUser();
}

export async function inviteInfo(token) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data, error } = await sb.rpc('invite_info', { invite: token });
  check(error);
  return data;
}

// ---------- administration ----------
export async function listUsers() {
  const { data, error } = await sb.from('profiles').select('*').order('full_name');
  check(error);
  return data.map(fromRow);
}

export async function listStaffNames() {
  const { data, error } = await sb.from('profiles').select('id, full_name');
  check(error);
  return new Map(data.map((r) => [r.id, { fullName: r.full_name }]));
}

export async function updateUser(id, { fullName, role, license, position, active }, actor) {
  const patch = { full_name: fullName.trim(), license: (license || '').trim(), position: (position || '').trim() };
  if (role !== undefined) patch.role = role;
  if (active !== undefined) patch.active = active;
  const { error } = await sb.from('profiles').update(patch).eq('id', id);
  check(error);
  await audit(actor, 'user.update', `${fullName}${role ? ` → ${ROLES[role].label}` : ''}${active === false ? ' (disabled)' : ''}`);
}

export async function adminSetPassword(user, password, actor) {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const { error } = await sb.rpc('admin_set_password', { target: user.id, new_password: password });
  check(error);
  await audit(actor, 'user.password', user.email);
}

export async function changeOwnPassword(user, current, next) {
  const problem = passwordProblem(next);
  if (problem) throw new Error(problem);
  const r = await sb.auth.signInWithPassword({ email: user.email, password: current });
  if (r.error) throw new Error('Current password is incorrect.');
  const { error } = await sb.auth.updateUser({ password: next });
  check(error);
  await sb.from('profiles').update({ must_change: false }).eq('id', user.id);
  await audit(user, 'user.password', 'changed own password');
}

export async function createInvite({ role, email, days, note }, actor) {
  const { data, error } = await sb.from('invites').insert({
    role, email: (email || '').trim().toLowerCase() || null, note: (note || '').trim(),
    expires_at: new Date(Date.now() + (days || 7) * 864e5).toISOString(),
  }).select().single();
  check(error);
  await audit(actor, 'invite.create', `${ROLES[role].label}${email ? ` for ${email}` : ''}`);
  return data;
}

export async function listInvites() {
  const { data, error } = await sb.from('invites').select('*').order('created_at', { ascending: false }).limit(100);
  check(error);
  return data;
}

export async function revokeInvite(token, actor) {
  const { error } = await sb.from('invites').update({ revoked: true }).eq('token', token);
  check(error);
  await audit(actor, 'invite.revoke', token.slice(0, 8));
}

export const inviteLink = (token) => `${location.origin}${location.pathname}#/join/${token}`;
