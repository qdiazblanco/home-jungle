# Kipe's Home Jungle 🌿

A houseplant encyclopedia and day-to-day care tracker, built as a static
PWA on GitHub Pages with **no backend at all**: the plant data lives in
this repository as JSON, reads are plain fetches, and writes are commits
made from the browser through the GitHub REST API — gated behind a
fine-grained access token. The git history doubles as the garden's care
diary.

## What it does

- **Today view** — plants sorted by watering urgency
  (fine / soon / due / overdue), with a warnings panel on top: overdue
  waterings, seasonal light checks, feeding reminders.
- **One-tap logging** — tap to water (with a short undo window), or
  select several plants and log a whole watering round as one commit.
  Ten event types, backdating included.
- **"Still moist"** — real watering is a finger-in-the-substrate call.
  A soil check on a due plant snoozes the schedule a couple of days
  without polluting the watering history; when the log keeps proving a
  plant drinks slower than the books say, the app suggests an observed
  rhythm (never applies it by itself).
- **Care table** — every plant at a glance: last/next watering, feeding,
  light, room; inline actions and quick edits. Collapses into compact
  cards on phones.
- **Plant profiles** — photo, full care sheet, substrate recipe,
  markdown notes and complete event history.
- **Photo album** — capture a photo from the profile; it is compressed
  on-device, committed to the repo like everything else, and logged as a
  photo event (each profile grows a little photo timeline; any shot can
  become the cover).
- **Reference vs. observed care** — every parameter keeps what the
  literature says *and* what has actually proven to work, side by side.
  Scheduling always follows the observed value; the source value is
  never overwritten.
- **Two modes** — without a token the site is a read-only showcase with
  no edit controls at all; with a token it's fully editable. The token
  is the entire auth system.
- **Transparent sync** — an always-visible status chip; failed writes
  queue on-device and retry, so nothing is ever lost. Concurrent edits
  from two devices merge through sha-conflict handling.
- **Installable** — manifest + service worker; loads fast and reads
  work offline.
- **Light & dark** — the botanical notebook and its night edition;
  follows the system setting or a manual pick in Settings.
- **Blended seasons (optional)** — instead of the hard May/October
  switch, watering rhythms can ramp month by month between the winter
  and summer values (Settings → Season).

- **Daily notifications, still no backend** — a scheduled GitHub Action
  reuses the same warnings module and sends a Telegram digest: thirsty
  plants nag daily, seasonal notices fire once.
- **Calendar** — a real month view of the log (tap a day for its
  entries), with the season's advice on top: feeding transitions,
  repotting season, autumn light checks, protecting the humidity lovers.
- **Propagation** — take a cutting from a plant's profile (event + linked
  child in one step) and see the family tree.
- **House map** — an illustrated floor plan of the actual flat, windows
  and furniture included, every plant a glyph tinted by live watering
  urgency — plus a 3D dollhouse mode you can orbit and zoom.
- **Encyclopedia** — every plant record in one place, badged "I got it"
  or "I want it": the wishlist lives here (with its celebratory "got it"
  flow when a plant comes home) alongside past plants — gifted and
  remembered ones included.

Built with vanilla HTML/CSS/JS (native ES modules, zero dependencies,
no build step). The scheduling and warning logic is a pure, fully
tested module that runs identically in the browser and in Node.

## What it deliberately does not do

- **Native web-push.** The Telegram digest from the scheduled Action *is*
  the notification system — a decision, not a deferral: it reuses the same
  tested warnings module, needs no permission ceremony, and is not at the
  mercy of iOS PWA push quirks.
