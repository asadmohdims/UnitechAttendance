# 2.0 parity audit: live app vs the Timecard canvas

Source of truth: the live code in `js/ui/*.js`, `js/camera.js`, `js/dayStatus.js` (read in full), compared
with the 11 boards on the canvas (`https://claude.ai/artifact/GNPVhdUoyDmES5x2cok6qs`).
Screens are named as in 2.0: **Days** (was Daily records), **Month** (Attendance = old Report, Pay = old
Salary, Payments), **People** (was Employees), **Kiosk**.

Status key: **OK** drawn and equivalent · **PART** drawn but incomplete or changed · **MISSING** not on the
canvas, must be added before build · **CHOICE** I dropped it on purpose, you decide.

Nothing here changes functionality. Every MISSING row is a function the live app has today.

---

## 1. Kiosk

| # | Live app does | Canvas | Status |
|---|---|---|---|
| K1 | Grid of active employees; tile = photo (initials if none), name | Tiles with initials only; real photo not drawn | OK · Kiosk home |
| K2 | Open session: "Working since 9:03 AM · Tap to finish", green | "In since 9:03 AM"; the "tap to clock out" cue is missing | OK · Kiosk home |
| K3 | Missed clock-in tile: amber "!" and "Hasn't clocked in yet" after the cutoff hour | Neutral "Tap to clock in" for everyone not in | **CHOICE** (shared-screen shaming) |
| K4 | Side panel roster line: "N of M clocked in now · K haven't shown up" | "4 of 7 clocked in" only; the "haven't shown up" count is gone | OK · restored (default; say if you want it gone) |
| K5 | Greeting (Good morning/afternoon/evening), clock, long date | Clock and date; greeting dropped | **CHOICE** (decorative) |
| K6 | One side button flips Payments / Attendance, label and icon swap | "Payments" button; the "Attendance" return state is not drawn | OK · Kiosk payments edge states |
| K7 | "Admin access" opens Employees, asking the admin password first if locked | Link drawn; unlock dialog not drawn; destination should become Days | OK · Dialogs (unlock); Admin access now opens Days |
| K8 | Version label | Drawn | OK |
| K9 | Sync indicator: "Syncing N…" (amber) / "N punches pending — check Wi-Fi" (red) / "N waiting — admin must sign in again" | One static reassurance line; the three states are not drawn | OK · Kiosk home, "sync" tweak |
| K10 | Empty roster: "No employees yet — ask the admin to add them." | Not drawn | MISSING |
| K11 | Tap inside 2 minutes, either direction: "Already clocked IN/OUT · At 9:03 AM — no need to tap again", avatar in place of a photo | Drawn (screen 3 of punch flow) | OK |
| K12 | Camera: title "Start work, Name?" / "Finish work, Name?", help text, shutter disabled until first frame, flash on capture | Drawn (title, help, buttons); no disabled-until-frame, no flash | OK · Punch flow, "shutter" tweak |
| K13 | Camera errors: "Photo didn't come out — tap Take photo again.", "Camera unavailable: …", "Failed: … — try again." | Not drawn | OK · Punch flow, "shutter" tweak |
| K14 | Avatar capture (admin): "Take Name's photo", help text, "Skip for now" | Not drawn | PART · add-person dialog says the camera opens; capture screen not drawn |
| K15 | Punch confirmation shows **the photo just taken**, "Clocked IN/OUT", name, "Started at 9:03 AM" / "Worked 4:02 hrs today"; tap or 1.8 s to dismiss | No photo; no "Worked N hrs today" line | OK · Punch flow |
| K16 | Haptics on success and PIN error | Not a visual; keep | n/a |
| K17 | Stale-session midnight close, wake resync, pinch-zoom lock | Behaviour only; unchanged | n/a |

## 2. Kiosk payments

| # | Live app does | Canvas | Status |
|---|---|---|---|
| P1 | Payments mode: banner "Tap your name to log a payment you received", tiles say "Tap to log a payment" | Not drawn | OK · Kiosk payments edge states |
| P2 | PIN pad: "Enter PIN for Name", "4-digit PIN", 4 dots, Cancel | Drawn | OK |
| P3 | PIN errors: "Incorrect PIN. 2 attempts left." (dots shake) · after **3** attempts "Too many incorrect attempts. See the owner to reset your PIN." and the keypad disables · "No PIN set for you yet — ask the owner." · "Can't check your PIN right now — Payments needs internet." | Not drawn. Also my Keypad README says four attempts; the code says **three** (fix) | OK · Kiosk payments edge states |
| P4 | Month landing: avatar, name, month, "Logged this month ₹X", "+ Add payment", entries by date as "₹a + ₹b" or "Not yet logged by you", Back | Drawn, but "Back" and the date-wise format differ | OK · Payments flow |
| P5 | Landing load failure: total "—", "Couldn't load your payments — Payments needs internet." (so nobody re-logs a payment) | Not drawn | OK · Kiosk payments edge states |
| P6 | Add payment: amount keypad (max 7 digits, Indian grouping), date field (default today), Save, Back | Drawn; Back missing | OK · Payments flow |
| P7 | Add errors: "Enter an amount." · "Pick a date." · "Couldn't save — check Wi-Fi and try again." | Not drawn | PART · "Pick a date." not drawn |
| P8 | Saved confirmation: check, "Payment logged", name, "₹1,500 · Saturday, 10 October — This will show in your payments this month"; returns to Attendance | Not drawn | OK · Kiosk payments edge states |
| P9 | Employee never sees match/mismatch status | Respected | OK |

## 3. Sign-in, lock and shell

| # | Live app does | Canvas | Status |
|---|---|---|---|
| S1 | Sign-in screen (email, password), errors incl. "Can't reach the server — signing in needs internet." | Not drawn | OK · Dialogs |
| S2 | Admin unlock (password), "Wrong password", offline message, Cancel | Not drawn | OK · Dialogs |
| S3 | Lock (keeps kiosk) and Sign out with a confirm ("The tablet will need the password to use the app again") | Buttons on People; confirm not drawn | OK · Dialogs |
| S4 | Loading overlay on every load; toast for every success and failure ("Load failed: …", "Failed: …") | Not drawn anywhere | PART · loading and toasts drawn; per-screen load states not |
| S5 | **Photo viewer**: tap any punch photo to enlarge; tap to close | Not drawn | PART · PhotoViewer is in the design system, not on the canvas |
| S6 | Navigation: left rail ≥900px, bottom bar below, "Kiosk" exit | Drawn (Days / Month / People) | OK |
| S7 | Silent auto-update reload when idle | Behaviour only | n/a |

## 4. Days (was Daily records)

| # | Live app does | Canvas | Status |
|---|---|---|---|
| D1 | Date bar: ‹ ›, tap the label to open a date picker, sub-label Today / Yesterday / year, › disabled at today | Stepper only; no picker; board titled "Today" | OK · Days |
| D2 | Summary line: "N people · K need a look · M still in · P with your edits" | Four stat cards; "with your edits" missing | OK · Days |
| D3 | List: NEEDS A LOOK then EVERYONE ELSE **for the chosen day**; row = avatar, name, one chip, paid hours (— if none), pencil if you set a punch | Cross-day queue on top; one day list below; pencil missing | OK · Days |
| D4 | Chips: Needs clock-out, Check punches, Still in, No lunch, Edited, Added, Half day, Absent, Not in yet, Holiday, Syncing | Seven drawn; **No lunch, Added, Half day, Holiday, Syncing** not in the day list | OK · Days, callout table |
| D5 | Detail header: back, avatar, date, name, "3 of 4 punches were set by you, not the kiosk", "+ Overtime" | Avatar, name, date, "Add overtime"; owner line missing | OK · Days variants 1 |
| D6 | **Callout kinds (13):** syncing, still-in, needs-clock-out, open-past, check-punches (late start, short, long, overlap), no-lunch, edited, added, half-day, not-in-yet, absent, holiday | Only needs-clock-out drawn; the component exists | OK · Days callouts (15) |
| D7 | Strip: PAID TODAY / PAID SO FAR, SESSIONS, LUNCH (unpaid / paid as work) | Drawn | OK |
| D8 | **In and out photo for every session**, six slot kinds: photo, uploading, not yet, closed automatically, entered by you, no photo | **None** | OK · Days, variants 1 to 4 |
| D9 | Session card: label, Edit, ⋯ menu (Split for lunch · Delete session…), "Edited 12 Oct, 4:10 PM" chip, paid middle (PAID / PAID TO CLOSING / SO FAR / NOT COUNTED) | Times and Edit; no ⋯ menu, no edited chip, no so-far state | OK · Days, variants 1 and 6 |
| D10 | Times under photos: pencil on a time you set, "kiosk recorded ~~9:41 AM~~", "added by you", "kiosk had no clock-out", "counts as 9:15", "after closing" flag | "counts as" only | OK · Days variants 1 and 4 |
| D11 | Gap row: Lunch / Break N min · not paid / paid as work ✓ + Pay as work / Undo | Drawn | OK |
| D12 | Overlap row: "Overlap 30 min · both sessions are paid for this time" | Not drawn | OK · Days variants 4 |
| D13 | Existing overtime row: "Overtime 2:00 · added by you, paid at the normal hourly rate" + Edit + Remove | Only the add button | OK · Days variants 6 |
| D14 | Rounding footnote | Drawn | OK |
| D15 | Edit dialog: day + what the kiosk recorded + auto-closed / earlier-edit note, Clock in, Clock out (optional), inline refusal when out ≤ in, "No changes to save." | Drawn as a sheet | OK |
| D16 | Add missed punch dialog (says there will be no photos) | Not drawn | OK · Dialogs |
| D17 | Delete confirm: "Delete this record for Name?" (danger) | Not drawn | OK · Dialogs |
| D18 | Split for lunch (one click; toast if session under 70 min) | Not drawn | OK · Days variants 6 |
| D19 | Holiday day: Mark unpaid / Restore as paid | Not drawn on Days | OK · Days variants 5 |
| D20 | Empty states: "No one to show for this day." · "Pick a person to see their day." · "No sessions to show" | Not drawn | OK · Days variants 6 |
| D21 | Phone: list then person with back; Back returns to Month when you came from there | Drawn | OK |
| D22 | Inactive people who still have records that day appear in the list | Data rule; keep | n/a |

## 5. Month: Attendance (was Report)

| # | Live app does | Canvas | Status |
|---|---|---|---|
| M1 | Month picker, prev/next | PeriodControl, one shared period | OK |
| M2 | Download Excel (loads the library on first tap; "Could not load the Excel exporter — check Wi-Fi.") | Button; failure not drawn | PART · failure toast generic only |
| M3 | Review alert "N attendance entries need review — X have not clocked out yet; Y has a day closed without a clock-out photo" + **Review entries** jumps to the first flagged day | Replaced by the Needs attention queue; no jump from Month | OK · "Review entries" link added (default) |
| M4 | Day states: full, half, absent A, holiday F, docked (marked unpaid), open "!", flagged, auto-info (blue dot: earlier session closed with no photo), unbroken (pink dot: possible missed lunch) | Full, half, A, F, flag "!", today; **docked, auto-info, unbroken, open-vs-flagged** missing | PART · legend drawn; markers not on the cells |
| M5 | Row sub-labels "● N days off", "● Review required" | Strip only | CHOICE |
| M6 | Days · **Absent (full + 0.5 per half day)** · Total hrs; click Absent opens the exact dates (full absent days and half days) | Stat cards; absent-dates detail missing | OK · Month + Dialogs |
| M7 | Click a day: inline sessions with In/Out and "→ 9:15 paid", **Edit, Delete, Split, Pay this/Undo, overtime add/edit/remove**, Worked and Paid totals, "Open in Daily records" | Day callout + Open in Days; the editing actions are handed off to Days | **CHOICE** (one place to edit) |
| M8 | Absent day click: Add missed punch · holiday click: Mark unpaid / Restore as paid | Callout shows Add missed punch; holiday not drawn | PART · holiday action on Days, not on Month |
| M9 | Metrics: Recorded hours, Attendance days, Needs review, Absences, Half days | Four cards; Half days folded into a sub-line | OK |
| M10 | Legend | Stamps row | OK |
| M11 | Empty: "No completed attendance for this month." | Not drawn | MISSING |
| M12 | Phone: people list with month strip + legend; person calendar; day card with the callout text; hands off | Drawn | OK |

## 6. Month: Pay (was Salary)

| # | Live app does | Canvas | Status |
|---|---|---|---|
| Y1 | Row: avatar, name, "₹18,000/mo · since 2026-01-01" or "No rate set", "Est. pay so far / this month", Show calculation, Amend | Table row; "No rate set" and so-far wording missing | OK · Pay |
| Y2 | Calculation table: Rate used · Hourly rate (₹ ÷ hours) · **Days worked (+ paid Fridays / marked unpaid)** · Hours worked (+ Friday credit + overtime) · **Docked** (when any) · Total pay | Rate, per hour, hours, pay drawn; Days worked and Docked rows missing | OK · Pay |
| Y3 | Amend dialog: Monthly salary, Effective from; toast "Salary updated for Name" | Button; dialog not drawn | OK · Dialogs |
| Y4 | Not set: "No salary rate has been set for Name yet — use Amend to add one." | Not drawn | OK · Pay |

## 7. Month: Payments (admin ledger)

| # | Live app does | Canvas | Status |
|---|---|---|---|
| Z1 | "+ Log payment" dialog (employee, amount, date) | Button; dialog not drawn | OK · Dialogs |
| Z2 | Alert "N payments need reconciliation — Name's entry doesn't match yours for date" | Drawn as a callout | OK |
| Z3 | Totals: Total logged, Matched, Awaiting other side, Mismatches (unresolved only) | Drawn | OK |
| Z4 | **Grouped by employee**: row = avatar, name, "N days this month", total, worst-case chip (N mismatches / N awaiting / All matched); expands to dates | Flat table by date | OK · Payments |
| Z5 | Date row: "Both sides logged" / "— amounts differ" / "Logged by employee only" / "Logged by you only"; amount "₹1,200 vs ₹1,500"; chip Matched / Awaiting you / Awaiting employee / Mismatch / Resolved | Four chips; "who is awaited" and Resolved not distinguished | OK · Payments |
| Z6 | Expand a date: **side-by-side cards** "Your entry (owner)" and "Name's entry", each entry with amount, "Logged 10 Oct, 4:10 PM", **Edit, Delete** | Not drawn | OK · Payments |
| Z7 | Mismatch: "Mark as resolved … the amounts stay as entered" / "Resolved — undo" | Button only | OK · Payments |
| Z8 | Edit payment dialog, Delete confirm | Not drawn | OK · Dialogs |
| Z9 | Empty "No payments logged this month." | Not drawn | OK · Payments |

## 8. People (was Employees)

| # | Live app does | Canvas | Status |
|---|---|---|---|
| E1 | Add by name; **opens the camera straight away** for the profile photo ("Skip for now") | Button; flow not drawn | PART · dialog drawn; capture screen not |
| E2 | List: avatar, name, Active / Inactive; "N total · K inactive" | Active only; inactive and the count not drawn | OK · People |
| E3 | Action sheet: Retake / Add photo · Rename · Set / Change PIN · Deactivate / Activate | Buttons on the person page | PART · buttons on the page; the action sheet is not drawn |
| E4 | Cannot deactivate someone who is clocked in: "Name is currently clocked in — clock them out before deactivating." | Not drawn | OK · People, Dialogs |
| E5 | Set PIN dialog (4 digits, "PIN must be exactly 4 digits.") · Rename dialog | Not drawn | OK · Dialogs |
| E6 | Person page with attendance, pay and payments summary, rate | **New**: the live app has no such page | NEW (confirm) |

## 9. Cross-cutting

| # | Live app does | Canvas | Status |
|---|---|---|---|
| X1 | Real profile photos for every person (list, tile, header, PIN, payments) | Initials only | OK · portraits stand in for real photos |
| X2 | Owner-edit markers at three levels (time, session, list) | Stamp exists; not applied to sessions or list | OK · Days variants |
| X3 | Syncing: chip + amber "Saved on the tablet" callout + "Uploading…" photo slot | Not drawn | OK · Days variants 3 |
| X4 | Loading, empty and error state on every screen | Almost none drawn | PART |
| X5 | Dates, times, ₹ Indian grouping | Per Vocabulary | OK |

---

## Tally (after the canvas fix)

| Status | Count |
|---|---|
| OK | 70 |
| PART | 10 |
| MISSING | 2 |
| CHOICE (your call) | 4 |
| NEW | 1 |
| n/a (behaviour, not a screen) | 4 |
| **Rows audited** | **91** |

Before the fix: 17 OK, 29 PART, 34 MISSING.

## Choices that need your decision

1. **K3**: keep the old "!" missed flag on the shared kiosk, or neutral (my proposal)?
2. **K4**: keep "K haven't shown up" in the kiosk roster line? It is an aggregate, not a name.
3. **K5**: drop the greeting?
4. **M3**: the Needs attention queue replaces the Report's review alert; add a "Review entries" link on Month too?
5. **M5**: drop the "N days off / Review required" row labels in favour of the month strip?
6. **M7**: editing a day from Month (edit, delete, split, lunch, overtime inline) becomes a hand-off to Days. One place to edit, but one more tap. Keep or restore inline?
7. **E6**: person page with summaries is new. Keep?

## Copy taken off the canvas (build from here)

Design notes that had leaked into screens were removed from the canvas; the wording is kept here.

- **Days · session menu**: "Split for lunch" appears only on a single closed session. Under 70 minutes it says
  "This session is too short to split off a 1-hour lunch."
- **Month · Payments**: deleting a payment asks again: "Delete this payment entry for Raju?"
- Already covered above: no-rate calculation text (Y4), payment date-row wording (Z5).
- **Days footnote** (changed from the live app): "Pay counts each punch to the nearest quarter hour, with up to 10
  minutes of grace. Times marked ✎ were set by you; the rest are what the kiosk recorded." The live wording
  (`js/ui/records.js`, `rec-foot`) says every time is what the kiosk recorded, which is false once a punch is edited.

## Built in v2 so far (kiosk home and punch flow, 2026-10-14)

Tile grid with state band, side panel (roster line, clock, Payments, Admin access, version, sync), camera dialog
(shutter off until a frame decodes, refuses a photo that did not come out, retry-safe), confirmations (in, out,
already clocked), the 2-minute duplicate window in both directions, the midnight auto-close (only on data fetched
this session), the sync indicator, and offline-first reads. Not built: Payments mode and its PIN flow, Admin access.
Both say "isn't built in 2.0 yet" when tapped. Tests: `src/kiosk/*.test.*`, `src/data/*.test.*`.

Not drawn on the canvas, decided here and open for your call: the empty-roster message (live wording kept),
the very first load with nothing saved yet (grid simply empty until the first fetch lands), the camera
"unavailable" text for causes other than a denied permission, the "Failed: …, try again." line when a punch
cannot be saved, and the shutter flash (kept from the live app).

## Built in v2: admin shell and Days (read view), 2026-10-14

Admin shell (left rail from 900px, bottom tab bar below, Kiosk exit), unlock dialog (re-checks the owner's
password against the saved session, same wording as live; demo mode goes straight in), deep link
`#/admin/days/YYYY-MM-DD`. Days: period control, Needs attention queue (month of the day shown), the day's
list split into "Needs a look" and "Everyone else", person detail with callout, strip, timeline, session cards with
photo-slot reasons, owner-edit marks (time, header line, session stamp, list pencil), lunch gap, overtime row,
footnote, photo viewer. Callout wording is ported from `calloutText()` and covered by tests.

Works for real: lunch "Pay as work" / "Undo", holiday "Mark unpaid" / "Restore as paid", "Split for lunch".
Say "isn't built in 2.0 yet" when used: Enter clock-out time / Edit, the session menu (Delete), Add missed
punch, Add / Edit / Remove overtime. Month and People tabs. Queue has no payment-mismatch items (Payments is
deferred). Deliberate differences from live: rows inside a group are ordered by chip importance (missing
clock-out before absent), the screen opens on the queue's first item for that day, and the Needs attention queue
is new (M3).
