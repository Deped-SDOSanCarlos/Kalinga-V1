# Kalinga — Division Medical-Dental & Nutrition Information System

A web app for a DepEd Schools Division health unit. Physicians, dentists and nurses use it to encode, sign and print health forms, follow learner nutrition and dental status, and generate division reports. It includes AI help from Anthropic Claude.

- **One central database.** Everyone signs in to the same Supabase (PostgreSQL) database, from any computer or phone, at any time. A record saved in one school appears everywhere right away.
- **Invite links.** The administrator sends each doctor, dentist or nurse a one-time link. They open it and create their own password.
- **Free.** GitHub Pages hosts the app and Supabase's free plan hosts the database.
- **Secure by design.** The database enforces who can see or change what. Nurses cannot sign physician certificates, signed records are locked, and the signer's name is stamped by the server so it can't be forged. Without an account, nothing can be read.

## How it fits together

```
 Staff browsers ──►  GitHub Pages (the app: HTML/JS)
        │
        └──────────►  Supabase (database + sign-in), Singapore region
        └──────────►  Anthropic Claude (AI features, optional)
```

## One-time setup (about 20 minutes)

### 1. Create the database
1. Go to **[supabase.com](https://supabase.com)**, click **Start your project**, and sign in with your GitHub account.
2. Click **New project**:
   - **Name:** `kalinga`
   - **Database password:** click *Generate* and save it somewhere safe. You rarely need it.
   - **Region:** **Southeast Asia (Singapore)**, the closest to the Philippines.

   Click **Create new project** and wait about 2 minutes.
3. Open **SQL Editor** in the left menu, then click **New query**. Open the file `supabase/schema.sql` from this folder, copy *all* of it, paste it into the editor, and click **Run**. You should see "Success. No rows returned".
4. Open **Authentication → Sign In / Providers → Email** and turn **off** "Confirm email". Keep "Allow new users to sign up" **on**, because invite links need it. Click **Save**.
   - Why: Supabase's free email service can only send a few messages per hour. Kalinga controls access with invite links instead of email confirmation, so unknown sign-ups can't see any data.
5. Click **Connect** at the top of the page, or go to **Project Settings → API**, and copy:
   - the **Project URL**, like `https://abcdefghijkl.supabase.co`
   - the **anon / publishable key**, a long text. Do **not** use the *service_role / secret* key.

### 2. Connect the app
1. In your GitHub repository, open `js/config.js` and click the ✏️ pencil icon. Paste the two values between the quotes:
   ```js
   export const SUPABASE_URL = 'https://abcdefghijkl.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
   Click **Commit changes**. The anon key is designed to be public, so it is safe in a public repository.
2. Upload the other new and changed files: **Add file → Upload files**, then drag in the `js`, `vendor`, `css` and `supabase` folders, `sw.js` and `README.md`. Click **Commit changes**.
   - Don't overwrite your edited `js/config.js`. Either upload it from this folder after filling it in here, or skip it when uploading.
3. Add the keep-awake job: **Add file → Create new file**, name it `.github/workflows/keepalive.yml`, paste in the contents of that file from this folder, and commit.
   - Free Supabase projects pause after 7 days without use, for example during school breaks. This job pings the database every 3 days so it stays available.
   - You can test it under **Actions → Keep database awake → Run workflow**.

### 3. First sign-in
1. Open your site (`https://<username>.github.io/<repo>/`) and press **Ctrl+F5** once, to drop the old cached version.
2. The **first-time setup** screen appears. Enter the region, the division, and **your** name, email and password. This creates the administrator account.
3. Go to **Settings** and add the division profile and logo, the schools, and optionally the AI key.
4. Go to **Users → Invite staff**. Choose the role, optionally lock the link to their email, and click **Create invite link**. Copy the link and send it by Messenger, SMS or email. Each link works **once** and expires after the time you choose.

### 4. Bring over data from the old version (if any)
The earlier version kept data inside each computer's browser. On each computer where data was encoded:
1. Open the new site in **that same browser** and sign in as the **administrator**.
2. Open **Data & backup**. A banner shows how many people and records the old version left there.
3. Click **Upload to central database**.

If you saved backup files from the old version, use **Data & backup → Import backup file** instead.

## Using it day to day
- **Signing in:** email and password, from any device with internet.
- **Forgot password:** the administrator opens **Users → 🔑** and sets a temporary password, and the person is asked to change it.
- **Someone leaves:** **Users → ✏️**, untick *Account active*. Their access stops within a minute.
- **Two people editing the same record:** the second save is refused with a message to reopen the record, so nobody silently overwrites a colleague's work.
- **Backups:** Supabase keeps the data online, but the free plan has **no automatic backups**. Once a month, the administrator should run **Data & backup → Download backup** (with a passphrase) and keep the file on a division drive.

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
- Sign and finalize it.
- Print it, or save it as a PDF, in an official-style layout.
- Print it blank, or export it to CSV.

> Layouts follow the structure of each form but are not facsimiles. Check them against the current official versions before formal use. To change a field, edit that form's entry in `js/forms.js`.

## Roles

| Role | Can do |
|---|---|
| Administrator / Developer | Everything: invites, users, settings, schools, import, audit log, reopening signed records, deleting |
| Physician | Encode all forms; sign medical certificates, Annual PE and Palaro clearances |
| Dentist | Encode all forms; sign dental records and referral slips |
| Nurse | Encode all forms; finalize health records. Certificates wait for a physician or dentist |

These rules are enforced inside the database (`supabase/schema.sql`), not only in the app's screens.

## AI features (Claude)

- **Smart-Fill:** turns typed or dictated exam notes into form fields.
- **Clinical summaries** of a person's record history.
- **Report writer:** situationer, SBFP memo, APE compliance, oral health plan.
- **AI Assistant:** a chat for school-health questions.

To set it up, an administrator adds an API key from [console.anthropic.com](https://console.anthropic.com) in **Settings → AI**. The key is stored in the central database and is readable only by signed-in staff. **Set a monthly spend limit on the key.**

Names and ID numbers are never sent to the AI.

## Privacy (Data Privacy Act of 2012)
- Health data is stored in Supabase's Singapore data center, encrypted in transit (HTTPS) and at rest.
- Discuss cloud storage of personnel and learner health data with your Division Data Protection Officer, and record it in your privacy impact assessment.
- Only invited, active staff can read records. Every sign-in, save, signature, print, import and export is written to the audit log.
- Encrypt exported backup files with a passphrase and store them on division-controlled drives.

## Free-plan limits
- Supabase free plan: 500 MB database, which is roughly several hundred thousand records, and unlimited API requests. It pauses after 7 days idle, which the keep-awake job prevents.
- GitHub may switch off scheduled jobs in a repository after 60 days with no commits. If that happens, **Actions → Keep database awake → Enable workflow**. Normal daily use also keeps the database awake.
- If the division outgrows the free plan, Supabase Pro adds daily backups and more space. No code changes are needed.

## Project layout

```
index.html              app entry
css/app.css             design system, light/dark themes, print styles
js/config.js            Supabase URL + anon key  ← fill this in
js/main.js              app shell, router and all screens
js/db.js                central database access, sync, backup/import
js/auth.js              sign-in, roles, invite links
js/forms.js             form templates and clinical helpers
js/render.js            form editor and printable documents
js/stats.js             dashboard and report statistics, charts
js/ai.js                Claude integration
supabase/schema.sql     tables, security rules, invite functions  ← run once in Supabase
vendor/                 bundled libraries (Supabase JS 2.117.2, Anthropic SDK 0.130.0)
.github/workflows/      keep-awake job
sw.js                   offline cache for the app files
```
