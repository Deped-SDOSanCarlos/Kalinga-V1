// Kalinga — DepEd Division Medical-Dental & Nutrition Information System
// App shell, router and screens.
import { db, sb, configured, uid, getSetting, setSetting, loadSettings as fetchSettings, exportAll, importAll, readLegacyLocal, encryptJSON, decryptJSON, audit, readAudit, ConflictError } from './db.js';
import { ROLES, can, login, logout, currentUser, currentSession, systemStatus, setupFirstAdmin, joinWithInvite, inviteInfo, listUsers, listStaffNames, updateUser, adminSetPassword, changeOwnPassword, createInvite, listInvites, revokeInvite, inviteLink } from './auth.js';
import { SUPABASE_URL } from './config.js';
import { FORMS, formById, formsFor, allFields, PERSON_FIELDS, fullName, ageAt, ageText, currentSchoolYear, withComputed, missingRequired, bmi, adultBmiClass, NUTRITION_STATUS, toothIndex } from './forms.js';
import { renderEditor, bindEditor, collect, applyValues, renderPrint } from './render.js';
import { loadAll, computeStats, perSchool, monthlyCounts, barList, columns } from './stats.js';
import { $, $$, esc, icon, toast, modal, confirmBox, download, pickFile, toCSV, parseCSV, fmtDate, fmtDateTime, today, initTooltips, debounce } from './ui.js';

const app = $('#app');
const state = { user: null, settings: {}, hasKey: false, schools: [], dirty: false, chat: [] };
const REGIONS = ['Region I – Ilocos Region', 'Region II – Cagayan Valley', 'Region III – Central Luzon', 'Region IV-A – CALABARZON', 'MIMAROPA Region', 'Region V – Bicol Region', 'Region VI – Western Visayas', 'Region VII – Central Visayas', 'Region VIII – Eastern Visayas', 'Region IX – Zamboanga Peninsula', 'Region X – Northern Mindanao', 'Region XI – Davao Region', 'Region XII – SOCCSKSARGEN', 'Caraga Region', 'Cordillera Administrative Region', 'National Capital Region', 'Negros Island Region', 'BARMM'];
const PULSE = '<svg class="pulse" viewBox="0 0 200 40" aria-hidden="true"><path d="M0 20 H70 L80 6 L92 34 L104 12 L112 20 H200" /></svg>';

// ======================================================= boot
async function boot() {
  initTooltips();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.user) { e.preventDefault(); commandPalette(); }
  });
  window.addEventListener('unhandledrejection', (e) => toast(e.reason?.message || String(e.reason), 'err', 6000));
  if (!configured) return notConfiguredScreen();
  try {
    const join = location.hash.match(/^#\/join\/([0-9a-f-]{36})$/i);
    if (join) return joinScreen(join[1]);
    const status = await systemStatus();
    state.division = status.division || '';
    if (!status.has_admin) return setupScreen();
    const s = await currentSession();
    if (s?.pending) return pendingScreen(s.pending);
    if (s?.inactive) { await sb.auth.signOut(); toast('Your account has been disabled. Contact the division administrator.', 'err', 8000); return loginScreen(); }
    if (!s?.user) return loginScreen();
    state.user = s.user;
    await startApp();
  } catch (err) {
    app.innerHTML = `<div class="boot"><p class="err">Kalinga could not reach its database.<br><small>${esc(err.message)}</small></p><p class="muted">Check the internet connection, then <a href="">reload</a>. If this keeps happening, the administrator should check that the Supabase project is running.</p></div>`;
  }
}

async function loadSettings(force = false) {
  const all = await fetchSettings(force);
  const { apiKey, ...rest } = all;
  state.settings = rest;
  state.hasKey = !!apiKey;
  state.schools = [...(await db.all('schools'))].sort((a, b) => a.name.localeCompare(b.name));
}

async function startApp() {
  await loadSettings();
  state.checkedAt = Date.now();
  renderShell();
  let lastHash = location.hash;
  window.onhashchange = () => {
    if (state.dirty && !confirm('You have unsaved changes. Leave this page?')) { history.replaceState(null, '', lastHash); return; }
    state.dirty = false;
    lastHash = location.hash;
    route();
  };
  window.onbeforeunload = (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } };
  route();
  if (state.user.mustChange) toast('Your password was reset by an administrator. Please set a new one in My account.', 'warn', 7000);
}

const schoolName = (id) => state.schools.find((s) => s.id === id)?.name || '';
const go = (hash) => { location.hash = hash; };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Magandang umaga' : h < 18 ? 'Magandang hapon' : 'Magandang gabi'; };
const displayName = (u) => (['doctor', 'dentist'].includes(u.role) && !/^dr\.?\s/i.test(u.fullName) ? `Dr. ${u.fullName.split(' ').slice(-1)[0]}` : u.fullName.split(' ')[0]);
const statusBadge = (r) => (r.status === 'final' ? `<span class="badge ok">${icon('check')}Final</span>` : `<span class="badge warn">Draft</span>`);
const optionList = (opts, sel) => opts.map((o) => (typeof o === 'string' ? [o, o] : o)).map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
const queryParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

function pageHead(eyebrow, title, actions = '') {
  return `<div class="page-head"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1></div><div class="actions">${actions}</div></div>`;
}

// ======================================================= setup & login
function authLayout(inner) {
  app.innerHTML = `
  <div class="auth">
    <section class="auth-brand">
      <div class="brand-mark">${logoMark()}<span>Kalinga</span></div>
      <div>
        <h1>Care for every <em>learner</em> and <em>teacher</em>, on record.</h1>
        <p>Division Medical-Dental &amp; Nutrition Information System — health examinations, certificates, dental and nutrition records in one place.</p>
      </div>
      ${PULSE}
      <p class="auth-foot">Department of Education · Schools Division Health Unit</p>
    </section>
    <section class="auth-panel">${inner}</section>
  </div>`;
}
const logoMark = () => `<img src="assets/icon.svg" alt="" width="36" height="36">`;

function notConfiguredScreen() {
  authLayout(`
    <div class="auth-card">
      <p class="eyebrow">Almost there</p>
      <h2>Connect the central database</h2>
      <p class="muted">This copy of Kalinga is not yet connected to the division's Supabase database. The administrator needs to:</p>
      <ol class="steps">
        <li>Create a free project at <b>supabase.com</b>.</li>
        <li>Run <code>supabase/schema.sql</code> in the project's SQL Editor.</li>
        <li>Put the project URL and anon key in <code>js/config.js</code> and upload it to GitHub.</li>
      </ol>
      <p class="muted small">Step-by-step instructions are in the README.</p>
    </div>`);
}

// Runs a form submit handler with the button disabled and errors shown as toasts.
function busySubmit(form, fn) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button[type=submit]');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Please wait…';
    try { await fn(Object.fromEntries(new FormData(form))); } catch (err) { toast(err.message, 'err', 7000); } finally { btn.disabled = false; btn.innerHTML = label; }
  };
}

async function enterApp(user) {
  state.user = user;
  history.replaceState(null, '', location.pathname + '#/dashboard');
  await startApp();
}

function setupScreen() {
  authLayout(`
    <form class="auth-card" id="setup">
      <p class="eyebrow">First-time setup</p>
      <h2>Set up your division</h2>
      <p class="muted">Create the administrator / developer account. Doctors, dentists and nurses join later through invite links.</p>
      <div class="grid2">
        <label>Region<input name="region" list="regions" required placeholder="e.g. Region III – Central Luzon"></label>
        <label>Schools Division of<input name="division" required placeholder="e.g. Tarlac Province"></label>
      </div>
      <datalist id="regions">${REGIONS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
      <label>Full name<input name="fullName" required autocomplete="name"></label>
      <label>Email<input name="email" type="email" required autocomplete="email" placeholder="you@deped.gov.ph"></label>
      <label>Password<input name="password" type="password" required autocomplete="new-password" minlength="8"></label>
      <button class="btn primary block" type="submit">Create administrator ${icon('arrowRight')}</button>
    </form>`);
  busySubmit($('#setup'), async (v) => {
    const user = await setupFirstAdmin(v);
    state.user = user;
    await setSetting('region', v.region.trim());
    await setSetting('division', v.division.trim());
    await setSetting('unit', 'School Health and Nutrition Unit');
    await audit(user, 'setup', 'first administrator');
    toast('Division set up. Welcome to Kalinga!');
    history.replaceState(null, '', location.pathname + '#/settings');
    await startApp();
  });
}

function loginScreen() {
  authLayout(`
    <form class="auth-card" id="login">
      <p class="eyebrow">Sign in${state.division ? ` · SDO ${esc(state.division)}` : ''}</p>
      <h2>${greeting()}!</h2>
      <p class="muted">Sign in with your Kalinga account. New staff: open the invite link your administrator sent you.</p>
      <label>Email<input name="email" type="email" required autocomplete="email" autofocus></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="btn primary block" type="submit">Sign in ${icon('arrowRight')}</button>
      <p class="muted small">${icon('lock')} Records are kept in the division's central database. Forgot your password? Ask the administrator to set a temporary one.</p>
    </form>`);
  busySubmit($('#login'), async (v) => {
    const s = await login(v.email, v.password);
    if (s?.pending) return pendingScreen(s.pending);
    if (s?.inactive) { await sb.auth.signOut(); throw new Error('Your account has been disabled. Contact the division administrator.'); }
    await enterApp(s.user);
  });
}

async function joinScreen(token) {
  authLayout('<div class="auth-card"><div class="loading"><span></span><span></span><span></span></div></div>');
  const info = await inviteInfo(token);
  if (!info || !info.valid) {
    authLayout(`<div class="auth-card"><p class="eyebrow">Invite link</p><h2>This link can’t be used</h2>
      <p class="muted">${info ? 'It has already been used, was revoked, or has expired.' : 'The link is incomplete or invalid.'} Ask the division administrator for a new invite link.</p>
      <a class="btn block" href="${location.pathname}">Go to sign in</a></div>`);
    return;
  }
  const clinician = ['doctor', 'dentist'].includes(info.role);
  authLayout(`
    <form class="auth-card" id="join">
      <p class="eyebrow">You’re invited${info.division ? ` · SDO ${esc(info.division)}` : ''}</p>
      <h2>Join Kalinga as <em>${esc(ROLES[info.role].label)}</em></h2>
      <p class="muted">Create your account. You will use this email and password to sign in from any computer or phone.</p>
      <label>Full name (as printed on forms)<input name="fullName" required autocomplete="name"></label>
      <label>Email<input name="email" type="email" required autocomplete="email" value="${esc(info.email || '')}" ${info.email ? 'readonly' : ''}></label>
      <label>Password<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <div class="grid2">
        <label>PRC license no.${clinician ? ' <b class="req">*</b>' : ''}<input name="license" ${clinician ? 'required' : ''}></label>
        <label>Position<input name="position" placeholder="e.g. Nurse II"></label>
      </div>
      <button class="btn primary block" type="submit">Create my account ${icon('arrowRight')}</button>
      <p class="muted small">Already have a Kalinga account? Enter its email and password above to use this invite with it.</p>
    </form>`);
  busySubmit($('#join'), async (v) => {
    const user = await joinWithInvite(token, v);
    toast(`Welcome, ${user.fullName}!`);
    await enterApp(user);
  });
}

function pendingScreen(email) {
  authLayout(`<div class="auth-card"><p class="eyebrow">Signed in as ${esc(email)}</p><h2>No access yet</h2>
    <p class="muted">This account isn’t linked to Kalinga. Open the invite link from your administrator, or ask for a new one.</p>
    <button class="btn block" id="out">Sign out</button></div>`);
  $('#out').onclick = async () => { await sb.auth.signOut(); location.reload(); };
}

// ======================================================= shell
const NAV = [
  { group: 'Overview', items: [['#/dashboard', 'home', 'Dashboard'], ['#/reports', 'chart', 'Reports']] },
  { group: 'Records', items: [['#/people/learner', 'learner', 'Learners'], ['#/people/personnel', 'personnel', 'Personnel'], ['#/records', 'file', 'All records'], ['#/forms', 'forms', 'Forms & templates']] },
  { group: 'Intelligence', items: [['#/assistant', 'spark', 'AI Assistant', 'ai.use']] },
  { group: 'Administration', items: [['#/data', 'database', 'Data & backup', 'data.export'], ['#/users', 'users', 'Users', 'users.manage'], ['#/settings', 'settings', 'Settings', 'settings.manage'], ['#/audit', 'log', 'Audit log', 'audit.view']] },
];

function renderShell() {
  const u = state.user;
  const nav = NAV.map((g) => {
    const items = g.items.filter((i) => !i[3] || can(u, i[3]));
    return items.length ? `<div class="nav-group"><span>${g.group}</span>${items.map(([href, ic, label]) => `<a href="${href}" data-nav>${icon(ic)}<span>${label}</span></a>`).join('')}</div>` : '';
  }).join('');
  app.innerHTML = `
  <div class="shell">
    <aside class="side" id="side">
      <a class="brand-mark" href="#/dashboard">${logoMark()}<span>Kalinga<small>${esc(state.settings.division ? `SDO ${state.settings.division}` : 'MDN Information System')}</small></span></a>
      <nav>${nav}</nav>
      <a class="me" href="#/account">
        <span class="avatar">${esc(initials(u.fullName))}</span>
        <span><b>${esc(u.fullName)}</b><small>${esc(ROLES[u.role].label)}</small></span>
      </a>
    </aside>
    <div class="scrim" id="scrim"></div>
    <div class="main">
      <header class="top">
        <button class="icon-btn only-mobile" id="menu" aria-label="Menu">${icon('menu')}</button>
        <button class="search-btn" id="search">${icon('search')}<span>Search learners, personnel, pages…</span><kbd>Ctrl K</kbd></button>
        <div class="top-right">
          <span class="net" id="net" data-tip="Connection status"></span>
          <button class="icon-btn" id="theme" aria-label="Toggle dark mode">${icon('moon')}</button>
          <button class="icon-btn" id="logout" aria-label="Sign out" data-tip="Sign out">${icon('logout')}</button>
        </div>
      </header>
      <main id="view" class="view" tabindex="-1"></main>
    </div>
  </div>`;
  $('#menu').onclick = () => document.body.classList.toggle('nav-open');
  $('#scrim').onclick = () => document.body.classList.remove('nav-open');
  $('#search').onclick = commandPalette;
  $('#theme').onclick = toggleTheme;
  $('#logout').onclick = async () => { if (state.dirty && !confirm('Discard unsaved changes and sign out?')) return; state.dirty = false; await logout(state.user); history.replaceState(null, '', location.pathname); location.reload(); };
  const net = () => { const el = $('#net'); if (!el) return; el.className = `net ${navigator.onLine ? 'on' : 'off'}`; el.textContent = navigator.onLine ? 'Online' : 'Offline'; };
  window.addEventListener('online', net); window.addEventListener('offline', net); net();
}

const initials = (n) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function toggleTheme() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('kalinga.theme', root.dataset.theme); } catch {}
}

// ======================================================= router
const ROUTES = [
  [/^\/?(dashboard)?$/, dashboardView],
  [/^\/people\/(learner|personnel)$/, (v, m) => peopleView(v, m[1])],
  [/^\/person\/([\w-]+)$/, (v, m) => personView(v, m[1])],
  [/^\/record\/new\/(\w+)\/([\w-]+)$/, (v, m) => recordView(v, { formId: m[1], personId: m[2] })],
  [/^\/record\/([\w-]+)$/, (v, m) => recordView(v, { id: m[1] })],
  [/^\/print\/blank\/(\w+)$/, (v, m) => printView(v, { formId: m[1] })],
  [/^\/print\/([\w-]+)$/, (v, m) => printView(v, { id: m[1] })],
  [/^\/records$/, recordsView],
  [/^\/forms$/, formsView],
  [/^\/reports$/, reportsView],
  [/^\/assistant$/, assistantView, 'ai.use'],
  [/^\/data$/, dataView, 'data.export'],
  [/^\/users$/, usersView, 'users.manage'],
  [/^\/settings$/, settingsView, 'settings.manage'],
  [/^\/audit$/, auditView, 'audit.view'],
  [/^\/account$/, accountView],
];

async function route() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('Your session has ended. Please sign in again.', 'warn'); return loginScreen(); }
  if (Date.now() - state.checkedAt > 60000) {
    const fresh = await currentUser().catch(() => state.user);
    if (!fresh) { await sb.auth.signOut(); toast('Your account is no longer active.', 'err'); return loginScreen(); }
    state.user = fresh;
    state.checkedAt = Date.now();
  }
  const path = location.hash.replace(/^#/, '').split('?')[0];
  const view = $('#view');
  document.body.classList.remove('nav-open');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', path.startsWith(a.getAttribute('href').slice(1)) || (path.startsWith('/person') && a.getAttribute('href') === '#/people/' + (view.dataset.ptype || ''))));
  for (const [re, fn, perm] of ROUTES) {
    const m = path.match(re);
    if (!m) continue;
    if (perm && !can(state.user, perm)) { view.innerHTML = emptyState('lock', 'Not available for your role', 'Ask the division administrator if you need access.'); return; }
    view.innerHTML = '<div class="loading"><span></span><span></span><span></span></div>';
    try { await fn(view, m); } catch (err) { console.error(err); view.innerHTML = emptyState('alert', 'Something went wrong', esc(err.message)); }
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    return;
  }
  view.innerHTML = emptyState('search', 'Page not found', '<a href="#/dashboard">Back to the dashboard</a>');
}

const emptyState = (ic, title, text = '') => `<div class="empty">${icon(ic)}<h3>${title}</h3><p>${text}</p></div>`;

// ======================================================= dashboard
async function dashboardView(view) {
  const data = await loadAll();
  const sy = currentSchoolYear();
  const st = computeStats(data, { sy });
  const months = monthlyCounts(data.records);
  const people = new Map(data.people.map((p) => [p.id, p]));
  const recent = [...data.records].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 7);
  const lastBackup = await getSetting('lastBackupAt');
  const backupOld = can(state.user, 'data.import') && data.records.length && (!lastBackup || Date.now() - new Date(lastBackup) > 30 * 864e5);
  const nut = st.learnerNutrition;
  const kpi = (href, label, val, sub, accent = '') => `<a class="kpi ${accent}" href="${href}"><span class="kpi-label">${label}</span><span class="kpi-val">${val}</span><span class="kpi-sub">${sub}</span></a>`;

  view.innerHTML = `
    <section class="hero">
      <div>
        <p class="eyebrow">${new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' })} · SY ${sy}</p>
        <h1>${greeting()}, <em>${esc(displayName(state.user))}</em>.</h1>
        <p class="muted">${esc(state.settings.unit || 'School Health and Nutrition Unit')} · Schools Division of ${esc(state.settings.division || '—')}</p>
      </div>
      <div class="hero-actions">
        <a class="btn primary" href="#/people/learner">${icon('learner')} Learners</a>
        <a class="btn" href="#/people/personnel">${icon('personnel')} Personnel</a>
        <a class="btn" href="#/forms">${icon('forms')} New form</a>
      </div>
      ${PULSE}
    </section>
    ${backupOld ? `<div class="banner warn">${icon('alert')}<span>${lastBackup ? `Last off-line backup was ${fmtDate(lastBackup)}.` : 'No off-line backup has been made yet.'} Download one monthly and keep it on a division drive, in case the online database is ever lost.</span><a class="btn sm" href="#/data">Back up now</a></div>` : ''}
    ${!data.people.length ? `<div class="banner">${icon('spark')}<span>Start by adding schools in <a href="#/settings">Settings</a>, then add or import learners and personnel.</span></div>` : ''}
    <section class="kpis">
      ${kpi('#/people/learner', 'Learners', st.learners.toLocaleString(), `${nut.coveragePct}% assessed this SY`)}
      ${kpi('#/people/personnel', 'Personnel', st.personnel.toLocaleString(), `${st.personnelHealth.apeCompliancePct}% with Annual PE`)}
      ${kpi('#/records', 'Records this SY', st.records.toLocaleString(), `${data.records.length.toLocaleString()} all-time`)}
      ${kpi('#/records?status=draft', 'Awaiting signature', st.pendingSignature.toLocaleString(), 'certificates & exams in draft', st.pendingSignature ? 'attn' : '')}
      ${kpi('#/reports', 'Wasted / severely wasted', `${nut.wastedOrSeverelyWastedPct}%`, `${nut.sbfpBeneficiaries} SBFP beneficiaries`)}
      ${kpi('#/reports', 'Overweight / obese', `${nut.overweightOrObesePct}%`, 'of assessed learners')}
    </section>
    <section class="cards">
      <article class="card">
        <header><h3>Learner nutritional status</h3><span class="muted">BMI-for-age · SY ${sy} · ${nut.assessed} assessed</span></header>
        ${nut.assessed ? barList(NUTRITION_STATUS.map((s) => ({ label: s, value: nut.bmiForAge[s] })), { unit: 'learners' }) : emptyState('apple', 'No assessments yet', 'Nutritional status comes from SHD Form 1 records.')}
      </article>
      <article class="card">
        <header><h3>Records encoded</h3><span class="muted">Last 12 months, by exam date</span></header>
        ${columns(months)}
      </article>
      <article class="card">
        <header><h3>Personnel BMI</h3><span class="muted">From Annual PE (CS Form 86) · ${st.personnelHealth.annualPEDone} examined</span></header>
        ${st.personnelHealth.annualPEDone ? barList(Object.entries(st.personnelHealth.bmiCategories).map(([label, value]) => ({ label, value })), { unit: 'personnel' }) + `<p class="muted small">${st.personnelHealth.bpAtOrAbove140over90} with BP ≥ 140/90 at exam.</p>` : emptyState('stethoscope', 'No Annual PE records yet')}
      </article>
      <article class="card">
        <header><h3>Recent activity</h3><a href="#/records" class="link">All records ${icon('arrowRight')}</a></header>
        ${recent.length ? `<ul class="list">${recent.map((r) => { const f = formById(r.formId); const p = people.get(r.personId); return `<li><a href="#/record/${r.id}"><span class="form-pill">${esc(f.code)}</span><span class="grow"><b>${esc(fullName(p))}</b><small>${esc(f.title)} · ${fmtDate(r.updatedAt)}</small></span>${statusBadge(r)}</a></li>`; }).join('')}</ul>` : emptyState('file', 'No records yet')}
      </article>
      ${can(state.user, 'ai.use') ? `<article class="card span-2 ai-card">
        <header><h3>${icon('spark')} Division health situationer</h3><button class="btn sm" id="sit">${state.hasKey ? 'Generate with AI' : 'Set up AI'}</button></header>
        <div id="sitOut" class="prose muted">Let Claude turn this school year's de-identified statistics into a short situationer with priorities for the health unit.</div>
      </article>` : ''}
    </section>`;
  $('#sit')?.addEventListener('click', () => {
    if (!state.hasKey) return go('#/settings');
    streamInto($('#sitOut'), (on) => import('./ai.js').then((ai) => ai.writeReport(st, 'Write a one-page division health situationer for the Schools Division Superintendent: key figures, what is concerning, and 3–5 prioritized actions for the health and nutrition unit.', on)), $('#sit'));
  });
}

// Stream AI text into an element, rendering light markdown.
async function streamInto(el, run, btn) {
  let text = '';
  let raf = 0;
  el.classList.remove('muted');
  el.innerHTML = '<div class="loading"><span></span><span></span><span></span></div>';
  if (btn) btn.disabled = true;
  try {
    await run((t) => {
      text += t;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; el.innerHTML = md(text); });
    });
    cancelAnimationFrame(raf);
    el.innerHTML = md(text) + `<div class="ai-foot"><button class="btn sm ghost" data-copy>${icon('clipboard')} Copy</button><span class="muted small">AI-generated — review before use.</span></div>`;
    el.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
    return text;
  } catch (err) {
    const { friendlyError } = await import('./ai.js');
    el.innerHTML = `<p class="err">${icon('alert')} ${esc(friendlyError(err))}</p>`;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function md(src) {
  let h = esc(src);
  h = h.replace(/^#{1,2} (.*)$/gm, '<h3>$1</h3>').replace(/^#{3,6} (.*)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/^\s*(?:[-*•]|\d+\.) (.*)$/gm, '<li>$1</li>');
  h = h.replace(/(?:<li>.*<\/li>\n?)+/g, (m) => `<ul>${m.replace(/\n/g, '')}</ul>`);
  return h.replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>').replace(/<br>(<\/?(?:h3|h4|ul))/g, '$1').replace(/(<\/(?:h3|h4|ul)>)<br>/g, '$1');
}

// ======================================================= people
async function peopleView(view, type) {
  view.dataset.ptype = type;
  const label = type === 'learner' ? 'Learners' : 'Personnel';
  const all = (await db.byIndex('people', 'type', type)).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const q = queryParams();
  let filter = { text: q.get('q') || '', school: q.get('school') || '', grade: '' };
  let page = 0;
  const PAGE = 50;
  const canWrite = can(state.user, 'people.write');

  view.innerHTML = `
    ${pageHead(type === 'learner' ? 'Learner &amp; student wellness' : 'Teaching &amp; non-teaching staff', `${label} <em>registry</em>`, `
      ${canWrite ? `<button class="btn" id="imp">${icon('upload')} Import CSV</button>` : ''}
      <button class="btn" id="exp">${icon('download')} Export CSV</button>
      ${canWrite ? `<button class="btn primary" id="add">${icon('plus')} Add ${type === 'learner' ? 'learner' : 'personnel'}</button>` : ''}`)}
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="q" placeholder="Search name, ${type === 'learner' ? 'LRN' : 'employee no.'}…" value="${esc(filter.text)}"></label>
      <select id="school"><option value="">All schools</option>${optionList(state.schools.map((s) => [s.id, s.name]), filter.school)}</select>
      ${type === 'learner' ? `<select id="grade"><option value="">All grades</option>${optionList(PERSON_FIELDS.learner.find((f) => f.k === 'gradeLevel').opts)}</select>` : ''}
      <span class="muted" id="count"></span>
    </div>
    <div class="table-wrap"><table class="table"><thead><tr>
      <th>Name</th><th>${type === 'learner' ? 'LRN' : 'Employee no.'}</th><th>Sex</th><th>Age</th><th>${type === 'learner' ? 'Grade & section' : 'Position'}</th><th>School</th>
    </tr></thead><tbody id="rows"></tbody></table></div>
    <div class="pager" id="pager"></div>`;

  const norm = (s) => String(s || '').toLowerCase();
  const filtered = () => all.filter((p) =>
    (!filter.school || p.schoolId === filter.school) &&
    (!filter.grade || p.gradeLevel === filter.grade) &&
    (!filter.text || norm(`${p.lastName} ${p.firstName} ${p.middleName} ${p.lrn || ''} ${p.employeeNo || ''} ${p.firstName} ${p.lastName}`).includes(norm(filter.text))));
  const draw = () => {
    const rows = filtered();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    page = Math.min(page, pages - 1);
    $('#count').textContent = `${rows.length.toLocaleString()} of ${all.length.toLocaleString()}`;
    $('#rows').innerHTML = rows.slice(page * PAGE, page * PAGE + PAGE).map((p) => {
      const a = ageAt(p.birthdate);
      return `<tr data-href="#/person/${p.id}" tabindex="0"><td><span class="person-cell"><span class="avatar sm ${p.sex === 'Female' ? 'f' : ''}">${esc(initials(`${p.firstName} ${p.lastName}`))}</span><b>${esc(fullName(p))}</b></span></td>
        <td class="mono">${esc(type === 'learner' ? p.lrn : p.employeeNo)}</td><td>${esc(p.sex)}</td><td>${a ? a.years : ''}</td>
        <td>${esc(type === 'learner' ? [p.gradeLevel, p.section].filter(Boolean).join(' – ') : p.position)}</td><td>${esc(schoolName(p.schoolId))}</td></tr>`;
    }).join('') || `<tr><td colspan="6">${emptyState(type === 'learner' ? 'learner' : 'personnel', all.length ? 'No matches' : `No ${label.toLowerCase()} yet`, all.length ? 'Try another search or filter.' : canWrite ? 'Add one, or import a class list from CSV.' : '')}</td></tr>`;
    $('#pager').innerHTML = pages > 1 ? `<button class="btn sm" data-p="-1" ${page === 0 ? 'disabled' : ''}>Previous</button><span>Page ${page + 1} of ${pages}</span><button class="btn sm" data-p="1" ${page >= pages - 1 ? 'disabled' : ''}>Next</button>` : '';
  };
  draw();
  $('#q').oninput = debounce((e) => { filter.text = e.target.value; page = 0; draw(); }, 120);
  $('#school').onchange = (e) => { filter.school = e.target.value; page = 0; draw(); };
  $('#grade')?.addEventListener('change', (e) => { filter.grade = e.target.value; page = 0; draw(); });
  $('#pager').onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) { page += +b.dataset.p; draw(); } };
  $('#rows').onclick = (e) => { const tr = e.target.closest('[data-href]'); if (tr) go(tr.dataset.href); };
  $('#rows').onkeydown = (e) => { if (e.key === 'Enter') { const tr = e.target.closest('[data-href]'); if (tr) go(tr.dataset.href); } };
  $('#add')?.addEventListener('click', async () => { const p = await personDialog(type); if (p) go(`#/person/${p.id}`); });
  $('#imp')?.addEventListener('click', () => importPeopleCSV(type));
  $('#exp').onclick = () => {
    const cols = [...PERSON_FIELDS[type].map((f) => ({ k: f.k, label: f.label })), { label: 'School', get: (p) => schoolName(p.schoolId) }];
    download(`kalinga-${type}-${today()}.csv`, toCSV(filtered(), cols), 'text/csv');
  };
}

function simpleField(f, v) {
  const name = `name="${f.k}" ${f.req ? 'required' : ''}`;
  let control;
  if (f.type === 'select') control = `<select ${name}><option value="">—</option>${optionList(f.opts, v)}</select>`;
  else if (f.type === 'date') control = `<input type="date" ${name} value="${esc(v)}">`;
  else control = `<input ${name} value="${esc(v)}" autocomplete="off">`;
  return `<label class="${f.span === 2 ? 'span-2' : ''}">${esc(f.label)}${f.req ? ' <b class="req">*</b>' : ''}${control}</label>`;
}

async function personDialog(type, person = null) {
  const fields = PERSON_FIELDS[type];
  return modal({
    title: person ? 'Edit details' : type === 'learner' ? 'Add learner' : 'Add personnel',
    wide: true,
    body: `<div class="grid3">${fields.map((f) => simpleField(f, person?.[f.k])).join('')}
      <label class="span-2">School / station<select name="schoolId"><option value="">— Division office / none —</option>${optionList(state.schools.map((s) => [s.id, s.name]), person?.schoolId)}</select></label></div>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', submit: true }],
    onSubmit: async (form) => {
      const v = Object.fromEntries([...fields.map((f) => [f.k, form.elements[f.k].value.trim()]), ['schoolId', form.elements.schoolId.value]]);
      const dupKey = type === 'learner' ? 'lrn' : 'employeeNo';
      if (v[dupKey]) {
        const dup = (await db.byIndex('people', 'type', type)).find((p) => p[dupKey] === v[dupKey] && p.id !== person?.id);
        if (dup) throw new Error(`${dupKey === 'lrn' ? 'LRN' : 'Employee no.'} ${v[dupKey]} already belongs to ${fullName(dup)}.`);
      }
      const now = new Date().toISOString();
      const rec = { ...(person || { id: uid(), type, createdAt: now, createdBy: state.user.id }), ...v, updatedAt: now };
      await db.put('people', rec);
      await audit(state.user, person ? 'person.update' : 'person.create', fullName(rec));
      toast('Saved');
      return rec;
    },
  });
}

async function importPeopleCSV(type) {
  const file = await pickFile('.csv,text/csv');
  if (!file) return;
  const rows = parseCSV(await file.text());
  if (rows.length < 2) return toast('The CSV has no data rows.', 'err');
  const fields = PERSON_FIELDS[type];
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const head = rows[0].map(norm);
  const colOf = (f) => head.findIndex((h) => h === norm(f.k) || h === norm(f.label));
  const map = fields.map((f) => [f, colOf(f)]).filter(([, i]) => i >= 0);
  const schoolCol = head.findIndex((h) => ['school', 'schoolname', 'schoolid', 'station'].includes(h));
  if (!map.some(([f]) => f.k === 'lastName') || !map.some(([f]) => f.k === 'firstName')) return toast('CSV needs at least "Last name" and "First name" columns. Download the template from Data & backup.', 'err', 6000);
  const defaultSchool = await modal({
    title: `Import ${rows.length - 1} ${type === 'learner' ? 'learners' : 'personnel'}`,
    body: `<p>Matched columns: <b>${map.map(([f]) => esc(f.label)).join(', ')}</b>${schoolCol >= 0 ? ', <b>School</b>' : ''}.</p>
      <label>School for rows without a school<select name="s"><option value="">— none —</option>${optionList(state.schools.map((s) => [s.id, s.name]))}</select></label>
      <p class="muted small">Rows whose ${type === 'learner' ? 'LRN' : 'employee no.'} already exists will update that person.</p>`,
    actions: [{ label: 'Cancel', value: null }, { label: 'Import', kind: 'primary', submit: true }],
    onSubmit: (form) => form.elements.s.value || '',
  });
  if (defaultSchool === null) return;
  const existing = await db.byIndex('people', 'type', type);
  const key = type === 'learner' ? 'lrn' : 'employeeNo';
  const byKey = new Map(existing.filter((p) => p[key]).map((p) => [p[key], p]));
  const now = new Date().toISOString();
  const out = [];
  for (const r of rows.slice(1)) {
    const v = Object.fromEntries(map.map(([f, i]) => [f.k, (r[i] || '').trim()]));
    if (!v.lastName || !v.firstName) continue;
    if (v.sex) v.sex = /^f/i.test(v.sex) ? 'Female' : /^m/i.test(v.sex) ? 'Male' : v.sex;
    if (v.birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(v.birthdate)) { const d = new Date(v.birthdate); v.birthdate = isNaN(d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); }
    let schoolId = defaultSchool;
    if (schoolCol >= 0 && r[schoolCol]) {
      const s = r[schoolCol].trim().toLowerCase();
      schoolId = state.schools.find((x) => x.name.toLowerCase() === s || String(x.code || '').toLowerCase() === s)?.id || defaultSchool;
    }
    const prev = v[key] && byKey.get(v[key]);
    out.push({ ...(prev || { id: uid(), type, createdAt: now, createdBy: state.user.id }), ...v, schoolId, updatedAt: now });
  }
  await db.bulkPut('people', out);
  await audit(state.user, 'person.import', `${out.length} ${type}`);
  toast(`Imported ${out.length} ${type === 'learner' ? 'learners' : 'personnel'}`);
  route();
}

// ======================================================= person profile
async function personView(view, id) {
  const p = await db.get('people', id);
  if (!p) { view.innerHTML = emptyState('search', 'Person not found'); return; }
  view.dataset.ptype = p.type;
  const records = (await db.byIndex('records', 'personId', id)).sort((a, b) => (b.examDate || '').localeCompare(a.examDate || ''));
  const a = ageAt(p.birthdate);
  const latestVitals = records.find((r) => r.data.weightKg && r.data.heightCm);
  const latestShd1 = records.find((r) => r.formId === 'shd1' && r.data.nutritionalStatus);
  const latestBP = records.find((r) => r.data.bpSys);
  const latestDental = records.find((r) => r.formId === 'shd2b');
  const users = await listStaffNames();
  const B = latestVitals ? bmi(latestVitals.data.weightKg, latestVitals.data.heightCm) : null;
  const snap = [
    ['Height / weight', latestVitals ? `${latestVitals.data.heightCm} cm · ${latestVitals.data.weightKg} kg` : '—', latestVitals && fmtDate(latestVitals.data.examDate)],
    ['BMI', B ?? '—', p.type === 'learner' ? latestShd1?.data.nutritionalStatus || 'BMI-for-age not assessed' : adultBmiClass(B)],
    ...(p.type === 'personnel' || latestBP ? [['Blood pressure', latestBP ? `${latestBP.data.bpSys}/${latestBP.data.bpDia}` : '—', latestBP && fmtDate(latestBP.data.examDate)]] : []),
    ...(p.type === 'learner' ? [['Dental (DMFT)', latestDental ? toothIndex(latestDental.data.teeth, 'perm') : '—', latestDental && fmtDate(latestDental.data.examDate)]] : []),
  ];
  view.innerHTML = `
    <section class="profile">
      <span class="avatar xl ${p.sex === 'Female' ? 'f' : ''}">${esc(initials(`${p.firstName} ${p.lastName}`))}</span>
      <div class="grow">
        <p class="eyebrow"><a href="#/people/${p.type}">${p.type === 'learner' ? 'Learners' : 'Personnel'}</a> / profile</p>
        <h1>${esc([p.firstName, p.middleName, p.lastName, p.suffix].filter(Boolean).join(' '))}</h1>
        <div class="tags">
          ${p.type === 'learner' ? `<span>LRN ${esc(p.lrn || '—')}</span><span>${esc([p.gradeLevel, p.section].filter(Boolean).join(' – ') || 'No grade')}</span>` : `<span>Emp. ${esc(p.employeeNo || '—')}</span><span>${esc(p.position || 'No position')}</span>`}
          <span>${esc(p.sex || '—')}</span><span>${a ? `${a.years} y ${a.months} m` : 'No birthdate'}</span>
          ${p.schoolId ? `<span>${icon('school')}${esc(schoolName(p.schoolId))}</span>` : ''}
          ${p.bloodType ? `<span>Blood ${esc(p.bloodType)}</span>` : ''}
        </div>
      </div>
      <div class="actions">
        ${can(state.user, 'people.write') ? `<button class="btn" id="edit">${icon('edit')} Edit</button>` : ''}
        ${can(state.user, 'people.delete') ? `<button class="btn danger ghost" id="del">${icon('trash')}</button>` : ''}
      </div>
    </section>
    <section class="snap">${snap.map(([l, v, s]) => `<div><span>${l}</span><b>${esc(v)}</b><small>${esc(s || '')}</small></div>`).join('')}</section>
    <div class="split">
      <section>
        <div class="section-head"><h2>Health records</h2><span class="muted">${records.length} on file</span></div>
        ${records.length ? `<ol class="timeline">${records.map((r) => { const f = formById(r.formId); return `
          <li><span class="dot ${r.status === 'final' ? 'ok' : ''}"></span>
            <a href="#/record/${r.id}" class="tl-card"><span class="form-pill">${esc(f.code)}</span><span class="grow"><b>${esc(f.title)}</b><small>${fmtDate(r.examDate) || 'No date'} · ${esc(users.get(r.createdBy)?.fullName || '')}${r.schoolYear ? ` · SY ${esc(r.schoolYear)}` : ''}</small></span>${statusBadge(r)}</a>
            <a class="icon-btn" href="#/print/${r.id}" data-tip="Print">${icon('print')}</a></li>`; }).join('')}</ol>` : emptyState('file', 'No records yet', 'Start one of the forms on the right.')}
      </section>
      <aside>
        ${can(state.user, 'records.write') ? `<div class="card"><header><h3>Start a form</h3></header><div class="form-buttons">${formsFor(p.type).map((f) => `<a class="form-btn" href="#/record/new/${f.id}/${p.id}">${icon(f.icon)}<span><b>${esc(f.short)}</b><small>${esc(f.code)}</small></span></a>`).join('')}</div></div>` : ''}
        ${can(state.user, 'ai.use') ? `<div class="card ai-card"><header><h3>${icon('spark')} AI clinical summary</h3><button class="btn sm" id="sum" ${records.length ? '' : 'disabled'}>Summarize</button></header><div id="sumOut" class="prose muted small">${records.length ? 'Summarizes trends, gaps and follow-ups from this person’s records. Names and identifiers are not sent.' : 'Available once there are records.'}</div></div>` : ''}
      </aside>
    </div>`;
  $('#edit')?.addEventListener('click', async () => { if (await personDialog(p.type, p)) route(); });
  $('#del')?.addEventListener('click', async () => {
    if (!(await confirmBox('Delete person?', `This permanently deletes <b>${esc(fullName(p))}</b> and their <b>${records.length}</b> record(s) from this device.`, 'Delete', true))) return;
    for (const r of records) await db.del('records', r.id);
    await db.del('people', p.id);
    await audit(state.user, 'person.delete', `${fullName(p)} (+${records.length} records)`);
    toast('Deleted');
    go(`#/people/${p.type}`);
  });
  $('#sum')?.addEventListener('click', () => {
    if (!state.hasKey) return toast('AI is not set up. An administrator can add the API key in Settings.', 'warn');
    streamInto($('#sumOut'), (on) => import('./ai.js').then((ai) => ai.summarizePerson(p, [...records].reverse(), on)), $('#sum'));
  });
}

// ======================================================= record editor
function canSign(form) {
  if (form.signer === 'medical') return can(state.user, 'records.sign.medical');
  if (form.signer === 'dental') return can(state.user, 'records.sign.dental');
  return can(state.user, 'records.write');
}

async function recordView(view, { id, formId, personId }) {
  let record = id ? await db.get('records', id) : null;
  if (id && !record) { view.innerHTML = emptyState('search', 'Record not found'); return; }
  const form = formById(record ? record.formId : formId);
  if (!form) { view.innerHTML = emptyState('search', 'Unknown form'); return; }
  const person = await db.get('people', record ? record.personId : personId);
  if (!person) { view.innerHTML = emptyState('search', 'Person not found'); return; }
  view.dataset.ptype = person.type;
  if (!record) {
    const data = {};
    for (const f of allFields(form)) if (f.default) data[f.k] = f.default();
    if (allFields(form).some((f) => f.k === 'examDate')) data.examDate = today();
    if (person.type === 'learner' && allFields(form).some((f) => f.k === 'gradeLevel')) data.gradeLevel = person.gradeLevel || '';
    record = { id: uid(), formId: form.id, personId: person.id, status: 'draft', data, isNew: true };
  }
  const locked = record.status === 'final';
  const readonly = locked || !can(state.user, 'records.write');
  const signer = form.signer === 'medical' ? 'physician' : form.signer === 'dental' ? 'dentist' : '';

  view.innerHTML = `
    ${pageHead(`<a href="#/person/${person.id}">${esc(fullName(person))}</a> / ${esc(form.code)}`, `${esc(form.title)}`, `${statusBadge(record)}`)}
    ${locked ? `<div class="banner ok">${icon('signature')}<span>Finalized and signed by <b>${esc(record.signedBy?.name)}</b>${record.signedBy?.license ? ` (Lic. ${esc(record.signedBy.license)})` : ''} on ${fmtDateTime(record.signedBy?.at)}. Finalized records are locked.</span></div>` : ''}
    <div class="editor">
      <form id="rec" class="rec-form" novalidate autocomplete="off">${renderEditor(form, record.data, person, { readonly })}</form>
      <aside class="editor-side">
        <div class="card sticky">
          <div class="meter"><span id="meterBar"></span></div>
          <p class="small muted" id="meterText"></p>
          <div class="stack">
            ${!readonly ? `<button class="btn primary" id="save">${icon('check')} Save ${record.isNew ? '' : 'changes'}</button>` : ''}
            ${!locked && canSign(form) ? `<button class="btn accent" id="sign">${icon('signature')} ${signer ? 'Sign & finalize' : 'Finalize'}</button>` : ''}
            ${!locked && signer && !canSign(form) ? `<p class="small muted">${icon('lock')} Needs a ${signer} to sign and finalize.</p>` : ''}
            ${locked && can(state.user, 'records.unlock') ? `<button class="btn" id="reopen">${icon('edit')} Reopen as draft</button>` : ''}
            ${!record.isNew ? `<a class="btn" href="#/print/${record.id}">${icon('print')} Print / PDF</a>` : ''}
            ${!record.isNew && can(state.user, 'records.delete') ? `<button class="btn danger ghost" id="delete">${icon('trash')} Delete</button>` : ''}
          </div>
          ${record.createdAt ? `<p class="small muted meta">Created ${fmtDateTime(record.createdAt)}<br>Updated ${fmtDateTime(record.updatedAt)}</p>` : ''}
        </div>
        ${!readonly && can(state.user, 'ai.use') ? `
        <div class="card ai-card">
          <header><h3>${icon('spark')} AI Smart-Fill</h3></header>
          <p class="small muted">Type, paste or dictate exam notes. Claude fills the matching fields; you review before saving.</p>
          <textarea id="notes" rows="5" placeholder="e.g. BP 128/84, PR 76, RR 18, T 36.6. Ht 158 cm, wt 63 kg. PE unremarkable. CBC normal, CXR: no active lung lesions. Fit for work."></textarea>
          <div class="row">
            ${'webkitSpeechRecognition' in window || 'SpeechRecognition' in window ? `<button class="btn sm" id="dictate" type="button">🎙 Dictate</button>` : ''}
            <button class="btn sm primary grow" id="fill" type="button">${icon('spark')} Fill form</button>
          </div>
        </div>` : ''}
      </aside>
    </div>`;

  const root = $('#rec');
  const updateMeter = (data) => {
    const missing = missingRequired(form, data, person);
    const fields = allFields(form).filter((f) => f.type !== 'computed' && (!f.show || f.show(data, person)));
    const filled = fields.filter((f) => { const v = data[f.k]; return v !== '' && v != null && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length); }).length;
    $('#meterBar').style.width = `${Math.round((filled / Math.max(1, fields.length)) * 100)}%`;
    $('#meterText').innerHTML = `${filled} of ${fields.length} fields filled${missing.length ? `<br><span class="err">Required: ${esc(missing.join(', '))}</span>` : ''}`;
  };
  bindEditor(root, form, () => person, (data) => { updateMeter(data); });
  updateMeter(withComputed(form, record.data, person));
  if (!readonly) root.addEventListener('input', () => { state.dirty = true; });

  const save = async (finalize = false) => {
    const data = collect(root, form);
    if (finalize) {
      const missing = missingRequired(form, data, person);
      if (missing.length) return toast(`Complete the required fields first: ${missing.join(', ')}`, 'err', 6000);
      if (signer && !state.user.license) return toast(`Add your PRC license number in My account before signing as ${signer}.`, 'err', 6000);
      if (!(await confirmBox('Sign & finalize?', `You are signing this <b>${esc(form.code)}</b> for <b>${esc(fullName(person))}</b> as <b>${esc(state.user.fullName)}</b>${state.user.license ? ` (Lic. ${esc(state.user.license)})` : ''}. Finalized records are locked.`, 'Sign & finalize'))) return;
    }
    const now = new Date().toISOString();
    const exam = data.examDate || data.referralDate || today();
    const rec = {
      id: record.id, _v: record._v, formId: form.id, personId: person.id, data,
      examDate: exam, schoolYear: data.schoolYear || currentSchoolYear(new Date(exam)),
      schoolId: person.schoolId || '',
      status: finalize ? 'final' : 'draft',
      createdAt: record.createdAt || now, createdBy: record.createdBy || state.user.id,
      updatedAt: now, updatedBy: state.user.id,
      ...(finalize ? { signedBy: { userId: state.user.id, name: state.user.fullName, license: state.user.license || '', role: state.user.role, at: now } } : {}),
    };
    try {
      await db.put('records', rec);
    } catch (err) {
      return toast(err.message, 'err', err instanceof ConflictError ? 10000 : 6000);
    }
    await audit(state.user, finalize ? 'record.sign' : record.isNew ? 'record.create' : 'record.update', `${form.code} · ${fullName(person)}`);
    state.dirty = false;
    toast(finalize ? 'Signed and finalized' : 'Saved');
    const target = `#/record/${rec.id}`;
    if (location.hash !== target) go(target); else route();
  };
  $('#save')?.addEventListener('click', () => save(false));
  $('#sign')?.addEventListener('click', () => save(true));
  $('#reopen')?.addEventListener('click', async () => {
    if (!(await confirmBox('Reopen record?', 'The signature will be removed and the record becomes an editable draft. This is recorded in the audit log.', 'Reopen'))) return;
    const { signedBy, ...rest } = record;
    await db.put('records', { ...rest, status: 'draft', updatedAt: new Date().toISOString(), updatedBy: state.user.id });
    await audit(state.user, 'record.reopen', `${form.code} · ${fullName(person)} (signed by ${signedBy?.name})`);
    route();
  });
  $('#delete')?.addEventListener('click', async () => {
    if (!(await confirmBox('Delete record?', `Permanently delete this ${esc(form.code)} record?`, 'Delete', true))) return;
    await db.del('records', record.id);
    await audit(state.user, 'record.delete', `${form.code} · ${fullName(person)}`);
    state.dirty = false;
    go(`#/person/${person.id}`);
  });
  $('#fill')?.addEventListener('click', async () => {
    const notes = $('#notes').value.trim();
    if (!notes) return toast('Enter some notes first.', 'warn');
    if (!state.hasKey) return toast('AI is not set up. An administrator can add the API key in Settings.', 'warn');
    const btn = $('#fill');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Reading notes…';
    const ai = await import('./ai.js');
    try {
      const values = await ai.smartFill(form, notes);
      const n = applyValues(root, form, values);
      state.dirty = true;
      toast(n ? `Filled ${n} field(s). Review the highlighted values, then save.` : 'No matching information found in the notes.', n ? 'ok' : 'warn', 5000);
    } catch (err) {
      toast(ai.friendlyError(err), 'err', 6000);
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('spark')} Fill form`;
    }
  });
  $('#dictate')?.addEventListener('click', (e) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'en-PH';
    rec.interimResults = false;
    rec.continuous = true;
    const btn = e.currentTarget;
    if (btn.dataset.on) { btn._rec?.stop(); return; }
    btn.dataset.on = '1'; btn.textContent = '■ Stop'; btn._rec = rec;
    rec.onresult = (ev) => { for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) $('#notes').value += `${ev.results[i][0].transcript.trim()}. `; };
    rec.onend = () => { delete btn.dataset.on; btn.textContent = '🎙 Dictate'; };
    rec.onerror = (ev) => toast(`Dictation: ${ev.error}`, 'err');
    rec.start();
  });
}

// ======================================================= print
async function printView(view, { id, formId }) {
  let record = null, person = null, form;
  if (id) {
    record = await db.get('records', id);
    if (!record) { view.innerHTML = emptyState('search', 'Record not found'); return; }
    person = await db.get('people', record.personId);
    form = formById(record.formId);
  } else form = formById(formId);
  if (!form) { view.innerHTML = emptyState('search', 'Unknown form'); return; }
  const school = state.schools.find((s) => s.id === person?.schoolId);
  view.innerHTML = `
    <div class="print-bar no-print">
      <a class="btn" href="${record ? `#/record/${record.id}` : '#/forms'}">← Back</a>
      <span class="muted">${record ? (record.status === 'final' ? 'Finalized record' : 'Draft — printed with a DRAFT watermark') : 'Blank template for manual filling'}</span>
      <button class="btn primary" id="print">${icon('print')} Print / Save as PDF</button>
    </div>
    <div class="print-stage">${renderPrint({ form, record, person, school, settings: state.settings, blank: !record })}</div>`;
  $('#print').onclick = () => window.print();
  if (record) audit(state.user, 'record.print', `${form.code} · ${fullName(person)}`);
}

// ======================================================= records list
async function recordsView(view) {
  const q = queryParams();
  const [records, people, U] = await Promise.all([db.all('records'), db.all('people'), listStaffNames()]);
  const P = new Map(people.map((p) => [p.id, p]));
  const years = [...new Set([currentSchoolYear(), ...records.map((r) => r.schoolYear).filter(Boolean)])].sort().reverse();
  const f = { form: q.get('form') || '', status: q.get('status') || '', school: '', sy: '', text: '' };
  view.innerHTML = `
    ${pageHead('Medical, dental &amp; nutrition', 'All <em>records</em>', `<button class="btn" id="exp">${icon('download')} Export CSV</button>`)}
    <div class="toolbar">
      <label class="search">${icon('search')}<input id="q" placeholder="Search name…"></label>
      <select id="form"><option value="">All forms</option>${optionList(FORMS.map((x) => [x.id, `${x.code} – ${x.short}`]), f.form)}</select>
      <select id="status"><option value="">Any status</option>${optionList([['draft', 'Draft'], ['final', 'Final']], f.status)}</select>
      <select id="sy"><option value="">All school years</option>${optionList(years)}</select>
      <select id="school"><option value="">All schools</option>${optionList(state.schools.map((s) => [s.id, s.name]))}</select>
      <span class="muted" id="count"></span>
    </div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Exam date</th><th>Name</th><th>Form</th><th>School</th><th>Encoded by</th><th>Status</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  const filtered = () => records.filter((r) => {
    const p = P.get(r.personId);
    return (!f.form || r.formId === f.form) && (!f.status || r.status === f.status) && (!f.sy || r.schoolYear === f.sy) && (!f.school || p?.schoolId === f.school) && (!f.text || fullName(p).toLowerCase().includes(f.text.toLowerCase()));
  }).sort((a, b) => (b.examDate || '').localeCompare(a.examDate || ''));
  const draw = () => {
    const rows = filtered();
    $('#count').textContent = `${rows.length.toLocaleString()} record(s)${rows.length > 300 ? ' · showing 300' : ''}`;
    $('#rows').innerHTML = rows.slice(0, 300).map((r) => { const p = P.get(r.personId); const fm = formById(r.formId); return `<tr data-href="#/record/${r.id}" tabindex="0"><td>${fmtDate(r.examDate)}</td><td><b>${esc(fullName(p))}</b></td><td><span class="form-pill">${esc(fm.code)}</span> ${esc(fm.short)}</td><td>${esc(schoolName(p?.schoolId))}</td><td>${esc(U.get(r.createdBy)?.fullName || '')}</td><td>${statusBadge(r)}</td></tr>`; }).join('') || `<tr><td colspan="6">${emptyState('file', 'No records match')}</td></tr>`;
  };
  draw();
  $('#q').oninput = debounce((e) => { f.text = e.target.value; draw(); }, 120);
  for (const k of ['form', 'status', 'sy', 'school']) $('#' + k).onchange = (e) => { f[k] = e.target.value; draw(); };
  $('#rows').onclick = (e) => { const tr = e.target.closest('[data-href]'); if (tr) go(tr.dataset.href); };
  $('#exp').onclick = () => {
    const rows = filtered();
    if (!rows.length) return toast('Nothing to export.', 'warn');
    if (!f.form) {
      download(`kalinga-records-${today()}.csv`, toCSV(rows, [
        { label: 'Exam date', k: 'examDate' }, { label: 'School year', k: 'schoolYear' }, { label: 'Name', get: (r) => fullName(P.get(r.personId)) },
        { label: 'LRN / Employee no.', get: (r) => P.get(r.personId)?.lrn || P.get(r.personId)?.employeeNo || '' }, { label: 'Form', get: (r) => formById(r.formId).code },
        { label: 'School', get: (r) => schoolName(P.get(r.personId)?.schoolId) }, { label: 'Status', k: 'status' }, { label: 'Signed by', get: (r) => r.signedBy?.name || '' },
      ]), 'text/csv');
      return toast('Exported. Choose a single form to export all of its fields.');
    }
    const fm = formById(f.form);
    const cols = [
      { label: 'Name', get: (r) => fullName(P.get(r.personId)) }, { label: fm.subject === 'learner' ? 'LRN' : 'Employee no.', get: (r) => P.get(r.personId)?.[fm.subject === 'learner' ? 'lrn' : 'employeeNo'] || '' },
      { label: 'Sex', get: (r) => P.get(r.personId)?.sex || '' }, { label: 'Age', get: (r) => ageText(ageAt(P.get(r.personId)?.birthdate, r.examDate)) },
      { label: 'School', get: (r) => schoolName(P.get(r.personId)?.schoolId) },
      ...allFields(fm).map((fd) => ({ label: fd.label + (fd.unit ? ` (${fd.unit})` : ''), get: (r) => {
        const v = withComputed(fm, r.data, P.get(r.personId))[fd.k];
        if (fd.type === 'pe') return Object.entries(v || {}).filter(([, x]) => x.s === 'Abnormal').map(([k, x]) => `${k}: ${x.f || 'abnormal'}`).join('; ') || (Object.keys(v || {}).length ? 'All examined normal' : '');
        if (fd.type === 'odontogram') return Object.entries(v || {}).map(([t, s]) => `${t}${s}`).join(' ');
        return v;
      } })),
      { label: 'Status', k: 'status' }, { label: 'Signed by', get: (r) => r.signedBy?.name || '' },
    ];
    download(`kalinga-${fm.id}-${today()}.csv`, toCSV(rows, cols), 'text/csv');
  };
}

// ======================================================= forms library
async function formsView(view) {
  const groups = ['Personnel', 'Learner'];
  view.innerHTML = `
    ${pageHead('DepEd &amp; CSC templates', 'Forms &amp; <em>templates</em>')}
    <p class="muted lead">Start a form for a person to encode it digitally, or print a blank template for manual filling in the field.</p>
    ${groups.map((g) => `
      <h2 class="group-title">${g === 'Personnel' ? 'Personnel health' : 'Learner &amp; student wellness'}</h2>
      <div class="form-grid">${FORMS.filter((f) => f.category === g).map((f) => `
        <article class="form-card">
          <span class="form-icon">${icon(f.icon)}</span>
          <p class="eyebrow">${esc(f.code)}</p>
          <h3>${esc(f.title)}</h3>
          <p class="muted small">${esc(f.description)}</p>
          <p class="small signer">${f.signer === 'medical' ? `${icon('signature')} Signed by physician` : f.signer === 'dental' ? `${icon('signature')} Signed by dentist` : `${icon('check')} Any health personnel`}</p>
          <div class="row">
            ${can(state.user, 'records.write') ? `<button class="btn sm primary" data-start="${f.id}">${icon('plus')} Start</button>` : ''}
            <a class="btn sm" href="#/print/blank/${f.id}">${icon('print')} Blank</a>
          </div>
        </article>`).join('')}</div>`).join('')}`;
  view.onclick = async (e) => {
    const b = e.target.closest('[data-start]');
    if (!b) return;
    const form = formById(b.dataset.start);
    const p = await pickPerson(form.subject);
    if (p) go(`#/record/new/${form.id}/${p.id}`);
  };
}

async function pickPerson(type) {
  const people = (await db.byIndex('people', 'type', type)).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  return modal({
    title: `Choose ${type === 'learner' ? 'a learner' : 'personnel'}`,
    body: `<label class="search">${icon('search')}<input id="pq" placeholder="Search name, ${type === 'learner' ? 'LRN' : 'employee no.'}…" autofocus></label><ul class="list pick" id="pl"></ul>
      ${can(state.user, 'people.write') ? `<button type="button" class="btn ghost sm" id="pnew">${icon('plus')} Add new ${type === 'learner' ? 'learner' : 'personnel'}</button>` : ''}`,
    onOpen: (dlg, close) => {
      const draw = (t = '') => {
        const m = people.filter((p) => `${fullName(p)} ${p.lrn || ''} ${p.employeeNo || ''}`.toLowerCase().includes(t.toLowerCase())).slice(0, 40);
        dlg.querySelector('#pl').innerHTML = m.map((p) => `<li><button type="button" data-id="${p.id}"><b>${esc(fullName(p))}</b><small>${esc(schoolName(p.schoolId))} ${esc(p.lrn || p.employeeNo || '')}</small></button></li>`).join('') || '<li class="muted">No matches</li>';
      };
      draw();
      dlg.querySelector('#pq').oninput = (e) => draw(e.target.value);
      dlg.querySelector('#pl').onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) close(people.find((p) => p.id === b.dataset.id)); };
      dlg.querySelector('#pnew')?.addEventListener('click', async () => { close(null); const p = await personDialog(type); if (p) go(`#/person/${p.id}`); });
    },
  });
}

// ======================================================= reports
async function reportsView(view) {
  const data = await loadAll();
  const years = [...new Set([currentSchoolYear(), ...data.records.map((r) => r.schoolYear).filter(Boolean)])].sort().reverse();
  let sy = years[0];
  view.innerHTML = `
    ${pageHead('Division analytics', 'Health &amp; nutrition <em>reports</em>', `<select id="sy">${optionList(years, sy)}</select>`)}
    <div id="rep"></div>`;
  const draw = () => {
    const st = computeStats(data, { sy });
    const rows = perSchool(data, sy);
    const n = st.learnerNutrition;
    $('#rep').innerHTML = `
      <section class="kpis">
        <div class="kpi"><span class="kpi-label">Learners assessed</span><span class="kpi-val">${n.assessed.toLocaleString()}</span><span class="kpi-sub">${n.coveragePct}% of ${st.learners.toLocaleString()}</span></div>
        <div class="kpi"><span class="kpi-label">Wasted + severely wasted</span><span class="kpi-val">${n.wastedOrSeverelyWastedPct}%</span><span class="kpi-sub">${n.bmiForAge.Wasted + n.bmiForAge['Severely wasted']} learners</span></div>
        <div class="kpi"><span class="kpi-label">Stunted + severely stunted</span><span class="kpi-val">${n.heightForAge.Stunted + n.heightForAge['Severely stunted']}</span><span class="kpi-sub">learners (height-for-age)</span></div>
        <div class="kpi"><span class="kpi-label">Annual PE compliance</span><span class="kpi-val">${st.personnelHealth.apeCompliancePct}%</span><span class="kpi-sub">${st.personnelHealth.annualPEDone} of ${st.personnel} personnel</span></div>
        <div class="kpi"><span class="kpi-label">Mean DMFT</span><span class="kpi-val">${st.dental.meanDMFT}</span><span class="kpi-sub">${st.dental.learnersExamined} learners examined</span></div>
        <div class="kpi"><span class="kpi-label">With dental caries</span><span class="kpi-val">${st.dental.withCariesPct}%</span><span class="kpi-sub">of examined learners</span></div>
      </section>
      ${reportTable('nut', 'Nutritional status by school (BMI-for-age)', ['School', 'Enrolled', 'Assessed', ...NUTRITION_STATUS, 'SBFP'], rows.map(({ school, stats: s }) => [school.name, s.learners, s.learnerNutrition.assessed, ...NUTRITION_STATUS.map((k) => s.learnerNutrition.bmiForAge[k]), s.learnerNutrition.sbfpBeneficiaries]), ['Division total', st.learners, n.assessed, ...NUTRITION_STATUS.map((k) => n.bmiForAge[k]), n.sbfpBeneficiaries])}
      ${reportTable('ape', 'Personnel Annual Physical Examination by school', ['School', 'Personnel', 'With Annual PE', 'Compliance %', 'BMI ≥ 25', 'BP ≥ 140/90'], rows.map(({ school, stats: s }) => [school.name, s.personnel, s.personnelHealth.annualPEDone, s.personnelHealth.apeCompliancePct, s.personnelHealth.bmiCategories.Overweight + s.personnelHealth.bmiCategories.Obese, s.personnelHealth.bpAtOrAbove140over90]), ['Division total', st.personnel, st.personnelHealth.annualPEDone, st.personnelHealth.apeCompliancePct, st.personnelHealth.bmiCategories.Overweight + st.personnelHealth.bmiCategories.Obese, st.personnelHealth.bpAtOrAbove140over90])}
      ${reportTable('den', 'Learner dental health by school', ['School', 'Learners', 'Examined', 'Coverage %', 'Mean DMFT', 'With caries %'], rows.map(({ school, stats: s }) => [school.name, s.learners, s.dental.learnersExamined, s.dental.coveragePct, s.dental.meanDMFT, s.dental.withCariesPct]), ['Division total', st.learners, st.dental.learnersExamined, st.dental.coveragePct, st.dental.meanDMFT, st.dental.withCariesPct])}
      ${can(state.user, 'ai.use') ? `<article class="card ai-card"><header><h3>${icon('spark')} AI report writer</h3>
        <div class="row"><select id="kind">
          <option value="Write a division health and nutrition situationer for the Schools Division Superintendent: key figures, concerns, and 3–5 prioritized actions.">Division situationer</option>
          <option value="Draft a memorandum to school heads on School-Based Feeding Program targeting, based on the wasted and severely wasted learners. Include priorities per school.">SBFP targeting memo</option>
          <option value="Write recommendations to improve Annual Physical Examination compliance among personnel, citing the schools with the lowest compliance.">APE compliance recommendations</option>
          <option value="Write an oral health program plan for learners based on the dental indicators, including priority schools.">Oral health plan</option>
        </select><button class="btn sm primary" id="gen">Generate</button></div></header>
        <div id="repOut" class="prose muted">Only the aggregated numbers above (no names) are sent to the AI.</div></article>` : ''}`;
    $('#rep').querySelectorAll('[data-csv]').forEach((b) => (b.onclick = () => {
      const t = b.closest('.card').querySelector('table');
      const rowsArr = [...t.rows].map((r) => [...r.cells].map((c) => c.textContent));
      download(`kalinga-report-${b.dataset.csv}-${sy}.csv`, toCSV(rowsArr.slice(1), rowsArr[0].map((label, i) => ({ label, get: (r) => r[i] }))), 'text/csv');
    }));
    $('#gen')?.addEventListener('click', () => {
      if (!state.hasKey) return toast('AI is not set up. An administrator can add the API key in Settings.', 'warn');
      const payload = { ...st, perSchool: rows.map(({ school, stats: s }) => ({ school: school.name, learners: s.learners, personnel: s.personnel, nutrition: s.learnerNutrition, personnelHealth: s.personnelHealth, dental: s.dental })) };
      streamInto($('#repOut'), (on) => import('./ai.js').then((ai) => ai.writeReport(payload, $('#kind').value, on)), $('#gen'));
    });
  };
  draw();
  $('#sy').onchange = (e) => { sy = e.target.value; draw(); };
}

function reportTable(id, title, head, rows, total) {
  return `<article class="card"><header><h3>${title}</h3><button class="btn sm ghost" data-csv="${id}">${icon('download')} CSV</button></header>
    <div class="table-wrap"><table class="table compact num"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="muted">No school data for this school year yet.</td></tr>`}</tbody>
    <tfoot><tr>${total.map((c) => `<td>${esc(c)}</td>`).join('')}</tr></tfoot></table></div></article>`;
}

// ======================================================= AI assistant
async function assistantView(view) {
  const suggestions = ['How do I classify BMI-for-age for a 9-year-old girl?', 'Draft a parent letter about the deworming schedule', 'Summarize the division’s nutrition situation', 'What should a Palaro pre-participation exam check for?'];
  view.innerHTML = `
    ${pageHead('Powered by Claude', 'AI <em>Assistant</em>', `<button class="btn ghost" id="clear">${icon('refresh')} New chat</button>`)}
    ${state.hasKey ? '' : `<div class="banner warn">${icon('key')}<span>AI is not set up yet. ${can(state.user, 'settings.manage') ? '<a href="#/settings">Add an Anthropic API key in Settings.</a>' : 'Ask your administrator to add an API key.'}</span></div>`}
    <section class="chat">
      <div class="chat-log" id="log">${state.chat.length ? '' : `<div class="chat-empty">${icon('spark')}<h3>Ask about school health, nutrition, dental care or DepEd health forms.</h3><div class="sugg">${suggestions.map((s) => `<button class="chip-btn">${esc(s)}</button>`).join('')}</div></div>`}</div>
      <form class="chat-input" id="ask">
        <textarea id="msg" rows="1" placeholder="Message Kalinga AI…" required></textarea>
        <label class="small muted toggle"><input type="checkbox" id="ctx" checked> Include division statistics (counts only)</label>
        <button class="btn primary" type="submit" aria-label="Send">${icon('send')}</button>
      </form>
      <p class="small muted center">AI can make mistakes. Clinical decisions remain with the attending physician, dentist or nurse. Do not type names or identifiers.</p>
    </section>`;
  const log = $('#log');
  const bubble = (role, html) => { log.querySelector('.chat-empty')?.remove(); const d = document.createElement('div'); d.className = `msg ${role}`; d.innerHTML = html; log.append(d); log.scrollTop = log.scrollHeight; return d; };
  for (const m of state.chat) bubble(m.role, m.role === 'user' ? esc(m.content) : md(m.content));
  const send = async (text) => {
    if (!text.trim()) return;
    if (!state.hasKey) return toast('AI is not set up yet.', 'warn');
    $('#msg').value = '';
    bubble('user', esc(text));
    const out = bubble('assistant', '');
    const ctx = $('#ctx').checked ? computeStats(await loadAll(), { sy: currentSchoolYear() }) : null;
    const history = state.chat.map((m) => ({ role: m.role, content: m.content }));
    const reply = await streamInto(out, (on) => import('./ai.js').then((ai) => ai.chat(history, text, ctx, (t) => { on(t); log.scrollTop = log.scrollHeight; })), $('#ask button[type=submit]'));
    if (reply) state.chat.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
  };
  $('#ask').onsubmit = (e) => { e.preventDefault(); send($('#msg').value); };
  $('#msg').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send($('#msg').value); } };
  $('#msg').oninput = (e) => { e.target.style.height = 'auto'; e.target.style.height = `${Math.min(200, e.target.scrollHeight)}px`; };
  log.onclick = (e) => { const b = e.target.closest('.chip-btn'); if (b) send(b.textContent); };
  $('#clear').onclick = () => { state.chat = []; route(); };
}

// ======================================================= data & backup
async function dataView(view) {
  await db.refresh();
  const counts = Object.fromEntries(await Promise.all(['people', 'records', 'schools'].map(async (s) => [s, await db.count(s)])));
  const lastBackup = await getSetting('lastBackupAt');
  const isAdmin = can(state.user, 'data.import');
  const legacy = isAdmin ? await readLegacyLocal() : null;
  view.innerHTML = `
    ${pageHead('Portability &amp; safety', 'Data &amp; <em>backup</em>')}
    ${legacy ? `<div class="banner">${icon('database')}<span>This browser still holds data from the earlier device-only version of Kalinga: <b>${(legacy.stores.people || []).length}</b> people and <b>${(legacy.stores.records || []).length}</b> records.</span><button class="btn sm primary" id="legacy">Upload to central database</button></div>` : ''}
    <section class="cards">
      <article class="card">
        <header><h3>${icon('database')} Central database</h3><span class="badge ok">Connected</span></header>
        <p class="muted small">Everyone signs in to the same Supabase database, so records are shared live across all computers and phones.</p>
        <dl class="dl">
          <dt>Project</dt><dd class="mono">${esc(new URL(SUPABASE_URL).hostname.split('.')[0])}</dd>
          <dt>People</dt><dd>${counts.people.toLocaleString()}</dd><dt>Records</dt><dd>${counts.records.toLocaleString()}</dd><dt>Schools</dt><dd>${counts.schools}</dd>
        </dl>
      </article>
      <article class="card">
        <header><h3>${icon('download')} Export backup</h3></header>
        <p class="muted small">Download a full copy of every person, record, school and setting. Keep one off-line, e.g. monthly on a division drive. User accounts are not included.</p>
        <form id="exp" class="stack">
          <label>Passphrase (recommended)<input type="password" name="pass" autocomplete="new-password" placeholder="Leave blank for an unencrypted file"></label>
          ${isAdmin ? '<label class="toggle"><input type="checkbox" name="key"> Include the AI API key</label>' : ''}
          <button class="btn primary" type="submit">${icon('download')} Download backup</button>
        </form>
        <p class="small muted">Last backup: <b>${lastBackup ? fmtDateTime(lastBackup) : 'never'}</b></p>
      </article>
      ${isAdmin ? `<article class="card">
        <header><h3>${icon('upload')} Import a backup</h3></header>
        <p class="muted small">Adds the people, records and schools in a Kalinga backup file to the central database. Where a record exists in both, the more recently edited copy is kept. Nothing is deleted.</p>
        <button class="btn" id="merge">${icon('upload')} Import backup file</button>
      </article>` : ''}
      <article class="card">
        <header><h3>${icon('file')} CSV templates</h3></header>
        <p class="muted small">Fill these in Excel or Google Sheets, then use <b>Import CSV</b> on the Learners or Personnel page. Columns can be in any order.</p>
        <div class="stack"><button class="btn" data-tpl="learner">${icon('download')} Learner template</button><button class="btn" data-tpl="personnel">${icon('download')} Personnel template</button></div>
      </article>
    </section>`;

  $('#exp').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pass = fd.get('pass');
    let data = await exportAll({ includeSecrets: !!fd.get('key') });
    if (pass) data = await encryptJSON(data, pass);
    const name = `kalinga-backup-${(state.settings.division || 'division').replace(/\W+/g, '-').toLowerCase()}-${today()}${pass ? '.encrypted' : ''}.json`;
    download(name, JSON.stringify(data));
    if (isAdmin) await setSetting('lastBackupAt', new Date().toISOString());
    await audit(state.user, 'data.export', pass ? 'encrypted' : 'unencrypted');
    toast(pass ? 'Encrypted backup downloaded. Keep the passphrase safe — it cannot be recovered.' : 'Backup downloaded. Store it somewhere safe; it contains health information.', 'ok', 6000);
    e.target.reset();
  };
  $('#merge')?.addEventListener('click', () => restoreBackup());
  $('#legacy')?.addEventListener('click', () => importBackup(legacy, 'this browser’s old local database'));
  $$('[data-tpl]').forEach((b) => (b.onclick = () => {
    const t = b.dataset.tpl;
    const sample = t === 'learner'
      ? [{ lrn: '123456789012', lastName: 'Dela Cruz', firstName: 'Juan', middleName: 'Santos', sex: 'Male', birthdate: '2016-05-14', gradeLevel: 'Grade 4', section: 'Sampaguita', guardian: 'Maria Dela Cruz', contact: '09171234567', address: 'Brgy. San Roque', school: state.schools[0]?.name || 'Sample Elementary School' }]
      : [{ employeeNo: '1234567', lastName: 'Reyes', firstName: 'Ana', middleName: 'Lopez', sex: 'Female', birthdate: '1988-02-20', civilStatus: 'Married', position: 'Teacher III', bloodType: 'O+', contact: '09181234567', address: 'Brgy. Poblacion', school: state.schools[0]?.name || 'Sample National High School' }];
    download(`kalinga-${t}-template.csv`, toCSV(sample, [...PERSON_FIELDS[t].map((f) => ({ k: f.k, label: f.label })), { k: 'school', label: 'School' }]), 'text/csv');
  }));
}

async function restoreBackup() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('That file is not valid JSON.', 'err'); }
  if (data.encrypted) {
    const pass = await modal({ title: 'Encrypted backup', body: '<label>Passphrase<input type="password" name="p" required autofocus></label>', actions: [{ label: 'Cancel', value: null }, { label: 'Unlock', kind: 'primary', submit: true }], onSubmit: (f) => f.elements.p.value });
    if (!pass) return;
    try { data = await decryptJSON(data, pass); } catch (err) { return toast(err.message, 'err'); }
  }
  if (data.app !== 'kalinga') return toast('This file is not a Kalinga backup.', 'err');
  return importBackup(data, `the backup from ${fmtDateTime(data.exportedAt)}`);
}

async function importBackup(data, source) {
  const n = (k) => (data.stores?.[k] || []).length.toLocaleString();
  const ok = await confirmBox('Import into the central database?', `From ${esc(source)}: <b>${n('people')}</b> people, <b>${n('records')}</b> records, <b>${n('schools')}</b> schools.<br><br>Everyone will see these right away. Existing data is kept; for records in both places, the more recently edited copy wins. User accounts are not imported — send invite links instead.`, 'Import');
  if (!ok) return;
  const progress = toastProgress('Uploading…');
  try {
    const summary = await importAll(data, (store, done, total) => progress(`Uploading ${store}: ${done.toLocaleString()} of ${total.toLocaleString()}`));
    await audit(state.user, 'data.import', JSON.stringify(summary));
    progress(null);
    toast(`Imported ${summary.people} people, ${summary.records} records, ${summary.schools} schools.`, 'ok', 6000);
    await loadSettings(true);
    renderShell(); route();
  } catch (err) { progress(null); toast(err.message, 'err', 8000); }
}

// A persistent status toast for long uploads; call with null to remove it.
function toastProgress(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<span class="spinner"></span><span></span>';
  $('#toasts').append(el);
  const set = (t) => { if (t === null) el.remove(); else el.lastChild.textContent = t; };
  set(text);
  return set;
}

// ======================================================= users
async function usersView(view) {
  const [users, invites] = await Promise.all([listUsers(), listInvites()]);
  const now = new Date().toISOString();
  const open = invites.filter((i) => !i.revoked && !i.used_at && i.expires_at > now);
  view.innerHTML = `
    ${pageHead('Accounts &amp; roles', '<em>Users</em>', `<button class="btn primary" id="add">${icon('plus')} Invite staff</button>`)}
    <article class="card">
      <header><h3>${icon('send')} Open invite links</h3><span class="muted small">Each link works once and expires automatically</span></header>
      ${open.length ? `<div class="table-wrap"><table class="table compact"><thead><tr><th>Role</th><th>For</th><th>Expires</th><th></th></tr></thead><tbody id="invites">
        ${open.map((i) => `<tr><td>${esc(ROLES[i.role].label)}</td><td>${esc(i.email || i.note || 'Anyone with the link')}</td><td>${fmtDate(i.expires_at)}</td>
          <td class="right"><button class="btn sm" data-copy="${i.token}">${icon('clipboard')} Copy link</button><button class="btn sm ghost danger" data-revoke="${i.token}">Revoke</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">No open invites. Use <b>Invite staff</b> to create a link for a doctor, dentist, nurse or another administrator.</p>'}
    </article>
    <div class="role-legend">
      <div><b>Administrator / Developer</b><small>Everything, including users, settings, backups, audit log and unlocking signed records.</small></div>
      <div><b>Physician</b><small>Encodes all forms; signs medical certificates, Annual PE and Palaro clearances.</small></div>
      <div><b>Dentist</b><small>Encodes all forms; signs dental records and referral slips.</small></div>
      <div><b>Nurse</b><small>Encodes all forms and finalizes health records; certificates wait for a physician or dentist.</small></div>
    </div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>License no.</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
    <tbody id="users">${users.map((u) => `<tr><td><span class="person-cell"><span class="avatar sm">${esc(initials(u.fullName))}</span><b>${esc(u.fullName)}</b></span></td><td>${esc(u.email)}</td><td>${esc(ROLES[u.role]?.label)}</td><td>${esc(u.license || '—')}</td><td>${u.lastLogin ? fmtDateTime(u.lastLogin) : 'Never'}</td>
      <td>${u.active === false ? '<span class="badge">Disabled</span>' : '<span class="badge ok">Active</span>'}</td>
      <td class="right"><button class="btn sm ghost" data-edit="${u.id}">${icon('edit')}</button><button class="btn sm ghost" data-pw="${u.id}" data-tip="Reset password">${icon('key')}</button></td></tr>`).join('')}</tbody></table></div>`;
  const userForm = (u = {}) => `<div class="grid2">
      <label class="span-2">Full name (as printed on forms)<input name="fullName" required value="${esc(u.fullName)}"></label>
      <label>Role<select name="role">${optionList(Object.entries(ROLES).map(([k, r]) => [k, r.label]), u.role || 'nurse')}</select></label>
      <label>PRC license no.<input name="license" value="${esc(u.license)}" placeholder="Required for signing"></label>
      <label class="span-2">Position / designation<input name="position" value="${esc(u.position)}" placeholder="e.g. Medical Officer III"></label>
      <label class="toggle span-2"><input type="checkbox" name="active" ${u.active !== false ? 'checked' : ''}> Account active</label>
    </div>`;
  const shareInvite = (token, role) => modal({
    title: 'Invite link ready',
    body: `<p>Send this link to the ${esc(ROLES[role].label.toLowerCase())} by Messenger, SMS or email. It opens a page where they create their own password.</p>
      <div class="invite-link"><input readonly value="${esc(inviteLink(token))}" id="il"><button type="button" class="btn primary" id="ilc">${icon('clipboard')} Copy</button></div>
      <p class="muted small">The link works once. Anyone who has it can join with this role until it is used or expires, so share it only with the intended person.</p>`,
    onOpen: (dlg) => {
      dlg.querySelector('#il').onfocus = (e) => e.target.select();
      dlg.querySelector('#ilc').onclick = () => navigator.clipboard.writeText(inviteLink(token)).then(() => toast('Invite link copied'));
    },
  });
  $('#add').onclick = async () => {
    const inv = await modal({
      title: 'Invite staff', wide: true,
      body: `<div class="grid2">
        <label>Role<select name="role">${optionList(Object.entries(ROLES).map(([k, r]) => [k, r.label]), 'nurse')}</select></label>
        <label>Link expires in<select name="days">${optionList([['1', '1 day'], ['3', '3 days'], ['7', '7 days'], ['30', '30 days']], '7')}</select></label>
        <label class="span-2">Their email (optional — only this email can use the link)<input type="email" name="email" placeholder="name@deped.gov.ph"></label>
        <label class="span-2">Note for your reference<input name="note" placeholder="e.g. Nurse Reyes – District II"></label>
      </div>`,
      actions: [{ label: 'Cancel', value: null }, { label: 'Create invite link', kind: 'primary', submit: true }],
      onSubmit: async (f) => createInvite({ role: f.elements.role.value, email: f.elements.email.value, days: +f.elements.days.value, note: f.elements.note.value }, state.user),
    });
    if (!inv) return;
    await shareInvite(inv.token, inv.role);
    route();
  };
  $('#invites')?.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]'), r = e.target.closest('[data-revoke]');
    if (c) { const i = invites.find((x) => x.token === c.dataset.copy); shareInvite(i.token, i.role); }
    if (r && (await confirmBox('Revoke invite?', 'The link will stop working immediately.', 'Revoke', true))) { await revokeInvite(r.dataset.revoke, state.user); route(); }
  });
  $('#users').onclick = async (e) => {
    const eb = e.target.closest('[data-edit]'), pb = e.target.closest('[data-pw]');
    if (eb) {
      const u = users.find((x) => x.id === eb.dataset.edit);
      const ok = await modal({ title: `Edit ${u.fullName}`, wide: true, body: userForm(u), actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', submit: true }],
        onSubmit: async (f) => {
          const v = Object.fromEntries(new FormData(f));
          const active = !!v.active;
          if (u.id === state.user.id && !active) throw new Error('You cannot disable your own account.');
          await updateUser(u.id, { ...v, active }, state.user);
          return true;
        } });
      if (ok) { toast('Saved'); state.checkedAt = 0; route(); }
    }
    if (pb) {
      const u = users.find((x) => x.id === pb.dataset.pw);
      const ok = await modal({ title: `Reset password for ${u.fullName}`, body: '<label>New temporary password<input type="password" name="p" required minlength="8" autocomplete="new-password"></label><p class="muted small">Tell them the temporary password privately. They will be reminded to change it.</p>', actions: [{ label: 'Cancel', value: null }, { label: 'Reset', kind: 'primary', submit: true }],
        onSubmit: async (f) => { await adminSetPassword(u, f.elements.p.value, state.user); return true; } });
      if (ok) toast('Password reset');
    }
  };
}

// ======================================================= settings
async function settingsView(view) {
  const s = state.settings;
  const { MODELS } = await import('./ai.js');
  const model = (await getSetting('aiModel')) || MODELS[0].id;
  view.innerHTML = `
    ${pageHead('Configuration', '<em>Settings</em>')}
    <section class="cards">
      <article class="card">
        <header><h3>${icon('school')} Division profile</h3></header>
        <p class="muted small">Printed in the header of every form.</p>
        <form id="prof" class="grid2">
          <label class="span-2">Region<input name="region" list="regions" value="${esc(s.region)}"></label>
          <datalist id="regions">${REGIONS.map((r) => `<option value="${esc(r)}">`).join('')}</datalist>
          <label class="span-2">Schools Division Office of<input name="division" value="${esc(s.division)}"></label>
          <label class="span-2">Office address<input name="address" value="${esc(s.address)}"></label>
          <label class="span-2">Health unit name<input name="unit" value="${esc(s.unit)}"></label>
          <label class="span-2">Logo for printouts (PNG/JPG, under 300 KB)<input type="file" name="logo" accept="image/png,image/jpeg"></label>
          ${s.logo ? `<div class="span-2 logo-prev"><img src="${esc(s.logo)}" alt="Current logo"><button type="button" class="btn sm ghost" id="rmLogo">Remove logo</button></div>` : ''}
          <button class="btn primary span-2" type="submit">Save profile</button>
        </form>
      </article>
      <article class="card">
        <header><h3>${icon('spark')} AI (Anthropic Claude)</h3><span class="badge ${state.hasKey ? 'ok' : 'warn'}">${state.hasKey ? 'Connected' : 'Not set up'}</span></header>
        <p class="muted small">Get a key at console.anthropic.com. The key is stored only on this device and is used directly from the browser, so set a monthly spend limit on it. Only de-identified data is sent for summaries and reports.</p>
        <form id="aiF" class="stack">
          <label>API key<input type="password" name="key" autocomplete="off" placeholder="${state.hasKey ? '•••••••••• (saved — enter a new key to replace)' : 'sk-ant-…'}"></label>
          <label>Model<select name="model">${optionList(MODELS.map((m) => [m.id, m.label]), model)}</select></label>
          <div class="row"><button class="btn primary" type="submit">Save</button><button class="btn" type="button" id="test">Test connection</button>${state.hasKey ? '<button class="btn danger ghost" type="button" id="rmKey">Remove key</button>' : ''}</div>
          <p class="small" id="testOut"></p>
        </form>
      </article>
      <article class="card span-2">
        <header><h3>${icon('school')} Schools</h3><span class="muted">${state.schools.length} school(s)</span></header>
        <div class="table-wrap"><table class="table compact"><thead><tr><th>School ID</th><th>School name</th><th>District</th><th></th></tr></thead>
        <tbody id="schools">${state.schools.map((x) => `<tr><td class="mono">${esc(x.code)}</td><td>${esc(x.name)}</td><td>${esc(x.district)}</td><td class="right"><button class="btn sm ghost" data-sedit="${x.id}">${icon('edit')}</button><button class="btn sm ghost" data-sdel="${x.id}">${icon('trash')}</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No schools yet.</td></tr>'}</tbody></table></div>
        <details class="bulk"><summary>${icon('plus')} Add schools</summary>
          <p class="muted small">One per line: <code>School ID, School name, District</code> — you can paste straight from a spreadsheet.</p>
          <textarea id="bulk" rows="4" placeholder="104567, San Roque Elementary School, District I&#10;300123, Rizal National High School, District II"></textarea>
          <button class="btn primary sm" id="addSchools">Add schools</button>
        </details>
      </article>
    </section>`;

  $('#prof').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    for (const k of ['region', 'division', 'address', 'unit']) await setSetting(k, f.elements[k].value.trim());
    const file = f.elements.logo.files[0];
    if (file) {
      if (file.size > 300 * 1024) return toast('Logo must be under 300 KB.', 'err');
      const url = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
      await setSetting('logo', url);
    }
    await audit(state.user, 'settings.profile');
    await loadSettings();
    toast('Division profile saved');
    renderShell(); route();
  };
  $('#rmLogo')?.addEventListener('click', async () => { await setSetting('logo', ''); await loadSettings(); route(); });
  $('#aiF').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const key = f.elements.key.value.trim();
    if (key) {
      if (!key.startsWith('sk-ant-')) return toast('That does not look like an Anthropic API key (it should start with sk-ant-).', 'err');
      await setSetting('apiKey', key);
    }
    await setSetting('aiModel', f.elements.model.value);
    await audit(state.user, 'settings.ai', key ? 'key updated' : 'model changed');
    await loadSettings();
    toast('AI settings saved');
    route();
  };
  $('#rmKey')?.addEventListener('click', async () => { await setSetting('apiKey', ''); await audit(state.user, 'settings.ai', 'key removed'); await loadSettings(); route(); });
  $('#test').onclick = async () => {
    const out = $('#testOut');
    out.className = 'small muted';
    out.textContent = 'Contacting Claude…';
    const ai = await import('./ai.js');
    try { out.textContent = await ai.testConnection(); out.className = 'small ok-text'; } catch (err) { out.textContent = ai.friendlyError(err); out.className = 'small err'; }
  };
  $('#addSchools').onclick = async () => {
    const lines = parseCSV($('#bulk').value.replace(/\t/g, ','));
    const add = lines.map((r) => (r.length === 1 ? { code: '', name: r[0].trim(), district: '' } : { code: (r[0] || '').trim(), name: (r[1] || '').trim(), district: (r[2] || '').trim() })).filter((x) => x.name);
    if (!add.length) return toast('Enter at least one school.', 'warn');
    await db.bulkPut('schools', add.map((x) => ({ id: uid(), ...x })));
    await audit(state.user, 'school.create', `${add.length} school(s)`);
    await loadSettings();
    toast(`Added ${add.length} school(s)`);
    route();
  };
  $('#schools').onclick = async (e) => {
    const ed = e.target.closest('[data-sedit]'), del = e.target.closest('[data-sdel]');
    if (ed) {
      const sc = state.schools.find((x) => x.id === ed.dataset.sedit);
      const ok = await modal({ title: 'Edit school', body: `<div class="grid2"><label>School ID<input name="code" value="${esc(sc.code)}"></label><label>District<input name="district" value="${esc(sc.district)}"></label><label class="span-2">Name<input name="name" required value="${esc(sc.name)}"></label></div>`,
        actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', submit: true }],
        onSubmit: async (f) => { await db.put('schools', { ...sc, code: f.elements.code.value.trim(), name: f.elements.name.value.trim(), district: f.elements.district.value.trim() }); return true; } });
      if (ok) { await loadSettings(); route(); }
    }
    if (del) {
      const sc = state.schools.find((x) => x.id === del.dataset.sdel);
      const used = (await db.byIndex('people', 'schoolId', sc.id)).length;
      if (used) return toast(`${sc.name} still has ${used} people assigned. Move them first.`, 'err', 5000);
      if (!(await confirmBox('Delete school?', `Delete <b>${esc(sc.name)}</b>?`, 'Delete', true))) return;
      await db.del('schools', sc.id);
      await audit(state.user, 'school.delete', sc.name);
      await loadSettings();
      route();
    }
  };
}

// ======================================================= audit
async function auditView(view) {
  const rows = await readAudit();
  view.innerHTML = `
    ${pageHead('Accountability', 'Audit <em>log</em>', `<button class="btn" id="exp">${icon('download')} Export CSV</button>`)}
    <div class="toolbar"><label class="search">${icon('search')}<input id="q" placeholder="Filter by user, action or detail…"></label><span class="muted" id="count"></span></div>
    <div class="table-wrap"><table class="table compact"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr></thead><tbody id="rows"></tbody></table></div>`;
  let shown = rows;
  const draw = (t = '') => {
    shown = rows.filter((r) => `${r.user} ${r.action} ${r.detail}`.toLowerCase().includes(t.toLowerCase()));
    $('#count').textContent = `${shown.length.toLocaleString()} entries${shown.length > 500 ? ' · showing 500' : ''}`;
    $('#rows').innerHTML = shown.slice(0, 500).map((r) => `<tr><td class="nowrap">${fmtDateTime(r.at)}</td><td>${esc(r.user)}</td><td><code>${esc(r.action)}</code></td><td>${esc(r.detail)}</td></tr>`).join('');
  };
  draw();
  $('#q').oninput = debounce((e) => draw(e.target.value), 120);
  $('#exp').onclick = () => download(`kalinga-audit-${today()}.csv`, toCSV(shown, [{ k: 'at', label: 'When' }, { k: 'user', label: 'User' }, { k: 'action', label: 'Action' }, { k: 'detail', label: 'Detail' }]), 'text/csv');
}

// ======================================================= my account
async function accountView(view) {
  const u = state.user;
  view.innerHTML = `
    ${pageHead(esc(ROLES[u.role].label), 'My <em>account</em>')}
    <section class="cards">
      <article class="card">
        <header><h3>Profile</h3></header>
        <form id="prof" class="stack">
          <label>Full name (as printed on forms)<input name="fullName" required value="${esc(u.fullName)}"></label>
          <label>PRC license no.<input name="license" value="${esc(u.license)}" ${['doctor', 'dentist'].includes(u.role) ? 'required' : ''}></label>
          <label>Position / designation<input name="position" value="${esc(u.position)}"></label>
          <button class="btn primary">Save profile</button>
        </form>
      </article>
      <article class="card">
        <header><h3>Change password</h3></header>
        <form id="pw" class="stack">
          <label>Current password<input type="password" name="cur" required autocomplete="current-password"></label>
          <label>New password<input type="password" name="new" required minlength="8" autocomplete="new-password"></label>
          <label>Repeat new password<input type="password" name="rep" required autocomplete="new-password"></label>
          <button class="btn primary">Change password</button>
        </form>
      </article>
    </section>`;
  $('#prof').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (!f.reportValidity()) return;
    await updateUser(u.id, { fullName: f.elements.fullName.value, license: f.elements.license.value, position: f.elements.position.value }, u);
    Object.assign(u, { fullName: f.elements.fullName.value.trim(), license: f.elements.license.value.trim(), position: f.elements.position.value.trim() });
    toast('Profile saved');
    renderShell(); route();
  };
  $('#pw').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.elements.new.value !== f.elements.rep.value) return toast('The new passwords do not match.', 'err');
    try {
      await changeOwnPassword(u, f.elements.cur.value, f.elements.new.value);
      u.mustChange = false;
      toast('Password changed');
      f.reset();
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ======================================================= command palette
async function commandPalette() {
  if ($('dialog.palette')) return;
  const people = await db.all('people');
  const pages = NAV.flatMap((g) => g.items.filter((i) => !i[3] || can(state.user, i[3])).map(([href, ic, label]) => ({ href, ic, label, sub: 'Page' })));
  const formsItems = FORMS.map((f) => ({ href: '#/forms', ic: f.icon, label: `${f.code} – ${f.title}`, sub: 'Form' }));
  const dlg = document.createElement('dialog');
  dlg.className = 'palette';
  dlg.innerHTML = `<div class="pal-in"><label class="search big">${icon('search')}<input id="palq" placeholder="Search learners, personnel, pages, forms…" autocomplete="off"></label><ul id="pall" class="list pick"></ul><p class="small muted">↑ ↓ to move · Enter to open · Esc to close</p></div>`;
  document.body.append(dlg);
  let items = [], sel = 0;
  const draw = (t) => {
    const s = t.toLowerCase().trim();
    const ppl = s ? people.filter((p) => `${p.firstName} ${p.lastName} ${p.lastName} ${p.firstName} ${p.lrn || ''} ${p.employeeNo || ''}`.toLowerCase().includes(s)).slice(0, 8).map((p) => ({ href: `#/person/${p.id}`, ic: p.type === 'learner' ? 'learner' : 'personnel', label: fullName(p), sub: `${p.type === 'learner' ? 'Learner' : 'Personnel'} · ${schoolName(p.schoolId)}` })) : [];
    items = [...ppl, ...[...pages, ...formsItems].filter((x) => !s || x.label.toLowerCase().includes(s))].slice(0, 12);
    sel = Math.min(sel, Math.max(0, items.length - 1));
    dlg.querySelector('#pall').innerHTML = items.map((x, i) => `<li><button type="button" class="${i === sel ? 'sel' : ''}" data-i="${i}">${icon(x.ic)}<b>${esc(x.label)}</b><small>${esc(x.sub)}</small></button></li>`).join('') || '<li class="muted">No results</li>';
  };
  const close = () => { dlg.close(); dlg.remove(); };
  const open = (i) => { if (items[i]) { close(); go(items[i].href); } };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); const b = e.target.closest('[data-i]'); if (b) open(+b.dataset.i); });
  const inp = dlg.querySelector('#palq');
  inp.oninput = () => { sel = 0; draw(inp.value); };
  inp.onkeydown = (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(inp.value); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(inp.value); e.preventDefault(); }
    if (e.key === 'Enter') open(sel);
  };
  draw('');
  dlg.showModal();
  inp.focus();
}

boot();
