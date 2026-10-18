---
title: Design inventory (backend view of the prototypes)
owner: Mohamed Tarek
status: Reference
last_verified: 2026-10-18
tags: [reference, designs, inventory]
---

# Design inventory (backend view of the prototypes)

> Copied from the owner's local working notes so cloud sessions can read them. The design
> exports themselves are not in this repo. The product's old name has been replaced with
> Maqady throughout, including in prototype file and component names: a name like
> `maqady-data.js` stands for the export file that still carries the old name.
>
> **This describes what the prototypes show. Business rules in it (hold length, seat limits,
> fees, zone or format pricing, statuses, deadlines, refunds) are not decisions.** They run on
> hardcoded demo data and contradict each other. Decisions live in `docs/system-design.md`
> and `docs/adr/`.

Scope and method
- Source: every `*.html` bundle in the export folder, decoded (manifest + template) into `scratchpad\design-src-full\` (script: `scratchpad\extract_bundles.py`, run with `python -I`). Style attributes stripped copies are in `scratchpad\design-src-stripped\` (script: `strip_styles.py`). Third-party libs (React, ReactDOM, dc-runtime, fonts, line-md icons) skipped.
- The "main customer app source" was NOT missing; it is split across named components (each customer `*.html` is a ~2.7 KB shell (after stripping embedded fonts) that does `<dc-import name="...">`):
  - `Web Home` -> Home.html (`Home__4d963f28.html`)
  - `Web Movies` -> Movies.html (`Movies__2a4e7b95.html`)
  - `Web Movie` -> Movie Details.html (`Movie_Details__37cb2619.html`)
  - `Web Theaters` view=`list|detail` -> Theaters.html / Theater Details.html (`Theater_Details__51d18f54.html`)
  - `Web Booking` view=`seats|signin|checkout|ticket` -> Seat Selection / Sign In / Checkout / Booking Confirmation (`Booking_Confirmation__524a4023.html`, 53 KB)
  - `Web Account` view=`bookings|booking|profile` -> My Bookings / Booking Details / Profile (`Booking_Details__06aff561.html`)
  - shared: `MaqadyNav` (`...__80a5485d.html`), `MaqadyFooter` (`Booking_Details__c13cb78d.html`), `MaqadyHold` timer (`Booking_Confirmation__12d9444d.html`), `MaqadyAdminNav` (`Admin_Bookings__ccad25e6.html`)
  - Admin pages are single inline templates (`Admin_*.template.html`); Discover.html and Maqady Design System.html are also inline.
- The prototypes are 100% client-side. Grep for `fetch(`, `XMLHttpRequest`, `/api/`, `localStorage`, `sessionStorage` over all app code: zero hits. The only shared state is `window.__maqadyBook` (selected seats, method) and `window.__maqadyHold` (timer start). Every number that looks like a result of a server call is computed from `maqady-data.js` or hardcoded.
- I did NOT have the PRD. "Beyond PRD MVP" flags in section 7 are my judgement (the only PRD evidence in the files is Discover.html saying "12 pages · routes from the PRD"). Cross-check section 7 against the real PRD.
- Important: **Discover.html is not a customer "Discover" screen.** It is a prototype index titled "All pages" (`data-screen-label="All pages"`) linking to the 12 customer + 8 admin pages and the design system. There is nothing for the backend there except the route list (below).

Route list stated by Discover.html (quoted)
- Customer: `/` Home, `/movies`, `/movies/:movieId`, `/theaters`, `/theaters/:theaterId`, `/showtimes/:showtimeId/seats`, `/login`, `/checkout/:bookingId`, `/booking-confirmation/:bookingId`, `/my-bookings`, `/my-bookings/:bookingId`, `/profile`.
- Admin: `/admin`, `/admin/theaters`, `/admin/movies`, `/admin/people`, `/admin/showtimes`, `/admin/bookings`, `/admin/payments`, `/admin/customers`. Sub-views by hash: `#detail`, `#new`, `#hall` (theaters), `#edit` (movies, people, bookings), `#detail`/`#edit`/`#new` (bookings), `#new` (showtimes).
- Lifecycle implication (not stated in prose, but forced by the routes): `/checkout/:bookingId` and `/booking-confirmation/:bookingId` mean **a booking record exists before payment**; the 5:00 seat hold is a pending booking tied to a `showtimeId`, not a bare seat lock. The prototype itself has no showtimeId/bookingId plumbing: Web Booking is hardcoded to The Last Lighthouse / Maqady Zamalek / Hall 3 / Thu 15 Oct 19:30 / "2D · 12+" with default seats `['F7','F8']`; every "Choose seats" / time-chip link is a plain `href="Seat Selection.html"` with no parameters.

---------------------------------------------------------------------------------------------------

## 0. Reference tables (enums, constants, state classification)

### 0.1 SERVER-SIDE enums (these are real domain states)
Source of truth = Maqady Design System "Status" badge groups (`badgeGroups`) plus data in `maqady-data.js` / admin code.

| Domain | Values (exact strings) | Where seen |
|---|---|---|
| Booking status | `Confirmed`, `Reserved`, `Completed`, `Failed`, `Refunded`, `Cancelled` | Design System `badgeGroups`; Admin Bookings `ST` map. `maqady-data.js` BOOKINGS only uses the first five; `Cancelled` appears only in admin UI. Customer My Bookings only styles Confirmed/Reserved/Completed, everything else falls to "View details". Admin Bookings status filter omits `Cancelled` (`['all','Confirmed','Reserved','Completed','Failed','Refunded']`). |
| Payment status (booking-level) | `Paid`, `Unpaid`, `Processing`, `Declined`, `Refunded` | Design System. Data only uses Paid/Unpaid/Declined/Refunded; `Processing` exists only as a badge. |
| Payment method (`pay.method`) | `card`, `wallet`, `cinema` | `maqady-data.js`. Admin payments derives UI sub-methods `cash`, `terminal`, `cinema` from the label text (regex on `Cash` / `terminal`) - fragile; model should store `cash`/`terminal` explicitly. |
| Transaction status (Admin Payments) | `Succeeded`, `Pending`, `Failed`, `Refunded` | Derived: Paid->Succeeded, Unpaid->Pending, Refunded->Refunded, else->Failed. |
| Movie status | `now`, `soon` (customer data) + `draft`, `archived` (admin). Labels: Now showing / Coming soon / Draft / Archived | Admin Movies `SL`; Design System. |
| Cinema/theater status | `Active`, `Sales paused`, `Draft` (admin list); badge labels `Open now` / `Closed` / `Sales paused` | Admin Theaters; Design System. `Open now` is computed from hours, not stored. |
| Customer status | `Active`, `Blocked` | `maqady-data.js` CUSTOMERS.status; Admin Customers. |
| Showtime display state | `bookable`, `started`, `sold` (customer); admin list `On sale`, `Sold out`, `New` | `showtimes()` returns `{started, sold, bookable}`. Admin treats "Sold out" as `sold >= 95` (%), customer treats `sold` as a flag - definition mismatch (see gap G13). |
| Seat state (customer map) | `avail`, `sel`, `booked`, `held` ("Temporarily unavailable"), `wheel` ("wheelchair space, available") | Web Booking `rows()`. |
| Seat state (admin hall editor) | zone `Front`/`Middle`/`Back`, per-seat `Wheelchair`, `Blocked` ("No seat") | Admin Theaters `cellState`. |
| Hall format | `2D`, `3D`, `IMAX`, `4DX`, `Dolby Atmos`, `VIP recliners` | `maqady-data.js` halls; admin MULT map. |
| Video source | `upload`, `youtube`; kind `Trailer`, `Teaser`, `Clip`, `Featurette` | MEDIA; Admin Movies add-video dialog `kinds`. |
| Photo kind | `Still`, `Behind the scenes` (with caption `cap`) | MEDIA (no admin field for kind/caption - gap G6). |
| Age rating | `G`, `PG`, `12+`, `16+`, `18+` (admin buttons); data uses `G`, `12+`, `16+` | Admin Movies `ratings`. |
| Person roles | `Actor`, `Voice`, `Director`, `Writer`, `Producer`, `Cinematographer`, `Composer` (admin People chips). Admin Movies cast-role options are only `Actor`, `Director`, `Writer`, `Cinematographer`, `Composer` | mismatch: Voice/Producer cannot be used as movie credit roles. |
| Genres | `Action`, `Adventure`, `Animation`, `Comedy`, `Drama`, `Family`, `Mystery`, `Romance`, `Sci-fi`, `Thriller` | `F.GENRES`. |
| Facilities | `IMAX`, `4DX`, `Dolby Atmos`, `3D`, `VIP recliners`, `Wheelchair access`, `Valet parking`, `Free parking`, `Café & bar`, `Food court`, `Kids room` (admin list). Data also contains `Street parking` (Maadi) which the admin list lacks. | |
| Showtime-cancel reasons | `Technical issue`, `Print not delivered`, `Low sales`, `Private event` | Admin Showtimes. |
| Booking-edit reasons | `Customer request`, `Seat problem`, `Showtime changed`, `Staff error` (required; "saved in the activity log") | Admin Bookings. |
| Pay-at-cinema release deadline (theater setting) | 15 / 30 / 60 minutes before the show (default 30) | Admin Theaters Pricing tab `deadlines`. |

### 0.2 CLIENT-ONLY UI state (do NOT model as server state)
- Web Booking `state.pay`: `idle | processing | confirming | declined | done` - UI choreography around the payment call (2000 ms fake processing, 1300 ms fake confirming). The server-visible outcomes are only approve / decline (+ hold expiry).
- Prototype props `outcome` (`approve|decline`), `start` (`idle|declined|processing`), `method`, `device` (`desktop|tablet|mobile`), `view`: demo controls.
- `tab` (`login|register`), `showPw`, `tried`, `busy`, `signed`, toasts, sheets, lightbox indexes, carousel `slide/paused/muted`: all UI.
- Responsive breakpoints: desktop >= 1200, tablet >= 768, mobile < 768 (JS `window.innerWidth`).

### 0.3 Constants as they appear in the prototype
| Constant | Value | Source |
|---|---|---|
| Seat hold | 300 s ("Seats are held for 5:00 once you continue"; `MaqadyHold total = 300`) | Web Booking, MaqadyHold |
| Max seats per booking | 8 (`HALL.max = 8`; toast "You can book up to 8 seats at a time."; "Up to 8 per booking.") | |
| Booking fee | EGP 12 per seat (`HALL.fee = 12`, line "Booking fee (n × EGP 12)"); admin Pricing tab input "Booking fee per ticket" EGP 12 (unwired) | |
| Seat zones (customer map) | Front rows A-C EGP 150; Middle rows D-H EGP 190; Back rows J-M EGP 230 (`HALL.zones`). Row letters `A B C D E F G H J K L M` (no I), 16 seats per row, aisles after seat 4 and after seat 12 | maqady-data.js |
| Wheelchair spaces | `M1, M2, M15, M16` (in Back zone) | `HALL.wheelchair` |
| Price formula | total = sum(zone price) + 12 × seats. All 13 sample bookings reconcile exactly (e.g. FY-7Q2K9 F7,F8: 2×190+24 = 404; FY-6KD2M J3-J5: 3×230+36 = 726) - including IMAX/Dolby halls (see G1) | derived |
| Pay-at-cinema deadline | "30 minutes before the show" hardcoded in customer copy ("by 19:00 today, 30 minutes before the show"); reserved free-release "until 30 minutes before the show" | Checkout / Booking Details |
| Showtime cleaning buffer | 20 minutes (`+ 20` in `fit()`, legend "20-min cleaning") | Admin Showtimes |
| Showtime length | movie `mins` (runtime) + 20 min cleaning; customer-facing `end` = start + runtime only (`showtimes()` uses default 128 in the shared generator) | |
| Doors | "Doors open 20 minutes before the film." | Confirmation/Booking Details |
| Refund ETA | "usually arrive in 5–10 days. Seats are released immediately." | Admin refund modal |
| Currency format | `'EGP ' + Math.round(n).toLocaleString('en-US')` -> integers, no piastres, `EGP 1,234`. Admin charts use `K`/`M` shorthand (`618K`, `1.24M`) | `F.egp` |
| Booking reference | `FY-` + 5 uppercase alphanumerics (`FY-7Q2K9`); admin-created: `'FY-' + Math.random().toString(36).slice(2, 7).toUpperCase()`; reservation tickets show `FY-7Q2K9-R` on the confirmation page only | see G9 |
| Stripe ids | `pi_3Q8x2KJd7` style = PaymentIntent ids (`pay.txn`) | maqady-data.js |
| "Now" | `NOW = { dow: 4, label: 'Thu 15 Oct 2026', time: '15:10' }` hardcoded; date window = 7 days (`DAYS`: Thu 15 ... Wed 21) | maqady-data.js |
| Upload limits (admin copy) | Video: "MP4 or MOV · up to 2 GB · 1080p or higher", processing creates "1080p and 720p versions"; Photos: "JPG or PNG, up to 10 MB each"; People photo: "Square photo, at least 600 × 600. JPG or PNG." | Admin Movies/People |
| Text limits | Synopsis 600 chars; person bio 400 chars | Admin Movies/People |

---------------------------------------------------------------------------------------------------

## 1. Screen-by-screen

Per-screen template: **Data shown** / **Filters · sort · search · pagination** / **Server actions** / **Stubs** (UI present, no handler in the prototype - listed so you can decide, not because endpoints are needed).

Global (all customer pages): nav `MaqadyNav` links `Movies.html`, `Theaters.html`, "Coming soon" -> `Home.html`; guest shows "Sign in", signed-in shows "My bookings" + profile chip (initials + name). Footer `MaqadyFooter`: Explore / Account / Cinemas (short name + main phone) / "© 2026 Maqady Cinemas · Card and wallet payments are processed by Stripe" / Help, Terms, Privacy (all `href="Home.html"`).
Stubs (global): nav search input "Search movies, cast or cinemas" (no handler, no results page designed); mobile menu "Help line +20 2 2735 1100 · daily 10:00–02:00" (hardcoded; equals Zamalek main phone); footer Help/Terms/Privacy.

### Customer 1. Home (`/`) - Web Home
- Data shown:
  - Hero carousel of exactly 5 `FEATURED` entries (`Featured n / 05`; `(i + 5) % 5`): `{ mi: movieId, display: 'The Last\nLighthouse' (title with manual line break), vid: mp4 URL, still: poster frame URL, syn: short synopsis }` plus movie `genres`, `runtime`, `rating`, `score` (e.g. `8.1`). Label "Trailer playing". Autoplays muted `<video src=mp4 loop>`; auto-advances on CSS animation end; pause/mute buttons; thumbnail strip (desktop).
  - Ticker: each now-showing movie with "NEXT {time}" (hardcoded `nextTimes` array - real = next bookable showtime today per movie).
  - "Browse by genre" (all genres except Comedy).
  - "Now showing": poster, title, `score`, first genre, `runtime`, `rating`.
  - "Coming soon": release date (`relLabel`), title, genres, poster.
  - "Our cinemas" (4): photo, name, address, open state ("Open now · until 01:00" / "Opens 12:00" - computed from `hours[dow]`), main phone, `halls` count, formats (non-2D, max 3).
- Filters/sort/search/pagination: none (genre links go to `Movies.html` without a genre parameter).
- Server actions: none (read only). Reads needed: featured movies (ordered, with hero video + still), now-showing list, coming-soon list, theaters summary, next-showtime-today per movie.
- Stubs: carousel is hardcoded to 5; hero `<video>` needs an mp4 URL, so a YouTube-only video cannot be a hero (see G7).

### Customer 2. Movies (`/movies`) - Web Movies
- Data shown: `m.poster`, `title`, `genres` (joined), `runtime`, `rating` (age cert), badge `★ {score}` or "Soon" (score null for coming soon), line "RELEASED 1 OCT 2026" / "IN CINEMAS 28 OCT 2026" (`relLabel`), tab counts.
- Filters/sort/search/pagination:
  - Tabs (`role=tablist` "Release status"): `now` "Now showing" / `soon` "Coming soon" with counts.
  - Search "Title or cast": case-insensitive substring over `title` and cast names.
  - Genre multi-select (only genres that exist, with per-genre counts within the tab; any-of match).
  - "Show date": `any`, `today`, `tomorrow`, `weekend` ("This weekend"); ignored on `soon` tab; backed by a hardcoded `AVAIL` map (m1: today/tomorrow/weekend ...) -> backend must answer "movies having >=1 bookable showtime on date X" (see G14).
  - Cast multi-select: first 8 people with role `Actor`; any-of match.
  - Sort: `rating` (score desc; items without score fall to release order) / `release` ("Release date": asc for soon, desc for now).
  - Pagination: "Load more", page size 6 (`shown: 6`, `+6`), label "Showing {shown} of {n}", "That's everything."; result count `"{n} movie(s)"`; filter chips with remove; "Clear all filters"; empty state "No matches".
- Server actions: none (read). Needs a list endpoint with q, genres[], castIds[], date, status, sort, offset/limit + counts.
- Stubs: none.

### Customer 3. Movie Details (`/movies/:movieId`) - Web Movie
- Data shown:
  - Header: `title`, `genres`, runtime (`2h 08m` from `mins`), `rating`, "Released {relLabel}", `lang` ("Arabic, English subtitles"); "Maqady rating" `score` "/10 · {votes}" (e.g. `8.1`, `2.4K`); "Showing at N cinemas" (hardcoded 4).
  - Media: poster; viewer with `MEDIA[movieId]` items (`type: video|photo`, `kind`, `title`, `dur`, `source: upload|youtube`, `src` mp4 / `yt` id -> youtube-nocookie embed, `thumb`, `cap`); counters "{n} videos / {n} photos"; lightbox with filter All/Videos/Photos, keyboard nav; uploaded videos show `file` size meta ("Uploaded · 2:14 · 186 MB").
  - Synopsis `syn`; tag chips (genres + hardcoded "Coastal mystery" - no data source, see G6); credits: Director, Writers, Stars (first 3 cast).
  - Aside: "Book tickets", "Watch trailer", "Next show today at 16:15, Zamalek" (hardcoded), "4 cinemas in Cairo & Giza", "From EGP 150 · pay online or at the cinema".
  - Showtimes: 7-day date tabs (`DAYS`: `['THU','15','Today'] ...`), cinema radiogroup with per-cinema count ("N SHOWTIMES" / "NONE THIS DAY"), time chips `{t, end, hall: 'Hall 3', format, from: price}` states: selectable / `Sold out` (disabled) / `Started` (disabled). Empty state "No showtimes on {day}" + "Show {nextDay}". Notes: "Prices vary by seat zone and hall format.", "Times are local. Showtimes that have started can't be booked." Sticky "Your showtime" bar -> "Choose seats" (disabled until a time is picked).
  - Cast & crew grid: face, name, role/character; toggle "All {n} cast & crew" (default 8, mobile 6).
  - Details table: Release date "1 October 2026 (Egypt)", Runtime, Age rating, Language, Country of origin, Filming locations, Production company, Budget ("EGP 48M").
  - "More like this" (hardcoded m4, m6, m7, m8): poster, title, genres, `★ score`.
- Filters/sort/search/pagination: date tab + theater selection for showtimes only.
- Server actions: none directly. Booking flow starts at "Choose seats" (needs `showtimeId`).
- Stubs: cast names link to `#cast-...` anchors (no person page exists); "More like this" has no algorithm (genre overlap assumed).

### Customer 4. Theaters (`/theaters`) - Web Theaters view=list
- Data shown: "Cairo & Giza · {totalHalls} halls"; cards: photo, name, address, open badge ("Open · until 01:00" / "Closed · opens 12:00"), "Today {hours}" + "All hours" (weekly), box-office phone (`contact.boxOffice`, `tel:` link), up to 5 facility chips (4 on mobile), "Showtimes & info", "Directions" (`https://www.google.com/maps/dir/?api=1&destination=lat,lng`), call button. Map iframe `maqady-map.html` (Leaflet + OpenStreetMap tiles, pins from `THEATERS[].lat/lng`, `postMessage` select/focus/all). Mobile List/Map toggle.
- Filters: `all`, `open` (open now), `imax`, `parking` (predicate `/Free|Valet/` - so Valet counts as "Free parking", mislabel), `vip`. No sort, no pagination (4 theaters).
- Server actions: none.
- Stubs: none. Backend needs lat/lng, hours per weekday, facilities, photo, phones.

### Customer 5. Theater Details (`/theaters/:theaterId`) - Web Theaters view=detail
- Data shown: hero photo, name, address, open badge; actions Get directions / Call box office / WhatsApp (`https://wa.me/{digits of contact.whatsapp}`); location block (mini map `maqady-map.html?focus=id&z=15&mini=1`, address, `getting.transit`, `getting.parking`, coords "30.0609° N, 31.2194° E"); weekly opening hours with TODAY marker; note "The box office opens with the cinema and closes 30 minutes after the last show starts. Holiday hours are posted a week ahead."; contacts (Main line `phone`, Box office `boxOffice`, WhatsApp, Email, Cinema manager `manager`); facilities (with icons); halls ("Hall n", `format`, `seats` + "wheelchair spaces"), "{hallCount} halls · {seats} seats"; "Showtimes here": 7 date tabs -> films with times (`t`, hall, format; `Started` disabled), "{n} films on {day}"; photos gallery (hero + 3 hardcoded ids with alts "Main hall", "An evening screening", "Seating in Hall 6", "Lobby seating").
- Server actions: none. Showtime chips link to `Seat Selection.html` (no id).
- Stubs: "Holiday hours are posted a week ahead" implies admin "Special dates" (exist in admin) but customer page does not render them. Manager name is shown publicly.

### Customer 6. Seat Selection (`/showtimes/:showtimeId/seats`) - Web Booking view=seats
- Data shown: header (movie, "Maqady Zamalek · Hall 3", "Thu 15 Oct · 19:30", "2D · 12+" - hardcoded), steps "01 Showtime / 02 Seats / 03 Checkout / 04 Ticket" (mobile "Step n of 4"), curved hall map from `HALL`: zone bands "Front · Rows A–C · EGP 150" etc., legend (Available / Selected / Booked / Temporarily unavailable / Wheelchair space), per-seat `aria` "Row F, seat 7, Middle zone, EGP 190, available"; "Your seats · {n} of 8" chips (`id`, `zone · EGP price`, remove); subtotal "EGP {subtotal}" (excludes fee); "Seats are held for 5:00 once you continue".
- Filters/sort/search/pagination: none.
- Server actions: (a) read seat availability for showtime (`booked`, `held`, `wheelchair`, zones/prices); (b) on "Continue": create the hold/pending booking (the 5:00 starts here, before sign-in).
- Client behavior that implies rules: >8 -> toast; booked and held seats disabled; wheelchair seats are ordinary selectable seats (no companion/eligibility rule); selection is client-only (`window.__maqadyBook.sel`).
- Stubs: "Continue" always links to `Sign In.html` (no branch for already-signed-in users); no realtime/polling of other users' holds shown.

### Customer 7. Sign In (`/login`) - Web Booking view=signin (see section 2)
- Data shown: copy "Your seats stay held while you sign in. We'll take you straight to checkout."; booking summary card (movie poster, "Zamalek · Hall 3 · Thu 15 Oct · 19:30", "Seats F7, F8 · EGP 404"); `MaqadyHold` pill; tabs "Sign in" / "Create account"; success state "Signed in as Nour" + "Go to checkout" + "Reset demo".
- Server actions: login; register.
- Stubs: "Forgot password?" `href="#"`; no standalone (no-held-seats) sign-in layout exists - the only sign-in page is wrapped in the booking flow.

### Customer 8. Checkout (`/checkout/:bookingId`) - Web Booking view=checkout
- Data shown: "Signed in as nour.hassan@gmail.com" + hold pill; payment method radiogroup (`card` / `wallet` / `cinema`, see section 4); order summary aside: poster, movie, "Maqady Zamalek · Hall 3", "Thu 15 Oct 2026 · 19:30 – 21:38", lines "Middle · F7, F8 / 2 × EGP 190 / EGP 380", "Booking fee (2 × EGP 12) EGP 24", "Discounts None", total (label "Pay at the cinema" for `cinema`), "Price confirmed by Maqady just now", CTA label `Pay EGP 404` / `Continue with wallet · EGP 404` / `Try again · EGP 404` / `Reserve seats`, copy "Don't refresh while we confirm. Tickets can't be cancelled once paid."
- Server actions: re-price server-side ("Price confirmed by Maqady just now"); create payment (Stripe PaymentIntent for card; wallet sheet; or reserve for `cinema`); handle decline (`payDeclined`); on success -> confirmation. Design System: "Loading keeps the button's width and blocks repeat clicks, which prevents duplicate payments" -> idempotency required.
- Stubs: card fields (number `4242 4242 4242 4242`, expiry `08 / 29`, CVC, name on card) are static text, not inputs (implies Stripe Elements); "Discounts: None" has no input.

### Customer 9. Booking Confirmation (`/booking-confirmation/:bookingId`) - Web Booking view=ticket
- Data shown: paid variant "You're booked" / reserved variant "Seats reserved"; facts - paid: Booking number `FY-7Q2K9`, Payment "EGP 404 · Visa •••• 4242", Status Confirmed, Cancellation "Not available"; reserved: Reservation `FY-7Q2K9-R`, "Amount due EGP 404 at the cinema", Status Reserved, "Pay by Thu 15 Oct, 19:00"; reserved banner "Pay by 19:00 today / After 19:00 the seats are released and the reservation is cancelled"; ticket card (movie still, badge "Paid · confirmed" / "Reserved · unpaid", Date, Time, Hall, Cinema, Seats, QR `role=img aria-label="QR code for booking {ref}"`, note "Scan at the entrance. Admits {n}." / "Show at the box office to pay. Admits nobody until paid."); body copy "We've emailed your tickets to {email}. Show the QR code at the entrance. Doors open 20 minutes before the film."
- Server actions: fetch booking by id; (email send is server side).
- Stubs: "Add to calendar" `href="#"`; QR is a fake hash pattern (payload undefined); Directions = Google Maps deep link with lat/lng.

### Customer 10. My Bookings (`/my-bookings`) - Web Account view=bookings
- Data shown: tabs "Upcoming {n}" / "Past {n}"; rows: day/dow/time, poster, title, "{cinema} · {hall} · Seats {ids}", status badge + ref (reserved shows "Reserved · pay at cinema"), "{pay.label} · {pay.status}", CTA text (Confirmed "View ticket", Reserved "View reservation", Completed "View receipt", else "View details"). Note "Paid bookings can't be cancelled."
- Filters: tabs only. "Upcoming" = status in (`Confirmed`,`Reserved`) AND not past (prototype hack: `!/Sep|2 Oct/.test(date)`); Failed/Refunded/Completed all land in "Past". No pagination.
- Server actions: list own bookings. None else.
- Stubs: none. No cancel/release button here.

### Customer 11. Booking Details (`/my-bookings/:bookingId`) - Web Account view=booking
- Data shown: ticket card + QR + ref (as 9); header "Booking {ref}", status + pay status ("Paid · Visa •••• 4242" / "Unpaid · pay at cinema"); reserved banner "Pay at the box office by {pay.due}"; Payment table (Tickets "2 × EGP 190 (Middle)", Booking fee, Total paid / Amount due, Method, Paid on / Pay by); History (paid: "Booking confirmed", "Payment received by Stripe", "Seats F7, F8 held" with timestamps - hardcoded; reserved: "Reserved, pay at cinema", "Seats held"); policy line - reserved: "You can release this reservation for free until 30 minutes before the show."; paid: "This booking can't be cancelled or refunded. If you can't make it, contact the cinema before the showtime."
- Server actions: fetch booking incl. payment lines and event history.
- Stubs: "Download ticket", "Email again" (no handlers); no "Release reservation" button even though the policy says it is allowed; Directions links to `Theater Details.html` (not maps); reserved tickets text uses hardcoded "EGP 230 (Back)", paid uses hardcoded "EGP 190 (Middle)" regardless of booking.

### Customer 12. Profile (`/profile`) - Web Account view=profile
- Data shown: initials avatar, name, "Member since March 2025 · 14 bookings"; form "Your details": Full name (required, "Enter your name"), Phone, Email (read-only, label "Verified"); Saved cards (`Visa •••• 4242` exp `08/29` Default, `Mastercard •••• 5100` exp `02/28`) + "Cards are stored by Stripe. Maqady only keeps the last four digits."; Change password (current, new, confirm; rule "At least 8 characters, with one number"; mismatch "Passwords don't match"); side nav Profile / My bookings / Sign out (confirm dialog "Sign out? You'll need to sign in again to see your tickets on this device.").
- Server actions: update profile (name, phone); delete saved payment method; change password; sign out.
- Stubs: both dialog buttons ("Stay signed in", "Sign out") call `cancelOut` (no real sign-out); no "add card"; no email change; no delete-account; no notification/language preferences. Password rule here (8 + digit) is stricter than at sign-up (8 only).

### Admin shell (all admin pages) - MaqadyAdminNav
- Nav groups: Insights (Overview) / Catalog (Movies, People) / Venues ("Theaters & halls") / Operations (Showtimes, Bookings [badge `2` hardcoded], Payments, Customers). Footer identity hardcoded: initials `MS`, "Mona Saeed", "Administrator", link "View customer site".
- Top bar on every page: "Search admin" input ("Search bookings, movies, customers") and bell ("Notifications, 4 new"): both stubs.
- Pattern: "Unsaved changes" bar with Discard/Save on edit screens; destructive actions use confirm dialogs that state the consequence; toasts.

### Admin 1. Overview (`/admin`)
- Data shown: scope label ("All theaters · Cairo & Giza" or "{name} · {n} halls"); "Updated 15:10 · Thu 15 Oct"; KPI cards (Revenue; Tickets sold; Occupancy; Avg. ticket; "Paid at cinema" % with "{n} unpaid reservations · EGP x") each with delta "vs last Thursday" / "vs previous 7 days" / "vs previous 30 days"; "Revenue · last 30 days" line chart per theater with legend toggles and hover tooltip; "Revenue by theater" table (THEATER, REVENUE, TICKETS, OCCUPANCY, AVG TICKET, ONLINE / AT CINEMA, VS PREV); "Payment methods" donut (Card (Stripe), Apple Pay / Google Pay, Pay at cinema · collected, Pay at cinema · unpaid); "Revenue by format" (2D, IMAX, Dolby Atmos, VIP recliners, 3D, 4DX) or "Revenue by hall" when one theater is scoped; "Top movies by revenue"; "Occupancy by day and time" heatmap (rows Sun..Sat; columns `12:00,15:00,18:00,21:00,00:00`; "% of seats sold"); "Tonight" (time, movie, "Zamalek H3", % sold); "Needs attention" (4 alerts, see below).
- Filters: Period radio `today | 7d | 30d`; Theater radio `all | zamalek | newcairo | zayed | maadi`; clicking a table row toggles theater scope.
- Server actions: read-only analytics endpoints. No writes.
- Stubs: "Export CSV"; bell; search; alert links go to other admin pages.
- Alert types (quoted): "Pay at cinema · 2 reservations unpaid" (expiry time + amount); "6 card payments failed today / Seats were released automatically"; "Midnight Tram 23:30 is 28% sold / ... consider moving it to Hall 4" (hardcoded alert text; the "Tonight" list only colors rows by threshold: >85% sold highlighted, <35% red); "Hall 4 has no showtimes on Sat 17 Oct" (hall-day gap).
- Definitions actually implemented (all synthetic in the prototype): revenue = sum of daily per-theater revenue; tickets = revenue / fixed per-theater avg (`AVG`: zamalek 205, newcairo 212, zayed 188, maadi 171 - not real); occupancy = revenue-weighted avg of per-theater `OCC`; avg ticket = revenue / tickets; "Paid at cinema" = share of revenue in cinema bucket (split[2]); collected vs unpaid split fixed 93% / 7%; revenue by format/hall uses hardcoded `MULT`; unpaid reservations from BOOKINGS where `pay.status === 'Unpaid'`. These need real definitions - see G15.

### Admin 2. Movies (`/admin/movies`, `#edit`)
- List data: poster, title, `"{id} · {rating} · {mins}m"`, genres, release, status badge, SHOWS (count of upcoming showtimes), MEDIA (photos / videos counts), CAST (cast + crew count), REVENUE 30D, checkbox, edit/delete.
- List filters: search "Search title or cast"; status radio All / Now showing / Coming soon / Draft / Archived (with counts); bulk select -> "Archive". No pagination.
- Server actions:
  - Create ("Add movie" -> blank edit with `rating` default `12+`), update (tabs below), "Save movie" (toast "{title} saved and published"; title required "A title is required").
  - Bulk archive; archive; delete. **Delete rule**: blocked when it has upcoming showtimes with paid bookings ("It has {n} upcoming showtimes with paid bookings, so it can't be deleted. Archive it ..."); otherwise "Deleting removes its details, media and credits permanently."
  - Edit tabs: **Details** (Title, "Original title (Arabic)" e.g. `المنارة الأخيرة`, "Runtime (minutes)", "Release date", Language, Country, "Production company", Synopsis max 600, Genres multi, Age rating G/PG/12+/16+/18+ - "Shown on the movie page, tickets and at the cinema entrance."); **Media** (Poster 2:3 "Replace poster"; Backdrop 16:9 "used behind the title and on the home carousel" via photo "Set as backdrop"; Videos: list, reorder up/down, per-video radio "Home hero trailer", delete; "Add video" dialog: tab "Upload from computer" (drag/drop, progress, "Uploaded and processed" with duration/1080p) or "YouTube link" (regex `(?:youtu\.be\/|[?&]v=|embed\/|shorts\/)([\w-]{11})`, error "That doesn't look like a YouTube video link.", "The video stays on YouTube and plays inside the Maqady viewer."), "Title shown to customers", Type Trailer/Teaser/Clip/Featurette; Photos: grid with order numbers, "Upload photos or drop files here", move earlier/later, set backdrop, delete, upload progress); **Cast & crew** (ordered list; per person role buttons Actor/Director/Writer/Cinematographer/Composer; "Character name" input for Actor; reorder; remove; "Add from People" search; link "Create a new person"); **Showtimes** (read-only upcoming list: DATE, TIME, THEATER, HALL, FORMAT, SOLD + "Schedule showtimes" link); **Publishing** (status radio: Draft "Only admins can see it." / Coming soon "Listed with a release date. No ticket sales." / Now showing "Bookable wherever it has showtimes." / Archived "Hidden from customers. History and bookings are kept."; switch "Feature in the home trailer carousel"; "Hero trailer: {title} (change on the Media tab)"; date inputs "Tickets on sale from" (2026-09-24) and "Hide after" (2026-11-30)).
  - Audit hint: header "m1 · Last edited by Mona S. at 14:52" -> store `updatedBy/updatedAt`.
- Stubs: "Replace poster" button; sales-window date inputs have no handler (display only); only title/synopsis/genres/rating/media/cast/status/featured/hero hold edited state - runtime/release/language/country/company edits do not store values in the prototype.

### Admin 3. People (`/admin/people`, `#edit`)
- List data: photo, name, role badges, `"{birth year} · {city} · {n} credits"`, "known for" (first 2 titles / "No credits yet").
- Filters: search "Search by name"; role radio All / Actors / Directors / Writers / Crew (Crew = `Cinematographer` or `Composer` only; `Producer`/`Voice` have no tab); no pagination.
- Server actions: create ("Add person", defaults roles `['Actor']`), update (name required "Enter the person's name"; toast "{name} saved. Movie pages update right away."), delete (confirm "Delete and remove credits": "Deleting removes them from those cast lists and from search." / "has no credits. This can't be undone."), photo replace/remove (progress simulated), manage Filmography (add credit: pick movie -> default role `Actor`; remove credit).
- Fields: Full name; "Name in Arabic" (`dir="rtl"`, e.g. `لينا حداد`); "Date of birth" (`DD Mon YYYY` free text); "Place of birth" (`City, Country`); Nationality; Roles chips; Biography (max 400); social links Instagram, "IMDb page", Website (placeholders only, no state); credits rows (movie, year, role, character).
- Stubs: links inputs; birth/place/nationality/bio/links are never shown on the customer site (no person page).

### Admin 4. Theaters & halls (`/admin/theaters`, `#detail`, `#new`, `#hall`)
- List data: theater name/area/photo, address, "{halls} · {seats}", today hours with open dot, box-office phone, REVENUE 30D, status (Active / Sales paused / Draft), edit/delete; stat tiles (Theaters, Halls, Seats, Open now).
- Server actions:
  - **New theater wizard** (4 steps: "Details & location" -> "Hours & contacts" -> "Halls" -> "Review"): name, street address, district, city (default Cairo), latitude, longitude (validation: required, numeric "Use decimal degrees, e.g. 30.0609"); defaults hours 12:00–01:00 daily; number of halls 1–16, "Each starts as 12 rows × 16 seats, 2D"; "Create theater" -> created as **Draft** ("Add hours and contacts, then publish"). There is no publish control anywhere (G10).
  - **Detail tabs**: Overview (KPIs: revenue 30d, tickets 30d, occupancy, "Showtimes today"; revenue by hall weighted by `seats × MULT[format]`); Location (name, address, district, city, lat, lng, "Public transport", "Parking"; map pin from lat/lng; note "Customers see this map, the address and a Directions button."); Opening hours (per weekday: open switch, `type=time` open/close, "next day" tag when close < open, "Copy Sunday to every day"; **Special dates** list "Armed Forces Day · 6 Oct · 10:00 – 03:00", "New Year's Eve · 31 Dec · 12:00 – 04:00", "Add special date" -> "Sham El-Nessim · 13 Apr · 11:00 – 02:00"); Contacts (repeatable phones label+number e.g. Main line / Box office / WhatsApp / "Group bookings"; Email; "Cinema manager"; "Manager phone"; switch "Show phone numbers and email on the website"); Facilities (11 checkboxes); Halls (table HALL, FORMAT, SEATS, LAYOUT "n × 16", STATUS "In use", "Edit layout", delete icon; "Add hall" -> toast "Hall 7 added as a draft. Set up its layout next."); Pricing (see below).
  - **Selling toggle** in header ("Selling tickets" / "Sales paused"; toast "Ticket sales paused for Maqady Zamalek").
  - **Save**: "Maqady Zamalek saved. Changes are live on the website." (no draft/publish stage for edits).
  - **Delete theater**: dialog lists impact ("{n} halls · {seats} seats", "38 upcoming showtimes", "212 active bookings, 9 unpaid reservations"; counts hardcoded); text "has upcoming showtimes and paid bookings, so it can't be deleted. Pause ticket sales to hide it from customers while keeping its history." The "Delete theater" button is permanently `disabled`; only "Pause ticket sales instead" works (even drafts are removed via that button).
  - **Hall layout editor** (`#hall`, "Hall 3 layout"): steppers Rows (4–12) and "Seats per row" (8–16); paint tools Front "EGP 150" / Middle "EGP 190" / Back "EGP 230" (row-level zone painting), Wheelchair space (per seat), "No seat" (Blocked, per seat); aisles at seat 4 and 12 only when 16 per row; summary "{n} seats · {front} front · {middle} middle · {back} back · {wheelchair} wheelchair"; Save toast "Hall 3 layout saved · {n} seats. Existing bookings keep their seats."
  - **Pricing tab**: "Default prices" matrix FORMAT x (FRONT A–C, MIDDLE D–H, BACK J–M): 2D 150/190/230; 3D 170/210/250; Dolby Atmos 180/220/260; IMAX 230/270/310; VIP recliners 320/320/320 (**no 4DX row** although 4DX halls exist); "Fees & payment": "Booking fee per ticket" EGP 12, switch "Allow reserve now, pay at the cinema", "Unpaid reservations are released" 15 min / 30 min / 1 hour before.
- Stubs: hall delete icon (no handler, no rule); theater photo management absent; hall format cannot be edited (no field in editor/add hall); fee input unwired; hardcoded theater `T0 = zamalek` in the detail view.

### Admin 5. Showtimes (`/admin/showtimes`, `#new`)
- Data shown: theater chips; view toggle Timeline / List; 7 date tabs with "{n} shows"; **timeline** rows per hall ("Hall n", "{format} · {seats}") on a fixed 12:00–02:00 axis with bars (movie, range, % sold bar), 20-min cleaning blocks and "Cinema closed" shading from opening hours; empty hall row "No showtimes · Schedule one"; **list** columns TIME, MOVIE, HALL, FORMAT, SOLD, STATUS (`On sale`/`Sold out`/`New`), ACTIONS "Manage".
- Server actions:
  1. **Create showtimes** (wizard on one page): 1 Movie (only `status === 'now'` movies, first 7 in prototype), 2 Theater, 3 Hall (shows `{format} · {seats} seats`), 4 Dates (multi-select, "Every day this week"), 5 "Starts at" (`type=time step=300`, quick picks 13:00 16:00 18:45 20:15 21:30 23:45), 6 "Prices for Hall n · {format}" (Front/Middle/Back, defaults derived: IMAX +80, Dolby +30, VIP 320) and switch "Allow reserve now, pay at the cinema" (per-showtime overrides). Result toast "{n} showtime(s) created · {k} skipped. They're on sale now." -> no draft state.
  2. **Availability / conflict check** (live as inputs change): per date -> `Available` ("Nothing else is scheduled within 20 minutes."), `Conflict` ("Overlaps {movie} {range}, including the 20-minute cleaning gap."), `Outside opening hours` ("Ends {hh:mm} but {theater} is open {o}–{c} that day."); rule = start >= opening AND end (= start + runtime) <= closing, and no overlap with any other show in the same hall expanded by 20 min each side; suggestions "Free start times in Hall n" (4 nearest, 5-min grid, >=30 min apart) and "Other halls free at {time}"; checkbox "Skip the dates that don't fit and create the rest"; button "Create n showtimes" / "Resolve conflicts to continue".
  3. **Manage panel** (click bar/row): stats (Seats sold n/N, Occupancy, Revenue, Unpaid reservations); "Move start time" buttons -30/-15/+15/+30/+60 min (disabled with tooltip "Overlaps another showtime" / "Outside opening hours"; toast "Moved to {t}. {n} ticket holders will be emailed."); link "View {n} bookings"; **Cancel this showtime**: impact list ("{n} bookings, {seats} seats", "EGP x refunded to cards and wallets", "{n} pay-at-cinema reservations released", "Everyone is emailed and sent an SMS"), reason (4 values above), button "Cancel and refund" -> toast "Showtime cancelled ({reason}). Refunds are on their way."
- Stubs: "Allow pay at cinema" and the price inputs on the New showtime form have no handler (not submitted); timeline renders only `halls.slice(0, 6)` (New Cairo has 9); movie picker truncated to 7.
- Constraints worth noting: no edit of movie/hall/format/language of an existing showtime; no subtitle/dub version per showtime (language is movie-level only); special dates are not consulted by the hours check; hours use `mins()` which maps hours < 06:00 to next-day.

### Admin 6. Bookings (`/admin/bookings`, `#detail`, `#edit`, `#new`)
- List data: summary cards (Today "{n} bookings" + hardcoded "EGP 61,240 collected"; "Unpaid · pay at cinema" count + "EGP x due today"; "Failed payments" ("Seats released"); "Refunded" ("Last 7 days")) - clicking filters; table BOOKING, CUSTOMER (name+email), MOVIE, SHOWTIME ("Thu 15 Oct · 19:30" + "Zamalek H3"), SEATS (ranges when > 3), TOTAL, PAYMENT (method label + pay status), STATUS, ACTIONS (view, edit); footer "Showing {n} of 1,284 bookings" (hardcoded total; no pagination control).
- Filters/search: search placeholder "Booking no., name, email, phone"; Status radio All/Confirmed/Reserved/Completed/Failed/Refunded; Method radio Any/Card/Wallet/At cinema.
- Server actions:
  - **Detail**: header ref, status, pay status, "Created {created} · online" (source hardcoded "online"); lines per seat ("Seat F7 · Middle EGP 190") + "Booking fee · n × EGP 12" + Total; Payment (Method, Status, "Stripe payment" id / "Pay by" / "Collected by", Amount, Refund reason); Activity log (label, actor e.g. `System`, `Stripe`, `Customer, online`, `Mona Saeed (admin)`, time); Internal notes (text + author·time; "Add a note for staff"); customer card (name, email, phone, "{n} bookings · EGP x spent · since {joined}", "Open customer").
  - **Collect payment** (only if Reserved + Unpaid): modal "Collect EGP x" -> choose Cash or Card terminal + "Receipt / terminal ref" (prefilled `R-ZM-20451`), button "Mark as paid" -> status `Confirmed`, pay `Paid`, label `Pay at cinema · Cash|Card terminal`, `collectedBy`, tickets issued.
  - **Refund** (only if `pay.status === 'Paid'` and method != cinema): choose "Full refund" or "Tickets only (keep fee)" (amount = total - seats×12); copy "Refunds go back to {label} through Stripe and usually arrive in 5–10 days. Seats are released immediately." -> status Refunded.
  - **Cancel booking** (not for Refunded/Cancelled/Failed/Completed): reserved -> "released and the seats go back on sale. Nothing was paid"; paid -> "Seats are released. Use Refund instead if the customer should get their money back." (cancel without refund leaves pay status Paid - undefined).
  - **Edit booking** (button disabled for Refunded/Cancelled/Failed; Completed is still editable): change showtime (options for the same movie), re-pick seats on a 12x16 map (taken = booked ∪ held; current seats shown amber), edit contact name/email/phone; before/after diff; price delta -> increase: "We'll send the customer a payment link for the difference." (cinema method: "Added to the amount due at the box office."), decrease: "Refunded to {label} automatically when you save.", equal: "Same total. New tickets replace the old ones."; required reason (4 values) saved in activity log; switch "Email and SMS the customer new tickets"; "Save changes".
  - **New booking** ("Box office sale or phone reservation"): movie, showtime, seats, customer (Walk-in guest / existing customer / typed name+email+phone), counter payment Cash / Card terminal / "Pay later"; button "Take payment · EGP x" or "Create reservation"; reservation `due` = showtime − 30 min; creates `Confirmed`+`Paid` (label `Box office · Cash|Card terminal`, `collectedBy`) or `Reserved`+`Unpaid`.
  - **Resend tickets** (email + SMS; logged).
- Stubs: "Export" button; summary "EGP 61,240 collected"; "1,284" total.

### Admin 7. Customers (`/admin/customers`)
- Data shown: header "Operations · 18,240 accounts" (hardcoded); table CUSTOMER (name, email), PHONE, JOINED ("Mar 2025"), BOOKINGS, SPENT, LAST BOOKING, STATUS, ACTIONS (view, block/unblock); drawer: stats Bookings / Spent / No-shows (`c3` = 1; no source for it), editable Name/Email/Phone with "Save details", "Recent bookings" (last 4), actions.
- Filters: search "Name, email or phone"; status radio All/Active/Blocked. No pagination.
- Server actions: update details; "Send password reset email"; Block/Unblock (copy: "They are signed out everywhere and can't book. Existing paid tickets stay valid." / "They can sign in and book again right away."); Delete account (copy: "Their profile and saved cards are removed. {n} past bookings are kept for accounting, without their name or contact details." -> anonymise, not hard delete).
- Stubs: "Export".

### Admin 8. Payments (`/admin/payments`)
- Data shown ("Operations · last 7 days"): KPIs Collected online ("Card and wallet via Stripe"), Collected at cinemas ("{cash} cash · {terminal} terminal"), Outstanding ("Pay-at-cinema reservations not yet paid"), Refunds ("0.9% of revenue"), "Failed today" (6, "Card declined or 3-D Secure abandoned"); **Reconciliation by theater** table THEATER, ONLINE, CASH, TERMINAL, OUTSTANDING, REFUNDS, NET + All theaters row, note "Cash and terminal totals come from box office end-of-day reports"; Transactions table TIME, BOOKING, CUSTOMER, METHOD, STATUS, AMOUNT (refunds negative), THEATER, REFERENCE (Stripe `pi_...` / `collectedBy` / "Due ..."); drawer: amount, status, Booking, Customer, Method, Processor ("Stripe" for card/wallet, "Maqady box office" otherwise), Reference, Theater · Hall, Showtime, Created; "Open booking".
- Filters: Method radio All methods/Card/Wallet/Cash/Terminal; Status radio Any status/Succeeded/Pending/Failed/Refunded. No date filter, no pagination.
- Server actions: refund (only `Succeeded` card/wallet; full amount only; toast "Refund for {ref} sent to Stripe").
- Stubs: "Export for accounting". "Reconcile" or "mark collected" actions do not exist here (collection is on the booking detail); end-of-day report ingestion has no screen.

### Design System page (`Maqady Design System.html`)
- Documentation only (Version "2.0 · 15 Oct 2026"; Color, Typography, Space, Icons, Motion, Buttons, Forms, Status, Cinema components, Patterns). Backend-relevant content: the status badge groups (section 0.1); alert specs ("Seats held for 5:00 / Finish checkout before the timer runs out."; "Your card was declined / You haven't been charged."; "Pay by 19:00 / Unpaid reservations are released automatically."; "No overlaps in Hall 3 / Customers see the showtime as soon as you save."); "Booking and payment status are separate, because a booking can be reserved and unpaid."; hold timer states (>= 60 s normal, < 60 s warning "Less than a minute left. Finish soon or the seats are released.", 0 s "Hold expired / Your seats were released. Pick seats again to continue."); every data screen must have loading (skeleton), empty ("No upcoming bookings"), and error ("Movies didn't load" + "Try again") states.

---------------------------------------------------------------------------------------------------

## 2. Auth

Customer Sign In screen (Web Booking view=signin) offers exactly:
- **Email + password only.** Tabs `Sign in` / `Create account`.
- Sign-in fields: Email (`/^\S+@\S+\.\S+$/`, errors "Enter your email address" / "Enter a valid email, like name@example.com"), Password (show/hide toggle "Show password"/"Hide password", min 8: "Enter your password" / "Use at least 8 characters"). Button "Sign in and continue" (busy "Signing in…"), shake animation on invalid.
- Sign-up fields: **Full name** (placeholder "As it appears on your card", error "Enter your name"), Email, Password (>= 8). Button "Create account and continue" (busy "Creating account…"). No phone, no confirm-password, no terms checkbox, no marketing opt-in at sign-up. Phone is only editable later in Profile.
- "Forgot password?" appears on the sign-in tab only; `href="#"` - no reset-request or reset-password screens designed. Admin can trigger "Send password reset email".
- Email verification: Profile shows "Verified" next to email, but no verification step/screen exists at sign-up.
- Password policy inconsistency: sign-up/sign-in 8 chars; Profile change-password "At least 8 characters, with one number".
- Sign out: Profile only, confirm dialog (wiring stubbed).
- **Not found**: phone/OTP sign-in, Google/Apple/social sign-in, magic link, guest checkout (the copy says "Sign in to continue"; seats can be browsed/selected as a guest, then `Continue` -> `Sign In.html`; "Your seats stay held while you sign in"), session-expiry UI or "session expired" message, CAPTCHA, rate-limit/lockout messages, blocked-account sign-in message (admin block copy exists: "signed out everywhere"), standalone sign-in page without seats context, post-login redirect other than "Go to checkout".
- Implication: the 5:00 hold must be created for an anonymous/guest session at `Continue` and attached to the user at login/registration (the hold pill is shown on the Sign In step before authentication).
- Admin auth: **no sign-in screen at all.** Single hardcoded persona "Mona Saeed · Administrator" in `MaqadyAdminNav`.

---------------------------------------------------------------------------------------------------

## 3. Booking lifecycle

### 3.1 Customer flow (as designed)
1. Movie Details: pick date -> theater -> showtime chip (states bookable / `Sold out` / `Started`; a started showtime cannot be booked) -> "Choose seats".
2. Seat Selection: seat states available/selected/booked/held("Temporarily unavailable")/wheelchair; max 8; zones Front/Middle/Back at EGP 150/190/230 (rows A-C / D-H / J-M); fee EGP 12 per seat; "Seats are held for 5:00 once you continue".
3. Continue -> Sign In (hold running; pill "{m:ss} left"); login/register -> "Go to checkout".
4. Checkout: choose Card / "Apple Pay / Google Pay" / "Pay at the cinema" (hold running).
   - card/wallet: `Pay` -> processing -> approved => confirmation (paid) | declined => message "Your card was declined ... you haven't been charged. Your seats are still held. Try again, use another card, or pay at the cinema." + button "Try again".
   - cinema: `Reserve seats` -> confirmation (reserved), `Unpaid`, due = show − 30 min; "Unpaid reservations are released automatically at 19:00 and the seats go back on sale."
5. Confirmation: e-ticket + QR (paid) or reservation (reserved: "Admits nobody until paid.").
6. My Bookings / Booking Details.

### 3.2 Implied entity model (from the routes and data)
- `/showtimes/:showtimeId/seats`: showtime is a first-class entity (movie, hall, theater, start, end, prices by zone, pay-at-cinema flag). `maqady-data.js` BOOKINGS flatten it into `{movie, theater, hall, date, time}` strings (date without year; time `HH:MM`) - there is no showtimeId in the data.
- `/checkout/:bookingId`: a booking (pending) is created at hold time. The Hold = pending booking with `expiresAt = now + 300 s`.
- A booking has BOTH a booking status and a payment status (Design System: "separate"). Seats are `string[]` like `['F7','F8']` (row letter + number).
- Booking needs: customer (nullable for walk-in; contact name/email/phone editable on the booking), channel (online vs box office - admin shows "Created … · online" hardcoded), `created` timestamp, `pay { method, label, status, txn?, due?, collectedBy?, refund? }`, activity log (label, actor, time), internal notes (text, author, time), notification log (email/SMS).

### 3.3 Implied status transitions
| From | Trigger | To (booking / payment) | Evidence |
|---|---|---|---|
| (hold) | Continue | pending booking, seats `held` ("Temporarily unavailable" to others) for 300 s | seats page copy, `HALL.held` |
| hold | timer reaches 0 | seats released; UI "Hold expired / Your seats were released. Pick seats again to continue." | MaqadyHold |
| hold | card/wallet approved | `Confirmed` / `Paid` | Booking Confirmation |
| hold | card declined | payment `Declined`; seats still held until timer ends; customer may retry or switch method | checkout alert |
| hold | declined and hold expires (implied) | `Failed` / `Declined`, "Seats released" by System (activity log "Payment declined" by Stripe, "Seats released") | Admin Bookings `logBase`; Overview alert "6 card payments failed today · Seats were released automatically" |
| hold | `Reserve seats` (cinema) | `Reserved` / `Unpaid`, due = start − deadline (15/30/60 min per theater, default 30) | Checkout, Admin Theaters |
| `Reserved` | deadline passes unpaid | auto-release, "reservation is cancelled" -> target status **not defined** (`Cancelled`? ) | confirmation copy |
| `Reserved` | admin "Collect payment" (Cash / Card terminal) | `Confirmed` / `Paid`, `collectedBy` | Admin Bookings |
| `Reserved` | customer releases (policy text "free until 30 minutes before the show") | **no UI/handler** | Booking Details |
| `Confirmed` | showtime passes | `Completed` (implied; trigger not shown) | My Bookings "View receipt" |
| `Confirmed` | admin Refund (card/wallet only) | `Refunded` / `Refunded` (full, or "Tickets only (keep fee)") | Admin Bookings, Payments drawer |
| `Confirmed`/`Reserved` | admin Cancel booking | `Cancelled` (payment unchanged for paid) | Admin Bookings |
| any with seats | admin "Cancel this showtime" | bookings refunded (card/wallet) + reservations released + email AND SMS; data example FY-5RC0P `Refunded` with `refund: 'Showtime cancelled'` | Admin Showtimes |
| `Confirmed` | admin "Edit booking" | stays Confirmed; seats/time/total change; payment link for extra amount or auto partial refund | Admin Bookings |
| Paid by customer | cancel/refund request | **not allowed**: "Tickets can't be cancelled once paid." / "Cancellation: Not available" / "Paid bookings can't be cancelled." / "This booking can't be cancelled or refunded. If you can't make it, contact the cinema before the showtime." | Checkout, Confirmation, My Bookings, Booking Details |

### 3.4 Rules shown to users (verbatim summary)
- Max 8 seats per booking; seat hold 5:00; fee EGP 12 per seat; "Price confirmed by Maqady just now".
- Paid bookings: no customer cancellation or refund (they must contact the cinema). Pay-at-cinema: free release until 30 min before show (policy text only), auto-release at the deadline, must pay at box office (cash, card or Meeza "Same price as online").
- Showtimes that have started cannot be booked.
- "Doors open 20 minutes before the film."; QR "Admits {n}" (one QR per booking; for reservations "Admits nobody until paid" -> QR must exist but validate as unpaid).
- Admin refund timing: 5–10 days via Stripe, seats released immediately.

### 3.5 E-ticket / QR / reference
- One ticket per booking: movie still, Date, Time, Hall (number), Cinema, Seats, booking ref, QR. QR drawn by a hash pattern generator (payload undefined); the visible `ref` text under the QR is the booking ref. Entrance scanning is described ("Scan at the entrance") but no scanner/check-in UI or `checked in` state exists. Downloads/email: "Download ticket", "Email again", "Resend tickets" (no PDF design). Ref format `FY-XXXXX`; reservation tickets show `-R` suffix on the confirmation page only (admin and My Bookings show the same ref without it).

---------------------------------------------------------------------------------------------------

## 4. Payments

### 4.1 Methods shown (quoted)
| Method | UI text | Notes |
|---|---|---|
| Card | label "Card", sub "Visa, Mastercard or Meeza"; brand badges `VISA`, `MC`, `MEEZA`; Checkout collects Card number, Expiry, CVC, Name on card (static mock) | "Card details go straight to Stripe over an encrypted connection. Maqady never sees or stores them." Data labels: `Visa •••• 4242`, `Mastercard •••• 5100`, `Meeza •••• 7781` |
| Wallet | "Apple Pay / Google Pay", sub "Confirm on your phone"; "Your wallet opens to confirm the payment. Nothing is charged until you approve it on your device." | Data labels `Apple Pay`, `Google Pay` (stored per booking as separate labels) |
| Pay at the cinema | sub "Reserve now, pay at the box office"; "Cash, card or Meeza accepted at the counter. Same price as online." | `pay.label`: `Pay at cinema` (unpaid), `Pay at cinema · Cash`, `Pay at cinema · Card terminal`; admin-created: `Box office · Cash`, `Box office · Card terminal`; `collectedBy` e.g. `Heba M. (box office)` |
| Admin counter options | Collect: `Cash`, `Card terminal` (+ "Receipt / terminal ref"); New booking: `Cash`, `Card terminal`, `Pay later` | |
- Gateways named: **Stripe only** ("processed by Stripe" footer; "Cards are stored by Stripe" profile; "Card and wallet via Stripe"; refund "through Stripe"; `pi_...` ids; "3-D Secure abandoned"). **Not found**: Paymob, Fawry, Vodafone Cash/InstaPay, Meeza as a separate rail, bank transfer, cash on delivery, vouchers/gift cards, promo codes, loyalty points.
- Verify (not derived from the files): Stripe is the only gateway the designs assume, including for Meeza cards and an Egypt-based merchant. Confirm Stripe availability for the Egyptian merchant entity and Meeza support before locking the gateway abstraction; a provider-agnostic payment interface is prudent.

### 4.2 Checkout collects / returns
- Collects: method, card data (via Stripe Elements implied), nothing else (no billing address, no promo code, no email/phone confirmation - uses account email).
- Server returns: price breakdown (zone lines, fee, "Discounts None", total), payment result.
- Failure/retry UI: decline message (above) and "Try again · EGP x"; "Don't refresh while we confirm"; processing state locks button (idempotency). No UI for: 3-D Secure challenge, network error, hold expiry mid-payment, pending/async confirmation, wallet cancelled.
- Saved cards: Profile list with Remove only (needs Stripe Customer + PaymentMethods); Checkout does not offer saved cards.

### 4.3 Admin payment actions
- Booking detail: **Collect payment** (reserved -> paid, cash/terminal), **Refund** (card/wallet only; full or tickets-only), **Cancel booking**, **Edit booking** (payment link for difference / auto partial refund), **Resend tickets**.
- Payments screen: filter, drawer, **Refund** (Succeeded card/wallet, full only), reconciliation table (cash/terminal from "box office end-of-day reports" - no ingestion screen), exports (stub).
- **Not found**: mark-as-reconciled, dispute/chargeback handling, manual payment-link creation screen, partial refund from Payments, refund for cash/terminal-collected bookings.

---------------------------------------------------------------------------------------------------

## 5. Admin

### 5.1 Roles / permissions / scoping
- Roles visible: **one persona**, "Mona Saeed - Administrator". No super-admin vs theater-manager vs box-office-staff distinction, no staff management screen, no login, no permission matrix, no per-theater scoping (theater is a filter chip on Overview/Showtimes, not a permission).
- Staff identities appear only as strings: `collectedBy: 'Heba M. (box office)'` (Heba Mansour is also Zamalek's `contact.manager`), `'Ramy S. (box office)'` (Ramy Sabry, Maadi manager), `'Mona S. (admin)'`; activity log actor `Mona Saeed (admin)`; internal-note author "Heba M. · today 14:02". Implication: actions need an actor (staff user) on `collectedBy`, activity log, notes, `Last edited by`.

### 5.2 Per-theater scoping
- Only as filters (Overview theater radio; Showtimes theater chips; Payments reconciliation per theater). Theater-level settings: opening hours, special dates, contacts + public toggle, facilities, halls, pricing, booking fee, "Allow reserve now, pay at the cinema", release deadline, selling toggle.

### 5.3 Hall / seat layout editor
- Rows 4–12, seats per row 8–16 (max 12 × 16 = 192 seats), row-level zone painting (Front/Middle/Back), per-seat Wheelchair and "No seat", aisles fixed after seat 4 and 12 (only at 16 seats/row), row letters skip `I`. No hall format editing, no aisle editing, no seat labels editing, no per-seat price override, no layout versioning UI (but save toast: "Existing bookings keep their seats.").
- Seat-count conflict: editor max = 192 but halls are declared with 72–240 seats (e.g. New Cairo Hall 1 IMAX 240, Zamalek Hall 5 IMAX 210) and the admin hall table fakes layout as `Math.round(seats / 16) × 16`.

### 5.4 Showtime scheduling & conflict checks
- Specified in section 1 (Admin 5): 20-min cleaning buffer, opening-hours window per weekday (cross-midnight handled by `mins()` hours < 6 -> +24), multi-date bulk create, skip-conflicts option, suggestions, move-time (±), cancel with refunds + notifications, per-showtime price and pay-at-cinema override (stub).
- Not covered: special-date hours, editing movie/hall of existing showtime, language/subtitle variant, 3D glasses/format surcharge, recurring schedules beyond the 7-day horizon, preventing scheduling `soon`/draft movies (only `now` movies are offered).

### 5.5 Movie media management
- Both **uploads** and **YouTube links**: upload MP4/MOV up to 2 GB (>= 1080p; server creates 1080p + 720p); YouTube id extracted from watch / youtu.be / shorts / embed; YouTube kept on YouTube and embedded via `youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&modestbranding=1`; YouTube thumbnail `i.ytimg.com/vi/{id}/hqdefault.jpg`. Photos JPG/PNG <= 10 MB, ordered, backdrop choice. Poster 2:3. Video reorder + one "Home hero trailer" per movie. Uploaded video metadata shown to customers: duration, file name/size (`dur`, `file`, `size`). Video thumbnails for uploads need server-side frame extraction (`thumb`).

### 5.6 People management
- CRUD with photo upload (square, >= 600 × 600), roles (7), Arabic name, DOB, place of birth, nationality, bio (<= 400), 3 social links, filmography editable from both sides (movie Cast & crew tab and person Filmography) -> many-to-many `movie_credit(movie, person, role, character, sort order)`. Delete cascades credits and removes from search.

### 5.7 Customer blocking
- Block: signs the customer out everywhere, prevents booking, existing paid tickets stay valid; Unblock restores immediately. Delete: anonymise (bookings kept for accounting without name/contact; profile and saved cards removed). Edit name/email/phone (email editable by admin though customer UI shows it read-only/"Verified"). Password reset email.

### 5.8 Analytics / KPIs and definitions
- See Admin 1 and the "Definitions actually implemented" note. Period `today/7d/30d`, theater scope, comparison baselines "vs last Thursday" (same weekday last week), "vs previous 7/30 days"; heatmap = % of seats sold per weekday × time slot; theater tab KPIs (30-day revenue, tickets, occupancy, "Showtimes today"); showtime stats (seats sold, occupancy, revenue, unpaid reservations); Payments KPIs (online, at cinemas cash/terminal, outstanding, refunds % of revenue, failed today). All numbers synthetic: real definitions must be set (what counts as revenue - paid only? incl. booking fee? net of refunds? at-cinema Confirmed only?).

---------------------------------------------------------------------------------------------------

## 6. Content / i18n

- **No language switch. UI is English only.** No `lang=` attribute on any page, no `dir` on customer pages, no translation keys, no Arabic UI strings.
- Arabic appears only as **data fields in admin**: movies "Original title (Arabic)" (`المنارة الأخيرة`) and people "Name in Arabic" (`dir="rtl"` input, `لينا حداد`). Neither is displayed on the customer site (no consumer of these fields yet). RTL support exists only on those two inputs. Movie `lang` is free text ("Arabic, English subtitles").
- Currency: single currency EGP, prefix "EGP ", integers only, `en-US` thousands separators (`toLocaleString('en-US')`). No piastres, VAT, tax or service charge lines anywhere.
- Time: 24-hour `HH:MM`, times "are local" (Movie Details note). No time-zone constant, no UTC, no DST handling; `NOW` is hardcoded. Dates are display strings without years (`Thu 15 Oct`). Opening hours can run past midnight ("01:00", "02:30", "next day" tag); `openNow()` compares `NOW.time` with the *same calendar weekday's* open/close, so after-midnight "open now" can be wrong (e.g. Zamalek, 01:30 on a Thursday morning: it tests Thursday's 12:00–02:30 window and reports Open, although Wednesday's 12:00–01:00 session already closed) - the model needs a "business day" concept for late shows (e.g. 23:55, ends 02:00).
- Numbers shown with Latin digits; Egyptian phone formats `+20 ...`; WhatsApp `wa.me` digits; coordinates "30.0609° N, 31.2194° E".
- Maps: Leaflet 1.9.4 + OpenStreetMap tile server; Google Maps directions deep links. Imagery from Pexels / randomuser.me / YouTube (demo). Backend only needs lat/lng, no geocoding service, no maps API key.

---------------------------------------------------------------------------------------------------

## 7. Beyond a basic-MVP scope (judgement; PRD not seen - verify)

Legend: **[BEYOND]** = I judge this outside a minimal book-a-seat MVP; **[CORE?]** = ambiguous.

| Feature | Evidence | Backend cost |
|---|---|---|
| **[BEYOND]** Featured hero trailer carousel on Home | `FEATURED` (5), `heroVideo`, admin switch "Feature in the home trailer carousel", per-video "Home hero trailer" radio, backdrop "used ... on the home carousel" | `featured`, `heroVideoId`, display order; hero needs an uploaded mp4 (YouTube cannot be used in `<video>`, G7) |
| **[BEYOND]** Theater maps / geo | `maqady-map.html` (Leaflet+OSM), lat/lng fields, Directions deep links, "Live map" | store lat/lng; no geo queries |
| **[BEYOND]** Facilities + formats as filterable attributes | Theaters filters `IMAX`, `Free parking`, `VIP recliners`, `Open now`; 11 facilities; 6 hall formats with format-based pricing | facilities m:n, hall format enum |
| **[BEYOND]** Photo/video gallery with uploads + YouTube, transcoding | Admin Media tab; "creating 1080p and 720p versions" | object storage + transcoding pipeline + metadata |
| **[BEYOND]** People entity with photos, bios, Arabic names, socials, filmography | Admin People; cast filter on Movies | people, credits, search |
| **[BEYOND]** Maqady rating (score + vote count) | `score` 8.1, `votes` '2.4K', "Maqady rating {score}/10 · {votes}", sort by Rating; no UI to submit a rating, no admin field | decide source (admin-entered vs user ratings); **no reviews/ratings UI exists** |
| **[BEYOND]** "More like this" | Movie Details hardcoded list | similarity query |
| **[BEYOND]** Pay-at-cinema reservations with auto-release and per-theater deadline | Checkout/Confirmation/Admin Theaters 15/30/60 | scheduled job to release; tickets invalid until paid |
| **[BEYOND]** Saved cards | Profile | Stripe customer/payment methods |
| **[BEYOND]** Admin analytics suite | Overview charts, heatmap, revenue by format/hall, top movies, alerts, "Tonight" | aggregation endpoints/materialized views |
| **[BEYOND]** Showtime timeline, conflict engine, bulk create, move time, cancel-with-refund | Admin Showtimes | scheduling service + notifications + refund fan-out |
| **[BEYOND]** Booking edit (diff, payment link, partial refund), box-office sale/phone reservation, internal notes, activity log, resend tickets | Admin Bookings | payment links, partial refunds, audit trail |
| **[BEYOND]** Payments reconciliation (cash/terminal end-of-day, outstanding, net) | Admin Payments | end-of-day import (not designed) |
| **[BEYOND]** Special dates (holiday hours), contact visibility toggle, draft theaters, pause sales | Admin Theaters | hours exceptions table |
| **[BEYOND]** Movie sales window ("Tickets on sale from", "Hide after"), draft/archived statuses, bulk archive | Admin Movies Publishing | status + window rules |
| **[BEYOND]** Notifications | bell "4 new"; email + SMS on showtime move/cancel/booking edit/resend | email + SMS providers; no bell panel designed |
| **[BEYOND]** Customer "No-shows" stat | Admin Customers drawer | requires check-in scanning (absent) |
| **[CORE?]** Customer sign-up/login, seats, hold, checkout, tickets, my bookings, profile | the 12 routes | - |
| **[CORE?]** Discover page | It is a prototype index, not a feature | none |
| Not present in the designs (do not build for these): promo codes (only "Discounts: None"), loyalty, watchlist/favorites, user reviews, push notifications, social login, guest checkout, gift cards, multi-language, multi-currency, seat upgrade, F&B ordering, waitlist.

---------------------------------------------------------------------------------------------------

## 8. Gaps and contradictions

Numbered for reference. **Bold** = decisions the backend design must make early.

**G1 - Three-plus pricing models coexist (pick one).** (a) `PRICE_FROM` by format: `IMAX 230, 4DX 260, Dolby Atmos 170, 3D 160, VIP recliners 320, 2D 150` (customer "from EGP" on time chips); (b) `HALL.zones` by row band 150/190/230 used for every seat map and every sample booking regardless of hall format; (c) Admin Pricing matrix format × zone (`2D 150/190/230`, `3D 170/210/250`, `Dolby Atmos 180/220/260`, `IMAX 230/270/310`, `VIP 320/320/320`, **no 4DX**); (d) per-showtime price inputs on New showtime (derived +80/+30/320, unwired). Mismatches: Dolby `from` 170 vs admin front 180; 3D `from` 160 vs admin 170; IMAX booking FY-6KD2M charges Back = 230 although admin IMAX Back = 310; 4DX (New Cairo Hall 2) has `from` 260 but no matrix row. Most specific should win: showtime override > theater/format/zone default.

**G2 - Single global seat map.** `HALL` is one 12×16 grid used for all halls; real halls declare 72–240 seats; admin editor caps at 192 and the halls table fakes layout as `round(seats/16) × 16`. Needs per-hall seat map entity (+ versioning: "Existing bookings keep their seats"). Wheelchair spaces are hardcoded `M1 M2 M15 M16`.

**G3 - Booking exists before payment but prototype has no ids.** Routes imply `bookingId` at checkout and `showtimeId` at seats; Web Booking is hardcoded (m1 / Zamalek / Hall 3 / 19:30 / seats F7,F8). Hold is created at "Continue" before authentication -> needs guest session hold + merge on login. Seat availability must include `held` by other users (no realtime/polling designed).

**G4 - Refund / cancellation policy is contradictory and incomplete.** Customer: "Tickets can't be cancelled once paid" (4 places); Booking Details policy says reserved can be released free until 30 min before show but no button exists. Admin: can refund (full or tickets-only) card/wallet only; **no refund path for cash/terminal-collected bookings** (Refund button requires method != cinema; Payments refund requires card/wallet); "Cancel booking" on a paid booking leaves payment `Paid` and says "Use Refund instead"; cancelling a showtime promises "refunded to cards and wallets" but is silent on at-cinema paid bookings. "Tickets only (keep fee)" refund and the auto partial refund on edit conflict with "full refund" only on Payments drawer.

**G5 - Admin identity is absent.** No admin login, no roles, no staff users, one hardcoded persona; yet box-office collection, notes, activity log, `Last edited by` all need an actor; theater managers appear as contact data, not users. No check-in/scan screen though QR says "Scan at the entrance" and customers have a "No-shows" stat.

**G6 - Fields shown on the customer site with no admin input (or vice versa).** Customer Details table: "Filming locations", "Budget"; tag chip "Coastal mystery"; `votes`/`score`; hero `display` title with manual line break; photo `kind` ("Still" / "Behind the scenes") and caption; video `dur` for YouTube ('—' in admin); director/writers as roles (derived). Admin has "Original title (Arabic)", nationality, social links, bio/birth data that no customer page displays; theater photos shown on customer pages have **no admin upload UI**; theater `getting.transit/parking` exist in admin; `managerPhone` exists only in admin.

**G7 - Hero video source.** Home hero uses `<video src=mp4>`; admin lets any video (including `source: 'youtube'`) be marked "Home hero trailer" -> YouTube cannot play there. Carousel hardcoded to 5 with no reorder UI. 

**G8 - Hold/decline behaviour.** Checkout says "Your seats are still held" after a decline, while Overview says "6 card payments failed today · Seats were released automatically" and admin Failed bookings show "Seats released" - the event that creates a `Failed` booking (decline vs hold expiry) is undefined. Hold running during payment (processing > 300 s) and mid-payment expiry have no UI.

**G9 - Booking reference inconsistencies.** Reservation ticket shows `FY-7Q2K9-R` (confirmation page) while My Bookings / admin show `FY-9PL2A` (no suffix); the same booking has two identities. Admin-created refs use `Math.random().toString(36)` (collision/guessability not addressed). Sample refs: all `FY-` + 5 alnum.

**G10 - Draft/publish states without transitions.** New theater "created as a draft ... then publish" but no publish control (only "Selling tickets" toggle); paused theater is described as hidden from customers ("Pause ticket sales to hide it from customers") although the toggle label is only "Sales paused" (hide vs block undefined). Showtimes are on sale immediately on create (no draft). Movie status `soon` = "No ticket sales" yet "Tickets on sale from" window exists for any movie.

**G11 - Unwired exports/stubs.** 4 admin export buttons (Overview "Export CSV", Bookings "Export", Customers "Export", Payments "Export for accounting"); Download ticket; Email again; Add to calendar; Forgot password; global search (customer + admin); bell; hall Delete; Profile Sign out; footer Help/Terms/Privacy; "Delete theater" permanently disabled.

**G12 - Data in KPI/analytics is synthetic.** `AVG` ticket constants, 0.93/0.07 collected/unpaid split, `MULT` format weights, heatmap `HEAT`, hardcoded "1,284 bookings", "18,240 accounts", "EGP 61,240 collected", "212 active bookings", "38 upcoming showtimes". Real definitions required (G15).

**G13 - "Sold out" definition.** Customer uses `sold` flag; admin list shows `Sold out` at `sold >= 95` %. Also seats counted in "% sold" include unpaid reservations (panel "Unpaid reservations" derived from seats sold).

**G14 - Date filter on Movies is hardcoded.** `AVAIL` map; backend must compute movies with bookable showtimes on today/tomorrow/this weekend (define "weekend" in Egypt: Fri–Sat; the prototype's `AVAIL` labels do not state it).

**G15 - KPI definitions missing**: revenue basis (paid only? includes booking fees? net of refunds? includes Confirmed+Completed only?), occupancy denominator (seats × showtimes in period vs only past showtimes), tickets = seats sold, avg ticket = revenue / tickets, comparison baselines, timezone/"today" boundary (business day vs calendar day), and refund timing.

**G16 - Role/format list mismatches.** People roles include Voice, Producer; movie credit roles do not; "Crew" tab only Cinematographer + Composer; facility "Street parking" (Maadi data) missing from admin; `4DX` missing from admin pricing; Theaters filter `Free parking` matches `Valet`.

**G17 - Status vocabulary mismatches.** `Cancelled` and `Processing` exist in the Design System but not in data or the admin list filter; customer My Bookings treats only Confirmed/Reserved as upcoming; Failed/Refunded/Cancelled fall to "Past"; Completed bookings are still editable in admin; what status results from auto-release of an unpaid reservation is undefined.

**G18 - Missing screens implied by the UI**: password reset (request + set new), email verification, standalone login/register (no seats), blocked-account message, session-expiry, release-reservation action, person detail page (cast links are anchors), search results (customer + admin), notifications panel, staff/role management, admin login, end-of-day cash report entry, check-in scanner, privacy/terms/help pages, error pages (design system lists loading/empty/error patterns but screens don't implement them).

**G19 - Concurrency & integrity points a backend must own (not in UI).** Seat hold atomicity and expiry job; idempotent payment creation (button locks only client-side); reservation auto-release job at `show − deadline`; reservation created inside the deadline window (e.g. booking 20 min before showtime with a 30 min deadline) is not handled; per-booking max 8 enforced server-side; wheelchair spaces have no eligibility rule; showtime move/cancel notifications fan-out (email + SMS); layout change vs existing seat ids; hall double-booking prevention with the 20-min buffer; theater hours exceptions.

**G20 - Time handling.** Display strings without year, "Times are local", no timezone; Egypt observes DST (verify current rules) so store timestamps with the theater's IANA zone (`Africa/Cairo`) and a business-day rule for post-midnight shows.

**G21 - Admin bookings list lacks pagination/sort controls** while claiming 1,284 rows; Customers (18,240 accounts) likewise; Payments has no date range though titled "last 7 days"; Movies/People lists have no pagination; none show sort controls (only Movies customer page has sort).

**G22 - Prototype truncations to ignore** (not requirements): movie picker `slice(0,7)` / `slice(0,6)`, timeline `halls.slice(0,6)`, first-two-theaters showtime options in booking edit, similar movies hardcoded, `T0 = zamalek` in theater detail, booking-edit showtime options limited to `THEATERS.slice(0,2)` × 2 days.

---------------------------------------------------------------------------------------------------

## 9. Entity checklist (quick derivation)

Movie (status, title, titleAr, runtime, release, language, country, company, budget?, filmingLocations?, synopsis<=600, genres, ageRating, score?, votes?, poster, backdrop, featured, heroVideoId, salesFrom, salesTo, updatedBy/At) - MovieMedia (type video|photo, source upload|youtube, ytId, file, size, duration, kind, caption, order, thumb, renditions 1080p/720p) - Person (name, nameAr, born, birthplace, nationality, roles[], bio<=400, photo, links) - MovieCredit (movie, person, role, character, order) - Theater (name, area/district, city, address, lat, lng, photo(s), status, selling, hours[7] with next-day, special dates, phones[label,number], email, manager, managerPhone, showContactsPublic, facilities[], transit, parking, bookingFee, allowPayAtCinema, releaseDeadline) - Hall (theater, number, format, seat map version, rows, cols, zone per row, wheelchair/blocked seats) - PriceMatrix (theater, format, zone) - Showtime (movie, hall, start, end, cleaning buffer, prices by zone, allowPayAtCinema, status) - Hold/Booking (ref, showtime, seats[], customer?, guest contact, channel online|box office|phone, status, createdAt, expiresAt, total, fee, source) - Payment (booking, method card|wallet|cinema(+cash|terminal), label, status, stripe PaymentIntent id, due, collectedBy, receipt ref, refund amount/reason) - BookingEvent (activity log: label, actor, time) - BookingNote (text, author, time) - Customer (name, email, phone, joined, status Active|Blocked, saved payment methods, no-shows?) - StaffUser (name, role) - Notification log (email/SMS).
