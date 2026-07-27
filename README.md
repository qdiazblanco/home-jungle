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
  Nine event types, backdating included.
- **Care table** — every plant at a glance: last/next watering, feeding,
  light, room; inline actions and quick edits. Collapses into compact
  cards on phones.
- **Plant profiles** — photo, full care sheet, substrate recipe,
  markdown notes and complete event history.
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

Built with vanilla HTML/CSS/JS (native ES modules, zero dependencies,
no build step). The scheduling and warning logic is a pure, fully
tested module that runs identically in the browser and in Node.

## What it may do in the future

- **Push notifications without a backend** — a daily GitHub Action that
  reuses the same warnings module and notifies phones via ntfy.sh.
- **Seasonal calendar** — a global "what's due this month" view.
- **Propagation** — create cuttings from a mother plant and visualize
  the family tree.
- **House map** — a room-by-room diagram of where every plant lives.
- **Wishlist** — a dedicated view for plants not yet acquired.
