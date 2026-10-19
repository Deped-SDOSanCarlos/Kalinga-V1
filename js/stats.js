// Aggregations for the dashboard and reports. Everything here is de-identified
// counts, so it is also what gets shared with the AI for reports.
import { db } from './db.js';
import { NUTRITION_STATUS, HFA_STATUS, formById, bmi, adultBmiClass, toothIndex } from './forms.js';
import { esc } from './ui.js';

export async function loadAll() {
  const [people, records, schools] = await Promise.all([db.all('people'), db.all('records'), db.all('schools')]);
  return { people, records, schools };
}

// Latest record of a form per person within a school year.
function latestBy(records, formId, sy) {
  const map = new Map();
  for (const r of records) {
    if (r.formId !== formId || (sy && r.schoolYear !== sy)) continue;
    const prev = map.get(r.personId);
    if (!prev || (r.examDate || '') > (prev.examDate || '')) map.set(r.personId, r);
  }
  return map;
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

export function computeStats({ people, records, schools }, { sy, schoolId } = {}) {
  const inScope = (p) => !schoolId || p.schoolId === schoolId;
  const personById = new Map(people.map((p) => [p.id, p]));
  const learners = people.filter((p) => p.type === 'learner' && inScope(p));
  const personnel = people.filter((p) => p.type === 'personnel' && inScope(p));
  const scopedRecords = records.filter((r) => { const p = personById.get(r.personId); return p && inScope(p) && (!sy || r.schoolYear === sy || !r.schoolYear); });

  const shd1 = latestBy(records, 'shd1', sy);
  const nutrition = Object.fromEntries(NUTRITION_STATUS.map((s) => [s, 0]));
  const hfa = Object.fromEntries(HFA_STATUS.map((s) => [s, 0]));
  let assessed = 0, sbfp = 0, dewormed = 0;
  for (const p of learners) {
    const r = shd1.get(p.id);
    if (!r) continue;
    if (r.data.nutritionalStatus) { nutrition[r.data.nutritionalStatus]++; assessed++; }
    if (r.data.heightForAge) hfa[r.data.heightForAge]++;
    if (r.data.sbfp === 'Yes') sbfp++;
    if (r.data.dewormed === 'Yes') dewormed++;
  }

  const ape = latestBy(records, 'cs86', sy);
  const adultBmi = { Underweight: 0, Normal: 0, Overweight: 0, Obese: 0 };
  let apeDone = 0, hypertensive = 0;
  for (const p of personnel) {
    const r = ape.get(p.id);
    if (!r) continue;
    apeDone++;
    const c = adultBmiClass(bmi(r.data.weightKg, r.data.heightCm));
    if (c) adultBmi[c]++;
    if (+r.data.bpSys >= 140 || +r.data.bpDia >= 90) hypertensive++;
  }

  const dental = latestBy(records, 'shd2b', sy);
  let dentalExamined = 0, dmftSum = 0, withCaries = 0;
  for (const p of learners) {
    const r = dental.get(p.id);
    if (!r) continue;
    dentalExamined++;
    const perm = parseInt(toothIndex(r.data.teeth, 'perm')) || 0;
    const total = perm + (parseInt(toothIndex(r.data.teeth, 'temp')) || 0);
    dmftSum += perm;
    if (total > 0) withCaries++;
  }

  const byForm = {};
  for (const r of scopedRecords) byForm[r.formId] = (byForm[r.formId] || 0) + 1;

  return {
    schoolYear: sy || 'all',
    school: schoolId ? schools.find((s) => s.id === schoolId)?.name : 'All schools',
    learners: learners.length,
    personnel: personnel.length,
    records: scopedRecords.length,
    pendingSignature: scopedRecords.filter((r) => r.status !== 'final' && formById(r.formId)?.signer !== 'any').length,
    learnerNutrition: { assessed, coveragePct: pct(assessed, learners.length), bmiForAge: nutrition, heightForAge: hfa, sbfpBeneficiaries: sbfp, dewormed, wastedOrSeverelyWastedPct: pct(nutrition.Wasted + nutrition['Severely wasted'], assessed), overweightOrObesePct: pct(nutrition.Overweight + nutrition.Obese, assessed) },
    personnelHealth: { annualPEDone: apeDone, apeCompliancePct: pct(apeDone, personnel.length), bmiCategories: adultBmi, bpAtOrAbove140over90: hypertensive },
    dental: { learnersExamined: dentalExamined, coveragePct: pct(dentalExamined, learners.length), meanDMFT: dentalExamined ? Math.round((dmftSum / dentalExamined) * 100) / 100 : 0, withCariesPct: pct(withCaries, dentalExamined) },
    recordsByForm: Object.fromEntries(Object.entries(byForm).map(([k, v]) => [formById(k)?.code || k, v])),
  };
}

export function perSchool(data, sy) {
  return data.schools.map((s) => ({ school: s, stats: computeStats(data, { sy, schoolId: s.id }) })).filter((x) => x.stats.learners || x.stats.personnel);
}

export function monthlyCounts(records, months = 12) {
  const out = [];
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-PH', { month: 'short' }), full: d.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }), value: 0 });
  }
  const idx = new Map(out.map((o, i) => [o.key, i]));
  for (const r of records) {
    const k = (r.examDate || r.createdAt || '').slice(0, 7);
    if (idx.has(k)) out[idx.get(k)].value++;
  }
  return out;
}

// ---------- charts (single-series, HTML/CSS, hover tooltips) ----------
export function barList(items, { unit = '', total } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const sum = total ?? items.reduce((a, b) => a + b.value, 0);
  return `<div class="barlist" role="table">${items.map((i) => {
    const share = sum ? Math.round((i.value / sum) * 1000) / 10 : 0;
    return `<div class="barlist-row" role="row" data-tip="<b>${esc(i.label)}</b><br>${i.value.toLocaleString()} ${esc(unit)} · ${share}%">
      <span class="barlist-label" role="cell">${esc(i.label)}</span>
      <span class="barlist-track"><span class="barlist-bar" style="width:${(i.value / max) * 100}%"></span></span>
      <span class="barlist-val" role="cell">${i.value.toLocaleString()}</span></div>`;
  }).join('')}</div>`;
}

export function columns(items, { unit = 'records' } = {}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const peak = items.reduce((a, b) => (b.value > a.value ? b : a), items[0]);
  return `<div class="cols" role="img" aria-label="Records per month">${items.map((i) => `
    <div class="col" data-tip="<b>${esc(i.full)}</b><br>${i.value.toLocaleString()} ${esc(unit)}">
      <span class="col-val">${i === peak && i.value ? i.value : ''}</span>
      <span class="col-bar" style="height:${Math.max(i.value ? 4 : 0, (i.value / max) * 100)}%"></span>
      <span class="col-label">${esc(i.label)}</span>
    </div>`).join('')}</div>`;
}
