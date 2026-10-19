// Claude integration. Runs in the browser with the division's own API key,
// stored in this device's database (Settings → AI).
import Anthropic from '../vendor/anthropic.mjs';
import { getSetting } from './db.js';
import { allFields, withComputed, formById, ageAt } from './forms.js';

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — most capable (recommended)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — faster, lower cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — fastest, lowest cost' },
];

const SYSTEM = `You are the clinical documentation assistant inside Kalinga, the Medical-Dental and Nutrition Information System of a DepEd Schools Division in the Philippines. Your users are division and school physicians, dentists and nurses.

- Follow Philippine DepEd, DOH and Civil Service Commission conventions (e.g. SBFP, WHO BMI-for-age for learners, Annual Physical Examination for personnel).
- You support clinicians; you do not replace their judgment. Point out findings that need follow-up or referral, but leave diagnosis and fitness decisions to the signing physician or dentist.
- Records you receive are de-identified. Do not ask for names or other identifiers.
- Write in clear, professional English. Use short sections and bullet points. Keep answers concise unless asked for a full document.`;

export class AIError extends Error {}

async function setup() {
  const apiKey = await getSetting('apiKey');
  if (!apiKey) throw new AIError('AI is not set up yet. An administrator can add an Anthropic API key in Settings → AI.');
  const model = await getSetting('aiModel', MODELS[0].id);
  return { client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 }), model };
}

// Requests go through the beta endpoint so Opus/Sonnet can use server-side
// refusal fallbacks ("default" routing picks the fallback model).
function params(model, effort, extra) {
  const p = { model, output_config: { effort }, system: SYSTEM, ...extra };
  if (model !== 'claude-haiku-5-5') {
    p.betas = ['server-side-fallback-2026-07-01'];
    p.fallbacks = 'default';
  }
  return p;
}

const textOf = (msg) => msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');

function checkStop(msg) {
  if (msg.stop_reason === 'refusal') throw new AIError('The AI declined this request. Rephrase it or complete the form manually.');
  if (msg.stop_reason === 'max_tokens') throw new AIError('The AI response was cut off. Try a shorter input.');
}

export function friendlyError(err) {
  if (err instanceof AIError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return 'The Anthropic API key was rejected. Check it in Settings → AI.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use the selected model.';
  if (err instanceof Anthropic.RateLimitError) return 'The AI is busy (rate limit). Wait a moment and try again.';
  if (err instanceof Anthropic.BadRequestError) return `The AI rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Cannot reach the AI service. Check your internet connection.';
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status}). Try again shortly.`;
  return err?.message || String(err);
}

export async function testConnection() {
  const { client, model } = await setup();
  const msg = await client.beta.messages.create(params(model, 'low', { max_tokens: 2048, messages: [{ role: 'user', content: 'Reply with exactly: Kalinga AI is ready.' }] }));
  checkStop(msg);
  return `${textOf(msg).trim()} (${msg.model})`;
}

// ---------- Smart-Fill: free-text notes -> form fields ----------
function fieldSchema(f) {
  const nullable = (s) => ({ anyOf: [s, { type: 'null' }] });
  switch (f.type) {
    case 'number': return nullable({ type: 'number' });
    case 'select': case 'radio': return nullable({ type: 'string', enum: f.opts });
    case 'yesno': return nullable({ type: 'string', enum: ['Yes', 'No'] });
    case 'checks': return { type: 'array', items: { type: 'string', enum: f.opts } };
    case 'date': return nullable({ type: 'string', description: 'YYYY-MM-DD' });
    case 'pe': {
      const row = { type: 'object', properties: { s: { type: 'string', enum: ['Normal', 'Abnormal'] }, f: { type: 'string' } }, required: ['s', 'f'], additionalProperties: false };
      return { type: 'object', properties: Object.fromEntries(f.opts.map((o) => [o, nullable(row)])), required: f.opts, additionalProperties: false };
    }
    default: return nullable({ type: 'string' });
  }
}

export async function smartFill(form, notes) {
  const { client, model } = await setup();
  const fields = allFields(form).filter((f) => !['computed', 'odontogram'].includes(f.type));
  const schema = { type: 'object', properties: Object.fromEntries(fields.map((f) => [f.k, fieldSchema(f)])), required: fields.map((f) => f.k), additionalProperties: false };
  const guide = fields.map((f) => `- ${f.k}: ${f.label}${f.unit ? ` (${f.unit})` : ''}`).join('\n');
  const prompt = `Fill in the form "${form.code} – ${form.title}" from the clinician's notes below.

Rules:
- Use only information stated in the notes. Use null (or an empty list) for anything not mentioned. Never guess.
- Convert units to the ones in the field list. Dates as YYYY-MM-DD. Today is ${new Date().toISOString().slice(0, 10)}.
- For physical-exam systems, mark "Normal" only when the notes say so (e.g. "PE unremarkable" means every listed system is Normal).

Fields:
${guide}

<notes>
${notes}
</notes>`;
  const base = params(model, 'low', { max_tokens: 16000, messages: [{ role: 'user', content: prompt }] });
  let msg;
  try {
    msg = await client.beta.messages.create({ ...base, output_config: { ...base.output_config, format: { type: 'json_schema', schema } } });
  } catch (err) {
    // Very large forms can exceed structured-output schema limits; fall back to plain JSON.
    if (!(err instanceof Anthropic.BadRequestError)) throw err;
    msg = await client.beta.messages.create({ ...base, messages: [{ role: 'user', content: `${prompt}\n\nAnswer with one JSON object whose keys are the field names above, and nothing else.` }] });
  }
  checkStop(msg);
  const text = textOf(msg);
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(json); } catch { throw new AIError('The AI response could not be read. Try again.'); }
}

// ---------- streaming text generation ----------
async function stream(content, onText, effort = 'medium', history = []) {
  const { client, model } = await setup();
  const s = client.beta.messages.stream(params(model, effort, { max_tokens: 64000, messages: [...history, { role: 'user', content }] }));
  s.on('text', (t) => onText(t));
  const msg = await s.finalMessage();
  checkStop(msg);
  return textOf(msg);
}

// De-identified view of a person's records for the AI.
export function deidentify(person, records) {
  const now = ageAt(person.birthdate);
  return {
    subject: person.type === 'learner' ? 'Learner' : 'School personnel',
    sex: person.sex || 'unknown',
    currentAge: now ? `${now.years} years ${now.months} months` : 'unknown',
    gradeOrPosition: person.type === 'learner' ? person.gradeLevel : person.position,
    records: records.map((r) => {
      const form = formById(r.formId);
      const data = withComputed(form, r.data, person);
      const clean = {};
      for (const f of allFields(form)) {
        const v = data[f.k];
        if (v === '' || v == null || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)) continue;
        if (['emName', 'emPhone', 'emRelation', 'receivingDentist', 'facility', 'referredTo'].includes(f.k)) continue;
        clean[f.label] = v;
      }
      return { form: `${form.code} – ${form.title}`, status: r.status, data: clean };
    }),
  };
}

export function summarizePerson(person, records, onText) {
  const payload = JSON.stringify(deidentify(person, records), null, 1);
  return stream(`Review this de-identified health record history and write a brief clinical summary for the school health team.

Use these headings: **Overview**, **Notable findings & trends** (e.g. BMI or nutritional status changes, blood pressure, dental indices), **Gaps** (missing exams, immunizations or overdue items for the current school year), **Suggested follow-up**.

<records>
${payload}
</records>`, onText, 'medium');
}

export function writeReport(stats, instruction, onText) {
  return stream(`Here are aggregated, de-identified statistics from the division's Medical-Dental and Nutrition Information System:

<stats>
${JSON.stringify(stats, null, 1)}
</stats>

${instruction}`, onText, 'medium');
}

export function chat(history, question, context, onText) {
  const content = context ? `<division_stats>\n${JSON.stringify(context)}\n</division_stats>\n\n${question}` : question;
  return stream(content, onText, 'medium', history);
}
