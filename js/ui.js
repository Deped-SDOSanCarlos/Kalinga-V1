// Small UI toolkit: escaping, icons, toasts, dialogs, downloads, CSV.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmtDate = (d, opts = { year: 'numeric', month: 'short', day: 'numeric' }) => {
  if (!d) return '';
  const x = new Date(d);
  return isNaN(x) ? '' : x.toLocaleDateString('en-PH', opts);
};
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const today = () => new Date().toISOString().slice(0, 10);

// ---------- icons (24px stroke icons) ----------
const P = {
  home: 'M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  learner: 'M2 9l10-5 10 5-10 5L2 9Zm4 2v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6',
  personnel: 'M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm0 5h18',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8l-5-5Zm0 0v5h5M9 13h6M9 17h6',
  forms: 'M9 4h6M9 4a1 1 0 0 0-1 1v1h8V5a1 1 0 0 0-1-1M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2M9 12l2 2 4-4',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Zm7 12 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z',
  database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3Zm8-3v14c0 1.7-3.6 3-8 3s-8-1.3-8-3V5m16 7c0 1.7-3.6 3-8 3s-8-1.3-8-3',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3Z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.2-1.3L14.3 3h-4l-.4 2.4a7.5 7.5 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.5 7.5 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
  log: 'M4 6h16M4 12h16M4 18h10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm10 3-5-5',
  plus: 'M12 5v14M5 12h14',
  print: 'M7 9V3h10v6M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v7H7v-7Z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  download: 'M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3',
  upload: 'M12 21V9m0 0-4 4m4-4 4 4M4 7V4h16v3',
  check: 'M5 12.5 10 17 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  logout: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5Z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-14v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  lock: 'M6 11h12v10H6V11Zm2 0V7a4 4 0 1 1 8 0v4',
  signature: 'M3 17c3-3 4-8 6-8s0 7 2 7 2-4 4-4 1 3 3 3 3-1 3-1M3 21h18',
  stethoscope: 'M6 3v6a4 4 0 0 0 8 0V3M10 13v2a5 5 0 0 0 10 0v-2m0 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  certificate: 'M5 4h14v11H5V4Zm4 4h6m-6 3h4M10 15l-1 6 3-2 3 2-1-6',
  calendar: 'M4 6h16v14H4V6Zm0 4h16M8 3v4m8-4v4',
  clipboard: 'M9 4h6v3H9V4ZM7 5H5v16h14V5h-2M8 12h8M8 16h5',
  apple: 'M12 7c-1.5-1-5-1.5-6.5 1.5S6 17 8.5 19.5c1.5 1.5 2.5.5 3.5.5s2 1 3.5-.5C18 17 19.5 11.5 18 8.5S13.5 6 12 7Zm0 0c0-2 1-3.5 3-4',
  tooth: 'M7 3c-2.5 0-4 2-4 4.5 0 3 1.5 4 2 7 .5 3 1 6.5 2.5 6.5S9 16 12 16s3.5 5 5 5 2-3.5 2.5-6.5c.5-3 2-4 2-7C21.5 5 20 3 17.5 3c-2 0-3.5 1-5.5 1S9 3 7 3Z',
  referral: 'M4 12h12m0 0-4-4m4 4-4 4M20 5v14',
  medal: 'M8 3h8l-2 6h-4L8 3Zm4 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 3.5 1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3 1-2Z',
  send: 'M4 12 20 4l-6 16-3-7-7-1Z',
  key: 'M14 10a4 4 0 1 0-3.5 4L9 15.5V18H6.5v2.5H4v-3l6.1-6.1M15.5 8.5h.01',
  alert: 'M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01',
  arrowRight: 'M5 12h14m-5-5 5 5-5 5',
  school: 'M3 21h18M5 21V10l7-5 7 5v11M9 21v-5h6v5M12 10h.01',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
};
export const icon = (name, cls = '') =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.file}"/></svg>`;

// ---------- toasts ----------
export function toast(message, kind = 'ok', ms = 3200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === 'err' ? 'alert' : 'check')}<span>${esc(message)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------- dialogs ----------
// modal({ title, body (html), actions: [{label, value, kind}], wide, onOpen(root) }) -> Promise<value|null>
export function modal({ title, body, actions = [{ label: 'Close', value: null }], wide = false, onOpen, onSubmit }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = `modal ${wide ? 'wide' : ''}`;
    dlg.innerHTML = `
      <form method="dialog" class="modal-inner" novalidate>
        <header><h3>${esc(title)}</h3><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></header>
        <div class="modal-body">${body}</div>
        <footer>${actions.map((a, i) => `<button type="${a.submit ? 'submit' : 'button'}" class="btn ${a.kind || ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</footer>
      </form>`;
    document.body.append(dlg);
    let settled = false;
    const close = (v) => { if (settled) return; settled = true; dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dlg.querySelector('[data-close]').onclick = () => close(null);
    const form = dlg.querySelector('form');
    const run = async (a) => {
      if (a.submit && onSubmit) {
        if (!form.reportValidity()) return;
        try {
          const v = await onSubmit(form, dlg);
          if (v !== undefined) close(v);
        } catch (err) {
          toast(err.message || String(err), 'err', 5000);
        }
      } else close(a.value ?? null);
    };
    dlg.querySelectorAll('footer .btn').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); run(actions[+b.dataset.i]); }));
    form.addEventListener('submit', (e) => { e.preventDefault(); const a = actions.find((x) => x.submit); if (a) run(a); });
    dlg.showModal();
    onOpen?.(dlg, close);
  });
}

export const confirmBox = (title, message, okLabel = 'Confirm', danger = false) =>
  modal({ title, body: `<p>${message}</p>`, actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, kind: danger ? 'danger' : 'primary' }] });

// ---------- files ----------
export function download(filename, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.onchange = () => resolve(inp.files[0] || null);
    inp.click();
  });
}

// ---------- CSV ----------
export function toCSV(rows, columns) {
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join('; ') : v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [columns.map((c) => cell(c.label)).join(','), ...rows.map((r) => columns.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.k])).join(','))].join('\r\n');
}

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------- hover tooltips for any [data-tip] element ----------
export function initTooltips() {
  const tip = $('#tooltip');
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t) return;
    tip.innerHTML = t.dataset.tip;
    tip.hidden = false;
    const r = t.getBoundingClientRect();
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2))}px`;
    tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
  });
  document.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]')) tip.hidden = true; });
}

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
