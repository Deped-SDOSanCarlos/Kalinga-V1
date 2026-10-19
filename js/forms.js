// Form templates. Each schema drives data entry, printing, CSV export and AI
// Smart-Fill, so adding or adjusting a DepEd/CSC form only needs edits here.
//
// Field types: text, number, date, select, radio, checks, yesno, textarea,
// pe (physical-exam grid), odontogram (dental chart), computed (read-only).
// Optional field props: unit, span (1–4 grid columns), help, show(data, person).

// ---------- clinical helpers ----------
export function ageAt(birthdate, onDate) {
  if (!birthdate) return null;
  const b = new Date(birthdate), d = onDate ? new Date(onDate) : new Date();
  if (isNaN(b) || isNaN(d)) return null;
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
  if (d.getDate() < b.getDate()) months--;
  return months < 0 ? null : { years: Math.floor(months / 12), months: months % 12, total: months };
}
export const ageText = (a) => (a ? `${a.years} y ${a.months} m` : '');

export function bmi(weightKg, heightCm) {
  const w = parseFloat(weightKg), h = parseFloat(heightCm) / 100;
  if (!(w > 0) || !(h > 0)) return null;
  return Math.round((w / (h * h)) * 10) / 10;
}
// WHO adult BMI categories (≥ 20 years old). Learners use BMI-for-age instead.
export function adultBmiClass(v) {
  if (v == null) return '';
  if (v < 18.5) return 'Underweight';
  if (v < 25) return 'Normal';
  if (v < 30) return 'Overweight';
  return 'Obese';
}
export function bpClass(sys, dia) {
  sys = parseFloat(sys); dia = parseFloat(dia);
  if (!(sys > 0) || !(dia > 0)) return '';
  if (sys >= 180 || dia >= 120) return 'Hypertensive crisis';
  if (sys >= 140 || dia >= 90) return 'Stage 2 hypertension';
  if (sys >= 130 || dia >= 80) return 'Stage 1 hypertension';
  if (sys >= 120) return 'Elevated';
  return 'Normal';
}
export function daysInclusive(from, to) {
  const a = new Date(from), b = new Date(to);
  if (isNaN(a) || isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86400000) + 1;
}

export function currentSchoolYear(d = new Date()) {
  // Philippine school year starts around June–August.
  const y = d.getFullYear();
  return d.getMonth() >= 5 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// ---------- shared option lists ----------
export const NUTRITION_STATUS = ['Severely wasted', 'Wasted', 'Normal', 'Overweight', 'Obese'];
export const HFA_STATUS = ['Severely stunted', 'Stunted', 'Normal', 'Tall'];
const SEX = ['Male', 'Female'];
const PE_ROWS = ['General survey', 'Skin', 'Head & scalp', 'Eyes', 'Ears', 'Nose & sinuses', 'Mouth & throat', 'Neck & thyroid', 'Chest & lungs', 'Heart', 'Abdomen', 'Genitourinary', 'Extremities', 'Musculoskeletal / spine', 'Neurologic'];
const MED_HISTORY = ['Hypertension', 'Diabetes mellitus', 'Bronchial asthma', 'Pulmonary tuberculosis', 'Heart disease', 'Kidney disease', 'Liver disease / hepatitis', 'Thyroid disorder', 'Cancer', 'Stroke', 'Epilepsy / seizures', 'Mental health condition', 'Peptic ulcer disease', 'Allergies'];
const FAMILY_HISTORY = ['Hypertension', 'Diabetes mellitus', 'Heart disease', 'Stroke', 'Cancer', 'Bronchial asthma', 'Tuberculosis', 'Kidney disease', 'Mental health condition'];
const LEARNER_IMMUNIZATION = ['BCG', 'Pentavalent / DPT', 'OPV / IPV', 'Hepatitis B', 'Measles / MR / MMR', 'PCV', 'Td (Grade 1 / 7)', 'MR (Grade 1 / 7)', 'HPV (Grade 4 females)', 'COVID-19'];
const ADULT_IMMUNIZATION = ['COVID-19 primary series', 'COVID-19 booster', 'Influenza (this year)', 'Hepatitis B', 'Tetanus-diphtheria (Td)', 'Pneumococcal', 'HPV'];

const vitals = (withVision = true) => [
  { k: 'heightCm', label: 'Height', type: 'number', unit: 'cm', step: '0.1' },
  { k: 'weightKg', label: 'Weight', type: 'number', unit: 'kg', step: '0.1' },
  { k: 'bmi', label: 'BMI', type: 'computed', unit: 'kg/m²', compute: (d) => bmi(d.weightKg, d.heightCm) ?? '' },
  { k: 'bpSys', label: 'BP systolic', type: 'number', unit: 'mmHg' },
  { k: 'bpDia', label: 'BP diastolic', type: 'number', unit: 'mmHg' },
  { k: 'bpClass', label: 'BP category', type: 'computed', compute: (d) => bpClass(d.bpSys, d.bpDia) },
  { k: 'pulse', label: 'Pulse rate', type: 'number', unit: '/min' },
  { k: 'respRate', label: 'Respiratory rate', type: 'number', unit: '/min' },
  { k: 'temp', label: 'Temperature', type: 'number', unit: '°C', step: '0.1' },
  ...(withVision ? [
    { k: 'visionOD', label: 'Visual acuity OD (right)', type: 'text', help: 'e.g. 20/20' },
    { k: 'visionOS', label: 'Visual acuity OS (left)', type: 'text' },
    { k: 'hearing', label: 'Hearing', type: 'select', opts: ['Normal', 'Impaired – right', 'Impaired – left', 'Impaired – both'] },
  ] : []),
];

const examInfo = [
  { k: 'examDate', label: 'Date of examination', type: 'date', req: true },
  { k: 'schoolYear', label: 'School year', type: 'text', help: 'e.g. 2026-2027', default: () => currentSchoolYear() },
];

// ---------- the forms ----------
export const FORMS = [
  {
    id: 'cs86', code: 'CS Form 86', title: 'Health Examination Record', short: 'Annual Physical Exam',
    subject: 'personnel', category: 'Personnel', signer: 'medical', icon: 'stethoscope',
    description: 'Mandatory Annual Physical Examination of teaching and non-teaching personnel.',
    sections: [
      { title: 'Examination', fields: [...examInfo, { k: 'purpose', label: 'Purpose', type: 'select', opts: ['Annual Physical Examination', 'Pre-employment', 'Return to work', 'Others'], default: () => 'Annual Physical Examination' }] },
      { title: 'Vital signs & anthropometrics', fields: [...vitals(true), { k: 'bmiClass', label: 'BMI category (adult)', type: 'computed', compute: (d) => adultBmiClass(bmi(d.weightKg, d.heightCm)) }] },
      { title: 'Present complaints & history', fields: [
        { k: 'complaints', label: 'Present complaints', type: 'textarea', span: 4 },
        { k: 'history', label: 'Known conditions', type: 'checks', opts: MED_HISTORY, span: 4 },
        { k: 'medications', label: 'Maintenance medications', type: 'textarea', span: 4 },
      ] },
      { title: 'Physical examination', fields: [{ k: 'pe', label: 'Findings by system', type: 'pe', opts: PE_ROWS, span: 4 }] },
      { title: 'Laboratory & diagnostics', fields: [
        { k: 'cbc', label: 'Complete blood count', type: 'text', span: 2 },
        { k: 'urinalysis', label: 'Urinalysis', type: 'text', span: 2 },
        { k: 'cxr', label: 'Chest X-ray', type: 'text', span: 2 },
        { k: 'ecg', label: 'ECG', type: 'text', span: 2 },
        { k: 'fbs', label: 'Fasting blood sugar', type: 'text', unit: 'mg/dL' },
        { k: 'lipid', label: 'Lipid profile', type: 'text' },
        { k: 'otherLabs', label: 'Other tests', type: 'text', span: 2 },
      ] },
      { title: 'Assessment', fields: [
        { k: 'impression', label: 'Impression / diagnosis', type: 'textarea', span: 4 },
        { k: 'classification', label: 'Physical fitness classification', type: 'radio', opts: ['Class A – Physically fit', 'Class B – Fit, with minor condition', 'Class C – Fit, with condition needing treatment', 'Class D – Unfit / pending further evaluation'], span: 4 },
        { k: 'recommendations', label: 'Recommendations', type: 'textarea', span: 4 },
      ] },
    ],
  },
  {
    id: 'cs211', code: 'CS Form No. 211', title: 'Medical Certificate', short: 'Medical Certificate (Employment)',
    subject: 'personnel', category: 'Personnel', signer: 'medical', icon: 'certificate',
    description: 'Required for new hires, promotion, or re-employment. Must be signed by a government physician.',
    sections: [
      { title: 'Purpose', fields: [
        { k: 'examDate', label: 'Date of examination', type: 'date', req: true },
        { k: 'purpose', label: 'Purpose', type: 'radio', opts: ['Original appointment', 'Promotion', 'Re-employment', 'Transfer', 'Reclassification', 'Others'], span: 3, req: true },
        { k: 'purposeOther', label: 'If others, specify', type: 'text', span: 2, show: (d) => d.purpose === 'Others' },
        { k: 'positionApplied', label: 'Position applied for', type: 'text', span: 2 },
      ] },
      { title: 'Medical history', fields: [
        { k: 'history', label: 'Has had or has any of the following', type: 'checks', opts: MED_HISTORY, span: 4 },
        { k: 'historyDetails', label: 'Details / dates', type: 'textarea', span: 4 },
        { k: 'surgeries', label: 'Previous operations / hospitalizations', type: 'textarea', span: 4 },
      ] },
      { title: 'Physical examination', fields: [...vitals(true), { k: 'pe', label: 'Findings by system', type: 'pe', opts: PE_ROWS, span: 4 }] },
      { title: 'Laboratory results', fields: [
        { k: 'cxr', label: 'Chest X-ray', type: 'text', span: 2 },
        { k: 'cbc', label: 'CBC', type: 'text', span: 2 },
        { k: 'urinalysis', label: 'Urinalysis', type: 'text', span: 2 },
        { k: 'drugTest', label: 'Drug test', type: 'select', opts: ['Negative', 'Positive', 'Not done'] },
        { k: 'psychEval', label: 'Psychological evaluation', type: 'select', opts: ['Passed', 'Failed', 'Not done'] },
        { k: 'otherLabs', label: 'Other tests', type: 'text', span: 4 },
      ] },
      { title: 'Certification', fields: [
        { k: 'result', label: 'Result', type: 'radio', opts: ['Physically and mentally fit for employment', 'Fit, with remarks', 'Unfit for employment'], span: 4, req: true },
        { k: 'remarks', label: 'Remarks', type: 'textarea', span: 4 },
        { k: 'validUntil', label: 'Certificate valid until', type: 'date' },
      ] },
    ],
  },
  {
    id: 'cs41', code: 'CS Form 41', title: 'Medical Certificate (Sick Leave)', short: 'Medical Certificate for Leave',
    subject: 'personnel', category: 'Personnel', signer: 'medical', icon: 'calendar',
    description: 'Supports sick leave spanning more than five consecutive working days.',
    sections: [
      { title: 'Leave period', fields: [
        { k: 'examDate', label: 'Date of consultation', type: 'date', req: true },
        { k: 'leaveFrom', label: 'Leave from', type: 'date', req: true },
        { k: 'leaveTo', label: 'Leave to', type: 'date', req: true },
        { k: 'leaveDays', label: 'Number of days', type: 'computed', compute: (d) => daysInclusive(d.leaveFrom, d.leaveTo) ?? '' },
      ] },
      { title: 'Clinical information', fields: [
        { k: 'diagnosis', label: 'Diagnosis', type: 'textarea', span: 4, req: true },
        { k: 'treatment', label: 'Treatment / management given', type: 'textarea', span: 4 },
        { k: 'confined', label: 'Hospital confinement', type: 'yesno' },
        { k: 'facility', label: 'Hospital / clinic', type: 'text', span: 3, show: (d) => d.confined === 'Yes' },
      ] },
      { title: 'Recommendation', fields: [
        { k: 'restDays', label: 'Recommended rest', type: 'number', unit: 'days' },
        { k: 'fitToReturn', label: 'Fit to return to work on', type: 'date' },
        { k: 'remarks', label: 'Remarks', type: 'textarea', span: 4 },
      ] },
    ],
  },
  {
    id: 'pmh', code: 'PMHR', title: 'Personal Medical History Record', short: 'Personal Medical History',
    subject: 'personnel', category: 'Personnel', signer: 'any', icon: 'clipboard',
    description: 'Baseline health record updated yearly by all school personnel.',
    sections: [
      { title: 'Record year', fields: [...examInfo] },
      { title: 'Past medical history', fields: [
        { k: 'history', label: 'Conditions', type: 'checks', opts: MED_HISTORY, span: 4 },
        { k: 'historyOther', label: 'Other conditions', type: 'text', span: 4 },
        { k: 'surgeries', label: 'Operations / hospitalizations (year, reason)', type: 'textarea', span: 4 },
      ] },
      { title: 'Family history', fields: [{ k: 'family', label: 'Conditions in immediate family', type: 'checks', opts: FAMILY_HISTORY, span: 4 }] },
      { title: 'Allergies & medications', fields: [
        { k: 'allergyFood', label: 'Food allergies', type: 'text', span: 2 },
        { k: 'allergyDrug', label: 'Drug allergies', type: 'text', span: 2 },
        { k: 'medications', label: 'Current medications (name, dose, frequency)', type: 'textarea', span: 4 },
      ] },
      { title: 'Immunization', fields: [{ k: 'immunization', label: 'Received', type: 'checks', opts: ADULT_IMMUNIZATION, span: 4 }] },
      { title: 'Lifestyle', fields: [
        { k: 'smoking', label: 'Smoking / vaping', type: 'select', opts: ['Never', 'Former', 'Current'] },
        { k: 'packYears', label: 'Sticks per day', type: 'number', show: (d) => d.smoking === 'Current' },
        { k: 'alcohol', label: 'Alcohol', type: 'select', opts: ['None', 'Occasional', 'Weekly', 'Daily'] },
        { k: 'exercise', label: 'Exercise', type: 'select', opts: ['None', '1–2× a week', '3× or more a week'] },
      ] },
      { title: "Women's health", note: 'Female personnel only', show: (d, p) => p?.sex === 'Female', fields: [
        { k: 'lmp', label: 'Last menstrual period', type: 'date' },
        { k: 'gravida', label: 'Gravida', type: 'number' },
        { k: 'para', label: 'Para', type: 'number' },
        { k: 'pregnant', label: 'Currently pregnant', type: 'yesno' },
      ] },
      { title: 'Emergency contact', fields: [
        { k: 'emName', label: 'Name', type: 'text', span: 2 },
        { k: 'emRelation', label: 'Relationship', type: 'text' },
        { k: 'emPhone', label: 'Contact number', type: 'text' },
      ] },
    ],
  },
  {
    id: 'shd1', code: 'SHD Form 1', title: "Learner's School Health Record", short: 'Learner Health Record',
    subject: 'learner', category: 'Learner', signer: 'any', icon: 'apple',
    description: "Tracks a learner's physical check-ups, immunizations and nutritional status.",
    sections: [
      { title: 'Examination', fields: [...examInfo, { k: 'gradeLevel', label: 'Grade level at exam', type: 'select', opts: ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
        { k: 'age', label: 'Age at exam', type: 'computed', compute: (d, p) => ageText(ageAt(p?.birthdate, d.examDate)) }] },
      { title: 'Anthropometrics & nutritional status', fields: [
        { k: 'heightCm', label: 'Height', type: 'number', unit: 'cm', step: '0.1' },
        { k: 'weightKg', label: 'Weight', type: 'number', unit: 'kg', step: '0.1' },
        { k: 'bmi', label: 'BMI', type: 'computed', unit: 'kg/m²', compute: (d) => bmi(d.weightKg, d.heightCm) ?? '' },
        { k: 'nutritionalStatus', label: 'BMI-for-age status', type: 'select', opts: NUTRITION_STATUS, help: 'Read from the WHO BMI-for-age table for the learner’s age and sex.' },
        { k: 'heightForAge', label: 'Height-for-age status', type: 'select', opts: HFA_STATUS },
        { k: 'temp', label: 'Temperature', type: 'number', unit: '°C', step: '0.1' },
        { k: 'pulse', label: 'Pulse rate', type: 'number', unit: '/min' },
        { k: 'respRate', label: 'Respiratory rate', type: 'number', unit: '/min' },
      ] },
      { title: 'Screening', fields: [
        { k: 'vision', label: 'Vision screening', type: 'select', opts: ['Passed', 'Failed – refer'] },
        { k: 'auditory', label: 'Auditory screening', type: 'select', opts: ['Passed', 'Failed – refer'] },
        { k: 'skinScalp', label: 'Skin / scalp', type: 'select', opts: ['Normal', 'Pediculosis', 'Scabies', 'Fungal infection', 'Wound / lesion', 'Others'] },
        { k: 'eyesEarsNose', label: 'Eyes / ears / nose', type: 'select', opts: ['Normal', 'Eye discharge / redness', 'Ear discharge', 'Nasal discharge', 'Others'] },
        { k: 'mouthThroat', label: 'Mouth / throat / neck', type: 'select', opts: ['Normal', 'Enlarged tonsils', 'Enlarged lymph nodes', 'Goiter', 'Others'] },
        { k: 'heartLungs', label: 'Heart / lungs', type: 'select', opts: ['Normal', 'Murmur', 'Wheezes / rales', 'Others'] },
        { k: 'abdomen', label: 'Abdomen', type: 'select', opts: ['Normal', 'Distended', 'Tender', 'Others'] },
        { k: 'deformities', label: 'Deformities', type: 'select', opts: ['None', 'Congenital', 'Acquired'] },
        { k: 'screeningNotes', label: 'Findings / notes', type: 'textarea', span: 4 },
      ] },
      { title: 'Health programs', fields: [
        { k: 'ironSupp', label: 'Iron supplementation', type: 'yesno' },
        { k: 'dewormed', label: 'Dewormed', type: 'yesno' },
        { k: 'dewormDate', label: 'Deworming date', type: 'date', show: (d) => d.dewormed === 'Yes' },
        { k: 'sbfp', label: 'SBFP beneficiary', type: 'yesno' },
        { k: 'fourPs', label: '4Ps beneficiary', type: 'yesno' },
        { k: 'immunization', label: 'Immunizations received', type: 'checks', opts: LEARNER_IMMUNIZATION, span: 4 },
        { k: 'menarche', label: 'Menarche', type: 'yesno', show: (d, p) => p?.sex === 'Female' },
      ] },
      { title: 'Remarks', fields: [{ k: 'remarks', label: 'Remarks / referrals', type: 'textarea', span: 4 }] },
    ],
  },
  {
    id: 'shd2b', code: 'SHD Form 2B', title: 'Dental Health Record', short: 'Dental Health Record',
    subject: 'learner', category: 'Learner', signer: 'dental', icon: 'tooth',
    description: 'Oral examination with tooth chart, indices and services rendered.',
    sections: [
      { title: 'Examination', fields: [...examInfo] },
      { title: 'Tooth chart', note: 'Click a tooth to cycle: Sound → Decayed → Missing → Filled → For extraction', fields: [{ k: 'teeth', label: 'Odontogram', type: 'odontogram', span: 4 }] },
      { title: 'Indices & oral condition', fields: [
        { k: 'dmft', label: 'DMFT (permanent)', type: 'computed', compute: (d) => toothIndex(d.teeth, 'perm') },
        { k: 'dft', label: 'dft (temporary)', type: 'computed', compute: (d) => toothIndex(d.teeth, 'temp') },
        { k: 'oralHygiene', label: 'Oral hygiene', type: 'select', opts: ['Good', 'Fair', 'Poor'] },
        { k: 'gingiva', label: 'Gingiva', type: 'select', opts: ['Healthy', 'Gingivitis', 'Periodontitis'] },
        { k: 'debris', label: 'Debris / plaque', type: 'yesno' },
        { k: 'calculus', label: 'Calculus', type: 'yesno' },
        { k: 'malocclusion', label: 'Malocclusion', type: 'yesno' },
        { k: 'oralLesions', label: 'Oral lesions', type: 'text' },
      ] },
      { title: 'Services rendered', fields: [
        { k: 'services', label: 'Services', type: 'checks', opts: ['Oral examination', 'Oral prophylaxis', 'Fluoride varnish', 'Pit & fissure sealant', 'Atraumatic restorative treatment (ART)', 'Permanent filling', 'Temporary filling', 'Extraction', 'Toothbrushing drill', 'Oral health education', 'Referred'], span: 4 },
        { k: 'remarks', label: 'Remarks', type: 'textarea', span: 4 },
      ] },
    ],
  },
  {
    id: 'shd3b', code: 'SHD Form 3B', title: 'Dental Referral Slip', short: 'Dental Referral',
    subject: 'learner', category: 'Learner', signer: 'dental', icon: 'referral',
    description: 'Official referral of a learner for dental treatment, with return slip.',
    sections: [
      { title: 'Referral', fields: [
        { k: 'examDate', label: 'Date of referral', type: 'date', req: true },
        { k: 'referredTo', label: 'Referred to (facility / dentist)', type: 'text', span: 3, req: true },
        { k: 'reasons', label: 'Reason for referral', type: 'checks', opts: ['Extraction', 'Restoration / filling', 'Root canal treatment', 'Oral surgery', 'Orthodontic evaluation', 'Periodontal treatment', 'Dental abscess / infection', 'Trauma / fracture', 'Oral lesion evaluation'], span: 4 },
        { k: 'findings', label: 'Findings (tooth numbers, condition)', type: 'textarea', span: 4 },
        { k: 'urgency', label: 'Urgency', type: 'radio', opts: ['Routine', 'Urgent', 'Emergency'], span: 2 },
      ] },
      { title: 'Return slip (to be filled by receiving facility)', fields: [
        { k: 'dateSeen', label: 'Date seen', type: 'date' },
        { k: 'actionTaken', label: 'Action taken', type: 'textarea', span: 3 },
        { k: 'followUp', label: 'Recommendation / follow-up', type: 'textarea', span: 4 },
        { k: 'receivingDentist', label: 'Attending dentist', type: 'text', span: 2 },
      ] },
    ],
  },
  {
    id: 'mcf3', code: 'MCForm-3', title: 'Palaro Medical Certificate', short: 'Fit to Play (Palaro)',
    subject: 'learner', category: 'Learner', signer: 'medical', icon: 'medal',
    description: '“Fit to Play” clearance for student-athletes joining sports meets.',
    sections: [
      { title: 'Event', fields: [
        { k: 'examDate', label: 'Date of examination', type: 'date', req: true },
        { k: 'meet', label: 'Sports meet', type: 'select', opts: ['District Meet', 'Division Meet', 'Regional Meet', 'Palarong Pambansa', 'Others'] },
        { k: 'sport', label: 'Sport / event', type: 'text' },
        { k: 'division', label: 'Category', type: 'select', opts: ['Elementary', 'Secondary', 'Para Games'] },
      ] },
      { title: 'Pre-participation history', fields: [
        { k: 'redFlags', label: 'Has the athlete ever had', type: 'checks', opts: ['Chest pain on exertion', 'Fainting / near-fainting during exercise', 'Shortness of breath out of proportion to effort', 'Palpitations / irregular heartbeat', 'Known heart murmur or heart disease', 'Family history of sudden death < 50 y', 'Asthma / exercise-induced wheeze', 'Seizures', 'Concussion / head injury', 'Fracture / dislocation', 'Recent surgery', 'Heat illness'], span: 4 },
        { k: 'historyDetails', label: 'Details', type: 'textarea', span: 4 },
        { k: 'medications', label: 'Current medications', type: 'text', span: 4 },
      ] },
      { title: 'Physical examination', fields: [...vitals(true), { k: 'pe', label: 'Findings by system', type: 'pe', opts: ['General survey', 'Eyes', 'Chest & lungs', 'Heart', 'Abdomen', 'Musculoskeletal / spine', 'Upper extremities', 'Lower extremities', 'Neurologic'], span: 4 }] },
      { title: 'Clearance', fields: [
        { k: 'ecg', label: 'ECG (if indicated)', type: 'text', span: 2 },
        { k: 'clearance', label: 'Clearance', type: 'radio', opts: ['Fit to play – no restriction', 'Fit to play – with restriction', 'Not fit to play', 'Pending further evaluation'], span: 4, req: true },
        { k: 'restrictions', label: 'Restrictions / recommendations', type: 'textarea', span: 4 },
        { k: 'validUntil', label: 'Valid until', type: 'date' },
      ] },
    ],
  },
];

export const formById = (id) => FORMS.find((f) => f.id === id);
export const formsFor = (subject) => FORMS.filter((f) => f.subject === subject);
export const allFields = (form) => form.sections.flatMap((s) => s.fields);

// ---------- odontogram (FDI numbering) ----------
export const TEETH = {
  permUpper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  permLower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
  tempUpper: [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  tempLower: [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
};
export const TOOTH_STATES = ['', 'D', 'M', 'F', 'X']; // sound, decayed, missing, filled, for extraction
export const TOOTH_LABEL = { '': 'Sound', D: 'Decayed', M: 'Missing', F: 'Filled', X: 'For extraction' };

export function toothIndex(teeth, kind) {
  if (!teeth || typeof teeth !== 'object') return '';
  const isTemp = (n) => Math.floor(n / 10) >= 5;
  let d = 0, m = 0, f = 0;
  for (const [num, s] of Object.entries(teeth)) {
    if (isTemp(+num) !== (kind === 'temp')) continue;
    if (s === 'D' || s === 'X') d++;
    else if (s === 'M' && kind === 'perm') m++; // missing primary teeth are usually exfoliated, so not counted
    else if (s === 'F') f++;
  }
  const total = d + m + f;
  return kind === 'perm' ? `${total} (D${d} M${m} F${f})` : `${total} (d${d} f${f})`;
}

// Evaluate computed fields and return a complete copy of the data.
export function withComputed(form, data, person) {
  const out = { ...data };
  for (const f of allFields(form)) if (f.type === 'computed') out[f.k] = f.compute(out, person);
  return out;
}

export function missingRequired(form, data, person) {
  const missing = [];
  for (const s of form.sections) {
    if (s.show && !s.show(data, person)) continue;
    for (const f of s.fields) {
      if (!f.req || (f.show && !f.show(data, person))) continue;
      const v = data[f.k];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) missing.push(f.label);
    }
  }
  return missing;
}

// Fields describing a person, used by people screens, CSV import/export and print headers.
export const PERSON_FIELDS = {
  personnel: [
    { k: 'employeeNo', label: 'Employee No.' }, { k: 'lastName', label: 'Last name', req: true }, { k: 'firstName', label: 'First name', req: true },
    { k: 'middleName', label: 'Middle name' }, { k: 'suffix', label: 'Suffix' }, { k: 'sex', label: 'Sex', type: 'select', opts: SEX, req: true },
    { k: 'birthdate', label: 'Birthdate', type: 'date' }, { k: 'civilStatus', label: 'Civil status', type: 'select', opts: ['Single', 'Married', 'Widowed', 'Separated'] },
    { k: 'position', label: 'Position / designation' }, { k: 'bloodType', label: 'Blood type', type: 'select', opts: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    { k: 'contact', label: 'Contact number' }, { k: 'address', label: 'Address', span: 2 },
  ],
  learner: [
    { k: 'lrn', label: 'LRN' }, { k: 'lastName', label: 'Last name', req: true }, { k: 'firstName', label: 'First name', req: true },
    { k: 'middleName', label: 'Middle name' }, { k: 'suffix', label: 'Suffix' }, { k: 'sex', label: 'Sex', type: 'select', opts: SEX, req: true },
    { k: 'birthdate', label: 'Birthdate', type: 'date' }, { k: 'gradeLevel', label: 'Grade level', type: 'select', opts: ['Kinder', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'] },
    { k: 'section', label: 'Section' }, { k: 'guardian', label: 'Parent / guardian' }, { k: 'contact', label: 'Contact number' }, { k: 'address', label: 'Address', span: 2 },
  ],
};

export const fullName = (p) => (p ? [p.lastName && `${p.lastName},`, p.firstName, p.middleName && `${p.middleName[0]}.`, p.suffix].filter(Boolean).join(' ') : '—');
