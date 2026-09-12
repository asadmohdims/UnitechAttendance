# Unitech Attendance — project notes for Claude

Shop attendance kiosk for a small shop (<10 employees). Employees clock in/out by tapping
their tile on a shared tablet; a photo is captured as proof each time. Admin side manages
employees, daily records, and a monthly report (Excel export).

Read `README.md` first for the user-facing feature list and Supabase setup steps. This file
describes *current* behavior and the reasoning worth not re-litigating — not a changelog.
Feature-by-feature history (what changed, when, which commit) lives in `git log`; don't add
narrative iteration history here, just the resulting design and any non-obvious "why".

## Stack & constraints

- Plain HTML/CSS/JS, ES modules, **no build step, no npm, no bundler** — this is deliberate,
  keep it that way. Don't introduce webpack/Vite/TypeScript/a framework without the user
  explicitly asking to change this constraint.
- Backend: Supabase (Postgres + private Storage bucket for photos), schema in
  `supabase-setup.sql`. **A real Supabase project has been live since 2026-09-09**
  (`DEMO_MODE = false` in `js/config.js`) — the deployed site requires real sign-in and reads/
  writes that project. `DEMO_MODE = true` is a separate, deliberate local-only sandbox
  (localStorage, zero network calls, no login) for dev/testing — flip it locally only, never in
  what's deployed. Anonymous Supabase access was considered and explicitly rejected (see
  Working conventions) — don't conflate "skip login for convenience" with this flag.
- Hosting: GitHub Pages, repo `asadmohdims/UnitechAttendance` (public — the Supabase key
  checked into `js/config.js` is the anon/publishable key, safe by design, RLS-protected).
  `.github/workflows/deploy.yml` auto-deploys on every push to `main`, staging into `_site/`
  (excludes `archive/`, the old pre-restructure draft, from the public site).
- `js/main.js` is loaded via `<script type="module">`, so **`file://` won't work** for local
  testing — serve it (`python3 -m http.server 8743` from the project root) and open
  `http://localhost:8743`.

## Architecture

```
index.html          -- markup only
css/styles.css        -- all styles
js/
  config.js             -- SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_MODE
  supabaseClient.js      -- creates `sb`, the Supabase client
  state.js               -- shared mutable `state = {employees, openSessions, onLunch, adminUnlocked}`
  utils.js                -- $, toast, busy, pad, dateStr, fmtTime, fmtHours, recHours
  avatars.js               -- initials-fallback avatar rendering (never shows the wrong photo)
  camera.js                 -- captureFor(emp, mode, onCapture) — owns the camera modal
  salary.js                  -- pure salary math (proration, rate selection) — no store/DOM access
  lunch.js                    -- pure lunch auto-close predicate (cutoff time, shouldAutoCloseForLunch)
  reportMath.js                -- pure per-day hours/review-flag/session-grouping math for the report
  rounding.js                   -- pure payroll rounding (grace-window rule) + recHoursRounded()
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
    records.js                     -- admin Daily records tab (same-day session grouping/dividers)
    report.js                       -- admin Monthly report: status-grid calendar + Excel export
    salary.js                       -- admin Salary tab (uses js/salary.js's math + report.js's monthData)
  main.js                            -- entry point
```

**The one rule that matters most here:** all data access goes through `store.*` — never add a
new `if(DEMO_MODE){...}else{...}` branch in UI code. Add the method to *both* `demoStore.js` and
`supabaseStore.js` behind the same interface, then call `store.xxx()` from the UI module.
Reintroducing DEMO_MODE branches in feature code undoes the point of the store abstraction.

Mutations (add/rename/deactivate employee, edit/delete a record) call `refreshAll()` (exported
from `js/ui/kiosk.js`) afterward to reload `state` from the store, then re-render — punch in/out
is the deliberate exception (mutates `state.openSessions` directly for latency).

## Offline-resilient punches (outbox pattern)

`supabaseStore.js`'s `clockIn`/`clockOut` never block on the network — they write instantly to
`js/store/outbox.js` (an IndexedDB queue) and return immediately; a background loop syncs to
Postgres/Storage afterward. Losing a punch to a network hiccup was treated as the one
unacceptable failure mode — this is why the design exists.

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

## Lunch-break support

Employees punch multiple in/out sessions per day — needed **no schema change** (`records` never
had a per-day uniqueness constraint). Worked hours are Σ(session durations); the lunch gap is
whatever falls *between* sessions, never a separately-deducted amount.

- **Only one gap per day is "lunch"**: with exactly one gap it's always "Lunch" (real usage is
  almost always one break); with 3+ sessions (2+ gaps), only the one nearest
  `LUNCH_CUTOFF_HOUR`/`MINUTE` is "Lunch", the rest render as "Break" (`lunchGapIndex()` in
  `js/reportMath.js`) — fixes a real bug where every gap rendered as a separate "Lunch". Purely a
  label — `dayHoursFromSessions()`'s hours math never cared what a gap was called.
- **Auto-close safety net** (`js/lunch.js`): anyone still clocked in on a session that started
  *today*, before `LUNCH_CUTOFF_HOUR`/`MINUTE` (`js/config.js`, placeholder pending the shop
  owner), gets auto-closed at the cutoff. Client-side and opportunistic
  (`checkLunchAutoClose()` in `js/ui/kiosk.js`, on load + the 5s poll tick), reusing the outbox
  write path rather than a server-side cron.
- **No new column needed to mark an auto-close**: a manual punch always has a real
  camera-captured photo; an auto-close is the *only* way `clock_out` gets set while `out_photo`
  stays `null` — that absence alone is the signal. `clockOut(recordId, blob, atIso)` only sets
  `out_photo` when a real blob is passed, and takes an explicit `atIso` for the exact cutoff
  instant.
- **`needsReview(sessions)`** (`js/reportMath.js`): a day's *last* session having no `out_photo`
  means either genuinely still open or auto-closed-and-never-resumed — both get the same "Review
  required" treatment (Report summary/banner, calendar pills, Daily records' "● Lunch not
  resumed" next to "● Still in").
- **Daily records grouping**: `renderRecords()` re-groups a date's raw records by employee before
  rendering, since `listRecordsForDate` sorts by `clock_in` globally across everyone (would
  otherwise interleave different people's sessions on a lunch-break day).

## Payroll rounding (`js/rounding.js`)

Salary pays on rounded punches, not raw minutes: `roundToQuarterHour()` uses a **grace-window
rule the shop chose directly** — up to 10 minutes past a quarter still counts as that quarter;
past 10 minutes rolls to the next one (10:30 is the exact cutover). Not the DOL's symmetric
7-minute rule this started from — the shop wanted a wider "still on time" window, chosen after
seeing the trade-off (net-neutral over a shift, since both in and out punches round the same way).

- Report and Daily records **keep showing exact punch times** (`recHours()`) — the audit trail
  tied to the proof photo. Only Salary's `hoursWorked` uses `recHoursRounded()`.
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
- Needs the Supabase migration applied before the toggle works against the live project.

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
  `.daypill.off` (dashed, "A") — an actually-worked day always wins and shows `.full`/`.half`
  regardless of weekday.
- **Half day vs. unbroken full day**: a single session under `HALF_DAY_HOUR_THRESHOLD` (75% of
  `STANDARD_DAY_HOURS`, 6 of 8) is `.half` (pink — an earlier teal was too close to full-day
  green to tell apart at a glance); at or above that threshold it's `.full` with an `.unbroken`
  corner dot (`isPossibleMissedLunch()`, pink not violet — violet was too close to the `.auto`
  dot's blue) — a quiet nudge to check for a missed lunch punch, not a review flag, since punch
  data alone can't tell a real no-break shift from a missed one. "Split for lunch"
  (`js/ui/records.js`, `store.splitSessionForLunch`) turns such a session into two around a
  chosen gap; the new gap defaults `lunch_paid: false` (matches every other path that creates a
  gap — reaching for Split for lunch usually means a suspected missed punch, not a cosmetic fix).
- **Docked-holiday pay override**: the owner can exclude one specific paid Friday from one
  employee's pay for a month they've taken more time off than the holiday allowance covers —
  narrower than an arbitrary day off (see Phase 3 below). Schema: `day_pay_overrides(emp_id,
  date, paid)`, one row per `(emp_id, date)`, upserted (`store.listDayPayOverrides()`/
  `setDayOverride()` in both stores; `paid` is explicit rather than the table only ever meaning
  "unpaid" so the same table could cover the opposite direction later without another
  migration). Control lives on the `'F'` pill in the Report calendar's day-detail panel
  (`renderHolidayDetail()`/`toggleHolidayPay()` in `js/ui/report.js`) — same reversible,
  no-confirm toggle shape as lunch-paid; Salary itself owns no day-level editing, by design.
  `monthData()` computes `dockedDays[empId][day]` alongside `gapStatus`, true only where the day
  is *actually* a `'holiday'` gap (a stale override surviving a punch added back for that day is
  ignored). The overrides fetch fails soft to `[]` if the migration isn't applied yet — Report/
  Salary keep working, the toggle just isn't available that load.
- **Calendar-day payroll model**: standard hours are the *actual* days in that calendar month ×
  `STANDARD_DAY_HOURS` (`js/ui/salary.js`: `standardHours = md.days * STANDARD_DAY_HOURS`) — the
  shop owner's explicit instruction, not a fixed 26-day approximation (no `STANDARD_MONTHLY_HOURS`
  constant exists anymore). Because the denominator now includes every calendar day, a paid
  (non-docked) Friday is credited its own `STANDARD_DAY_HOURS` into the numerator
  (`creditedHours = paidFridays * STANDARD_DAY_HOURS`) — otherwise Fridays would count against
  pay for the first time, a silent cut every month. A docked Friday simply isn't credited (no
  subtraction) — same treatment as any other absence. `calcSalary()` in `js/salary.js` is
  therefore plain ratio math (`ratio = hoursWorked / standardHours`) with zero Friday-specific
  knowledge; that logic all lives in `js/ui/salary.js`.
- **Salary calc panel** (`js/ui/salary.js`) is a bordered `<table class="calc-table">`, not
  paragraphs: Rate used → Hourly rate (`monthly_salary ÷ (this month's N days × 8h)`, via
  `fmtRate()` — 2 decimals, not rounded to the rupee like `fmtCurrency`, so `rate × hours`
  actually reproduces the shown total) → Days worked (actual, with paid/docked Fridays called
  out) → Hours worked (shows the Friday credit inline, e.g. `8:45 + 8:00 (1 paid Friday) =
  16:45`) → Docked (only when applicable) → **Total pay** (`rate/hr × hours = pay`, visually
  emphasized, `.calc-total`). Row + its calc-detail are one `.salary-item` unit (border on the
  wrapper, not the row) so an open panel doesn't visually run into the next employee.
- **Phase 3 — day-off-aware deduction for an arbitrary (non-Friday) day off — still undecided**:
  ambiguous between a paid-leave credit (adds hours back for an authorized absence) and an extra
  deduction (penalizes an unauthorized one) — opposite effects on pay, needs a direct answer from
  Asad/the owner, not a guess.
- Tested: `js/reportMath.test.mjs` (`dayOffStatus` precedence incl. Friday-before-hire,
  `isHalfDay`/`isPossibleMissedLunch`, `lunchGapIndex`'s nearest-cutoff/tie-break logic),
  `js/salary.js` (ratio math, `fmtRate` precision). The Friday-crediting logic itself lives in
  the UI layer (`js/ui/salary.js`), deliberately not automated-tested — see Testing below.

## Kiosk "on lunch" tile state

`tileStatus(e)` derives `onLunch` from data (`state.sessionsToday[empId] === 1 && !open`) rather
than a separately-mutated flag — the old `state.onLunch` was only ever set by the auto-close
path, so a *manual* lunch clock-out showed no distinct tile state at all. Exactly `1`, not "any
odd number" or `>= 1`: a day with 2+ completed sessions already has its normal full-day shape
done, and showing "on lunch" past that would invite a stray extra tap. `state.sessionsToday` is
bumped directly at clock-in time (same latency pattern as `openSessions`/`punchedToday`).
`tileStatus()` is exported and reused by Daily records' missed-clock-in banner — one source of
truth instead of two copies that could drift. The resume badge (`↻`) is distinct from the
tap-to-start badge (`▶`) so the difference doesn't depend on reading the status text.

## Design system

**Kiosk home**: landscape layout — a fixed side panel + a wrapping grid of ID-badge-shaped tiles
(not circles — ties to the "punch clock" identity). Palette reuses the app's existing tokens, no
separate palette. `--green` = "currently clocked in" only (border glow + lift on `.badge-tile.in`);
`--amber` = the lunch tile state and the transient sync indicator; kept distinct from `--blue`
(the one brand accent) so none of the three compete. Side panel wordmark + live clock both in
Bebas Neue (one "signage" identity); no logo mark anywhere, considered and dropped. Panel is two
flex groups (`.kiosk-top`/`.kiosk-footer`) so `space-between` on `.kiosk-side` has exactly one
gap to distribute. **The roster line lives inside `.kiosk-identity`, not as a sibling of
`.kiosk-top`/`.kiosk-footer`** — this broke the row's mobile `space-between` layout once already
when tried as a sibling; keep it nested if this area gets touched again.

**Admin screens** (Employees/Daily records/Report/Salary) share one grid-list visual language
(`.emp-row`, `.rec-row`, `.report-person`/`.salary-person` in `css/styles.css`), each its own
independent CSS grid with fixed pixel column widths (not `auto`/1fr) so a row with a longer
annotation can't drift its columns out of alignment with the rest of the list. Daily records
groups a lunch-break day into `.rec-group` (one header with the combined total, sessions nested
underneath) — a single-session day stays a plain `.rec-row`.

**Report calendar**: a status-grid, not a plain number table — `Employee` pinned left,
`Days`/`Total hrs` pinned right (`position:sticky`), only the day columns scroll. Each day is a
`.daypill`; corner dots distinguish sub-states (`.auto` blue = informational, `.flagged` amber =
needs review, `.unbroken`/half-day pink, `.docked` red = a deliberate pay deduction) from the
base fill color, and `.calendar-legend` reuses the real `.daypill` markup at small scale so it
can't visually drift from the actual cells. The calendar is the **primary, always-visible**
surface on the Report tab (header → month picker → review-alert → calendar → summary metrics) —
it used to be a collapsed-by-default card at the bottom, which cost a full scroll and an extra
click on every visit. Clicking a day/pill opens an inline, actionable detail panel
(`renderDayDetail()`/`renderHolidayDetail()` in `js/ui/report.js`) reusing Daily records' own
store-backed flows (`editRecord`/`deleteRecordFlow`/`toggleLunchPaid`/`splitForLunch`, each with
an optional `afterSave` override) rather than a second implementation. Three things worth
knowing if this area gets touched again:
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

## Status / what's done vs. pending

- ✅ Kiosk identification fixes, home screen redesign, modular restructure (store abstraction,
  ES modules) — see Architecture/Design system above.
- ✅ Real Supabase backend live (`DEMO_MODE = false` in production): the offline-resilient
  outbox above, plus a kiosk sync-status indicator (amber "Syncing…" / red "check Wi-Fi").
- ✅ Salary v1: pure proration math in `js/salary.js`, the `salary_rates` table, the Salary tab.
  The standard-hours denominator was a placeholder pending the shop owner — **resolved**, see
  "Calendar-day payroll model" above; no overtime cap yet (see backlog below).
- ✅ **Stage 2 — admin UX**: Daily records' edit/delete go through `promptModal()` (`js/ui/
  modal.js`, `danger` styling + optional fields) instead of native `prompt()`/`confirm()`, with a
  real `<input type=time>` picker; deactivating a clocked-in employee is blocked with a toast
  instead of orphaning their session; Employees/Daily records brought onto the shared grid-list
  design. A short-PIN admin unlock was considered and dropped — full password re-entry stays.
- ✅ Kiosk/admin typography pass: removed the logo mark, both wordmarks in Bebas Neue, kiosk
  panel restructured for deterministic spacing, added the live roster line.
- ✅ **Lunch-break support + Report calendar redesign** — see dedicated sections above.
- ✅ Missed clock-in highlight: "not currently clocked in as of now" (the simpler of two
  possible designs, no schedule/shift-time concept added). `MISSED_CLOCKIN_HOUR` (`js/config.js`)
  is a placeholder pending the shop owner, same status as `LUNCH_CUTOFF_HOUR`/
  `WEEKLY_HOLIDAY_DAY`. Kiosk tile + a Daily records banner (`js/missedClockIn.js`).
- ✅ Kiosk tile redesign + a perf fix stopping `refreshTileStates()`'s 5s tick from re-fetching
  every avatar's signed URL on every poll (split from the full `renderHome()` rebuild).
- ✅ **Payroll rounding + lunch-paid override** — see dedicated sections above. **Overtime is
  the one remaining item from the original time-and-attendance backlog** (see below) —
  deliberately deferred until just before going live, the owner's call.
- ✅ **Cross-device clock-out fix**: `clockOut()` in `supabaseStore.js` required the session in
  *that browser's* local outbox with no fallback, so a session opened on one device showed as
  clockable on another's tile but failed with a misleading error when tapped. Fixed with the
  same "not local → write straight to Postgres" fallback `updateRecordTimes`/`setLunchPaid`/
  `deleteRecord` already had. **Still only code-reviewed, not re-verified against two real
  devices** — worth doing before relying on it under real multi-week usage.
- ✅ **Holiday & day-off visibility, made actionable, docked-holiday override, and the
  calendar-day payroll model** — see the dedicated "Holiday, day-off, and payroll model" and
  "Design system" sections above for the full current mechanism. None of this touched the
  `records` schema or Report/Records' own (exact) hours figures — Salary-only, except the new
  `day_pay_overrides` table. **Phase 3 (arbitrary day-off deduction) is still undecided** — see
  that section.

## Time & attendance backlog — overtime (the one item left)

Missed clock-in, lunch break, and rounding are all done (see Status above). Overtime on top of
the now-rounded, lunch-net hours is the last piece, **deliberately deferred until just before
going live** (the owner's call). Open questions when it's picked up: basis (daily >8h, weekly
>40h, or both), multiplier (1.5x is the common convention but hasn't actually been discussed),
and whether it's a separate line in `calcSalary`'s output or folded into the existing ratio.
Belongs in `js/salary.js` alongside the existing money math, testable with `node --test`.

Also still open, same "ask the owner, don't guess" status: `LUNCH_CUTOFF_HOUR`,
`MISSED_CLOCKIN_HOUR`, `WEEKLY_HOLIDAY_DAY` (`js/config.js`) are the shop's own operating facts,
not engineering judgment calls — don't change these without being told the real numbers.

## Testing

Some pure logic has automated coverage via Node's **built-in** test runner (`node:test` +
`node:assert`) — zero npm installs, zero config, zero build step, consistent with the "no
build step" constraint above (it's testing, not bundling).

- Run everything: `node --test js/` from the project root.
- Test files are co-located with the code they cover, named `*.test.mjs`.
- Covered: `js/salary.js` (proration, retroactive rate-selection, boundary/leap-year dates,
  `fmtRate` vs `fmtCurrency` precision), `js/store/demoStore.js` (a regression suite for a real
  rename-reverts-on-reread bug), `js/lunch.js` (auto-close cutoff predicate, incl. the
  today-only guard against force-closing a stale prior-day session), `js/reportMath.js`
  (per-day hours/open-flag accumulation incl. an order-dependent masking regression;
  session-grouping; `needsReview`; `dayHoursFromSessions`' lunch-paid merge across several
  chain shapes; `dayOffStatus`'s holiday/off/nothing-to-show classification incl. the
  Friday-before-hire regression; `isHalfDay`/`isPossibleMissedLunch`'s session-count-plus-hours
  distinction; `lunchGapIndex`'s nearest-cutoff and tie-break logic), and `js/rounding.js`
  (both sides of the grace-window cutover, the exact 10:30 tie, hour/day rollovers,
  `recHoursRounded`'s open-session/zero-length cases).
- Deliberately **not** covered: `supabaseStore.js` (touches the real network/DB — verify via the
  console against the live project instead) and the UI layer (no headless-browser tool set up —
  new tooling, ask first). Both stores share the same pure `salary.js`/`reportMath.js`/
  `rounding.js` logic rather than duplicating it, so testing it once covers both data paths.

## Working conventions established on this project

- Small, reviewable changes — use plan mode for anything non-trivial, get sign-off before
  implementing, keep diffs scoped to one concern.
- Never `git commit`/`push` without the user explicitly asking, even mid-task.
- Test in demo mode via a local server + the Browser pane (or the user's own Chrome, at their
  request, for real-app verification) for UI/logic checks; real camera permission prompts need
  the user's actual Chrome (`Claude in Chrome`) or their own device — the sandboxed Browser pane
  blocks camera access and can't click native OS/browser dialogs.
- A real Supabase project is live and the `DEMO_MODE=false` path has been runtime-tested
  end-to-end against it, including a real simulated network-outage test — see the outbox
  section above. Camera-driven punches still need the user's actual Chrome/device; everything
  else (store calls, IndexedDB, Postgres reads) is testable via the console against the real
  project. New schema (a table, a column) needs its migration run in the Supabase Dashboard SQL
  editor against the live project — the anon key checked into the repo can't run DDL.
- **Decision: considered and rejected loosening RLS to allow anonymous access** as a way to skip
  login for convenience — it would expose all attendance data to anyone with the public anon
  key, and that exposure is a live-database-level change independent of git branches. Don't
  re-suggest this. `DEMO_MODE = true` remains the sanctioned login-free sandbox for dev/testing.
- **Token/cost-conscious collaboration** (2026-09-12): prefer DOM/JS-based checks
  (`querySelector`, computed styles, `innerText`) over screenshots when the question is about a
  computed or logical property, not a genuinely visual judgment (color, spacing, alignment) —
  screenshots cost real tokens as images. Batch multi-step browser sequences into one call
  rather than many single-action round trips. For "does this look right" checks when Asad is
  already in the app himself, let him look and report back rather than independently
  re-navigating and re-screenshotting to double-check the same thing.
