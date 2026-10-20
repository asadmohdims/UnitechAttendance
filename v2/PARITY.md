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
| M3 | Review alert "N attendance entries need review — X have not clocked out yet; Y has a day closed without a clock-out photo" + **Review entries** jumps to the first flagged day | Replaced by the Needs attention queue; no jump from Month | OK · "Review entries" link added (default). The banner, tile, marks and Days queue are one list (also holds a day closed with no photo; today's clocked-in people are not on it, unlike v1's alert) |
| M4 | Day states: full, half, absent A, holiday F, docked (marked unpaid), open "!", flagged, auto-info (blue dot: earlier session closed with no photo), unbroken (pink dot: possible missed lunch) | Full, half, A, F, flag "!", today; **docked, auto-info, unbroken, open-vs-flagged** missing | PART · legend drawn; markers not on the cells |
| M5 | Row sub-labels "● N days off", "● Review required" | Team grid names carry "N days off · ● N to review / ✓ reviewed"; the one-person list keeps the strip | OK · Proposal · Month boards |
| M6 | Days · **Absent (full + 0.5 per half day)** · Total hrs; click Absent opens the exact dates (full absent days and half days) | Stat cards; absent-dates detail missing | OK · Month + Dialogs |
| M7 | Click a day: inline sessions with In/Out and "→ 9:15 paid", **Edit, Delete, Split, Pay this/Undo, overtime add/edit/remove**, Worked and Paid totals, "Open in Daily records" | Day callout + Open in Days; the editing actions are handed off to Days | **CHOICE** (one place to edit) |
| M11 | One calendar for everyone (v1's Report grid), Days / Absent / Total hrs pinned right | **Whole team** view: names and totals pinned, scrolls to today; a tap opens that person. Below 900px only the one-person view (as v1's phone view) | OK · Proposal · Month · Whole team |
| M12 | Tiles follow the selection; "reviewed" marks | Tiles show the whole team or the chosen person (`statsFor`); a day the owner set is ticked ✓ and the banner says "All reviewed" at 0. Any owner edit shows ✓ | OK · Proposal · Month boards |
| M13 | A day closed with no clock-out photo and no owner marker (e.g. an edit made before markers existed) cannot be cleared except by moving a time | **Mark as reviewed** on the "No clock-out photo" callout (Days and the Month day card): asks once, writes the edit marker with the times unchanged (`updateRecordTimes` with the same values), day reads "Reviewed" / "Confirmed by you" and leaves the list. Words live in `v2/src/admin/review.ts`, not the shared module | OK · Proposal · Mark as reviewed board |
| D1 | Dark mode | **Display** pop-up (sun / moon) in the admin rail and the phone header; one choice per device, kept in the browser (`tc2:theme`), applies to the kiosk and admin on that device; default Light. Dark is graphite "G3 Deep" (`#0b0c0e` ground). No "System" option (not drawn). | OK · Dark preview boards |
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
this session), the sync indicator, and offline-first reads. Payments mode and Admin access were built later (see the sections below). Tests: `src/kiosk/*.test.*`, `src/data/*.test.*`.

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

Works for real: lunch "Pay as work" / "Undo", holiday "Mark unpaid" / "Restore as paid", "Split for lunch",
Enter clock-out time / Edit (typed times validated by the live `buildEntryTimes`; an unchanged save writes nothing),
Delete session with confirm, Add missed punch, Add / Edit / Remove overtime. The queue gained its payment-mismatch items
with the ledger (see below).
Wording from the Dialogs board where it differs from live: the clock-out error reads "Clock out must be after the
2:02 PM clock in." (live: "Clock-out must be later than clock-in on the same day. Check AM/PM."), the title is
"Edit Shakib" (live: "Edit — Shakib"), the overtime hint is "Paid at the normal hourly rate." Time fields are the
browser's own time input, not the text field the board draws, so AM/PM and 24-hour entry both work.
Deliberate differences from live: rows inside a group are ordered by chip importance (missing
clock-out before absent), the screen opens on the queue's first item for that day, and the Needs attention queue
is new (M3).

## Built in v2: Month Attendance, Pay and Excel (2026-10-14)

`v2/src/admin/month/`. Rules are a typed port of `monthData`/`pillInfo` (`monthModel.ts`), tested against the
live behaviour: day classification, half-day and absent counting, docked Fridays, Friday-before-hire, overtime in
paid hours only, open "!" / "In", and the calendar-day pay maths (`buildPayLines`). Tests: `monthModel.test.ts`,
`MonthScreen.test.tsx`.

Where it differs from the live app or from the board, and why:

- **Day cells** carry the legend's four markers as dots (needs a look, earlier session closed with no photo, no
  lunch punch ring, holiday marked unpaid). The board only drew one flag; the legend names four, so all four are on the cells.
- **Future weekly holidays** show as a violet "F" (the board draws them so); the live Report leaves them blank.
- **Open day**: "!" on a past day (attention tint), "In" on today (green), as the board draws today.
- **Strip colours**: half day and still-open share the attention colour (the board's four-colour legend has no
  fifth); a day closed without a photo keeps the worked colour because its hours are known.
- **"Needs attention"** is the Days queue (missing clock-out + check punches), as on the Days board; the callout above
  it is the live Report's review list (missing clock-out, closed without a photo). The two can differ, as on the board.
- **Edit actions** on a day hand off to Days (M7 choice). Absent days offer Add missed punch, holidays Mark unpaid /
  Restore as paid, here as well as in Days. "Open in Days" now opens that person (`#/admin/days/DATE/EMP`).
- **"See the exact dates"** is a list of the absent and half days; picking one opens it in Days (the live app showed
  a read-only dialog).
- **Excel** is the live sheet: exact punch hours, "IN (no out)", totals **without** overtime. This disagrees with the
  month's "Hours recorded" figure, which includes overtime, exactly as live. Say if the sheet should include it.
- **Already paid out** (Pay) is the sum of **owner-entered** payments for the month; the board draws the figure but
  does not say which side. Shows "—" if the payments read fails. Confirm or change.
- **Change rate** replaces Amend (board wording); same two fields and the same toast.
- **Payments** section: built later, see "Built in v2: People, Payments, sign-in".
- Not verified on a device: the phone layout was only measured (375px: no horizontal scroll, two-column stats).

## Built in v2: People, Payments (admin and kiosk), sign-in (2026-10-18)

The seven open choices above were confirmed at their defaults (K3 neutral tile, K4 roster line keeps "haven't
shown up", K5 no greeting, M3 "Review entries" link, M5 no row labels, M7 edit hands off to Days, E6 person page).

**People** (`v2/src/admin/people/`): list with PIN and inactive marks, person page (month numbers come from the same
`useMonthData` as Month, so they cannot disagree), Retake/Add photo, Rename, Set/Reset PIN (text field, so a
leading zero works; hashed with the live `js/pin.js`), Change rate (one dialog shared with Month · Pay),
Deactivate/Activate, Add a person then the camera, Lock admin, Sign out with its confirm.
**Payments, admin** (`v2/src/admin/month/Payments.tsx`, maths in `paymentsModel.ts` on the unchanged
`js/paymentsMath.js`): alert, four totals, people → days → side-by-side cards, Edit, Delete (with confirm), Mark
resolved / undo, Log a payment. Mismatches also appear in the Days "Needs attention" queue as the Days board draws
them ("you ₹1,500, Raju ₹1,200").
**Payments, kiosk** (`v2/src/kiosk/payments/`): mode toggle with the board's banner and tile wording, PIN pad
(3 tries, then locked; "no PIN" and "can't check offline" are not tries), the employee's own month (never the
owner's amount or the match status), amount keypad (7 digits, Indian grouping), retry-safe save, the confirmation,
and the automatic return to Attendance.
**Sign-in** (`v2/src/admin/SignIn.tsx`): v2 had no sign-in screen, so Sign out would have locked a tablet out. Added
from the Dialogs board; shown only when the device has no saved sign-in.

Not drawn on the canvas, decided here (say if you want any changed):
- Activate button and its copy for an inactive person; "No people yet. Add the first person."; the loading text.
- Avatar capture screen: the camera dialog titled "Take {name}'s photo", the live help text, "Skip for now".
- Sign-in failure "Wrong email or password." (the board draws only the offline message). Not dismissible.
- Ledger: no chevron on expandable rows (the board draws none); unresolved mismatch days are tinted even when
  collapsed; "nothing to reconcile" under a zero Mismatches total; "Couldn't load payments. Check the Wi-Fi." when
  the read fails; the resolved state reuses the live wording ("Marked resolved, tap to undo").
- Where the board differs on purpose: the **Edit payment** dialog is Save / Cancel; the board adds a Delete there,
  but Delete is already on the card with its own confirm, so a second route to the same destructive action is left out.
  The kiosk date field is the browser's date input (the board draws formatted text), with no upper limit, as live.
- People is not auto-selected on a wide screen; the board shows one open. Active people sort first, then inactive.

Fixed on the way: the punch and payment confirmations never dismissed themselves, because the kiosk redraws every
second and each redraw restarted the 1.8 s timer. Now covered by `confirmTimer.test.tsx` (fails on the old code).

Not verified: the camera for avatar capture (the Browser pane blocks it; tested with an injected camera only); sign-in
and sign-out against a real Supabase session (tested with injected functions; the real calls are the live app's);
haptics on a real Android tablet (and the punch confirmation has none yet); phone layouts were measured at 390 px
(no horizontal scroll, People list hides under the person with a Back button, ledger cards stack), not seen.

## Days layout change at the owner's request (2026-10-18)

On the Days left column the chosen day (its date, the people count and the Needs a look / Everyone else lists) now
sits **above** the month's "Needs attention" queue. The Admin · Days board draws the queue first; the canvas has not
been updated. Reason: the queue is a month-wide list, and put first it pulled focus from the day being looked at.

## Phone layouts and the day list (2026-10-18), built from the updated canvas

The canvas gained **Phone · Kiosk home**, **Phone · Kiosk payments mode** and **Phone · Days · option A**; Admin · Days
and Kiosk · home were revised (option B, columns, was drawn and not chosen). Built to those boards:

- **Kiosk on a phone** (≤ 760px, `kiosk.css`): the side panel becomes a header (roster and sync left, clock and
  "Tue 13 Oct" right, the Payments / Attendance button beneath), tiles two across, Admin access and the version in a
  bar pinned to the bottom. The tablet layout is unchanged. Before this v2 had no phone kiosk: the 360px panel left
  30px for the tiles.
- **Clock**: 64px on the tablet (the 72px token was 26px wider than its panel for an 8-character time such as
  "11:08 AM"), 36px on a phone.
- **Days list**: each row says who is in and when, under the name (`rowTimes()` in `dayText.ts`): "9:13 AM – 6:01 PM",
  "In since 9:30 AM" in green, "9:03 AM – no clock-out" when the kiosk closed the day at midnight, "Not in yet",
  "No punches", "Holiday"; three or more sessions add "· 3 sessions". On a narrow row the hours sit over the chip.
- **Days on a phone**: the list, then one person's day behind a "‹ Days" back button (it used to be one long page with
  the person 870px down). The person's session cards show In and Out side by side with the paid time on its own line,
  as the Phone · A person's day board draws them. The queue sits below the day's list at every width.
- Deliberate differences: the Days header still puts "Kiosk" on its own line above the title on a phone (the board has
  them on one row); the phone Days stat reads "Needs a look" for the day, where the old board said "Needs attention".
  Nothing on the Days list marks the pencil on the in/out line: the hours column already carries it.

## v1 safeguards carried into v2 (2026-10-18)

Added after the v1-incident review: **pinch-zoom lock** on the kiosk only (`kiosk/zoomLock.ts`), **re-read of every
screen after a sign-in renewal** (`onSignInRestored` → `requestRefresh()`; the store still re-sends queued punches by
itself), and a **buzz on a recorded punch**. New tests: three rapid shutter taps record one punch (fails with 3 punches
if the guard is removed), a tap before the camera has a frame records nothing, the zoom lock, the refresh.
Still to build: the service worker (offline cold start) and the auto-update reload when idle. Both wait on where v2 is
deployed (same GitHub Pages site under `/v2/`, which needs a one-line change to v1's `sw.js`, or a separate host).
Not verifiable here: iOS Safari ignores `user-scalable=no`, so the lock holds on Android Chrome only (as in v1).

## Offline start and side-by-side deployment (2026-10-18)

Service worker (`vite-plugin-pwa` 1.3.0, build only): precaches 18 files (about 1.5 MB), serves them with no network, and
updates itself when idle (`src/pwa.ts`). Checked in the Browser pane against a stand-in for Pages with v1 and v2 side by
side: with v1 installed first, `/v2/` still opened v2 (not v1), v2 registered its own worker at `/v2/`, and with the server
stopped a reload showed the kiosk with its tiles and clock. v1's `sw.js` gained one rule so it leaves `/v2/` alone (4 new
tests, 2 of which fail on the old file). `deploy.yml` builds and publishes v2 under `/v2/`; v2 failing never blocks v1.
Not verified: the real GitHub Actions run (it only runs on `main`), a real tablet, and the update flow across two real
deploys (the worker's update check and idle switch are unit-tested for the idle rule only). The manifest does not lock
orientation (v1's does, to landscape); say if the kiosk install should.

## Monthly reports as PDFs (2026-10-19), built from the Report boards

Month's header now has one **Download** button (a popover from 900px, a bottom sheet on a phone) in place of "Download Excel":
- **Attendance report**: A4 landscape, everyone by day (P, H, A, F), Days / Absent / Hours per person, four totals. Hours only.
  More than about a dozen people continue on a second page with the header row repeated. Offered through the share sheet on a
  touch device and as a download on a desktop.
- **Employee statements**: A4 portrait, one page per person (calendar, days, absent, half days, hours worked, "how your hours are
  counted", signature lines). **No money anywhere**: a test fails if a rupee sign, "salary", "payment", "balance" or "rate" appears
  in either document. "All in one PDF" for printing, or each person on their own (Share on a touch device, Save elsewhere).
- **Data for a spreadsheet**: the existing Excel export, renamed.
- **Payroll summary**: drawn, **not built** (the menu says so on use). So is the owner-only "changes and checks" page: it was taken
  out of the shared pack because a printed list of owner edits invites questions; the board is kept, titled "later".

The numbers are Month's own: hours come from `buildMonthModel`, and a test holds every person's printed hours and the statement's
"hours counted" equal to Month · Pay's `punchedHours` / `paidHours`.

How: pdfmake 0.3.11 (lazy, its own 359 KB gzipped chunk) drawing on the device, offline once cached. Fonts are trimmed static TTFs of
Figtree and IBM Plex Mono, with the ₹ checked (`src/assets/pdf-fonts/README.md`; the published Plex Mono TTFs crash the library, the
trimmed ones do not). Checked: real PDFs render in node for 5 and 14 people, 28/30/31-day months and an empty month; in the Browser
pane the Download menu produced a valid `%PDF` file for the report (about 1.1 s the first time) and for the statements (0.3 s).
Rendered pages were compared by eye with the boards.

Deliberate differences from the boards: an absent day is a solid tint with its letter, not hatching (the library has no pattern
fill); "Log a payment" is now a secondary button on the Payments tab, because Download is the one primary; the legend lists "?" only
when a day is still open.
Confirmed by the owner: the shop name printed is "Unitech Machineries" (`src/reports/shop.ts`); the statement carries no promise or deadline, only how a punch is counted (`STATEMENT_NOTE`); Latin names only.
Not verified: the share sheet on a real Android or iOS device; printing on paper; a name in another script would print as blanks (the embedded fonts hold Latin only; the owner does not need other scripts, and
`src/assets/pdf-fonts/README.md` says how to add one).

Also fixed on the way: the dev server went blank when `virtual:pwa-register` was imported without the plugin loaded (the plugin now
loads in every mode and does nothing outside a build); a kiosk test that failed between midnight and 4 AM because it assumed the real
clock was mid-day.
