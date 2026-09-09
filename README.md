# Shop Attendance Tracker

A single-file web app to track employee attendance for a small shop (< 10 employees).

## Features

- Employees clock in/out by tapping their name; a photo is captured via the device camera as proof.
- Daily hours are calculated automatically (supports overnight shifts and fixing missed punches).
- Records view per day with in/out photos, editable times.
- Monthly report: hours per day per employee, days worked, total hours — downloadable as Excel (.xlsx).

## Usage

Open the hosted page (GitHub Pages) on the tablet/phone at the shop entry and allow camera access. Add employees in the **Employees** tab, then use the main screen to clock in/out.

## Data storage & security

Data lives in a [Supabase](https://supabase.com) free-tier project: employees and attendance records in Postgres, clock-in/out photos in a private storage bucket. The whole site requires sign-in (Supabase Auth); the Records, Report and Employees tabs are additionally locked behind an admin password re-entry, so employees at the shared tablet can only clock in/out.

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
