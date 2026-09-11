# Unitech Attendance — project notes for Claude

Shop attendance kiosk for a small shop (<10 employees). Employees clock in/out by tapping
their tile on a shared tablet; a photo is captured as proof each time. Admin side manages
employees, daily records, and a monthly report (Excel export).

Read `README.md` first for the user-facing feature list and Supabase setup steps — this file
is the "how this codebase is organized and where things stand" reference.

## Stack & constraints

- Plain HTML/CSS/JS, ES modules, **no build step, no npm, no bundler** — this is deliberate,
  keep it that way. Don't introduce webpack/Vite/TypeScript/a framework without the user
  explicitly asking to change this constraint.
- Backend: Supabase (Postgres + private Storage bucket for photos), schema in
  `supabase-setup.sql`. **A real Supabase project has been live since 2026-09-09**
  (`DEMO_MODE = false` in `js/config.js`, commit `8f8a29b`) — the deployed site requires real
  sign-in and reads/writes that project. `DEMO_MODE = true` still exists as a separate,
  deliberate local-only sandbox (localStorage, zero network calls, no login) for dev/testing —
  flip it locally only, never in what's deployed. Don't conflate "skip login for convenience"
  with this flag — anonymous Supabase access was considered and explicitly rejected, see
  Working conventions below.
- Hosting: GitHub Pages, repo `asadmohdims/UnitechAttendance` (public — the Supabase key
  checked into `js/config.js` is the anon/publishable key, safe by design, RLS-protected).
  `.github/workflows/deploy.yml` auto-deploys on every push to `main`.
- `js/main.js` is loaded via `<script type="module">`, so **`file://` won't work** for local
  testing — serve it (`python3 -m http.server 8743` from the project root) and open
  `http://localhost:8743`.

## Architecture (as of the Sept 2026 restructure)

```
index.html          -- markup only
css/styles.css        -- all styles
js/
  config.js             -- SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_MODE
  supabaseClient.js      -- creates `sb`, the Supabase client
  state.js               -- shared mutable `state = {employees, openSessions, adminUnlocked}`
  utils.js                -- $, toast, busy, pad, dateStr, fmtTime, fmtHours, recHours
  avatars.js               -- initials-fallback avatar rendering (never shows the wrong photo)
  camera.js                 -- captureFor(emp, mode, onCapture) — owns the camera modal
  salary.js                  -- pure salary math (proration, rate selection) — no store/DOM access
  store/
    index.js                  -- `store = DEMO_MODE ? demoStore : supabaseStore`
    demoStore.js                -- localStorage-backed
    supabaseStore.js            -- Supabase-backed, offline-resilient (see below)
    outbox.js                    -- IndexedDB queue used only by supabaseStore.js
  ui/
    shell.js                    -- tabs, nav, login/logout, admin lock/unlock, live clock
    kiosk.js                     -- home screen, punch flow, refreshAll(), punch confirmation
    modal.js                     -- promptModal() — styled stand-in for prompt()
    employees.js                  -- admin Employees tab
    records.js                     -- admin Daily records tab
    report.js                       -- admin Monthly report + Excel export
    salary.js                       -- admin Salary tab (uses js/salary.js's math + report.js's monthData)
  main.js                            -- entry point
```

**The one rule that matters most here:** all data access goes through `store.*` — never add a
new `if(DEMO_MODE){...}else{...}` branch in UI code. Add the method to *both*
`demoStore.js` and `supabaseStore.js` behind the same interface, then call `store.xxx()` from
the UI module. This is the fix for the duplication problem the restructure solved; reintroducing
DEMO_MODE branches in feature code undoes the point of it.

Mutations (add/rename/deactivate employee, edit/delete a record) should call `refreshAll()`
(exported from `js/ui/kiosk.js`) afterward to reload `state` from the store, then re-render —
punch in/out is the deliberate exception (mutates `state.openSessions` directly for latency,
matching the original app's behavior).

## Offline-resilient punches (outbox pattern)

`supabaseStore.js`'s `clockIn`/`clockOut` never block on the network — they write instantly to
`js/store/outbox.js` (an IndexedDB queue) and return immediately; a background loop syncs to
Postgres/Storage afterward. Salary is calculated from these timestamps, so losing a punch to a
network hiccup was treated as the one unacceptable failure mode — this is why the design exists.

- **A client-generated `crypto.randomUUID()` IS the eventual Postgres `records.id`** (it
  overrides the column's `default gen_random_uuid()` on upsert). There's no temp-id
  reconciliation step — the same id is used from the tap onward, synced or not. Syncing is
  just `upsert({id: clientId, ...})`, which makes a retried sync always safe to repeat.
- Sync fires: immediately after every write (`outbox.kick()`), on the browser's `online`
  event, and every 30s as a fallback. See `startBackgroundSync`/`runSync` in
  `outbox.js`/`supabaseStore.js`.
- A row **stays in the outbox** after its clock-in has synced if the session is still open
  (`clockOut`/`listOpenSessions` still need to find it locally) — it's only deleted once
  `clock_out` is set and synced. Because of this, `getSyncStatus()` deliberately does **not**
  count "open, already-synced, no error" rows as pending — only a row with a still-unsynced
  photo blob or a failed attempt counts. Getting this wrong would make the kiosk's sync-status
  indicator show a permanent false "Syncing…" any time someone is clocked in.
- Verified against a real Supabase project with a real simulated outage (intercepting `fetch`
  to the Supabase host): clock-out still resolved in ~4ms while "offline," Postgres correctly
  kept the prior state until reconnect, then synced automatically within ~1.5s of the network
  returning.
- `demoStore.js` does **not** use the outbox — there's nothing to be offline from against
  localStorage, so its `clockIn`/`clockOut` just changed signature (blob instead of a
  pre-computed photo path) to match the shared interface, no offline logic.

## Design system (kiosk/home screen)

Landscape layout: a fixed side panel + a centered, wrapping grid of ID-badge-shaped employee
tiles (not circles — deliberate, ties to the "punch clock" identity). Palette reuses the app's
own existing tokens (`--bg`, `--blue`, `--ink`, `--muted` etc. in `css/styles.css`) — no
separate palette was introduced. `--green` is reserved specifically for the "currently clocked
in" signal (border glow + lift on `.badge-tile.in`), kept distinct from `--blue` (the one
UI/brand accent) so the two don't compete.

The side panel's wordmark and the live clock both use Bebas Neue — one display face carries the
brand and the big number, so they read as one "signage" identity instead of a small label next
to an unrelated number. There's no logo mark/badge icon anywhere (kiosk panel or the admin
`<header>`'s `<h1>`, which shares this same Bebas Neue treatment) — considered and dropped,
the wordmark alone carries the identity. The panel is structured as two flex groups —
`.kiosk-top` (wordmark + a live "N of M clocked in now" roster line + the clock/date) and
`.kiosk-footer` (admin link) — so `justify-content:space-between` on `.kiosk-side` has exactly
one gap to distribute, at the bottom; spacing within `.kiosk-top` is a fixed, deliberate gap,
not auto-margin centering. In portrait/mobile, `.kiosk-top`/`.kiosk-footer` become
`display:contents` so their children flatten back into `.kiosk-side`'s row layout — the roster
line lives *inside* the wordmark's wrapper (`.kiosk-identity`), not as a sibling, specifically
so it doesn't become a third flex participant and break the row's `space-between` spacing (this
broke once already — see git history around 2026-09-11 if this area gets touched again). The
roster line hides entirely when there are no active employees, matching the tile grid's own
empty state. Report and Salary got a further redesign on top of that: a metrics/summary
row, a review-alert callout for open sessions, and a grid-based employee list
(`.report-person`/`.salary-person` in `css/styles.css`) with its own mobile breakpoint — this is
the "modern" look going forward. Employees and Daily records now share that same grid-list
pattern (`.emp-row` and `.rec-row` in `css/styles.css`) — every admin screen is on one visual
language as of the Stage 2 work below. On mobile, `.emp-row`'s action buttons wrap onto their
own row instead of stacking one-per-line, and `.rec-row` uses `grid-template-areas` to
regroup avatar/name/hours onto one line and in/out/actions onto a second.

Pinch-zoom (`user-scalable`) is toggled dynamically on the single `<meta name=viewport>` tag
in `switchTab()` (`js/ui/shell.js`) — locked only on the kiosk home tab (stops an employee
mid-queue from accidentally zooming the shared tablet), unlocked on every admin tab so an
admin isn't blocked from zooming Records/Report/Employees/Salary on their own phone.

## Status / what's done vs. pending

- ✅ Kiosk identification fixes: real avatar capture on add-employee, initials fallback
  (never shows another employee's photo), full-screen punch confirmation, colorblind-safe
  ▶/■ state indicator.
- ✅ Kiosk home screen redesign: landscape badge-card layout described above.
- ✅ Modular restructure described above (store abstraction, ES modules).
- ✅ Real Supabase backend live (`DEMO_MODE = false` in production, commit `8f8a29b`,
  2026-09-09): the offline-resilient outbox described above, plus a small sync-status
  indicator on the kiosk screen (amber "Syncing…" / red "check Wi-Fi", hidden the rest of
  the time — which is nearly always, since syncs usually finish before the next 5s poll).
- ✅ Salary v1 (commit `a770548`): pure proration math in `js/salary.js` (retroactive
  rate-selection rule, tested), the `salary_rates` table, and the Salary admin tab
  (`js/ui/salary.js`) built on the same grid-list design as Report. `STANDARD_MONTHLY_HOURS`
  in `js/config.js` is a placeholder pending confirmation with the shop owner; no overtime cap
  yet (see Planned features #4 below).
- ✅ **Stage 2 — admin UX** (from the original audit, done 2026-09-11): `js/ui/records.js`'s
  edit/delete now go through `promptModal()` (see `js/ui/modal.js`, which gained `danger`
  styling for destructive confirms and optional/`required:false` fields) instead of native
  `prompt()`/`confirm()`, with a real `<input type=time>` picker for edit; deactivating a
  currently-clocked-in employee is now blocked with a toast instead of silently orphaning
  their open session; Employees and Daily records were brought up to the Report/Salary
  grid-list design (see Design system above). A short-PIN admin unlock was considered and
  dropped from scope — full password re-entry stays as the daily admin-unlock mechanism.
- ✅ Two smaller items from the same review, done alongside Stage 2: Report's per-employee
  "days worked" figure was shown twice (a text sub-label and a numbered tile) — the sub-label
  is now mobile-only (`.report-days-inline` in `css/styles.css`), where it's the only copy
  since the numbered tile hides there; `.github/workflows/deploy.yml` now stages the site into
  `_site/` excluding `archive/` before uploading to Pages, so the old pre-restructure draft no
  longer ships to the public site alongside the real app.
- ✅ Kiosk/admin typography pass (2026-09-11): removed the checkmark logo mark from both the
  kiosk panel and the admin `<header>`; both wordmarks now set in Bebas Neue (see Design system
  above); kiosk panel restructured into `.kiosk-top`/`.kiosk-footer` for deterministic spacing;
  added the live roster status line; the admin date/greeting area's date bumped from muted to
  bold full-ink for more presence without competing with the clock's size-driven dominance.

## Planned features — time & attendance accuracy (not started, discussed 2026-09-10)

Four features, sequenced by dependency — don't reorder without reconsidering, since #2 and #3
both feed the numbers #4 depends on. Working one at a time, ticking off in this order unless
Asad says otherwise.

1. **Missed clock-in highlight** — flag on the home/admin screen when someone hasn't clocked
   in. Intent still undecided — open question before starting: is "missed" evaluated against a
   fixed expected shift-start time (needs a schedule concept that doesn't exist yet) or just
   "not currently clocked in as of now" (no schedule needed)? Independent of the other three —
   can be done in any order, whenever that conversation happens.
2. **15-minute rounding on clock in/out** (e.g. 9:13 → 9:15) — do this before #4, since overtime
   should be computed on rounded hours, not raw punch times. Open decision needed: rounding
   direction — nearest-15 (symmetric), always-favor-shop (in↑/out↓), or nearest-with-grace-window
   (more payroll-standard, more rules to encode). Pure function; belongs in `js/salary.js`
   alongside the existing money math, testable with `node --test` like the rest of that file.
3. **Lunch break (pre-lunch / post-lunch shifts)** — schema change, not just math. `records`
   today is one clock_in/clock_out pair per day (see `supabase-setup.sql`). Two options: (a) two
   `records` rows per employee per day, reusing the existing session model and outbox pattern
   as-is, or (b) one row plus `lunch_out`/`lunch_in` columns — smaller migration, but both
   `salary.js` and the kiosk UI then need to understand a 4-state day instead of 2. Decide
   together before touching the live schema — see the RLS decision precedent below on treating
   schema/data changes to the live project as decisions, not just code changes.
4. **Overtime calculation** — depends on #2 (rounded hours) and probably #3 (net-of-lunch
   hours). Needs a decision on basis (daily >8h, weekly >40h, or both) and whether it's a
   separate line in `calcSalary`'s output or folded into the ratio.

## Testing

Some of this codebase's pure logic has automated coverage via Node's **built-in** test runner
(`node:test` + `node:assert`) — zero npm installs, zero config file, zero build step, so this
doesn't conflict with the "no build step, no npm, no bundler" constraint above (it's testing,
not bundling).

- Run everything: `node --test js/` from the project root.
- Test files are co-located with the code they cover, named `*.test.mjs` — the `.mjs`
  extension is what lets Node treat them as ES modules with zero config, no `package.json`
  needed.
- Covered so far: `js/salary.js` (the money math — proration, the retroactive rate-selection
  rule, boundary/leap-year dates) and `js/store/demoStore.js` (a regression suite for a real
  bug found 2026-09-09: the employee loader was silently reverting any rename back to the
  hardcoded seed name on every subsequent read — see the "rename survives a subsequent read"
  test, which fails against the old code and passes against the fix).
- Deliberately **not** covered by automated tests: `supabaseStore.js` (touches the real
  network/DB — a proper test would need a mocked client or a disposable test project; keep
  verifying it via the console against the live project, per the working conventions below)
  and the UI layer (no headless-browser test tool is set up — that would be new tooling, ask
  first). Because both stores share the same pure `salary.js` logic rather than duplicating
  it, testing that logic once covers correctness for both the demo and production data paths
  — `supabaseStore.js` itself is thin CRUD with little logic of its own left to break.

## Working conventions established on this project

- Small, reviewable changes — use plan mode for anything non-trivial, get sign-off before
  implementing, keep diffs scoped to one concern.
- Never `git commit`/`push` without the user explicitly asking, even mid-task.
- Test in demo mode via a local server + the Browser pane for UI/logic checks; real camera
  permission prompts need the user's actual Chrome (`Claude in Chrome`) or their own device —
  the sandboxed Browser pane blocks camera access and can't click native OS/browser dialogs.
- A real Supabase project is live and the `DEMO_MODE=false` path has been runtime-tested
  end-to-end against it, including a real simulated network-outage test — see the outbox
  section above. It's no longer "read it and hope." Camera-driven punches still need the
  user's actual Chrome/device either way (the sandboxed Browser pane blocks `getUserMedia`);
  everything else (store calls, IndexedDB, Postgres reads) is testable via the console
  against the real project.
- **Decision (2026-09-09): considered and rejected loosening RLS to allow anonymous access**
  as a way to skip login for convenience — it would expose all attendance data to anyone with
  the public anon key, and that exposure is a live-database-level change independent of git
  branches (a "safe" branch doesn't protect data once the policy is loosened). Don't
  re-suggest this. `DEMO_MODE = true` remains the sanctioned login-free sandbox for dev/testing.
