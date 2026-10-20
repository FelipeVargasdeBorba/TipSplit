# TipSplit

TipSplit helps the Café en Seine team split cash tips and prepare physical payouts from the cash available. The app uses a shared Supabase workspace so authorized administrators and supervisors see the same team and saved distributions.

## Features

- Equal weighted allocation for regular shifts, with a 1.25× weight for staff who close.
- Cash note and coin inventory with payout suggestions that do not exceed an employee's target share.
- Shared employee list and distribution history.
- Administrator and supervisor accounts.
- Automatic removal of saved tip distributions 30 days after they are created.

## Requirements

- A current Node.js LTS release.
- A Supabase project with the TipSplit database schema installed.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file by copying `.env.example` to `.env.local`.
3. Fill in the values in `.env.local`:
   - `VITE_SUPABASE_URL`: your Supabase project URL.
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: the `sb_publishable_...` key. Never put an `sb_secret_...` key in a browser app.
   - `VITE_TIPSPLIT_WORKSPACE_ID`: the workspace UUID shown in `.env.example`.
4. Start the development server:

   ```bash
   npm run dev
   ```

Open the local URL printed in the terminal.

## Supabase setup

For a new database, run `supabase/schema.sql` in the Supabase SQL Editor. Do not rerun setup scripts on a live workspace unless you understand the effects described below.

Create the first account in Supabase Dashboard → Authentication → Users. Copy that user's UUID, then add them as workspace administrator using the SQL below. Replace `AUTH_USER_UUID` with the account's actual UUID:

```sql
insert into public.workspace_members (workspace_id, user_id, role)
values (
  'b4f4c574-6f44-4ed0-a9cd-a1c6f50fcd10',
  'AUTH_USER_UUID',
  'admin'
)
on conflict (workspace_id, user_id)
do update set role = excluded.role;
```

To authorize another account, repeat the query with that account's UUID and set the role to `supervisor` instead of `admin`.

## 30-day history retention

Run `supabase/retention-policy.sql` once in the existing Supabase project to apply the retention rule and schedule the database cleanup. The deletion age is measured from the time the distribution was saved (`created_at`), not from the business date. A scheduled job runs daily at 04:00 UTC, so an old record is removed by the next cleanup after it passes 30 days.

**Permanent data deletion:** this script removes the retired audit log and any tip records that are already older than 30 days. Employees and newer tip records are preserved. Make a database backup before running it. If Supabase cannot create the `pg_cron` extension from SQL, enable Cron in the Supabase Dashboard and run the script again.

## Validation

Run the tests and production build before deploying changes:

```bash
npm run test
npm run build
```

## Security

`.env.local` contains local project credentials and should not be committed or shared. Use the publishable key only in frontend code; never expose a secret key or database password.
