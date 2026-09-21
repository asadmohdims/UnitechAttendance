# Unitech Attendance — project notes for Claude

Shop attendance kiosk for a small shop (<10 employees). Employees clock in/out by tapping
their tile on a shared tablet; a photo is captured as proof each time. Admin side manages
employees, daily records, a monthly report (Excel export), salary, and a payments ledger.

Read `README.md` first for the user-facing feature list and Supabase setup steps. This file
describes *current* behavior and the reasoning worth not re-litigating — not a changelog.
Feature-by-feature history (what changed, when, which commit) lives in `git log`; don't add
narrative iteration history here, just the resulting design and any non-obvious "why".

## Stack & constraints

- Plain HTML/CSS/JS, ES modules, **no build step, no npm, no bundler** — this is deliberate,
  keep it that way. Don't introduce webpack/Vite/TypeScript/a framework without the user
  explicitly asking to change this constraint.
- Backend: Supabase (Postgres + private Storage bucket for photos), schema in
  `supabase-setup.sql`. A real Supabase project is live (`DEMO_MODE = false` in `js/config.js`)
  — the deployed site requires real sign-in and reads/writes that project. `DEMO_MODE = true` is
  a separate, deliberate local-only sandbox (localStorage, zero network calls, no login) for
  dev/testing — flip it locally only, never in what's deployed. Anonymous Supabase access was
  considered and explicitly rejected (see Working conventions) — don't conflate "skip login for
  convenience" with this flag.
- Hosting: GitHub Pages, repo `asadmohdims/UnitechAttendance` (public — the Supabase key
  checked into `js/config.js` is the anon/publishable key, safe by design, RLS-protected).
  `.github/workflows/deploy.yml` auto-deploys on every push to `main`, staging into `_site/`
  (excludes `archive/`, the old pre-restructure draft, from the public site), and stamps a real
  git-short-SHA + timestamp into `version.json`/`js/version.js` (see PWA section below).
- `js/main.js` is loaded via `<script type="module">`, so **`file://` won't work** for local
  testing — serve it (`python3 -m http.server 8743` from the project root) and open
  `http://localhost:8743`.

## Architecture

```
index.html      -- markup only
manifest.json   -- PWA manifest (standalone, landscape)
sw.js           -- hand-rolled service worker, app-shell caching
version.json    -- deploy-time version stamp (CI-written; 'dev' placeholder in repo)
css/styles.css  -- all styles
js/
  config.js          -- SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_MODE, shop config constants
  version.js         -- deploy-time version stamp, JS form (CI-written; 'dev' in repo)
  supabaseClient.js  -- creates `sb`, the Supabase client
  state.js           -- shared mutable `state = {employees, openSessions, onLunch, adminUnlocked}`
  utils.js           -- $, toast, busy, pad, dateStr, fmtTime, fmtHours, recHours
  avatars.js         -- initials-fallback avatar rendering (never shows the wrong photo)
  camera.js          -- captureFor(emp, mode, onCapture) — owns the camera modal
  salary.js          -- pure salary math (proration, rate selection) — no store/DOM access
  paymentsMath.js    -- pure payments reconciliation math (matched/mismatch/awaiting)
  pin.js             -- pure PIN hash/verify (employee kiosk access to Payments)
  staleSession.js    -- pure end-of-day auto-close predicate — the kiosk's only automatic clock-out
  missedClockIn.js   -- pure "hasn't shown up today" predicate
  reportMath.js      -- pure per-day hours/review-flag/session-grouping math for the report
  rounding.js        -- pure payroll rounding (grace-window rule) + recHoursRounded()
  store/
    index.js          -- `store = DEMO_MODE ? demoStore : supabaseStore`
    demoStore.js       -- localStorage-backed
    supabaseStore.js   -- Supabase-backed, offline-resilient (see below)
    outbox.js          -- IndexedDB queue used only by supabaseStore.js
  ui/
    shell.js       -- tabs, nav, login/logout, admin lock/unlock, live clock
    kiosk.js       -- home screen, punch flow, refreshAll(), punch confirmation
    modal.js       -- promptModal() (input dialog) + infoModal() (read-only, e.g. the
                      absence-dates popup) — both a styled stand-in for prompt()
    payments.js    -- kiosk PIN pad + payment entry, admin reconciliation tab
    appVersion.js  -- polls version.json, silently reloads once idle on a new deploy
    employees.js   -- admin Employees tab
    records.js     -- admin Daily records tab (session grouping, overtime controls)
    report.js      -- admin Monthly report: status-grid calendar + Excel export
    salary.js      -- admin Salary tab (uses js/salary.js's math + report.js's monthData)
  main.js          -- entry point
```

**The one rule that matters most here:** all data access goes through `store.*` — never add a
new `if(DEMO_MODE){...}else{...}` branch in UI code. Add the method to *both* `demoStore.js` and
`supabaseStore.js` behind the same interface, then call `store.xxx()` from the UI module.
Reintroducing DEMO_MODE branches in feature code undoes the point of the store abstraction.

Mutations (add/rename/deactivate employee, edit/delete a record) call `refreshAll()` (exported
from `js/ui/kiosk.js`) afterward to reload `state` from the store, then re-render — punch in/out
is the deliberate exception (mutates `state.openSessions` directly for latency).

## Offline resilience

**Punch outbox pattern**: `supabaseStore.js`'s `clockIn`/`clockOut` never block on the network —
they write instantly to `js/store/outbox.js` (an IndexedDB queue) and return immediately; a
background loop syncs to Postgres/Storage afterward. Losing a punch to a network hiccup was
treated as the one unacceptable failure mode — this is why the design exists.

- **A client-generated `crypto.randomUUID()` IS the eventual Postgres `records.id`** (overrides
  the column's `default gen_random_uuid()` on upsert) — no temp-id reconciliation step. Syncing
  is just `upsert({id: clientId, ...})`, safe to retry.
- Sync fires on every write (`outbox.kick()`), on the browser's `online` event, and every 30s as
  a fallback (`startBackgroundSync`/`runSync` in `outbox.js`/`supabaseStore.js`).
- A row **stays in the outbox** after its clock-in syncs if the session is still open
  (`clockOut`/`listOpenSessions` need to find it locally) — deleted only once `clock_out` is set
  and synced. `getSyncStatus()` therefore does **not** count an open-already-synced-no-error row
  as pending, only one with an unsynced photo blob or a failed attempt — otherwise the
  sync-status indicator would show a permanent false "Syncing…" for anyone clocked in.
- Verified against a real Supabase project with a simulated outage: clock-out resolved in ~4ms
  offline, synced automatically within ~1.5s of reconnect.
- `demoStore.js` doesn't use the outbox (nothing to be offline from against localStorage).
- Manual admin edits (`updateRecordTimes`, `setLunchPaid`, `addManualRecord`, payments,
  overtime) are **plain awaited store calls, not routed through the outbox** — deliberate: the
  outbox exists for the kiosk's high-frequency instant-tap punch flow, not low-frequency
  deliberate desktop edits. A failed write there just shows a retry-able error toast. If a
  session opened on one device needs editing from another, these calls fall back to writing
  straight to Postgres instead of requiring the record in that browser's local outbox.

**Cold boot and session persistence**: a device that has logged in before opens the kiosk
immediately from its persisted Supabase session and validates that session for real in the
background, rather than blocking on a network round-trip first — a stale/expired session with no
network used to take ~20s to resolve and then force a login screen (which itself needs network),
locking out all punching in the meantime. `refreshAll()`'s independent reads run in parallel, and
the store's read-with-fallback calls carry a short client-side timeout, so a cold offline boot
settles in under a second instead of ~9s worst case.

## PWA (installable app)

- `manifest.json` — standalone display, landscape orientation, icons from a calendar-check SVG.
- `sw.js` — hand-rolled, no Workbox/npm: caches same-origin GET requests only, stale-while-
  revalidate, Supabase/CDN traffic untouched.
- Version stamping: CI (`.github/workflows/deploy.yml`) writes a real git-short-SHA + timestamp
  into `version.json`/`js/version.js` at deploy time (the repo keeps `'dev'` placeholders). The
  kiosk shows the version in a small muted corner of the side panel. `js/ui/appVersion.js` polls
  `version.json` every 5 minutes and silently `location.reload()`s once idle (no open
  modal/punch/payment overlay) — a deliberate choice over a "tap to update" prompt, since nobody
  should have to handle that on a shared kiosk.
- **Testing limitation**: service worker registration and camera access (`getUserMedia`) can't be
  verified in the sandboxed Browser pane — both fail there in ways that look like bugs but
  aren't. Manifest validity, icon files, and the version/appVersion wiring are all verifiable in
  the sandbox; actual installability (the "Add to Home Screen" prompt, standalone launch,
  orientation lock, real SW registration) needs a real Chrome/device.

## Lunch-break support

Employees punch multiple in/out sessions per day — needed **no schema change** (`records` never
had a per-day uniqueness constraint). Worked hours are Σ(session durations); the lunch gap is
whatever falls *between* sessions, never a separately-deducted amount. The shop's policy is four
taps a day: morning in, lunch out, lunch in, evening out.

- **Lunch is never inferred — don't re-add a lunch auto-close.** The kiosk is a toggle (what a
  tap does depends on whether the employee is currently open), so any system-initiated
  clock-out desyncs the employee's mental model from the recorded state, and every later tap then
  means the opposite of what they intended. A fixed-cutoff auto-close did exactly this in beta:
  closed at 1:00, the employee tapped at 1:05 to leave for lunch and was clocked *in*, their 3:00
  "back from lunch" tap clocked them *out*, and two hours of lunch got paid as work. The system
  can't tell "leaving for lunch at 1:05" from "back from a 5-minute break", so it must not guess.
  Forgotten lunch taps surface through existing review signals instead: a long unbroken session
  gets the pink `.unbroken` nudge (fix: **Split for lunch**), and a parity flip that leaves the
  day's last session open ends up closed by the stale-session net below and flagged for review.
  Known silent case: forgetting the lunch-out, then re-tapping a minute later, records a
  1-minute "lunch" with no flag (a short-gap review flag would close this — not built yet).
- **Only one gap per day is "lunch"**: with exactly one gap it's always "Lunch" (real usage is
  almost always one break); with 3+ sessions (2+ gaps), only the one nearest
  `LUNCH_CUTOFF_HOUR`/`MINUTE` is "Lunch", the rest render as "Break" (`lunchGapIndex()` in
  `js/reportMath.js`). Purely a label — `dayHoursFromSessions()`'s hours math never cares what a
  gap is called.
- **One automatic clock-out: the forgotten end-of-day one** (`js/staleSession.js`,
  `checkStaleSessionAutoClose()` in `js/ui/kiosk.js`, on load + the 5s poll tick, reusing the
  outbox write path rather than a server-side cron — this app has no backend compute at all, so
  it can't be a scheduled job; it just self-heals whenever the kiosk next happens to be on). A
  session left open overnight would otherwise sit "currently clocked in" forever, turning the
  employee's next tap into a bizarre clock-out instead of a fresh start.
  `shouldAutoCloseStaleSession()`: any open session that did *not* start today gets closed, at
  **midnight** (`endOfDayFor()`) rather than a guessed real punch time — shifts vary in length,
  so there's no single "end of shift" hour, and an obviously-artificial timestamp is a louder,
  harder-to-miss review signal than a plausible-but-wrong one would be. Runs *before*
  `renderHome()`, so a stale session is already gone from `state.openSessions` by the time the
  kiosk draws tiles.
- **No new column needed to mark an auto-close**: a manual punch always has a real
  camera-captured photo; the stale-session close is the only *automatic* way `clock_out` gets set
  while `out_photo` stays `null` (admin-created punches — **Split for lunch**'s morning half,
  `addManualRecord` — are also honestly unphotographed) — that absence alone is the signal.
  `clockOut(recordId, blob, atIso)` only sets `out_photo` when a real blob is passed, and takes an
  explicit `atIso` for the exact close instant (midnight, for a stale session).
- **`needsReview(sessions)`** (`js/reportMath.js`): a day's *last* session having no `out_photo`
  means either genuinely still open or closed with no photo (stale-session midnight close, or an
  admin-added punch) — both get the same "Review required" treatment (Report summary/banner,
  calendar pills, Daily records' "● No clock-out photo" next to "● Still in"). Legacy rows
  auto-closed for lunch before that behavior was removed still exist and read the same way.
- **Daily records grouping**: `renderRecords()` re-groups a date's raw records by employee before
  rendering, since `listRecordsForDate` sorts by `clock_in` globally across everyone (would
  otherwise interleave different people's sessions on a lunch-break day).

## Kiosk "on lunch" tile state

`tileStatus(e)` derives `onLunch` from data (`state.sessionsToday[empId] === 1 && !open`) rather
than a separately-mutated flag, so the tile can't drift from what's actually recorded. Exactly `1`, not "any odd number" or `>= 1`: a day with 2+ completed sessions
already has its normal full-day shape done, and showing "on lunch" past that would invite a stray
extra tap. `state.sessionsToday` is bumped directly at clock-in time (same latency pattern as
`openSessions`/`punchedToday`). `tileStatus()` is exported and reused by Daily records'
missed-clock-in banner — one source of truth instead of two copies that could drift. The resume
badge (`↻`) is distinct from the tap-to-start badge (`▶`) so the difference doesn't depend on
reading the status text.

## Payroll rounding (`js/rounding.js`)

Salary pays on rounded punches, not raw minutes: `roundToQuarterHour()` uses a **grace-window
rule the shop chose directly** — up to 10 minutes past a quarter still counts as that quarter;
past 10 minutes rolls to the next one (10:30 is the exact cutover). Not the DOL's symmetric
7-minute rule this started from — the shop wanted a wider "still on time" window, net-neutral
over a shift since both in and out punches round the same way.

- Daily records and the Report day-detail panel **keep showing exact punch times** (`recHours()`)
  — the audit trail tied to the proof photo. The Report calendar's per-day pill number is the one
  exception: it shows PAID hours (`recHoursRounded()`, via `monthData()`'s `payHours`) so it
  reads the same figure Salary pays on at a glance — the day's *classification* (half/full/
  unbroken) still comes from exact hours, since that's about attendance, not pay. Salary's
  `hoursWorked` uses `recHoursRounded()` throughout.
- Wherever rounding moves a punch, a small "→ 9:15 paid" annotation shows next to the exact time
  (`wasRounded()`), in Daily records and the Report day-detail panel — so a pay figure can be
  explained against the exact time if ever challenged.
- Tested in `js/rounding.test.mjs`: both sides of the cutover, the exact 10:30 tie, hour/day
  rollovers, `recHoursRounded`'s open-session/zero-length cases.

## Lunch-paid override

The owner can opt, per lunch gap, to pay through it as worked time — one tap in Daily records
("Include as paid work"); tapping again fully reverts it, no confirm dialog (reversibility is
the safety net).

- **Schema**: `records.lunch_paid boolean default false`, set on the *earlier* of the two
  sessions the gap sits between. `store.setLunchPaid(recordId, paid)` in both stores.
- **Math**: `dayHoursFromSessions(sessions, hoursFn)` (`js/reportMath.js`) collapses any run of
  sessions chained by `lunch_paid` into one virtual span *before* rounding — a paid-through day
  gets one continuous shift's rounding at its true start/end, not two independently-rounded
  halves plus an unrounded gap. `buildDayHours()`, Daily records' day-header total, and the
  Report day-detail panel all call this same function, so the three screens can't disagree.

## Manual overtime

The owner can add a specific number of extra hours to one employee's specific day, paid at the
**same flat hourly rate as regular hours, no multiplier** — deliberately simpler than an
automatic daily/weekly-threshold overtime scheme, which would have needed a basis and multiplier
nobody had actually decided on.

- **Schema**: `overtime_hours(emp_id, date, hours)`, one row per `(emp_id, date)`, upserted on
  add/edit, deleted on remove. `store.setOvertimeHours`/`listOvertimeForRange`/`removeOvertime`
  in both stores.
- **UI**: `addOrEditOvertime()`/`removeOvertime()`/`overtimeControls()` in `js/ui/records.js` are
  shared between Daily records and the Report calendar's day-detail panel (worked days and paid
  holidays alike), the same one-implementation pattern as `editRecord`/`toggleLunchPaid`.
- **Folded into `payHours`** (calendar pill, Total hrs column, Salary) alongside the exact
  punch-verified hours, which stay untouched as the audit trail. Salary's breakdown shows
  overtime as its own line so the displayed equation doesn't double-count it (the base-hours row
  subtracts overtime back out from the combined total before display).
- Fetches fail soft to `[]` if the `overtime_hours` migration hasn't been applied yet — Report/
  Records/Salary keep working, overtime just doesn't show up that load (see Known gaps: this is
  currently unconfirmed on the live project).

## Holiday, day-off, and payroll model

The weekly holiday (`WEEKLY_HOLIDAY_DAY`, `js/config.js`, default 5/Friday) is unpunched but
paid; any other zero-punch day is an inferred absence. Both the calendar display and the payroll
math below are one connected system — a paid holiday changes how pay is computed, not just how
the calendar looks.

- **Inferred, not recorded**: `dayOffStatus()` (`js/reportMath.js`) classifies a day
  `buildDayHours` already found had zero sessions: `'holiday'` on the weekly holiday, `'off'`
  otherwise, `null` if the day hasn't happened yet or predates the employee (gated on
  `employees.created_at`, checked *before* the holiday check — a Friday before hiring must not
  show as a paid holiday; demo mode has no `created_at` so this gate is always skipped there).
  `monthData()` computes `gapStatus[empId][day]` once per render so the calendar and payroll
  math can't disagree about a given day. Calendar: `.daypill.holiday` (violet, "F"),
  `.daypill.off` (dashed, red, "A") — an actually-worked day always wins and shows
  `.full`/`.half` regardless of weekday. `.off` is dashed rather than solid so it stays distinct
  from a real worked day by shape, not just color.
- **Half day vs. unbroken full day**: a single session under `HALF_DAY_HOUR_THRESHOLD` (75% of
  `STANDARD_DAY_HOURS`, 6 of 8) is `.half` (yellow, hue 54° — kept deliberately far from
  `--amber`'s hue 38° so the two stay visually distinguishable; an earlier, closer shade was
  rejected for exactly this reason). At or above the threshold it's `.full` with an `.unbroken`
  corner dot (`isPossibleMissedLunch()`, pink) — a quiet nudge to check for a missed lunch punch,
  not a review flag, since punch data alone can't tell a real no-break shift from a missed one.
  **"Split for lunch"** (`js/ui/records.js`, `store.splitSessionForLunch`) is a single click, not
  a time picker — picking exact times for a break nobody photographed would add friction without
  real accuracy. `defaultLunchWindow()` centers a 1-hour gap on `LUNCH_CUTOFF_HOUR`/`MINUTE` when
  that window actually fits inside the session, falling back to the session's own midpoint
  otherwise. The new gap defaults `lunch_paid: false` (reaching for Split for lunch usually means
  a suspected missed punch); either half's times are still editable afterward via Edit.
- **Absent-days column + exact-dates detail**: the Report calendar's `Days`/`Total hrs` sticky
  columns sandwich a middle `Absent` column — full absences (`gapStatus === 'off'`) plus **0.5
  per half day**, computed inline in `renderDetailCalendar()` from the same `gapStatus`/
  `isHalfDay()` classification the pills themselves use. Clicking a non-zero value opens
  `infoModal()` (`showAbsenceDetail()` in `js/ui/report.js`) listing the actual dates, re-derived
  from the same classification rather than a second array threaded through from render time.
  **`Days` (any day with a punch) and `Absent` are not complements and won't sum to the days in
  the month by design** — a half day is legitimately counted as attended in one and
  half-missing in the other. This was reviewed and confirmed correct (pay is unaffected either
  way, since `calcSalary()` is hours-based, never day-count-based) — don't "fix" this
  reconciliation without it being raised again.
- **Backfilling a missed punch on an absence**: an absence is sometimes actually a missed punch
  (kiosk down, forgot to tap), not a real no-show. Clicking a red `.off` pill opens
  `addMissedPunch()` (`js/ui/records.js`) — the same clock-in/out time-picker as editing an
  existing record, creating a brand-new one via `store.addManualRecord(empId, date, clockInIso,
  clockOutIso)`. Deliberately **not** wired to a blank "no record" pill (`gapStatus === null`):
  by `dayOffStatus()`'s own gates, that state can only mean a future date or a day before the
  employee was hired — nothing safe to backfill there. A backfilled record has no photo, so
  `needsReview()` catches it too — an honest signal it wasn't camera-verified, not a bug.
- **Docked-holiday pay override**: the owner can exclude one specific paid Friday from one
  employee's pay for a month they've taken more time off than the holiday allowance covers —
  narrower than an arbitrary day off (see Known gaps' Phase 3). Schema: `day_pay_overrides
  (emp_id, date, paid)`, one row per `(emp_id, date)`, upserted. `paid` is stored explicitly
  (rather than the table only ever meaning "unpaid") so the same mechanism could cover the
  opposite direction later without another migration — only "dock a holiday" is wired up today.
  Control lives on the `'F'` pill's day-detail panel (`renderHolidayDetail()`/
  `toggleHolidayPay()` in `js/ui/report.js`) — same reversible, no-confirm shape as lunch-paid;
  Salary itself owns no day-level editing. `monthData()` computes `dockedDays[empId][day]`
  alongside `gapStatus`, true only where the day is *actually* a `'holiday'` gap. The overrides
  fetch fails soft to `[]` if the migration isn't applied yet.
- **Calendar-day payroll model**: standard hours are the *actual* days in that calendar month ×
  `STANDARD_DAY_HOURS` (`js/ui/salary.js`: `standardHours = md.days * STANDARD_DAY_HOURS`) — not
  a fixed 26-day approximation (no `STANDARD_MONTHLY_HOURS` constant exists). Because the
  denominator includes every calendar day, a paid (non-docked) Friday is credited its own
  `STANDARD_DAY_HOURS` into the numerator (`creditedHours = paidFridays * STANDARD_DAY_HOURS`) —
  otherwise Fridays would count against pay, a silent cut every month. A docked Friday simply
  isn't credited (no subtraction) — same treatment as any other absence. `calcSalary()` in
  `js/salary.js` is therefore plain ratio math (`ratio = hoursWorked / standardHours`) with zero
  Friday-specific knowledge; that logic lives entirely in `js/ui/salary.js`.
- **Salary calc panel** (`js/ui/salary.js`) is a bordered `<table class="calc-table">`: Rate used
  → Hourly rate (`monthly_salary ÷ (this month's N days × 8h)`, via `fmtRate()` — 2 decimals, not
  rounded to the rupee like `fmtCurrency`, so `rate × hours` actually reproduces the shown total)
  → Days worked (with paid/docked Fridays called out) → Hours worked (shows the Friday credit and
  overtime inline, e.g. `8:45 + 8:00 (1 paid Friday) + 2:00 (overtime) = 18:45`) → Docked (only
  when applicable) → **Total pay** (`rate/hr × hours = pay`, visually emphasized, `.calc-total`).
  Row + its calc-detail are one `.salary-item` unit (border on the wrapper, not the row) so an
  open panel doesn't visually run into the next employee.
- Tested: `js/reportMath.test.mjs` (`dayOffStatus` precedence incl. Friday-before-hire,
  `isHalfDay`/`isPossibleMissedLunch`, `lunchGapIndex`'s nearest-cutoff/tie-break logic),
  `js/salary.js` (ratio math, `fmtRate` precision). The Friday-crediting logic itself lives in
  the UI layer (`js/ui/salary.js`), deliberately not automated-tested — see Testing below.

## Payments (two-sided cash ledger)

A standalone reconciliation ledger, **not wired into Salary's payroll math** — no money actually
moves through the app, it's a paper trail for pay-reconciliation conversations between the owner
and employee.

- **Independent dual entry, not a request/confirm workflow**: the employee (via kiosk PIN) and
  the owner (via admin) each log what they believe was paid, on their own side, blind to the
  other's entry. Ratification is simply the system comparing sums per employee+date
  (`js/paymentsMath.js`) and flagging mismatches/one-sided entries — humans talk it out in
  person, then the owner can mark a flagged item resolved (reversible toggle, no confirm dialog)
  without necessarily editing either amount.
- **Kiosk entry point** is a standalone "Payments" button in the side-panel footer, visually
  separate from the attendance tile grid (not a mode-switch mixed into it). PIN-gated
  (`employees.pin_hash`/`pin_salt`, hashed via `js/pin.js`, lockout after repeated failures) so
  one employee's payment history stays private from others on the shared kiosk. Saving always
  returns to Attendance mode on the kiosk.
- **Add-payment form is deliberately minimal**: amount + date only, on both the kiosk and admin
  side — method/note fields were cut as unneeded complexity.
- **Schema**: `payments(emp_id, amount, occurred_on, entered_by)`, `payment_resolutions(emp_id,
  date, resolved, note)`. `entered_by` is who logged the row ('employee' | 'owner'), not who was
  paid (`emp_id` always is).
- Payment writes go straight to the store, not through the outbox — see the outbox note under
  Offline resilience above for why.

## Design system

**Kiosk home**: landscape layout — a fixed side panel + a wrapping grid of ID-badge-shaped tiles
(not circles — ties to the "punch clock" identity). Palette reuses the app's existing tokens, no
separate palette. `--green` = "currently clocked in" only (border glow + lift on `.badge-tile.in`);
`--amber` = the lunch tile state and the transient sync indicator; kept distinct from `--blue`
(the one brand accent) so none of the three compete. Side panel wordmark + live clock both in
Bebas Neue (one "signage" identity); no logo mark anywhere. Panel is two flex groups
(`.kiosk-top`/`.kiosk-footer`) so `space-between` on `.kiosk-side` has exactly one gap to
distribute. **The roster line lives inside `.kiosk-identity`, not as a sibling of
`.kiosk-top`/`.kiosk-footer`** — this broke the row's mobile `space-between` layout once already
when tried as a sibling; keep it nested if this area gets touched again.

**Motion**: every tappable control gives real press feedback and springs back to rest via a
`--lift` custom property that composes with state classes (`.badge-tile.in`/`.lunch`/`.missed`)
instead of competing with them on specificity — a prior version tied specificity between
`.badge-tile.in` and `.badge-tile:active` and silently killed press feedback on any
already-clocked-in tile. Confirmation moments (punch, payment, PIN) fade+pop in with an animated
SVG checkmark instead of a hard display cut, closing the "did that register?" gap on a shared,
all-day kiosk. Camera shutter flashes on capture (see `js/camera.js`).

**Admin screens** (Employees/Daily records/Report/Salary) share one grid-list visual language
(`.emp-row`, `.rec-row`, `.report-person`/`.salary-person` in `css/styles.css`), each its own
independent CSS grid with fixed pixel column widths (not `auto`/1fr) so a row with a longer
annotation can't drift its columns out of alignment with the rest of the list. Daily records
groups a lunch-break day into `.rec-group` (one header with the combined total, sessions nested
underneath) — a single-session day stays a plain `.rec-row`.

**Report calendar**: a status-grid, not a plain number table — `Employee` pinned left,
`Days`/`Absent`/`Total hrs` pinned right (`position:sticky`), only the day columns scroll. Each
day is a `.daypill`; base fill colors are `.full` green, `.half` yellow, `.off` (absent) red,
`.holiday` violet — corner dots layer sub-states on top (`.auto` blue = informational,
`.flagged` amber = needs review, `.unbroken` pink = possible missed lunch, `.docked` red = a
deliberate pay deduction), and `.calendar-legend` reuses the real `.daypill` markup at small
scale so it can't visually drift from the actual cells. A pill's own number shows **paid** hours
(e.g. `3:55`), not the day-of-month the header row above it already carries; letter pills
(`F`/`A`) and the still-open `!` are unaffected. The calendar is the **primary, always-visible**
surface on the Report tab (header → month picker → review-alert → calendar → summary metrics).
Clicking a day/pill opens an inline, actionable detail panel (`renderDayDetail()`/
`renderHolidayDetail()` in `js/ui/report.js`) reusing Daily records' own store-backed flows
(`editRecord`/`deleteRecordFlow`/`toggleLunchPaid`/`splitForLunch`, each with an optional
`afterSave` override) rather than a second implementation. Three things worth knowing if this
area gets touched again:
- Every action's `afterSave` is `renderReport()` (rebuilds the whole table — an edit can move
  another day's totals too), so `openDetailKey` (`empId:day`, module-scope) tracks which panel
  to reopen with fresh data afterward.
- The calendar's "click outside closes the open panel" listener explicitly excludes
  `.detail-row`, `.daypill`, `#promptModal`, and `#btnReviewRecords` — missing any of these lets
  that element's own click handler get closed out from under itself a tick after it opens
  something (a real, verified failure mode, not theoretical).
- The old standalone "Employee summary" card is gone, not relocated — its only two genuinely
  unique bits (days-off count, review-state badge) now live under the employee's name in the
  calendar's own sticky `.col-emp` cell, so the two views can't drift apart.

Pinch-zoom (`user-scalable`) toggles on the single `<meta name=viewport>` tag in `switchTab()` —
locked only on the kiosk home tab (stops accidental zoom mid-queue on the shared tablet),
unlocked on every admin tab.

## Known gaps — what's left before go-live

1. **Three placeholder constants in `js/config.js`** still need the shop owner's real numbers:
   `LUNCH_CUTOFF_HOUR`, `MISSED_CLOCKIN_HOUR`, `WEEKLY_HOLIDAY_DAY`. These are the shop's own
   operating facts, not engineering judgment calls — don't change them without being told the
   real numbers. (`LUNCH_CUTOFF_HOUR` is now label-only — it picks which gap reads "Lunch" and
   where "Split for lunch" lands, and no longer affects anyone's pay — so it's the lowest-stakes
   of the three.)
2. **Cross-device clock-out fix is code-reviewed but not re-verified on two real physical
   devices simultaneously** — `clockOut()`'s Postgres fallback (see Offline resilience) fixed a
   real bug where a session opened on one device showed as clockable on another's tile but
   failed with a misleading error. Worth a real two-device pass before relying on it under
   multi-week usage.
3. **Whether the `overtime_hours` migration was actually run against the live Supabase project
   is unconfirmed** (unlike the Payments migration, which was). The feature fails soft if it's
   missing, so this could be silently inert — check with `select count(*) from overtime_hours;`
   in the SQL editor.
4. **Phase 3 — an arbitrary (non-Friday) day off's effect on pay — is undecided**: ambiguous
   between a paid-leave credit (adds hours back for an authorized absence) and an extra deduction
   (penalizes an unauthorized one) — opposite effects on pay, needs a direct answer from the shop
   owner, not a guess. Not a launch blocker on its own.

## Testing

Some pure logic has automated coverage via Node's **built-in** test runner (`node:test` +
`node:assert`) — zero npm installs, zero config, zero build step, consistent with the "no
build step" constraint above (it's testing, not bundling).

- Run everything: `node --test js/` from the project root (104 tests as of this writing, all
  passing).
- Test files are co-located with the code they cover, named `*.test.mjs`.
- Covered: `js/salary.js` (proration, retroactive rate-selection, boundary/leap-year dates,
  `fmtRate` vs `fmtCurrency` precision), `js/store/demoStore.js` (a regression suite for a real
  rename-reverts-on-reread bug), `js/reportMath.js`
  (per-day hours/open-flag accumulation incl. an order-dependent masking regression;
  session-grouping; `needsReview`; `dayHoursFromSessions`' lunch-paid merge across several
  chain shapes; `dayOffStatus`'s holiday/off/nothing-to-show classification incl. the
  Friday-before-hire regression; `isHalfDay`/`isPossibleMissedLunch`'s session-count-plus-hours
  distinction; `lunchGapIndex`'s nearest-cutoff and tie-break logic), `js/rounding.js`
  (both sides of the grace-window cutover, the exact 10:30 tie, hour/day rollovers,
  `recHoursRounded`'s open-session/zero-length cases), `js/staleSession.js` (a session from a
  prior day vs. earlier today vs. already closed; `endOfDayFor()`'s midnight rollover incl.
  across a month boundary), `js/missedClockIn.js`, `js/paymentsMath.js` (matched/mismatch/
  awaiting reconciliation), and `js/pin.js` (hash/verify).
- Deliberately **not** covered: `supabaseStore.js` (touches the real network/DB — verify via the
  console against the live project instead) and the UI layer (no headless-browser tool set up —
  new tooling, ask first). Both stores share the same pure `salary.js`/`reportMath.js`/
  `rounding.js`/`paymentsMath.js` logic rather than duplicating it, so testing it once covers
  both data paths.

## Working conventions established on this project

- Small, reviewable changes — use plan mode for anything non-trivial, get sign-off before
  implementing, keep diffs scoped to one concern.
- Never `git commit`/`push` without the user explicitly asking, even mid-task.
- Test in demo mode via a local server + the Browser pane (or the user's own Chrome, at their
  request, for real-app verification) for UI/logic checks; real camera permission prompts need
  the user's actual Chrome (`Claude in Chrome`) or their own device — the sandboxed Browser pane
  blocks camera access and can't click native OS/browser dialogs (see PWA section for the same
  limitation with service worker registration).
- Everything except camera-driven punches and service worker registration (store calls,
  IndexedDB, Postgres reads) is testable via the console against the real project. New schema (a
  table, a column) needs its migration run in the Supabase Dashboard SQL editor against the live
  project — the anon key checked into the repo can't run DDL.
- **Anonymous Supabase access was considered and rejected** as a way to skip login for
  convenience — it would expose all attendance data to anyone with the public anon key. Don't
  re-suggest this. `DEMO_MODE = true` remains the sanctioned login-free sandbox for dev/testing.
- **`supabase-setup.sql` is not safe to blindly re-run as a whole** against an already-provisioned
  project — `create table`/`alter table ... add column` are idempotent, but `create policy` has
  no such guard in Postgres and errors if the policy already exists. For any schema change, give
  only the new incremental SQL block, never "just re-run the whole file."
- **Token/cost-conscious collaboration**: prefer DOM/JS-based checks (`querySelector`, computed
  styles, `innerText`) over screenshots when the question is about a computed or logical
  property, not a genuinely visual judgment (color, spacing, alignment) — screenshots cost real
  tokens as images. Batch multi-step browser sequences into one call rather than many
  single-action round trips. For "does this look right" checks when Asad is already in the app
  himself, let him look and report back rather than independently re-navigating and
  re-screenshotting to double-check the same thing.
