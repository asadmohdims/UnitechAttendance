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
- **No CDN dependencies at runtime.** supabase-js, SheetJS and the Bebas Neue font are checked
  in (`vendor/`, `assets/fonts/`), pinned, with provenance and upgrade steps in
  `vendor/README.md`. A CDN `<script>`/stylesheet in `<head>` holds up the whole page until it
  loads and can't be pre-cached by the service worker. That's what made the kiosk "wait for
  Wi-Fi to show the page". `js/swPrecache.test.mjs` fails if one is re-added.
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
  git-short-SHA + timestamp into `version.json`/`js/version.js`/`sw.js` (see PWA section below).
- `js/main.js` is loaded via `<script type="module">`, so **`file://` won't work** for local
  testing — serve it (`python3 -m http.server 8743` from the project root) and open
  `http://localhost:8743`.

## Architecture

```
index.html      -- markup only
manifest.json   -- PWA manifest (standalone, landscape)
sw.js           -- hand-rolled service worker: pre-caches the app shell, serves it cache-first
version.json    -- deploy-time version stamp (CI-written; 'dev' placeholder in repo)
css/styles.css  -- all styles (incl. the self-hosted @font-face)
vendor/         -- pinned third-party libraries (supabase-js, SheetJS) + README with provenance
assets/fonts/   -- self-hosted Bebas Neue (latin + latin-ext)
js/
  config.js          -- SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_MODE, shop config constants
  version.js         -- deploy-time version stamp, JS form (CI-written; 'dev' in repo)
  supabaseClient.js  -- creates `sb`; network time limits (withTimeout, per-request cap);
                        reads this device's saved session locally (persistedSession);
                        onSignInRestored() for resync after a sign-in renewal
  signedOutGuard.js  -- pure: refuses data requests that lack a signed-in pass; roster-cache rule
  swPrecache.test.mjs -- guards sw.js's APP_SHELL list against drift
  state.js           -- shared mutable `state = {employees, openSessions, punchedToday, adminUnlocked}`
  utils.js           -- $, toast, busy, pad, dateStr, fmtTime, fmtHours, recHours
  avatars.js         -- initials-fallback avatar rendering (never shows the wrong photo); marks
                        what an <img> is showing so kiosk tiles can keep it (avatarIsCurrent)
  camera.js          -- captureFor(emp, mode, onCapture) — owns the camera modal
  salary.js          -- pure salary math (proration, rate selection) — no store/DOM access
  paymentsMath.js    -- pure payments reconciliation math (matched/mismatch/awaiting)
  pin.js             -- pure PIN hash/verify (employee kiosk access to Payments)
  staleSession.js    -- pure end-of-day auto-close predicate — the kiosk's only automatic clock-out
  autoClosed.js      -- pure: recognises an auto-closed session, caps its counted clock-out at closing time
  missedClockIn.js   -- pure "hasn't shown up today" predicate
  punchCooldown.js   -- pure duplicate-punch window (latest punch per employee, lock-until time)
  timeEntry.js       -- pure: typed HH:MM -> stored instants for an owner edit; refuses clock-out <= clock-in
                        (no silent "crossed midnight" +24h), keeps unchanged fields' exact seconds
  editMarker.js      -- pure: edited_at / orig_clock_in / orig_clock_out marker for owner edits
  reportMath.js      -- pure per-day hours/review-flag/session-grouping math for the report
  dayStatus.js       -- pure: one person-day -> one chip, one callout, photo-slot types, "Check punches" checks
  rounding.js        -- pure payroll rounding (grace-window rule) + recHoursRounded()
  store/
    index.js          -- `store = DEMO_MODE ? demoStore : supabaseStore`
    demoStore.js       -- localStorage-backed
    supabaseStore.js   -- Supabase-backed, offline-resilient (see below)
    outbox.js          -- IndexedDB queue used only by supabaseStore.js
    outboxRules.js     -- pure: what sync does to an outbox row after a send (rev/syncedRev optimistic lock)
  ui/
    shell.js       -- tabs, nav (left rail >=900px, bottom tab bar below), login/logout, admin lock/unlock, live clock
    kiosk.js       -- home screen, punch flow, refreshAll(), punch confirmation
    modal.js       -- promptModal() (input dialog) + infoModal() (read-only, e.g. the
                      absence-dates popup) — both a styled stand-in for prompt() — plus actionSheet()
                      (a list of actions for one thing: bottom sheet on phones, centred card from 900px)
    payments.js    -- kiosk PIN pad + payment entry, admin reconciliation tab
    appVersion.js  -- polls version.json, silently reloads once idle on a new deploy
    employees.js   -- admin Employees tab: one tappable row per person, their actions in an actionSheet()
    records.js     -- admin Daily records tab: people list + selected person's sessions (see Daily records below)
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
- **Every outbox change is an atomic `outbox.update(id, fn)`** (one IndexedDB readwrite
  transaction: read, change, write), never `getItem` ... `putItem` across an `await`. Each real
  content change bumps `rev`; a successful sync records `syncedRev`. After sending, sync applies
  its result only if the row still has the `rev` it sent (`js/store/outboxRules.js`): a clock-out
  tapped while the open row was in flight is kept and goes out on the next pass. The old pattern
  wrote the sync's stale copy back over the tap (lost update). `needsSync()` is also the sync
  indicator's "pending" test, and an already-synced open session is no longer re-upserted every 30s.
  Legacy rows without `rev` are treated as "send once more" (same idempotent upsert) — no migration.
  `splitSessionForLunch` writes the new afternoon row *before* shortening the morning one so a crash
  between them can only duplicate, never lose, the end-of-day punch. Deliberately NOT done: a
  compensating server delete when a row is deleted mid-sync — "row is missing" can also mean another
  tab already synced it, and deleting the server copy then would be worse than the rare resurrection.
- Deleting a still-open session from the tablet that clocked it in also deletes the server copy
  (`existsOnServer()`); a never-synced row is deleted locally with no network.
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
- **Clock-out never needs the network either, even for a session this tablet doesn't have
  locally** (opened on another device, or the admin's "Add missed punch" with the clock-out left
  empty). `clockOut(record, blob, atIso)` takes the whole record from `state.openSessions` and
  queues a `remoteClose` outbox row. That row syncs as a **conditional update**
  (`set clock_out … where clock_out is null`), not an upsert: if the session was closed, edited
  or deleted elsewhere first, the server's version wins and the queued tap is dropped
  (`console.warn`). A lost response is told apart from a real conflict by re-reading and
  comparing the clock-out instant. The remote-close photo gets a unique path so it can never
  overwrite another device's photo for the same session. Admin edits skip `remoteClose` rows
  (`getOwnedLocalRow()`) and write to Postgres; the queued close then only applies if the
  session is still open.
- `listOpenSessions` is **local-wins**, like `listRecordsForDate`: a session closed on this
  tablet but not yet synced is removed from the server's "open" list, so it can't come back as a
  clockable tile.
- Manual admin edits (`updateRecordTimes`, `setLunchPaid`, `addManualRecord`, payments,
  overtime) are **plain awaited store calls, not routed through the outbox** — deliberate: the
  outbox exists for the kiosk's high-frequency instant-tap punch flow, not low-frequency
  deliberate desktop edits. A failed write there just shows a retry-able error toast. If a
  session opened on one device needs editing from another, these calls fall back to writing
  straight to Postgres instead of requiring the record in that browser's local outbox.
- The outbox calls `navigator.storage.persist()` so the browser won't clear it (it can hold the
  only copy of a punch) under storage pressure.

**Time limits on every network call** (`js/supabaseClient.js`): nothing may leave the UI waiting
on a "connected but barely working" connection, where a request can sit for minutes.
- Every `supabaseStore.js` call goes through `withTimeout()`: 8s by default
  (`REQUEST_TIMEOUT_MS`), 3s (`FAST_READ_TIMEOUT_MS`) for the kiosk reads that have a local
  fallback (roster, open sessions, today's records). It's measured from the call, so it also
  covers time queued behind supabase-js's token refresh, which retries for up to ~30s and blocks
  every other call meanwhile. For database queries it also **cancels** the request
  (`.abortSignal()`), so a write never goes out after the UI already said it failed.
- The `fetch` given to `createClient` caps each individual HTTP request at 15s
  (`HTTP_TIMEOUT_MS`), as a backstop for auth calls and photo uploads, which can't be cancelled.
- **Signed-out guard** (`readWithFallback()`): every table is "authenticated only", and with no
  session RLS returns zero rows, not an error. If supabase-js has dropped the session, the
  fallback reads refuse the server's answer, so an empty list can't overwrite the offline
  roster cache or show everyone as clocked out.
- **Signed-out request guard** (`js/signedOutGuard.js`, wrapped around the `fetch` given to
  `createClient`). Production incident, 30 Sep 2026: on wake, supabase-js renews the expired
  one-hour pass immediately; if Wi-Fi is still reconnecting the renewal fails, and for the next
  **60s (its retry cooldown) it sends every request with only the public key** — anonymous. RLS
  doesn't reject an anonymous read, it returns `200 []`, so the kiosk showed "No employees yet",
  saved `[]` over the offline roster, and punch uploads got 401 ("pending — check Wi-Fi"). The
  session stays saved through a network-type renewal failure, so `hasPersistedSession()` alone
  can't catch this. Supabase logs showed it three times that day (~1:00, 3:38, 4:20 PM), each
  ending ~60s later. Now any `/rest/v1/` or `/storage/v1/` request without a user pass gets an
  immediate **local 401** (never sent) — a 401 rather than a thrown error because supabase-js
  retries a GET that throws (1+2+4s), which would delay the offline fallback. Consequences: kiosk
  reads fall back to local data as if offline; the outbox doesn't count a refusal toward "stuck"
  while a session is still saved (a genuinely signed-out device does, and says "admin must sign
  in again"); on the next `TOKEN_REFRESHED` after a refusal, `onSignInRestored()` kicks the outbox
  and quietly re-runs `refreshAll({quiet:true})` once the kiosk is idle. Separately,
  `listEmployees()` never replaces a non-empty saved roster with an empty one
  (`keepCachedRoster()` — employees are only ever deactivated, never deleted).
  `js/signedOutGuard.test.mjs` replays the incident against the real vendored supabase-js: it
  asserts the bug without the guard and the fix with it — keep that pair when upgrading
  supabase-js.
- The kiosk's payment Save is retry-safe: `addPayment` takes a client-generated id, reused when
  Save is retried with the same amount and date. A retry whose first attempt actually landed
  hits the primary key (23505) and counts as saved, not as a duplicate.

**Cold boot and session persistence**: a device that has logged in before opens the kiosk
immediately from its persisted Supabase session (`hasPersistedSession()`, read straight from
localStorage) and validates that session for real in the background, rather than blocking on a
network round-trip first — a stale/expired session with no network used to take ~20s to resolve
and then force a login screen (which itself needs network), locking out all punching in the
meantime. `refreshAll()`'s independent reads run in parallel under the 3s fast-read limit. Admin
unlock reads the account email from the saved session too (it used to fetch it from the server,
and crashed silently offline). Sign-in failures say "needs internet" instead of "Wrong password"
when the server can't be reached.

## PWA (installable app)

- `manifest.json` — standalone display, landscape orientation, icons from a calendar-check SVG.
- `sw.js` — hand-rolled, no Workbox/npm. It works like Workbox's precaching:
  - **install** downloads every file in `APP_SHELL` into a cache named after the deploy's
    version. It uses `cache:'reload'`, because GitHub Pages' 10-minute max-age would otherwise
    risk storing the previous deploy's files. `addAll` is all-or-nothing, so an install
    interrupted by Wi-Fi fails and the old worker keeps serving the old version.
  - **fetch** serves same-origin GETs **cache-first**, and every navigation gets the cached
    `index.html`. There's no revalidation: one cache is exactly one deploy's files, so old and
    new modules can never mix. Supabase traffic and `version.json` go straight to the network.
  - `VERSION === 'dev'` (local) is network-first instead, so edits show up on reload.
  - **Don't put network calls at the top level of `sw.js`.** Chrome stops an idle worker after
    ~30s and re-runs the whole script on the next request, so top-level code runs on nearly
    every page load. An earlier version fetched `version.json` there to name its cache; every
    response waited on it, and offline it fell back to a cache name that didn't exist and served
    "Offline".
  - `APP_SHELL` is an explicit list. `js/swPrecache.test.mjs` fails if a `js/` module, or a file
    referenced by `index.html`/`styles.css`, is missing from it. The ~900KB SheetJS file is
    deliberately left out: it's loaded on the first Export tap (`loadXlsx()` in
    `js/ui/report.js`) and cached at runtime.
- Version stamping: CI (`.github/workflows/deploy.yml`) writes a real git-short-SHA + timestamp
  into `version.json`, `js/version.js` **and `sw.js`'s `VERSION`** at deploy time (the repo keeps
  `'dev'` placeholders; a `grep` fails the deploy if the `sw.js` line stops matching). Changing
  `sw.js`'s bytes is what makes browsers install the new worker at all. The kiosk shows the
  version in a small muted corner of the side panel. `js/ui/appVersion.js` polls `version.json`
  every 5 minutes. Under a service worker, a new version triggers `registration.update()`, and
  the reload happens on `controllerchange`, once the new worker has pre-cached and taken over
  (reloading any earlier would just serve the old version from the old cache). Without a
  worker it reloads directly. Either way it waits until idle (no open modal/punch/payment
  overlay) — a deliberate choice over a "tap to update" prompt, since nobody should have to
  handle that on a shared kiosk.
- **Testing limitation**: camera access (`getUserMedia`) can't be verified in the sandboxed
  Browser pane. The pane *can* register the dev service worker, and a worker left over from an
  earlier session will serve a stale cached copy (network-first falls back to cache) if the
  preview server isn't actually reachable — check `navigator.serviceWorker.controller` and clear
  it before trusting what the pane shows. The preview server also needs the Claude app to have
  macOS Files & Folders access to Documents, or it silently never starts listening. Manifest validity, icon files, and the version/appVersion wiring are all verifiable in
  the sandbox; actual installability (the "Add to Home Screen" prompt, standalone launch,
  orientation lock, real SW registration) needs a real Chrome/device.

## Owner edits are never silent

Real data (Oct 2026) showed sessions hand-closed with no way to tell what they were before, when, or
by whom, and a 4:35 typed against a 2:02 PM clock-in silently became 4:35 AM *next day* (the edit
dialog used to add 24h whenever clock-out < clock-in). Now:
- `buildEntryTimes()` (`js/timeEntry.js`, used by Edit and Add missed punch) **refuses** clock-out
  <= clock-in inline (`promptModal`'s `validate`), because no shift here crosses midnight. Editing an
  auto-closed row pre-fills 00:00, which therefore has to be corrected, on purpose.
- A time whose minute is unchanged keeps its exact stored instant (the dialog only has minutes and
  used to zero the seconds of *both* fields); a save with no real change writes nothing.
- `records.edited_at / orig_clock_in / orig_clock_out` (nullable, additive; `editMarkerFor()`):
  `edited_at` = last owner edit, `orig_*` = what the kiosk captured, saved on the **first** edit only.
  An owner-created record has `edited_at` and null `orig_*` ("added by owner"). Past edits are *not*
  backfilled — a zero-seconds timestamp is a fingerprint of an edit, not proof, and we don't write
  guesses into history. Marker writes are best-effort: if the migration isn't applied the edit still
  saves without it, and kiosk punch sync only sends these columns for an edited row.
- The kiosk and the admin share one Supabase login (admin unlock is a client-side gate), so the
  database cannot say *who* edited, only when and what. Supabase's API logs are the only other trace.
- Daily records shows the marker: an "Edited" chip, the kiosk's original time under an edited punch
  ("was 5:41 PM", "photo taken at ..."), and "Entered by you" in a photo slot the owner typed. The
  Report day-detail panel does not show it yet.

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
  Known silent case: forgetting the lunch-out, then re-tapping just after the duplicate-punch
  window (see Kiosk tile states) records a few-minute "lunch" with no flag (a short-gap review
  flag would close this — not built yet). A re-tap *inside* the window is refused instead.
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
- **An auto-closed session is paid to closing time, not to the midnight stamp**
  (`js/autoClosed.js`). Counting the midnight close as a real punch paid someone who clocked in
  at 2 PM and forgot to tap out ~10 hours. `isAutoClosedSession()` *infers* it (no `out_photo`,
  `clock_out` exactly the midnight `endOfDayFor()` stamps — no schema column, and it corrects
  rows closed before this existed); `countedClockOut()` caps it at `SHOP_CLOSING_HOUR`/`MINUTE`
  (`js/config.js`, 6 PM) on the clock-in day, never before the clock-in. Applied inside
  `recHours()` and `recHoursRounded()` so Records, Report and Salary can't disagree. The stored
  `clock_out` and the review flag are untouched — the owner still has to enter the real time,
  and once they do the record stops matching and is counted as entered. Records/Report show
  "→ 6:00 PM paid" beside the 12:00 AM. Known limit: a hand-entered exactly-12:00-AM, photoless
  clock-out reads as auto-closed. `dayHoursFromSessions` carries `out_photo` onto its merged
  lunch-paid span so this detection still works on a chained day.
- **`needsReview(sessions)`** (`js/reportMath.js`): a day's *last* session having no `out_photo`
  means either genuinely still open or closed with no photo (stale-session midnight close, or an
  admin-added punch) — both get the same "Review required" treatment (Report summary/banner,
  calendar pills). Legacy rows auto-closed for lunch before that behavior was removed still exist and
  read the same way. **The flag clears once the owner gives the session a real clock-out**
  (`isOwnerResolved()` in `js/editMarker.js`: `clock_out` set, `edited_at` set, and no longer the
  midnight auto-close stamp). Before this, entering the real time left `out_photo` empty and the day
  "Review required" forever. An owner edit that leaves the midnight stamp in place does not clear it.

## Daily records (list + detail)

Wide (>= 900px, desktop and tablet landscape look the same): the day's people on the left, the selected
person's sessions on the right. Phone: one pane at a time, with a back button. All the decisions about
*what to show* live in pure `js/dayStatus.js` (tested in `js/dayStatus.test.mjs`); `js/ui/records.js`
only draws them. Three rules keep every day readable:
- **One chip per person** in the list, the most important thing winning (`needs-clock-out` > `check-punches`
  > `still-in` > `no-lunch` > `edited`/`added` > `half-day`). A normal day has no chip, so a chip always
  means "look here". "Needs a look" = needs-clock-out, check-punches, or absent.
- **Anything unusual gets one callout** at the top of the detail: what happened, what it does to pay, and at
  most one primary action. Copy is composed in `calloutText()` (records.js), decisions in `dayModel()`.
- **Every empty photo slot says why**: `not-yet` (still in), `auto` (the kiosk closed it), `owner` (you typed
  it), `missing` (no photo, cause unknown), or a real photo. Times are written under the photos, never on them;
  "counts as 9:15" appears only where rounding moved the punch.
- **"Check punches"** (`sessionProblems()`): last session started after closing (`SHOP_CLOSING_*`, a tap earlier
  in the day was probably missed), a session under `SHORT_SESSION_MINUTES` (10), over `LONG_SESSION_HOURS` (11),
  or two sessions overlapping (pays the overlap twice). It only points at a day; it never changes pay or edits
  anything, and lunch is still never inferred. A session the owner has edited is not second-guessed for being
  short/long/late (overlap is always reported). A midnight auto-close whose clock-in was after closing reads as
  "Check punches", not "Needs clock-out", because entering a clock-out time is not the real fix there.
- Everyone on the roster gets a row, including days with no punches (Absent / Not in yet / Holiday), except
  days before the person was added or in the future. Today's morning is not called a half day.
- **Syncing**: a punch this tablet has not finished uploading (`supabaseStore.js` marks such rows `_sync`,
  never a column) gets a "Syncing" chip, an amber "Saved on the tablet" callout and an "Uploading…" photo
  slot. It only appears on the tablet that holds the unsynced punch, and never in demo mode (no outbox).
- Today with no punches is "Not in yet" only until `SHOP_CLOSING_*`; after that it reads Absent, like the
  Report's cell for today. A weekly holiday that is today is a holiday.
- The Edit dialog says what is being changed: the day, what the kiosk recorded, whether it was closed
  automatically, and any earlier edit (`editNote()` in records.js; `promptModal`'s `note`).
- Arriving from the Report's phone view, Back returns there (`showPersonDay(date, empId, onBack)`); the
  return is cleared on any other navigation.
- Not built, deliberately: delete-with-undo. Delete keeps its confirm dialog. An undo would have to put the
  row back through the outbox and the server, and the record's photos are removed from Storage when it is
  deleted, so a restore would come back without them; the confirm already guards the mistake. Also not
  built: "Don't pay this holiday" from this screen (it lives in the Report).

## Kiosk tile states

`tileStatus(e)` returns just `{open, missed}` — no "on lunch" distinction. An earlier version
highlighted a tile amber with a resume badge (`↻`) after exactly one session, but that state
never affected pay (lunch is just the gap between two sessions either way — see Lunch-break
support above) and, in live use, added a visual distinction with no real payoff: the shop's
actual four-taps-a-day rhythm (in, out, in, out) makes a second tap of the day just another
ordinary clock-in. Removed 2026-09-22. A second tap now renders identically to a first-ever
tap (`▶`, "Tap to start work") — `handlePunchCapture()`'s branching (open session → clock out,
else → clock in) never depended on the on-lunch label to begin with, so behavior is unchanged,
only the tile's own highlighting. `tileStatus()` stays exported for the kiosk's roster line.

**The tile area is centred only while the tiles fit** (`.kiosk-main` in `css/styles.css`, two flexible
spacers instead of `justify-content:center`). Centring a scrolling flex box pushes content that is too tall
off its top edge, where scrolling can't reach it: on a phone the first two employees could not be tapped, and
on the tablet the first row was clipped from the 10th employee. Checked by measuring tile positions at 390px,
844x390 and 1180x820 with 3, 8, 9 and 10 employees (layout can't be covered by `node --test`).

**Tiles are reconciled, not rebuilt**: `renderHome()` keeps each employee's existing tile
(matched by `data-emp-id`) and only updates its name/handlers, then `refreshTileStates()` does the
clock-state half. It used to wipe the grid, so every wake (`visibilitychange` → `refreshAll()`)
and every punch dropped all photos to initials until a fresh Supabase signed URL came back — and
for good if the tablet woke offline. A tile's photo is only re-requested when
`avatarIsCurrent()` says the avatar path changed or the photo never loaded (e.g. an offline boot).
That's why `handleAvatarCapture()` saves each retake under a **new** path
(`{empId}/avatar-{timestamp}.jpg`) rather than overwriting one fixed name — a changed path is how
every device learns there's a new picture (old files are left in Storage; older rows still point
at the legacy `{empId}/avatar.jpg`, which is fine). Switching to/from Payments mode (different
tiles in the same `#empGrid`) still starts clean. The "Already clocked IN/OUT" overlay copies the
tile's `src` rather than fetching the avatar again.

**Duplicate-punch window** (`js/punchCooldown.js`, `PUNCH_COOLDOWN_MINUTES = 2` in
`js/config.js`): a tile tap within 2 minutes of that employee's last punch, **in either
direction**, doesn't open the camera — it re-shows the punch confirmation as "Already clocked
IN/OUT" (profile picture in place of a photo). Prompted by a real day: an employee thought a bad
photo meant the punch failed and retook it, twice — out-then-in at 1:15 and again at 2:24 — so a
~70-minute lunch was paid as work behind a "Lunch: 0:00" gap. Both directions because the
kiosk is a toggle: any retap records the opposite punch, and out→in (lunch paid, every later tap
flipped) is the costlier one. Deliberately a refusal that *answers* rather than a silent no-op (a
dead tile reads as "broken" and invites more taps), and deliberately no "clock out anyway"
override (people retapping in a hurry don't read dialogs) — a genuine wrong-tile mistake is fixed
by the owner in Daily records. `state.lastPunchAt` is rebuilt from today's records in
`refreshAll()` (so it covers other devices' punches) and updated locally on each punch. The
camera shutter also disables itself *before* its first `await`, so a fast double-tap can't
record two punches from one capture.

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
- **On a phone** (<= 620px) the admin ledger's four totals sit two by two and the employee/date rows let
  the name column shrink and wrap (it used to keep a 160px minimum, pushing the amount and its status chip
  past the card's edge and clipping them). The kiosk payment sheets left-align Back and make their one action
  full-width.
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

**Kiosk on a phone** (<= 760px, `css/styles.css`): a short header (name and roster left, time and date
right, the mode button under them, 136px instead of the old 178px), "Admin access" and the version in a
small bar pinned to the bottom (a 44px tap target, no longer sitting on the header's border), and tiles two
across so eight people fit in about one screen. Tablet portrait (761px and up) keeps the bar above and
larger tiles; it still has the old absolutely-positioned admin link and version, which overlap the bar's
bottom border. Measured at 390px and 360px with 8 employees: first and last tile reachable, nothing under
the bottom bar, no horizontal scroll, and the tablet-landscape layout unchanged.

**Motion**: every tappable control gives real press feedback and springs back to rest via a
`--lift` custom property that composes with state classes (`.badge-tile.in`/`.lunch`/`.missed`)
instead of competing with them on specificity — a prior version tied specificity between
`.badge-tile.in` and `.badge-tile:active` and silently killed press feedback on any
already-clocked-in tile. Confirmation moments (punch, payment, PIN) fade+pop in with an animated
SVG checkmark instead of a hard display cut, closing the "did that register?" gap on a shared,
all-day kiosk. Camera shutter flashes on capture (see `js/camera.js`).

**Admin screens** (Employees/Report/Salary) share one grid-list visual language
(`.emp-row`, `.report-person`/`.salary-person` in `css/styles.css`), each its own
independent CSS grid with fixed pixel column widths (not `auto`/1fr) so a row with a longer
annotation can't drift its columns out of alignment with the rest of the list. Daily records
is a people list plus a detail pane instead (see Daily records above). Admin navigation is one
element (`#adminTools`): a left rail from 900px up, a bottom tab bar below (phone), with the
phone's "Kiosk" exit in the header.

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

**Report on a phone** (below 900px): the 31-column grid cannot fit 390px — its four pinned columns alone
were wider than the screen, so no days showed at all — so the wide table, the five metric cards and the
legend are hidden there and replaced by `#reportPhone`: everyone first (hours, and a one-line colour strip
of their month), then one person's month as a Monday-first 7-column calendar, with the tapped day's summary
below it. Both views are drawn from the same data and the same `pillInfo()` (`js/ui/report.js`), which
also builds the desktop pills, so a day can't read differently on the two. The day card says what Daily
records would (`calloutText()`) and hands off to it ("Open in Daily records") instead of duplicating the
editing screens; an absence offers "Add missed punch" and a paid Friday keeps "Mark unpaid". The review
alert's button opens the first flagged person's day. The desktop pills were checked identical (296 pills,
class, text and title) before and after pulling `pillInfo()` out.

Pinch-zoom (`user-scalable`) toggles on the single `<meta name=viewport>` tag in `switchTab()` —
locked only on the kiosk home tab (stops accidental zoom mid-queue on the shared tablet),
unlocked on every admin tab.

## Known gaps — what's left before go-live

0. **Run the edit-marker migration** (last block of `supabase-setup.sql`: three `add column if not
   exists` statements) in the Supabase SQL editor, *before* deploying the version that writes
   them. Until then edits still save but record no marker.

1. **Three placeholder constants in `js/config.js`** still need the shop owner's real numbers:
   `LUNCH_CUTOFF_HOUR`, `MISSED_CLOCKIN_HOUR`, `WEEKLY_HOLIDAY_DAY`. These are the shop's own
   operating facts, not engineering judgment calls — don't change them without being told the
   real numbers. (`LUNCH_CUTOFF_HOUR` is now label-only — it picks which gap reads "Lunch" and
   where "Split for lunch" lands, and no longer affects anyone's pay — so it's the lowest-stakes
   of the three.)
2. **The offline-first changes (pre-cached app shell, vendored libraries, time limits, queued
   remote clock-out) are unit-tested and checked in the Browser pane, but not yet on the real
   tablet.** The Browser pane can't run a service worker, and the remote-close sync needs a
   signed-in session. Still to verify on a real device: (a) boot with Wi-Fi off after the worker
   is stopped (DevTools → Application → Service workers → Stop) shows the kiosk, not "Offline";
   (b) a deploy's auto-update reloads onto the new version; (c) closing a session opened
   elsewhere (e.g. "Add missed punch" with no clock-out) while offline syncs once back online;
   (d) the same with that session already closed elsewhere is dropped, not overwritten.
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

- Run everything: `node --test js/` from the project root (213 tests as of this writing, all
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
  across a month boundary), `js/missedClockIn.js`, `js/punchCooldown.js` (latest punch across
  ins/outs regardless of record order, the window boundary, future-dated punches never locking), `js/paymentsMath.js` (matched/mismatch/
  awaiting reconciliation), `js/pin.js` (hash/verify), and `sw.js`'s pre-cache list
  (`js/swPrecache.test.mjs`: every listed file exists; every module/referenced file is listed;
  no cross-origin script or stylesheet in `index.html`), `js/signedOutGuard.js` (which requests
  count as signed out, the local 401, the roster-cache rule, and a replay of the 30 Sep incident
  against the real vendored supabase-js).
- Also covered: `js/store/outboxRules.js` (replays the lost-update incident: a clock-out tapped
  mid-sync survives; legacy rows; photo-clear; failure bookkeeping), `js/timeEntry.js` (the 4:35
  regression, precision preservation), `js/editMarker.js` and demoStore's first-edit-wins.
  `outbox.update()` itself needs real IndexedDB, so it is verified in a browser, not in `node --test`.
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
