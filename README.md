# Kalinga — Division Medical-Dental & Nutrition Information System

A web app for a DepEd Schools Division health unit. Physicians, dentists and nurses use it to encode, sign and print health forms, follow learner nutrition and dental status, and generate division reports. It includes AI help from Anthropic Claude.

- **Free hosting** on GitHub Pages. There is no server, no build step and no monthly cost.
- **Fast and works offline.** It is a single-page app with no framework. After the first visit it opens without internet; only the AI features need a connection.
- **Transferable database.** All data is plain JSON. One backup file moves everything (people, records, users, settings) to another computer or browser, with optional AES-256 encryption.

## Forms included

| Form | Use | Signed by |
|---|---|---|
| CS Form 86 – Health Examination Record | Annual Physical Exam of personnel | Physician |
| CS Form No. 211 – Medical Certificate | New hires, promotion, re-employment | Physician |
| CS Form 41 – Medical Certificate (Sick Leave) | Sick leave of more than 5 days | Physician |
| Personal Medical History Record | Yearly baseline for all personnel | Any health personnel |
| SHD Form 1 – Learner's School Health Record | Check-ups, immunization, nutritional status | Any health personnel |
| SHD Form 2B – Dental Health Record | Tooth chart (FDI), DMFT/dft, services | Dentist |
| SHD Form 3B – Dental Referral Slip | Referral with return slip | Dentist |
| MCForm-3 – Palaro Medical Certificate | "Fit to Play" clearance for athletes | Physician |

You can do four things with every form:
- Encode it with live calculations: BMI, BP category, age at exam, leave days, DMFT.
- Sign and finalize it. A finalized record is locked.
- Print it, or save it as a PDF, in an official-style layout. Drafts carry a DRAFT watermark.
- Print it blank for manual filling, or export it to CSV.

> Layouts follow the structure of each form but are not facsimiles. Check them against the current official versions before formal use. To add or change a field, edit that form's entry in `js/forms.js`; entry, printing, CSV export and AI Smart-Fill all update from it.

## Accounts and roles

| Role | Can do |
|---|---|
| Administrator / Developer | Everything: users, settings, schools, backups and import, audit log, reopening signed records |
| Physician | Encode all forms; sign medical certificates, Annual PE and Palaro clearances |
| Dentist | Encode all forms; sign dental records and referral slips |
| Nurse | Encode all forms; finalize health records. Certificates wait for a physician or dentist |

- Passwords are stored as salted PBKDF2-SHA256 hashes.
- After 5 failed sign-ins, the account is locked for 30 seconds.
- Signing requires a PRC license number in **My account**.
- Every important action is written to the audit log.

## AI features (Claude)

- **Smart-Fill.** Type, paste or dictate exam notes such as "BP 130/85, wt 62 kg, PE unremarkable…". Claude fills in the matching form fields, and you review them before saving.
- **Clinical summary.** On a person's profile: trends, gaps and suggested follow-ups.
- **Report writer.** Turns the statistics into a division situationer, an SBFP targeting memo, APE compliance recommendations or an oral health plan.
- **AI Assistant.** A chat for school-health questions.

To set it up, an administrator opens **Settings → AI** and pastes an API key from [console.anthropic.com](https://console.anthropic.com). The key is stored only on that device. Because the app calls Claude straight from the browser, **set a monthly spend limit on the key**.

Names and ID numbers are never sent to the AI. Summaries use de-identified data (age, sex, findings), and reports use only aggregate counts. Smart-Fill sends only the notes you type, so don't put names in them.

The default model is `claude-opus-5-5`. Sonnet 5.5 and Haiku 5.5 can be chosen in Settings.

## Put it online with GitHub Pages (free)

1. Create a free account at [github.com](https://github.com) and click **New repository**. Name it, for example, `kalinga`. Choose **Private** if your plan allows Pages for private repositories; otherwise **Public** is fine, because the code holds no data.
2. Click **uploading an existing file** and drag **everything inside the `kalinga` folder** into the page, including the `.nojekyll` file and the `js`, `css`, `vendor` and `assets` folders. Then click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then branch **main** and folder **/ (root)**, and click **Save**.
4. After about a minute the site is live at `https://<your-username>.github.io/kalinga/`.
5. Open it and complete **first-time setup**, which creates the administrator account. Then add schools in Settings and create accounts for your doctors, dentists and nurses.

To release an update, upload the changed files again. Also change `VERSION` in `sw.js` (for example to `kalinga-v1.0.1`) so devices drop the old cached copy.

To try it on your own computer first, run any static web server inside the folder, for example `npx serve .`, and open the address it prints. Opening `index.html` directly from disk doesn't work, because browsers block modules on `file://`.

## Where the data lives, and how to move it

The data is stored in the browser's **IndexedDB** on each computer. The website itself holds no records. This means:

- **Each computer has its own database.** To use the same data on another computer, go to **Data & backup → Download backup** on the first computer, then **Replace with a backup** on the second.
- **To combine** records encoded on different computers, for example by several nurses in the field, use **Merge a backup**. It keeps the newest version of each record.
- **Back up regularly.** The dashboard reminds you if there hasn't been a backup in 7 days. Clearing the browser's site data deletes the records. Click **Ask browser to keep data** on the Data page to protect them from automatic cleanup.
- **Bulk-load learners and personnel from CSV.** Templates are on the Data page. The backup file is plain JSON (`stores.people`, `stores.records`, and so on), so it can later be loaded into a server database such as Supabase or PostgreSQL if the division wants real-time sharing across computers.

### Privacy (Data Privacy Act of 2012)

- Use a passphrase on backups. Encrypted files use AES-256-GCM, and **a lost passphrase cannot be recovered**.
- Keep backup files on division-controlled storage.
- Use Kalinga only on division-issued devices with their own OS login, because anyone who can use the browser profile can reach the stored data.

## Project layout

```
index.html            app entry
css/app.css           design system, light/dark themes, print styles
js/main.js            app shell, router and all screens
js/forms.js           form templates and clinical helpers (BMI, BP, DMFT…)
js/render.js          form editor and printable document renderer
js/db.js              IndexedDB storage, backup/import, encryption, audit
js/auth.js            accounts, roles, password hashing, sessions
js/stats.js           dashboard and report statistics, charts
js/ai.js              Claude integration
vendor/anthropic.mjs  bundled Anthropic SDK (@anthropic-ai/sdk 0.130.0)
sw.js                 offline cache
```
