# Weighbridge Register

A private website for weighbridge slip entry with three roles, live data on every laptop and phone, and Excel/PDF downloads.

| Role | Can do |
|---|---|
| **Owner** | Everything: entries, records, edit, delete, downloads, merge with old Excel, activity history, **Settings** (people, passwords, permissions, business details) |
| **Admin** | Entries and Records. Edit, delete, download and see activity **only if the owner switches it on** in Settings |
| **Manager** | Entry form only. Optionally sees their own entries from today (owner's choice) |

Everything is enforced **inside the database** (Row Level Security), not only by hiding buttons. A manager cannot read, edit or delete records even with technical tricks.

Built with plain HTML, CSS and JavaScript. Supabase is the database and login; Vercel hosts it. Both have free plans that are enough for a weighbridge.

---

## Setup (about 20 minutes, once)

### 1. Supabase: database and logins
1. Create a free account at **supabase.com** → **New project**. Pick a region near you (Mumbai for India). Save the database password somewhere safe.
2. Open **SQL Editor** → **New query**. Paste everything from `supabase/schema.sql` → **Run**. It should say *Success*.
3. **Authentication → Sign In / Providers** (or *Providers → Email*):
   - Turn **off** "Allow new users to sign up". Only the owner adds people.
   - Turn **off** "Confirm email". Usernames are used, no emails are sent.
4. **Project Settings → API** (or *API Keys*). Copy three things:
   - **Project URL**
   - **anon / public** key
   - **service_role** key. This one is secret. Never put it in GitHub or share it.

### 2. GitHub: store the code
1. Create a free account at **github.com** → **New repository** → name it `weighbridge-register` → **Private** → Create.
2. On the new repository page click **uploading an existing file**, drag in **everything inside this folder** (`api`, `public`, `supabase`, `package.json`, `vercel.json`, `README.md`, `.gitignore`), then **Commit changes**.

### 3. Vercel: put it online
1. Create a free account at **vercel.com** with your GitHub login → **Add New → Project** → import `weighbridge-register`.
2. Framework preset: **Other**. Leave build settings empty.
3. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Project URL from step 1.4 |
   | `SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role secret key |
   | `SETUP_KEY` | Any long phrase you make up, e.g. `blue-truck-gate-7712` |

4. **Deploy**. You get a link like `https://weighbridge-register.vercel.app`.

### 4. Create the owner account
1. Open `https://YOUR-SITE.vercel.app/setup`.
2. Enter the `SETUP_KEY`, your name, a username and a password → **Create owner account**.
3. In Vercel → Settings → Environment Variables, **delete `SETUP_KEY`**, then **Deployments → ⋯ → Redeploy**. The setup page is now locked forever.

### 5. Add your people
Sign in → **Settings** → **Add a person**. Choose Admin or Manager, set a username and password, and give them those details. They open the same link on their laptop or phone.

---

## Daily use
- **New entry**: Date, Slip no., Party, Vehicle, Item and Net wt. are compulsory; Deduction and Rate are optional. Final wt. (Net − Deduction) and Amount (Final × Rate) calculate live. The same slip number can't be saved twice.
- **Records** (owner/admin): filter by dates, search party/slip/vehicle/item, totals at the top. Updates live when anyone saves.
- **Download** (owner, or admin if allowed):
  - Excel: register sheet with business name, totals row, filters, and **Party summary** and **Item summary** sheets.
  - PDF: landscape A4 with totals.
  - Choose all entries, a date range, the current Records view, or ticked rows.
  - **Merge with an earlier Excel**: upload your old register (.xlsx). Old rows and website entries are combined, sorted by date, and written back in the old file's own formatting, totals row and notes. If a slip is in both, the website version wins.
- **Activity**: every add, edit, delete, user change and settings change, with who and when. Nobody can erase it.
- **Settings** (owner): business name, time zone, auto sign-out time, permission switches, people (add, change role, turn off, new password, delete).
- **My account**: everyone can change their own password.

## Security built in
- Database rules check every request against the person's role and the owner's permission switches.
- Turning a person off blocks them immediately, even if they are signed in.
- Owner can never be locked out: the last owner can't be turned off, demoted or deleted.
- Sessions end when the browser closes, and after the inactivity time set in Settings.
- Passwords need 8+ characters with a letter and a number. Supabase limits repeated wrong tries.
- Strict browser security headers (`vercel.json`): no other site can embed or inject scripts into the pages.
- All libraries are stored inside the project (`public/vendor`), not loaded from outside sites.
- The secret service key stays on Vercel's server and is only used by the owner-only functions in `/api`.

## Updating from the first version
If you already ran the old `schema.sql` (the one with Gross wt. and Tare wt.), just run the new `supabase/schema.sql` once more in the SQL Editor. It removes Gross and Tare, keeps every saved entry and its Net wt., and changes nothing else.

## Good to know
- **Backups:** Supabase free plan has no automatic backups you can restore yourself. Download a full Excel from the Download tab every week or month.
- **Free plan pause:** a Supabase free project pauses after 7 days with no use. Daily use keeps it awake. If it pauses, open supabase.com and click Restore.
- **Changing the code later:** edit files on GitHub. Vercel redeploys automatically in about a minute.
- **XML export:** planned for later. `public/js/files.js` is where it will go.

## Project files
```
api/             server functions (Vercel): config, one-time setup, owner user management
public/          the website: index (sign in), app, setup, css, js, vendor libraries
supabase/        schema.sql: tables, security rules, activity log, totals
vercel.json      hosting settings and security headers
```
