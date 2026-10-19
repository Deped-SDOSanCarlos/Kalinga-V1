// Renders a form schema as an editable form, reads it back, and produces the
// printable document.
import { esc, fmtDate } from './ui.js';
import { allFields, withComputed, TEETH, TOOTH_STATES, TOOTH_LABEL, fullName, ageAt, ageText } from './forms.js';

const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

// ================= editor =================
export function renderEditor(form, data, person, { readonly = false } = {}) {
  data = withComputed(form, data, person);
  return form.sections.map((s, i) => `
    <section class="fsec" data-sec="${i}" ${s.show && !s.show(data, person) ? 'hidden' : ''}>
      <header><span class="fsec-num">${String(i + 1).padStart(2, '0')}</span><h3>${esc(s.title)}</h3>${s.note ? `<p class="muted">${esc(s.note)}</p>` : ''}</header>
      <div class="fgrid">${s.fields.map((f) => fieldHTML(f, data, person, readonly)).join('')}</div>
    </section>`).join('');
}

function fieldHTML(f, data, person, ro) {
  const v = data[f.k];
  const hidden = f.show && !f.show(data, person);
  const dis = ro ? 'disabled' : '';
  const id = `f_${f.k}`;
  const unit = f.unit ? `<span class="unit">${esc(f.unit)}</span>` : '';
  let control = '';
  switch (f.type) {
    case 'textarea':
      control = `<textarea id="${id}" name="${f.k}" rows="3" ${dis}>${esc(v)}</textarea>`; break;
    case 'number':
      control = `<div class="with-unit"><input id="${id}" name="${f.k}" type="number" inputmode="decimal" step="${f.step || 'any'}" value="${esc(v)}" ${dis}>${unit}</div>`; break;
    case 'date':
      control = `<input id="${id}" name="${f.k}" type="date" value="${esc(v)}" ${dis}>`; break;
    case 'select':
      control = `<select id="${id}" name="${f.k}" ${dis}><option value="">—</option>${f.opts.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
    case 'radio':
    case 'yesno': {
      const opts = f.type === 'yesno' ? ['Yes', 'No'] : f.opts;
      control = `<div class="chips" role="radiogroup">${opts.map((o) => `<label class="chip"><input type="radio" name="${f.k}" value="${esc(o)}" ${o === v ? 'checked' : ''} ${dis}><span>${esc(o)}</span></label>`).join('')}</div>`; break;
    }
    case 'checks': {
      const set = new Set(Array.isArray(v) ? v : []);
      control = `<div class="chips">${f.opts.map((o) => `<label class="chip"><input type="checkbox" name="${f.k}" value="${esc(o)}" ${set.has(o) ? 'checked' : ''} ${dis}><span>${esc(o)}</span></label>`).join('')}</div>`; break;
    }
    case 'pe': {
      const pe = v && typeof v === 'object' ? v : {};
      control = `<div class="pe" data-pe="${f.k}">
        <div class="pe-row pe-head"><span>System</span><span>Status</span><span>Findings</span></div>
        ${f.opts.map((row, i) => {
          const r = pe[row] || {};
          return `<div class="pe-row" data-row="${esc(row)}"><span>${esc(row)}</span>
            <div class="seg">${['Normal', 'Abnormal'].map((s) => `<label><input type="radio" name="pe_${f.k}_${i}" value="${s}" ${r.s === s ? 'checked' : ''} ${dis}><span>${s}</span></label>`).join('')}</div>
            <input type="text" class="pe-f" value="${esc(r.f)}" placeholder="${r.s === 'Abnormal' ? 'Describe finding' : ''}" ${dis}></div>`;
        }).join('')}
        ${ro ? '' : '<button type="button" class="btn ghost sm" data-pe-all>Mark all unmarked as Normal</button>'}
      </div>`; break;
    }
    case 'odontogram':
      control = `<div class="odonto" data-odonto="${f.k}"><input type="hidden" name="${f.k}" value="${esc(JSON.stringify(v || {}))}">${odontoHTML(v || {}, ro)}</div>`; break;
    case 'computed':
      control = `<output id="${id}" data-computed="${f.k}" class="computed">${esc(v === '' || v == null ? '—' : v)}</output>${unit}`; break;
    default:
      control = `<input id="${id}" name="${f.k}" type="text" value="${esc(v)}" autocomplete="off" ${dis}>`;
  }
  const wide = ['pe', 'odontogram'].includes(f.type) ? 4 : f.span || 1;
  return `<div class="field span-${wide} t-${f.type}" data-k="${f.k}" ${hidden ? 'hidden' : ''}>
    ${f.type === 'pe' || f.type === 'odontogram' ? '' : `<label for="${id}">${esc(f.label)}${f.req ? ' <b class="req">*</b>' : ''}</label>`}
    ${control}${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}</div>`;
}

function odontoHTML(teeth, ro) {
  const row = (nums) => `<div class="teeth">${nums.map((n) => {
    const s = teeth[n] || '';
    return `<button type="button" class="tooth s-${s || 'ok'}" data-tooth="${n}" ${ro ? 'disabled' : ''} data-tip="${n} · ${TOOTH_LABEL[s]}" aria-label="Tooth ${n}: ${TOOTH_LABEL[s]}"><b>${s || ''}</b><small>${n}</small></button>`;
  }).join('')}</div>`;
  return `<div class="odonto-arch"><span class="arch-label">Permanent</span>${row(TEETH.permUpper)}${row(TEETH.permLower)}</div>
    <div class="odonto-arch temp"><span class="arch-label">Temporary</span>${row(TEETH.tempUpper)}${row(TEETH.tempLower)}</div>
    <div class="odonto-legend">${TOOTH_STATES.map((s) => `<span><i class="tooth-dot s-${s || 'ok'}"></i>${TOOTH_LABEL[s]}</span>`).join('')}</div>`;
}

// Wire live behaviour (computed fields, conditional visibility, PE shortcuts, tooth chart).
export function bindEditor(root, form, getPerson, onChange) {
  const refresh = () => {
    const data = withComputed(form, collect(root, form), getPerson());
    const person = getPerson();
    for (const f of allFields(form)) {
      const wrap = root.querySelector(`.field[data-k="${f.k}"]`);
      if (f.show && wrap) wrap.hidden = !f.show(data, person);
      if (f.type === 'computed') {
        const out = root.querySelector(`[data-computed="${f.k}"]`);
        if (out) out.textContent = data[f.k] === '' || data[f.k] == null ? '—' : data[f.k];
      }
    }
    form.sections.forEach((s, i) => { if (s.show) root.querySelector(`.fsec[data-sec="${i}"]`).hidden = !s.show(data, person); });
    onChange?.(data);
  };
  root.addEventListener('input', refresh);
  root.addEventListener('change', refresh);
  root.addEventListener('click', (e) => {
    const all = e.target.closest('[data-pe-all]');
    if (all) {
      all.closest('.pe').querySelectorAll('.pe-row[data-row]').forEach((r) => {
        if (!r.querySelector('input[type=radio]:checked')) r.querySelector('input[value=Normal]').checked = true;
      });
      refresh();
    }
    const tooth = e.target.closest('[data-tooth]');
    if (tooth) {
      const box = tooth.closest('[data-odonto]');
      const hidden = box.querySelector('input[type=hidden]');
      const teeth = JSON.parse(hidden.value || '{}');
      const n = tooth.dataset.tooth;
      const next = TOOTH_STATES[(TOOTH_STATES.indexOf(teeth[n] || '') + 1) % TOOTH_STATES.length];
      if (next) teeth[n] = next; else delete teeth[n];
      hidden.value = JSON.stringify(teeth);
      tooth.className = `tooth s-${next || 'ok'}`;
      tooth.querySelector('b').textContent = next;
      tooth.dataset.tip = `${n} · ${TOOTH_LABEL[next]}`;
      refresh();
    }
  });
  return refresh;
}

// Read the form back into a plain data object.
export function collect(root, form) {
  const data = {};
  for (const f of allFields(form)) {
    if (f.type === 'computed') continue;
    if (f.type === 'checks') {
      data[f.k] = [...root.querySelectorAll(`input[name="${f.k}"]:checked`)].map((i) => i.value);
    } else if (f.type === 'radio' || f.type === 'yesno') {
      data[f.k] = root.querySelector(`input[name="${f.k}"]:checked`)?.value || '';
    } else if (f.type === 'pe') {
      const pe = {};
      root.querySelectorAll(`[data-pe="${f.k}"] .pe-row[data-row]`).forEach((r) => {
        const s = r.querySelector('input[type=radio]:checked')?.value || '';
        const fnd = r.querySelector('.pe-f').value.trim();
        if (s || fnd) pe[r.dataset.row] = { s, f: fnd };
      });
      data[f.k] = pe;
    } else if (f.type === 'odontogram') {
      try { data[f.k] = JSON.parse(root.querySelector(`input[name="${f.k}"]`).value || '{}'); } catch { data[f.k] = {}; }
    } else {
      const el = root.querySelector(`[name="${f.k}"]`);
      if (!el) continue;
      data[f.k] = f.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim();
    }
  }
  return data;
}

// Put values (e.g. from AI Smart-Fill) into the form without touching other fields.
export function applyValues(root, form, values) {
  let n = 0;
  for (const f of allFields(form)) {
    const v = values[f.k];
    if (v == null || v === '' || f.type === 'computed') continue;
    if (f.type === 'checks' && Array.isArray(v)) {
      root.querySelectorAll(`input[name="${f.k}"]`).forEach((i) => { if (v.includes(i.value)) { i.checked = true; n++; } });
    } else if (f.type === 'radio' || f.type === 'yesno') {
      const i = [...root.querySelectorAll(`input[name="${f.k}"]`)].find((x) => x.value === v);
      if (i) { i.checked = true; n++; }
    } else if (f.type === 'pe' && typeof v === 'object') {
      root.querySelectorAll(`[data-pe="${f.k}"] .pe-row[data-row]`).forEach((r) => {
        const item = v[r.dataset.row];
        if (!item) return;
        const radio = r.querySelector(`input[value="${item.s}"]`);
        if (radio) radio.checked = true;
        if (item.f) r.querySelector('.pe-f').value = item.f;
        n++;
      });
    } else {
      const el = root.querySelector(`[name="${f.k}"]`);
      if (el && el.type !== 'hidden') { el.value = v; el.classList.add('ai-filled'); n++; }
    }
  }
  root.dispatchEvent(new Event('change', { bubbles: true }));
  return n;
}

// ================= print =================
const box = (on) => `<span class="cb">${on ? '✓' : ''}</span>`;

function printValue(f, v, blank) {
  if (blank) {
    if (f.type === 'checks' || f.type === 'radio') return `<div class="p-opts">${f.opts.map((o) => `<span>${box(false)} ${esc(o)}</span>`).join('')}</div>`;
    if (f.type === 'yesno') return `<span>${box(false)} Yes</span> <span>${box(false)} No</span>`;
    if (f.type === 'textarea') return '<div class="p-lines"></div>';
    return `<span class="p-blank"></span>${f.unit ? ` ${esc(f.unit)}` : ''}`;
  }
  if (f.type === 'checks') { const set = new Set(v || []); return `<div class="p-opts">${f.opts.map((o) => `<span>${box(set.has(o))} ${esc(o)}</span>`).join('')}</div>`; }
  if (f.type === 'radio') return `<div class="p-opts">${f.opts.map((o) => `<span>${box(o === v)} ${esc(o)}</span>`).join('')}</div>`;
  if (f.type === 'yesno') return `<span>${box(v === 'Yes')} Yes</span> <span>${box(v === 'No')} No</span>`;
  if (f.type === 'date') return esc(fmtDate(v));
  if (v === '' || v == null) return '<span class="p-empty">—</span>';
  return `${esc(v).replace(/\n/g, '<br>')}${f.unit ? ` ${esc(f.unit)}` : ''}`;
}

function printPE(f, pe, blank) {
  pe = pe || {};
  return `<table class="p-table"><thead><tr><th>System</th><th>Normal</th><th>Abnormal</th><th>Findings</th></tr></thead><tbody>
    ${f.opts.map((row) => { const r = blank ? {} : pe[row] || {}; return `<tr><td>${esc(row)}</td><td class="c">${box(r.s === 'Normal')}</td><td class="c">${box(r.s === 'Abnormal')}</td><td>${esc(r.f || '')}</td></tr>`; }).join('')}
  </tbody></table>`;
}

function printOdonto(teeth, blank) {
  teeth = blank ? {} : teeth || {};
  const row = (nums) => `<tr>${nums.map((n) => `<td><b>${esc(teeth[n] || '')}</b><small>${n}</small></td>`).join('')}</tr>`;
  return `<table class="p-teeth"><tbody>${row(TEETH.permUpper)}${row(TEETH.permLower)}</tbody></table>
    <table class="p-teeth temp"><tbody>${row(TEETH.tempUpper)}${row(TEETH.tempLower)}</tbody></table>
    <p class="p-legend">Legend: D – Decayed · M – Missing · F – Filled · X – For extraction · blank – Sound</p>`;
}

// Certification sentences printed above the signature for certificate forms.
function statement(form, data, person) {
  const name = person ? `<b>${esc([person.firstName, person.middleName, person.lastName, person.suffix].filter(Boolean).join(' '))}</b>` : '______________________';
  switch (form.id) {
    case 'cs211': return `This is to certify that I have personally examined ${name} and that, based on the findings above, the examinee is found <b>${esc(data.result || '______________________')}</b>.`;
    case 'cs41': return `This is to certify that ${name} was examined / treated by the undersigned and was ill and unable to report for work from <b>${esc(fmtDate(data.leaveFrom) || '________')}</b> to <b>${esc(fmtDate(data.leaveTo) || '________')}</b>${data.leaveDays ? ` (<b>${esc(data.leaveDays)}</b> day/s)` : ''}.`;
    case 'mcf3': return `This is to certify that ${name} has been examined and is <b>${esc(data.clearance || '______________________')}</b>${data.sport ? ` in <b>${esc(data.sport)}</b>` : ''}.`;
    default: return '';
  }
}

export function renderPrint({ form, record, person, school, settings, blank = false }) {
  const data = blank ? {} : withComputed(form, record?.data || {}, person);
  const s = settings || {};
  const p = blank ? null : person;
  const age = p ? ageText(ageAt(p.birthdate, data.examDate)) : '';
  const idRows = form.subject === 'personnel'
    ? [['Name', p ? fullName(p) : ''], ['Employee No.', p?.employeeNo], ['Sex', p?.sex], ['Birthdate / Age', p ? `${fmtDate(p.birthdate)}${age ? ` · ${age}` : ''}` : ''], ['Position', p?.position], ['Station / School', school?.name], ['Civil status', p?.civilStatus], ['Blood type', p?.bloodType]]
    : [['Name of learner', p ? fullName(p) : ''], ['LRN', p?.lrn], ['Sex', p?.sex], ['Birthdate / Age', p ? `${fmtDate(p.birthdate)}${age ? ` · ${age}` : ''}` : ''], ['Grade & section', p ? [data.gradeLevel || p.gradeLevel, p.section].filter(Boolean).join(' – ') : ''], ['School', school?.name], ['Parent / guardian', p?.guardian], ['Contact no.', p?.contact]];

  const sections = form.sections.filter((sec) => blank || !sec.show || sec.show(data, p)).map((sec, i) => {
    const fields = sec.fields.filter((f) => blank || !f.show || f.show(data, p));
    const body = fields.map((f) => {
      if (f.type === 'pe') return `<div class="p-full">${printPE(f, data[f.k], blank)}</div>`;
      if (f.type === 'odontogram') return `<div class="p-full">${printOdonto(data[f.k], blank)}</div>`;
      const full = ['checks', 'radio', 'textarea'].includes(f.type) || (f.span || 1) >= 3;
      return `<div class="p-cell ${full ? 'p-full' : ''}"><span class="p-label">${esc(f.label)}</span><span class="p-val">${printValue(f, data[f.k], blank)}</span></div>`;
    }).join('');
    return `<section class="p-sec"><h2>${roman[i]}. ${esc(sec.title)}</h2><div class="p-grid">${body}</div></section>`;
  }).join('');

  const signed = !blank && record?.status === 'final' ? record.signedBy : null;
  const signerTitle = form.signer === 'dental' ? 'Dentist' : form.signer === 'medical' ? 'Physician' : 'Examiner / School Health Personnel';
  const stmt = statement(form, data, p);
  return `
  <article class="doc ${!blank && record?.status !== 'final' ? 'is-draft' : ''}">
    <header class="doc-head">
      ${s.logo ? `<img src="${esc(s.logo)}" alt="" class="doc-logo">` : '<div class="doc-logo ph"></div>'}
      <div class="doc-org">
        <div>Republic of the Philippines</div>
        <div class="doc-dep">Department of Education</div>
        <div>${esc(s.region || 'Region ____')}</div>
        <div class="doc-div">Schools Division Office of ${esc(s.division || '____________')}</div>
        <div class="doc-addr">${esc(s.address || '')}</div>
      </div>
      <div class="doc-code">${esc(form.code)}</div>
    </header>
    <h1 class="doc-title">${esc(form.title)}</h1>
    ${s.unit ? `<p class="doc-sub">${esc(s.unit)}</p>` : ''}
    <table class="p-id"><tbody>${idRows.reduce((acc, r, i) => acc + (i % 2 === 0 ? '<tr>' : '') + `<th>${esc(r[0])}</th><td>${esc(r[1] || '')}</td>` + (i % 2 === 1 ? '</tr>' : ''), '')}</tbody></table>
    ${sections}
    ${stmt ? `<p class="p-stmt">${stmt}</p>` : ''}
    <div class="p-sign">
      <div class="sig">
        <div class="sig-line">${signed ? `<span class="sig-name">${esc(signed.name)}</span>` : ''}</div>
        <div class="sig-cap">${signerTitle} — signature over printed name</div>
        <div class="sig-meta">License No.: ${esc(signed?.license || '____________')} &nbsp; Date: ${esc(signed ? fmtDate(signed.at) : '____________')}</div>
      </div>
      <div class="sig">
        <div class="sig-line"></div>
        <div class="sig-cap">${form.subject === 'learner' ? 'Parent / guardian' : 'Examinee'} — signature over printed name</div>
      </div>
    </div>
    <footer class="doc-foot">${blank ? 'Blank template' : `Record ${esc(record.id.slice(0, 8).toUpperCase())} · ${record.status === 'final' ? 'Finalized' : `DRAFT${form.signer === 'any' ? '' : ` – not valid until signed by the ${signerTitle.toLowerCase()}`}`}`} · Printed ${esc(new Date().toLocaleDateString('en-PH'))} · Kalinga MDNIS</footer>
  </article>`;
}
