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

## Lunch-break support (2026-09-11)

Employees punch multiple in/out sessions per day now instead of one — this needed **no schema
change**: `records` already had no per-day uniqueness constraint (its own comment says "one row
per in/out session"), so a lunch break is just an ordinary second clock-in/out pair. Worked
hours are simply Σ(session durations) — the lunch gap is whatever falls *between* sessions,
never an inferred or separately-deducted amount.

- **Only one gap per day is actually "lunch" (fixed 2026-09-12)** — a real bug, not just messy
  test data: `js/ui/records.js` and `js/ui/report.js` both labeled *every* gap between sessions
  "Lunch: Xh Ym", which was fine for the 2-session case (exactly one gap) but wrong the moment a
  day had 3+ sessions — an extra punch (a forgotten tap, a same-day errand, or what actually
  surfaced this: repeated test taps on the real kiosk) meant 2+ gaps, and all of them rendered as
  separate lunch breaks in one day. `lunchGapIndex(sessions)` in `js/reportMath.js` fixes this:
  with exactly one gap it's always "lunch" (unchanged — real usage is almost always one break a
  day, no reason to second-guess what time it happened to fall at), but with more than one gap,
  only the one nearest the shop's configured lunch time (`LUNCH_CUTOFF_HOUR`/`MINUTE` — the same
  constant the auto-close safety net below already uses) gets called "Lunch"; every other gap
  renders as a plain "Break" instead. Purely a labeling fix — `dayHoursFromSessions()`'s hours
  math never cared what a gap was called (a gap is just unpaid time unless `lunch_paid` is set,
  regardless of label), so no payroll figure changed. Covered in `js/reportMath.test.mjs`: the
  single-gap case, a multi-gap case where the nearest-to-cutoff gap wins over an early-morning
  errand, an equidistant tie (picks the earlier gap deterministically), and a 4-session case
  with the winning gap in the middle.
- **Auto-close safety net** (`js/lunch.js`): the one real gap the multi-session model doesn't
  cover by itself — an employee who forgets to tap out for lunch would otherwise sit in one
  long open session and get paid through it. `LUNCH_CUTOFF_HOUR`/`LUNCH_CUTOFF_MINUTE` in
  `js/config.js` (default 1:00pm — a placeholder pending the shop owner, same status as
  `STANDARD_MONTHLY_HOURS`) mark the cutoff; anyone still clocked in on a session that started
  *today* and before the cutoff gets auto-closed at the cutoff time. Deliberately
  **client-side and opportunistic** (`checkLunchAutoClose()` in `js/ui/kiosk.js`, run once on
  load and again on the same 5s tick as the sync-status poll — not a server-side cron), so it
  reuses the existing offline-resilient outbox write path instead of a separate mechanism.
- **No new column needed to mark "this was an auto-close":** a manual punch always has a real
  camera-captured photo (`js/camera.js`'s `captureFor` is the only path to a blob). An
  auto-close is therefore the *only* way `clock_out` gets set while `out_photo` stays `null` —
  that absence alone is the signal. `clockOut(recordId, blob, atIso)` in both stores only sets
  `out_photo`/`out_photo_blob` when a real blob is passed, and takes an explicit `atIso` so an
  auto-close records the exact cutoff instant rather than whenever the periodic check happened
  to run.
- **Abandoned-lunch review flag** (`needsReview()` in `js/reportMath.js`): an auto-close firing
  isn't the same as the situation being resolved — if the employee never taps back in, nothing
  else would ever flag that day, and it would silently read as a clean, unremarkable partial
  shift. `needsReview(sessions)` catches this with one check: a day's *last* session having no
  `out_photo` means either it's genuinely still open (forgot to clock out) or it was
  auto-closed and nothing followed it (forgot to resume) — both get the same "Review required"
  treatment already used for open sessions: the Report summary cards, the top review
  banner/count (wording distinguishes the two cases), the calendar's status pills, and a
  matching "● Lunch not resumed" indicator in `js/ui/records.js` next to the existing
  "● Still in".
- **Daily records grouping**: `renderRecords()` in `js/ui/records.js` re-groups a date's raw
  records by employee before rendering — `listRecordsForDate` sorts by `clock_in` **globally
  across every employee**, which interleaves different people's sessions on a lunch-break day
  — so a same-day second session always renders directly under its first, with a
  "Lunch: Xh Ym" divider between them (`(auto)` appended only when the closing session had no
  photo).
- **Merged to `main`** (commit `c4bcf37`) and live.

## Payroll rounding (2026-09-11, `js/rounding.js`)

Salary pays on rounded punches, not raw minutes: `roundToQuarterHour()` rounds any timestamp to
the nearest 15-minute mark using a **grace-window rule the shop chose directly** — a punch up
to 10 minutes past a quarter still counts as that quarter; only past 10 minutes does it roll to
the next one (10:30 is the exact cutover). This is *not* the DOL's symmetric 7-minute rule the
work started from — the shop wanted a wider "still counts as on time" window than that standard
gives, and explicitly chose it after seeing the trade-off (a wider down-rounding window is still
net-neutral over a full shift, since the same function rounds both the in and the out punch).

- Report and Daily records **keep showing exact punch times** — `recHours()` — since they're the
  audit trail tied to the proof photo. Only Salary's `hoursWorked` comes from `recHoursRounded()`
  (`buildDayHours(recs, empIds, days, recHoursRounded)` in `reportMath.js`).
- Wherever rounding actually moves a punch, a small "→ 9:15 paid" annotation shows next to the
  exact time (`wasRounded()`), in both Daily records and the Report calendar's day-detail panel —
  so an admin can show an employee the exact-vs-counted time if a pay figure is ever challenged,
  not just present a silently-different total.
- Covered by `js/rounding.test.mjs`: both sides of the 10/11-minute cutover, the exact 10:30
  tie, hour- and day-boundary rollovers, and `recHoursRounded`'s null-for-open-session case.

## Lunch-paid override (2026-09-11)

The owner can opt, per lunch gap, to pay through it as if it were worked time — a real feature
request from reviewing a simulated month, not a hypothetical. One tap in Daily records
("Include as paid work" on the lunch divider); tapping again fully reverts it — that
reversibility *is* the safety net, so there's no separate confirm dialog.

- **Schema**: `records.lunch_paid boolean default false` (see `supabase-setup.sql`), set on the
  *earlier* of the two sessions the gap sits between — a flag, never a change to the punch times
  themselves. `store.setLunchPaid(recordId, paid)` in both `demoStore.js`/`supabaseStore.js`.
- **Math**: `dayHoursFromSessions(sessions, hoursFn)` in `reportMath.js` collapses any run of
  sessions chained by `lunch_paid` into one virtual span *before* calling `hoursFn` — so a
  paid-through day gets one continuous shift's rounding at its true start/end, not two
  independently-rounded halves plus an unrounded gap stitched on. `buildDayHours()` uses this
  for Report/Salary's totals; `js/ui/records.js`'s day-header total and `js/ui/report.js`'s
  day-detail panel both call the same function directly, so all three screens can never disagree
  about a lunch-paid day's total.
- Needs the Supabase migration applied (done, per the owner, 2026-09-11) before the toggle works
  against the live project — a fresh clone/reset would need to re-run that `alter table`.

## Holiday & day-off visibility — Phase 1 (2026-09-11)

First of a 3-phase piece of work: (1) this phase — make Friday's paid holiday and an
employee's days off visible in the monthly report; (2) make the monthly view's day-detail
actionable instead of read-only, so a correction doesn't require a trip to Daily records; (3)
day-off-aware salary deduction. Phases 2 and 3 are not started yet.

This phase is **purely visibility — no schema change, no new store method**. `WEEKLY_HOLIDAY_DAY`
(`js/config.js`, default 5/Friday, same "placeholder pending the owner" status as
`LUNCH_CUTOFF_HOUR`/`MISSED_CLOCKIN_HOUR`) is the one thing that would need to change if the
shop's weekly off day is ever something other than Friday. `STANDARD_DAY_HOURS = 8` was pulled
out of `STANDARD_MONTHLY_HOURS` (still `= STANDARD_DAY_HOURS * 26`) so Phase 3's per-day salary
deduction shares the same number instead of a second hardcoded `8`.

- **A day off is inferred, not recorded** — a deliberate call (owner's, 2026-09-11): rather than
  requiring the owner to explicitly mark every day off, any active employee's day with zero
  punches is treated as one automatically. `dayOffStatus()` (`js/reportMath.js`) is the single
  place this is decided, given a day that `buildDayHours` already found had no sessions at all:
  `'holiday'` if it's the weekly holiday, `'off'` otherwise, or `null` if the day hasn't happened
  yet or predates the employee (checked via `employees.created_at`, gated *before* the holiday
  check — a Friday before someone was hired must not show as a paid holiday). An explicit
  "owner adds a reason for a specific day off" capability was intentionally deferred rather than
  built now — the owner wants the ability eventually, but only "if needed," and it doesn't gate
  anything in this phase.
- `monthData()` in `js/ui/report.js` computes `gapStatus[empId][day]` once per render, exactly
  the way `hours`/`openFlags`/`reviewFlags` already work — the calendar pills and the employee
  summary's days-off count read the same array, so they can't disagree about a given day.
- **Calendar**: `.daypill.holiday` (new `--violet` token, filled, labelled "F" for Friday — a
  frequent, expected state worth reading at a glance) and `.daypill.off` (dashed border, labelled
  "A" for absent/day off, reuses the existing `--muted`/`--border` tokens rather than a second
  new accent — deliberately quieter, since it's inferred rather than confirmed data). A day
  actually worked always wins and shows as `.full`/`.half` regardless of whether it's a Friday —
  the pill reflects what happened, not what day it is. New legend rows for all of these in
  `index.html`.
- **Half day** (added 2026-09-11 on owner feedback after seeing Phase 1 live): a day with
  exactly one session — as opposed to the two-session morning+afternoon pattern a full day
  normally has now that lunch breaks are routinely punched separately — gets its own
  `.daypill.half` color (`--pink`) instead of blending into `.full`. The first color chosen,
  `--teal` (`#2dd4bf`), sat close enough to `--green` (`#22c55e`) in both hue and brightness
  that the owner misread a real full pill as half at a glance — switched to pink specifically
  because it's far from green on the color wheel, unlike every other candidate close to an
  already-used hue.
  `isHalfDay(sessions, hoursWorked)` in `js/reportMath.js` originally used session count alone,
  which the owner correctly flagged as confusing once real-looking data hit it: a genuine
  9-hour single-session day (worked straight through, no break) read identically to a real
  4-hour half day. Fixed the same day by also checking hours — a single session needs to fall
  under `HALF_DAY_HOUR_THRESHOLD` (75% of `STANDARD_DAY_HOURS`, so 6 of 8) to count as half;
  a single session close to a full day's hours now correctly stays `.full`. `hoursWorked` is
  the day's already-computed total from `buildDayHours` (not re-derived), so this can never
  disagree with the hours figure shown elsewhere on the same day.
- **"Split for lunch" (added 2026-09-11)** is the owner's chosen way to handle that caveat: for
  a genuinely worked-straight-through day, `js/ui/records.js`'s `singleSessionRow` gets a "Split
  for lunch" action (any closed single session) that turns it into two sessions around a chosen
  gap — `store.splitSessionForLunch(recordId, lunchStartIso, lunchEndIso)` in both
  `demoStore.js`/`supabaseStore.js`. Needed **no schema change** (`lunch_paid` already existed):
  the new later session inherits the original record's real `out_photo` (moved, not duplicated),
  so the day's last session always keeps a genuine photo and never misreads as an unresolved
  auto-close (`needsReview()` in `reportMath.js`); the earlier (new-shape) session's `out_photo`
  is null at the split point since nothing was actually photographed there — same as any
  auto-close, which is also why its lunch divider reads "(auto)" in Daily records even though
  a human did this, not the cutoff safety net. Cosmetic only (no functional effect), flagged as
  a known label overlap rather than fixed, since disambiguating would need a new column for a
  minor wording issue. The split defaults `lunch_paid: true` on the earlier session so the
  day's total pay is unchanged unless the owner deliberately un-marks it afterward — the point
  is reclassifying the calendar pill, not accidentally docking pay for a break that was never
  actually taken.
- **Employee summary**: an always-visible "● N days off" line under the employee's name
  (`.report-daysoff` — muted, bold) is the actually-prominent surface for this, per the owner's
  "very clearly" ask; the calendar pill alone is small enough to miss when scanning.
- Tested in `js/reportMath.test.mjs` — the Friday/holiday precedence, the today-is-eligible
  boundary, and the regression this guards against: checking weekday before `employeeSince`
  would have paid someone a "holiday" for a Friday before they were ever added.
- **Jump-to-Daily-records from the day-detail panel (2026-09-11)**: this was the actual "for any
  amends they need to go to daily view, select date and then make a change" complaint from the
  original review — `toggleDayDetail()` in `js/ui/report.js` was read-only (see its own comment:
  "the toggle itself lives in Daily records"), so fixing a flagged day still meant leaving the
  calendar, opening Daily records, and re-picking the date by hand. Rather than build full inline
  editing into the calendar (a bigger change — real Phase 2 scope, not started), the smallest fix
  that actually closes that loop: a `↗` icon button (`.detail-jump`, title/aria-label carry the
  meaning since there's no room for label text) appended to the same chip row, reusing the exact
  `setRecordsDate()` + `switchTab('records')` pair the review banner's "Review entries" button
  already used for the *first* flagged entry — now available from *any* day's detail panel, not
  just the first flagged one.

## Kiosk "on lunch" tile state (2026-09-11)

Prompted by the owner walking through the employee-facing tap flow and finding it confusing —
a deep-dive (see chat history around this date) found the real issue wasn't the number of
taps, it was an asymmetry: an employee who **manually** tapped out for lunch got no distinct
tile state at all (identical to "never showed up" or "done for the whole day"), while only an
employee the auto-close safety net caught got the amber "On lunch" treatment. Backwards — the
person who did the right thing was the one left with no feedback.

- **Fixed by deriving "on lunch" from data instead of a separately-mutated flag.** The old
  `state.onLunch` (`js/state.js`) was only ever set by the auto-close path
  (`checkLunchAutoClose()`) and cleared on the next clock-in — a manual clock-out never touched
  it, which was the actual bug. Replaced with `state.sessionsToday[empId]` (count of today's
  records, open or closed, built in `refreshPunchedToday()` in `js/ui/kiosk.js`).
  `tileStatus(e)` now computes `onLunch = !open && sessionsToday[e.id] === 1` — true whenever
  exactly one session is done and none is open, **regardless of whether that session ended
  itself (manual tap) or was closed by the safety net** — so the two cases can no longer
  disagree on what the tile shows.
- **Why exactly 1, not "any odd number" or ">= 1"**: a day with 2+ completed sessions already
  has its normal full-day shape done — showing "on lunch" past that point would invite a stray
  extra tap that creates a spurious 3rd session. Verified live: a genuinely-completed
  two-session day correctly falls through to the plain idle tile, not amber.
- `state.sessionsToday` is bumped directly at clock-in time in `handlePunchCapture()`
  (matching the existing pattern for `openSessions`/`punchedToday` — mutate immediately for
  latency, don't wait for the next `refreshAll()`), otherwise a stale in-memory count would
  re-label a genuine end-of-day clock-out as "on lunch" again for the rest of that session.
- **Resume gets its own badge glyph** (`↻`, distinct from the plain `▶` used for "tap to
  start") — a tap here means "continue where you left off," not "begin," and that shouldn't
  depend on the employee reading the status text or noticing the border color.
- `tileStatus()` is now exported and reused by Daily records' missed-clock-in banner
  (`js/ui/records.js`), replacing that screen's own inline reimplementation of the same
  open/on-lunch/missed rule — one source of truth instead of two copies that could drift.
- **Deliberately not changed**: the underlying 2-session-per-lunch-break data model, the
  auto-close safety net itself, and how pay is calculated — this was scoped as a UI-only fix
  after the owner explicitly chose it over a bigger "true 2-taps-a-day, pay in full by
  default" redesign, which would have been a payroll-policy change, not a UI one.

## Design system (kiosk/home screen)

Landscape layout: a fixed side panel + a centered, wrapping grid of ID-badge-shaped employee
tiles (not circles — deliberate, ties to the "punch clock" identity). Palette reuses the app's
own existing tokens (`--bg`, `--blue`, `--ink`, `--muted` etc. in `css/styles.css`) — no
separate palette was introduced. `--green` is reserved specifically for the "currently clocked
in" signal (border glow + lift on `.badge-tile.in`), kept distinct from `--blue` (the one
UI/brand accent) so the two don't compete. A third tile state, `.badge-tile.lunch`, was added
for the lunch-break feature (auto-closed, hasn't tapped back in) — it uses `--amber`, which
today is otherwise only a small transient "Syncing…" text color, so claiming it for a third
persistent tile state doesn't blur what `.in`/`--blue` already mean.

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

Daily records was redesigned again (2026-09-11) once the lunch-paid feature made a plain list of
same-weight rows genuinely hard to read: a lunch-break day now renders as `.rec-group` — one
header (`.rec-group-header`: avatar, name, status badge, and the day's *combined* total) with
the individual sessions nested underneath as indented `.rec-session-row`s, so the total is never
mental arithmetic and the exact per-punch audit trail is still one glance away. A single-session
day still renders as the plain `.rec-row` from before — the grouped treatment only exists where
it's needed. Because each `.rec-row`/`.rec-group` is its own independent CSS grid (not a shared
table), their column widths are fixed pixel values rather than `auto`/1fr-content-based — a row
with a longer "paid" rounding annotation would otherwise size its own columns wider than a plain
row and the columns would drift out of alignment down the list.

The Report tab's detailed calendar was redesigned (2026-09-11) from a plain number-per-day
table into a status grid — the old design had no room for what a day can now contain (more
than one session, a lunch gap, whether it was auto-closed), and had no horizontal scroll
container at all, so `Total hrs` was clipped off-screen entirely at the app's own 980px width.
`Employee` stays pinned left and `Days`/`Total hrs` stay pinned right via `position:sticky`
(`#reportTable .col-emp`/`.col-days`/`.col-total`), so those columns are never what scrolls —
only the day columns are. Each day is a `.daypill` (green "full", amber "!" "review", or an
amber-bordered "full" with a corner dot for "flagged") rather than a number/IN/dot — a small
corner-dot decorator distinguishes an auto-close that resolved fine (blue, informational, see
`.daypill.auto`) from one that never got resumed (amber, folded into the same review flag as a
genuinely-open session, see `.daypill.flagged`). A `.calendar-legend` below the table explains
the states by reusing the exact `.daypill` markup at a smaller scale, so it can't visually
drift out of sync with the real cells. Clicking a day expands an inline row with that day's
actual session times/lunch gap (`toggleDayDetail()` in `js/ui/report.js`) — the expanded panel
is itself `position:sticky; left:0` so it stays in view regardless of horizontal scroll
position, and a document-level click listener closes it on any click outside a pill or the
open row itself.

**Report calendar day-detail made actionable — Phase 2 of holiday/day-off visibility**
(2026-09-12): the day-detail panel above (`toggleDayDetail()`) was purely read-only except for
the Phase-1-era jump-to-Daily-records button — any correction still meant leaving the calendar,
finding the date again in Daily records, and coming back. `renderDayDetail()` (split out of
`toggleDayDetail()`, which now just tracks open/closed) adds Edit and Delete per session, a
lunch-gap paid-work toggle, and Split for lunch (on a closed single session) directly inline —
by calling the exact same store-backed flows Daily records itself uses
(`editRecord`/`deleteRecordFlow`/`toggleLunchPaid`/`splitForLunch`, all now exported from
`js/ui/records.js` with an optional `afterSave` override, defaulting to `renderRecords` so
Daily records' own behavior is unchanged) rather than a second implementation of any of them.
Two things worth knowing if this area gets touched again:
- Every action's `afterSave` is `renderReport()`, not a targeted DOM patch — an edit here can
  change another day's totals too (a lunch-paid toggle moves hours across the month total), and
  this panel has no local copy of `monthData` to patch in place. `renderReport()` rebuilds the
  whole table from scratch, which would otherwise silently close whichever day's panel the admin
  was looking at mid-edit — `openDetailKey` (`empId:day`) is tracked at module scope specifically
  so `renderDetailCalendar()` can reopen the same day's panel, with fresh data, right after.
- `promptModal()` (Edit/Delete/Split all use it) renders as a separate overlay elsewhere in the
  DOM, not nested inside `.detail-row` — the calendar's own "click outside closes the open
  panel" listener has to explicitly exclude `#promptModal` too, not just `.detail-row`/`.daypill`,
  or clicking that modal's own Save button bubbles up and closes the panel a tick before the
  save's `afterSave` gets a chance to reopen it (verified this was a real failure mode before the
  exclusion was added, not just a theoretical one).
Verified end-to-end in demo mode (Browser pane): edit, delete, lunch-paid toggle, and split all
correctly update the day's/month's totals and the calendar pill color, and the panel survives a
save and stays open on the same day. Not a schema change, not a payroll-math change — existing
`node --test js/` suite (79 tests) still passes unmodified.

**Panel alignment + jump-button prominence fix (2026-09-12).** Every chip and button for the
whole day used to be siblings in one flex-wrap container, so a 2-session day wrapped wherever it
ran out of width rather than at a session boundary — real feedback from a live screenshot, not
hypothetical. Now each session (and the lunch/break gap before it) is its own `.detail-row-line`,
and within a session row, Edit/Delete/Split are grouped into a non-wrapping `.detail-actions`
cluster (same punches/actions split `js/ui/records.js`'s `sessionContent()` already uses) — a
narrow panel now wraps a whole cluster onto its own line instead of stranding a single button.
The Worked/Paid total and the jump-to-Daily-records button moved into their own `.detail-footer`
row (a border-top divider sets it apart as the summary/exit row), and the jump button itself
changed from a bare 32px icon-only square to a labeled, blue-accented button ("Open in Daily
records →") — it was easy to miss as a plain icon at the tail of a wrapped chip line before.

**Monthly report restructured around the calendar as the primary surface (2026-09-12).** Once
the day-detail panel became actionable (Phase 2 above), the page layout still treated the
calendar like optional supplementary detail: it was the *last* thing on the page, inside a card
that was `display:none` until a "View detailed calendar" text link was clicked. Every visit cost
a full scroll-past-everything plus an extra click before you could do anything — a UX review
prompted by the owner. New order in `index.html`'s `#tab-report`: header → month picker →
review-alert (conditional) → **the calendar, always rendered, no toggle** → the 3 summary metric
tiles (Recorded hours / Attendance days / Needs review), now below it as reference info rather
than the first thing shown.
- **The standalone "Employee summary" card is gone, not just moved.** It showed avatar, name,
  days-worked, days-off count, review status, and total hours per employee — but `#reportTable`
  already had a pinned Employee/Days/Total-hrs column showing four of those five things. Only
  the days-off count and review-status badge were genuinely unique. `renderDetailCalendar()` in
  `js/ui/report.js` now builds those two as a small `.report-daysoff`/`.report-state` block
  under the employee's name in the calendar's own sticky `.col-emp` cell (reusing the exact same
  CSS classes the old card used, just relocated) — so nothing shown before is actually lost, one
  whole section is deleted instead of just relocated, and the two views of the same numbers can
  no longer drift apart from each other. `.emp-name`'s `align-items` changed from `center` to
  `flex-start` to keep the avatar aligned with the name now that this cell can be multi-line.
  Dead CSS removed: `.report-person`, `.report-detail-toggle`, `.report-number`,
  `.report-days-inline` (and their mobile-breakpoint overrides) — checked via `grep -rn` across
  `js/`/`index.html` first, since `.report-list`/`.report-list-head`/`.report-avatar`/
  `.report-name`/`.report-detail`/`.report-daysoff`/`.report-state` all turned out to be shared
  with Daily records, Employees, and/or Salary and had to stay.
- **The review-alert's "Review entries" button no longer switches to the Daily records tab** —
  it opens the flagged day's detail panel directly in the calendar below (via the same
  `renderDayDetail()`/`openDetailKey` machinery a pill click uses) and scrolls it into view. Now
  that the calendar can actually fix a flagged entry in place, leaving the tab to do it was the
  one remaining "passive vs. actionable" mismatch on the page — this button is a prompt that
  leads *into* the tool, not a summary to read *after*, which is also why it's the one thing that
  stayed positioned above the calendar rather than moving down with the metrics. Needed one more
  fix once wired up: the calendar's own "click outside an open panel closes it" listener didn't
  know about this button, which lives outside `.detail-row`/`#promptModal` — without excluding
  `#btnReviewRecords` too, that same click would close the panel a tick after this handler opened
  it (found and fixed during verification, not theoretical).
- The `#reportDetail` card gained its own header ("Attendance calendar" + the resolved month
  label) since the old toggle button's text was doing that labeling job implicitly; the
  "No completed attendance for this month" empty-state message moved into this card too.
- Purely a layout/markup change — no schema, no payroll math touched; all 84 tests pass
  unmodified. Verified in demo mode (Browser pane): calendar visible with no click needed,
  days-off/review badges match what the old card showed, review-alert opens the correct day
  in place, empty-state and mobile (sticky columns, horizontal scroll) all still work.

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
  yet (see "Time & attendance backlog" below).
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
- ✅ **Lunch-break support + Report calendar redesign** (2026-09-11) — see the dedicated
  "Lunch-break support" section above and the Design system paragraph on the status-grid
  calendar. Merged to `main`.
- ✅ Missed clock-in highlight (commit `3951074`): resolved as "not currently clocked in as of
  now" — the simpler of the two forks, no schedule/shift-time concept added. `MISSED_CLOCKIN_HOUR`
  in `js/config.js` is a placeholder pending the shop owner, same status as
  `STANDARD_MONTHLY_HOURS`/`LUNCH_CUTOFF_HOUR`. Kiosk tile + a Daily records banner
  (`js/missedClockIn.js`).
- ✅ Kiosk tile redesign (commit `2089f2e`) and a perf fix (commit `acd0510`) stopping
  `refreshTileStates()`'s 5s tick from re-fetching every avatar's signed URL on every poll —
  see the split between it and the full `renderHome()` rebuild in `js/ui/kiosk.js`.
- ✅ **Payroll rounding + lunch-paid override** (2026-09-11) — see the dedicated sections above.
  The 15-min rounding rule and the lunch-paid toggle are both live; **overtime is the one
  remaining item from the original time-and-attendance backlog** — see below. The owner has
  said he'll tackle it just before going live, not now.
- ✅ **Cross-device clock-out fix** (2026-09-11): `clockOut()` in `supabaseStore.js` required
  the session to exist in *that browser's* local outbox, with no fallback — so a session opened
  on one device (or one whose local outbox had already been cleared after syncing) would show as
  clockable on another device's tile, then fail with a misleading "check internet" message when
  tapped. The lunch auto-close safety net had the identical exposure, since it runs against
  `state.openSessions`, which already merges in sessions from *other* devices via
  `listOpenSessions()`. Fixed by giving `clockOut()` the same "not local → write straight to
  Postgres" fallback `updateRecordTimes`/`setLunchPaid`/`deleteRecord` already had; the auto-close
  loop in `js/ui/kiosk.js` also now isolates one record's failure so it can't block the rest of
  that tick. Not yet re-verified against the live project with a real second device — worth
  doing before relying on it for real multi-week usage.
- 🔶 **Holiday & day-off visibility — Phases 1 and 2 done** (Phase 1: 2026-09-11; Phase 2:
  2026-09-12, still on branch `feature/holiday-dayoff-visibility`): see the dedicated sections
  above. Friday's paid holiday and an inferred day off are visible in the monthly report;
  the calendar's day-detail panel is now actionable in place (edit/delete/lunch-paid/split)
  instead of read-only. Neither phase touched a schema or any payroll figure.
  **Phase 3 (day-off-aware salary deduction) was deliberately left un-started on 2026-09-12** —
  see "Autonomous session — decisions deferred, not skipped" below for why and for the two
  candidate designs to choose between.

## Autonomous session (2026-09-12) — decisions deferred, not skipped

Asad asked Claude to clear the entire remaining backlog unattended in one session, calling out
any decision points rather than pausing for approval. Everything engineering-scoped and
unambiguous got built (Phase 2 above). Three items were deliberately left alone instead of
guessed at, because guessing them wrong means a real employee gets paid the wrong amount, or
this file starts asserting shop facts nobody actually confirmed — both worse outcomes than
waiting one more day for a two-line answer:

- **Overtime (the time & attendance backlog item below) — not attempted.** Not an oversight:
  Asad himself deferred this "until just before going live" on 2026-09-11, one day before this
  session. Building it anyway would have overridden that call rather than executed it. The open
  questions below (daily vs. weekly basis, separate line vs. folded ratio, and now also: what
  multiplier — 1.5x is the common convention but was never actually discussed here) are exactly
  the kind of thing this file's own "ask before a significant choice" convention exists for.
- **Phase 3, day-off-aware salary deduction — not attempted.** The backlog line itself
  ("manual per employee/month per the owner's call") is honestly ambiguous between two real
  designs, and they move pay in opposite directions:
  1. *A paid-leave credit* — a per-day toggle (symmetric to the existing `lunch_paid` override)
     that adds `STANDARD_DAY_HOURS` back into that period's `hoursWorked` for a specific inferred
     "off" day, so a day the owner authorizes doesn't cost the employee the automatic ratio
     reduction it causes today.
  2. *An extra deduction* — the owner flags a specific unauthorized absence for a penalty
     *beyond* the automatic ratio reduction that already happens today (an "off" day already
     contributes zero hours toward `STANDARD_MONTHLY_HOURS`, which already reduces pay
     proportionally — this only matters if that automatic effect is considered insufficient).
  Note also that today's `STANDARD_MONTHLY_HOURS = 8 × 26` already assumes the weekly holiday as
  a non-work day baked into the 26, so Friday itself likely needs no separate salary handling at
  all — only genuine "off" days do. Picking wrong here means shipping a live payroll feature
  that moves real pay in a direction nobody asked for; this needs one direct question to Asad,
  not an inferred answer.
- **Config placeholders unchanged** (`STANDARD_MONTHLY_HOURS`, `LUNCH_CUTOFF_HOUR`,
  `MISSED_CLOCKIN_HOUR`, `WEEKLY_HOLIDAY_DAY` in `js/config.js`) — these are the shop's own
  operating facts (actual hours/days worked, actual lunch/missed-clock-in cutoffs), not
  engineering judgment calls. Left exactly as before.
- **Cross-device clock-out fix — still only code-reviewed, not re-verified live.** The Status
  entry above already flagged this as needing a real second device; that's still true. This
  session didn't attempt it against the live Supabase project either — the sandboxed preview
  browser can't drive the camera, and deliberately avoided writing synthetic test rows into the
  live production `records` table to fake the "opened on another device" case, since that's
  real shop data and the risk (a stray row, however briefly) wasn't worth taking unsupervised.
  Re-read `clockOut()`/`updateRecordTimes()`/`setLunchPaid()`/`splitSessionForLunch()`'s
  "not in local outbox → write straight to Postgres" fallback in `supabaseStore.js` line by
  line instead — the logic is sound on inspection, but "logic looks right" and "verified against
  two real devices" are different claims, and only the second is the one CLAUDE.md originally
  asked for.

## Time & attendance backlog — overtime (the one item left)

Everything else from the original four-item backlog (missed clock-in, lunch break, rounding) is
done — see Status above. Overtime calculation on top of the now-rounded, lunch-net hours is the
last piece, **deliberately deferred until just before going live** (the owner's call, 2026-09-11).
Open questions when it's picked up: basis (daily >8h, weekly >40h, or both), and whether it's a
separate line in `calcSalary`'s output or folded into the existing ratio — can draw on real
lunch-break and rounding data rather than raw punch times. Belongs in `js/salary.js` alongside
the existing money math, testable with `node --test` the same way.

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
  rule, boundary/leap-year dates), `js/store/demoStore.js` (a regression suite for a real
  bug found 2026-09-09: the employee loader was silently reverting any rename back to the
  hardcoded seed name on every subsequent read — see the "rename survives a subsequent read"
  test, which fails against the old code and passes against the fix), `js/lunch.js` (the
  auto-close cutoff predicate — before/after the cutoff, the today-only guard against
  force-closing a stale prior-day open session, a session that started after the cutoff), and
  `js/reportMath.js` (per-day hours/open-flag accumulation, including the regression test for
  an order-dependent bug where a closed session's hours could mask a same-day still-open
  session; the session-grouping behind the calendar's click-through detail; `needsReview`'s
  logic for both "still open" and "auto-closed, never resumed"; and `dayHoursFromSessions`'s
  lunch-paid merge — not flagged, flagged on the last session of a day, a chain of 3+ sessions,
  merging under a rounding `hoursFn`, and a still-open session after a flagged one; and
  `dayOffStatus`'s holiday/off/nothing-to-show classification, including the Friday-before-hire
  precedence regression and the "no `employeeSince`" demo-mode case; `isHalfDay`'s
  session-count-plus-hours distinction, including the regression this guards against — a
  single session with close to a full day's hours must NOT read as a half day; and
  `lunchGapIndex`'s single-gap-is-always-lunch case, a multi-gap case where the nearest-to-
  cutoff gap wins over an early-morning errand, a deterministic tie-break, and a 4-session case
  with the winning gap in the middle), and `js/rounding.js` (both
  sides of the 10/11-minute grace-window cutover, the exact 10:30 tie, hour/day rollovers, and
  `recHoursRounded`'s open-session and zero-length cases).
- Deliberately **not** covered by automated tests: `supabaseStore.js` (touches the real
  network/DB — a proper test would need a mocked client or a disposable test project; keep
  verifying it via the console against the live project, per the working conventions below)
  and the UI layer (no headless-browser test tool is set up — that would be new tooling, ask
  first). Because both stores share the same pure `salary.js`/`reportMath.js`/`rounding.js`
  logic rather than duplicating it, testing that logic once covers correctness for both the
  demo and production data paths — `supabaseStore.js` itself is thin CRUD with little logic of
  its own left to break, though the cross-device `clockOut()` fallback (see Status above) is a
  recent exception worth a real-device re-check before trusting it under load.

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
