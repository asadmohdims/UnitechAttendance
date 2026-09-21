# Shop Attendance Tracker

A web app to track employee attendance for a small shop (< 10 employees).

## Features

- Employees clock in/out by tapping their name; a photo is captured via the device camera as proof.
- Punches are captured instantly and sync to the server in the background, so a brief
  internet drop at the shop doesn't lose a clock-in/out — it just syncs a little later.
- Daily hours are calculated automatically. If someone forgets to clock out and the tablet stays
  on overnight, that session is auto-closed and flagged for the admin to double-check rather than
  left "still clocked in" forever or silently paid through; a genuinely missed punch (kiosk was
  down, forgot to tap) can be backfilled by an admin from the monthly report.
- Lunch breaks are just two extra taps — out for lunch, back in — no separate button to learn
  (four taps a day: morning in, lunch out, lunch in, evening out). The kiosk never guesses at
  lunch; a day that looks like a forgotten lunch tap is flagged for the admin, who can fix it
  in one click ("Split for lunch"). The owner can also opt, per lunch break, to pay through it as
  if it were worked time — a one-tap, fully reversible toggle right next to that day's records.
- Records view per day, grouped: a lunch-break day shows one combined total for the day up top,
  with the individual sessions and their photos underneath — no adding two numbers by hand.
  Times are editable, with an audit trail (the exact captured time never changes, even where pay
  rounding applies — see below).
- Monthly report: a status-grid calendar (not just a number per day) shows at a glance who
  worked, who's still clocked in, who was absent or took a half day, and whose lunch needs a
  second look — click any day for the full session breakdown or the exact absent dates. Hours
  per day per employee, days worked, total hours — downloadable as Excel (.xlsx). Employees get
  one paid weekly holiday (day configurable); the owner can exclude a specific one from pay for
  an employee who's taken more time off than the allowance covers.
- Salary: prorates a monthly rate against hours actually worked, with a full calculation
  breakdown shown per employee. Pay is based on each punch rounded to the nearest 15 minutes
  (a configurable grace window, not a strict nearest-quarter split); wherever rounding changes a
  punch, the exact time and the paid time are both shown side by side, so a pay figure can
  always be explained if it's ever questioned. Rate changes are amendments (never edited in
  place), so past months keep the rate that was actually in effect at the time. The owner can
  also credit an employee extra hours for a specific day (paid at their normal rate), shown as
  its own line in the breakdown.
- Payments: a simple two-sided cash log — the employee (via their own PIN on the kiosk) and the
  owner each record what they believe was paid, independently, and the app flags any day where
  the two don't match so it can be talked through rather than silently trusted. No money actually
  moves through the app; it's a record-keeping aid for pay conversations.
- Installable on the shop tablet like a native app (Add to Home Screen), with new versions
  picked up automatically in the background — nothing for anyone at the shop to update by hand.

## Usage

Open the hosted page (GitHub Pages) on the tablet/phone at the shop entry and allow camera access. Add employees in the **Employees** tab, then use the main screen to clock in/out.

## Data storage & security

Data lives in a [Supabase](https://supabase.com) free-tier project: employees and attendance records in Postgres, clock-in/out photos in a private storage bucket. The whole site requires sign-in (Supabase Auth); the Records, Report and Employees tabs are additionally locked behind an admin password re-entry, so employees at the shared tablet can only clock in/out.

Clock-in/out itself is offline-resilient: each punch is written to the browser's local storage first and synced to Supabase in the background, so a spotty shop internet connection won't lose a timestamp or photo. (That local queue lives in the browser, so wiping the kiosk device's browser data before a punch has synced would lose that one punch — worth keeping in mind for whatever device ends up running the kiosk day to day.)

### One-time setup

1. Create a free project at supabase.com.
2. Run `supabase-setup.sql` in the project's SQL Editor.
3. Create the admin login: Authentication → Users → Add user (email + password, check "Auto Confirm User").
4. Paste the project URL and anon public key into the CONFIG block at the top of `js/config.js`, and set `DEMO_MODE = false`.

## Tech

Plain HTML/CSS/JS, no build step. Supabase JS v2 and [SheetJS](https://sheetjs.com/) via CDN.

## Development

No build step — plain HTML/CSS/JS split into ES modules under `js/` (see `CLAUDE.md` for the module map). Because it uses `<script type="module">`, opening `index.html` directly via `file://` won't work in most browsers; serve it locally instead, e.g. `python3 -m http.server 8743` from the project root, then open `http://localhost:8743`. Deploys automatically to GitHub Pages on every push to `main` (see `.github/workflows/deploy.yml`).

`archive/source/` holds an earlier draft, kept for reference only — not part of the live app.
