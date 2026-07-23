# Digital Garden 🌿

A living encyclopedia and day-to-day care tracker for our houseplants —
a static PWA on GitHub Pages with **no backend at all**: the data lives in
this repository as JSON, reads are plain fetches, and writes are commits
made through the GitHub REST API from the browser. The git history doubles
as the garden's diary.

- **Visitor mode** (no token): read-only browsing. All edit controls are
  absent — a showcase nobody can break.
- **Gardener mode** (token configured in Settings): tap "water" → the app
  commits the event to `data/events.json` and the sync chip shows
  saving… / saved ✓ / error with retry. Git never has to be touched.

## Setup (once)

1. Create a GitHub repository for this code and push it. The repository
   **must be public** (GitHub Pages on the free plan requires it — and
   visitor mode is the point of this app anyway).
2. In the repo: **Settings → Pages → Build and deployment → Source:
   GitHub Actions**. The included workflow
   ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) deploys
   on every push to `main` — including the pushes the app itself makes
   when you log a watering.
3. Open `https://<user>.github.io/<repo>/` — you are in visitor mode.
4. Generate a token (next section) and paste it in **Settings** inside the
   app to become a gardener.

## Creating the GitHub token

The app writes through the GitHub Contents API using a **fine-grained
personal access token** that can do exactly one thing: edit the contents
of this repository.

1. GitHub → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**
   ([direct link](https://github.com/settings/personal-access-tokens/new)).
2. Name it per device ("digital-garden — Kike's phone"), pick an
   expiration you're comfortable with.
3. **Repository access → Only select repositories** → this repo.
4. **Permissions → Repository permissions → Contents: Read and write.**
   Nothing else.
5. Generate, copy the `github_pat_…` string, paste it into the app's
   Settings screen. The app validates it against the repo before saving.

Notes worth knowing:

- The token lives **only in the device's browser storage** and is only
  ever sent to `api.github.com`. It is never committed.
- When it expires, the sync chip switches to "Token expired — fix in
  Settings", queued changes wait safely, and you paste a fresh token.
- Worst case if a token leaks: someone can commit to this one repository —
  and every change is reversible through git history.
- Heads-up on GitHub Pages: **all project sites of one account share the
  same browser origin** (`user.github.io`), so they share storage. Don't
  host untrusted JavaScript on other Pages sites of the same account, or
  use a dedicated account for the garden.

## Onboarding the second gardener (and phones in general)

Pepa doesn't need a GitHub account — the token is the auth, the **author
setting** is the attribution.

On each phone:

1. Open the site in the browser.
2. **Install it first**: on iOS, Share → *Add to Home Screen* (important:
   installed web apps are exempt from Safari's 7-day storage cleanup — in
   a browser tab the token would vanish after a week of not visiting).
   On Android, accept the install prompt or use *Add to home screen*.
3. Open the installed app, go to Settings, paste the token
   (iOS keeps browser-tab storage and installed-app storage separate, so
   paste it *inside the installed app*).
4. Pick who you are (Kike / Pepa). Events and commits will carry that
   name — `git log` reads like a gardening diary with real authorship.

## How it works (architecture)

- **Reads**: the app fetches `data/plants.json` and `data/events.json`.
  Visitors read the published Pages copy; gardeners read through the API
  (content + sha in one response) so writes always start from the exact
  version they saw.
- **Writes**: every action becomes an *operation* (append events, patch
  plant fields) in a persistent queue. A flusher applies operations to the
  freshest data and `PUT`s the file with its `sha`. On a sha conflict
  (the other phone got there first) it refetches, **re-applies the
  operation onto the fresh data** and retries — appends merge naturally,
  plant edits are field-level patches so they never clobber the other
  gardener's changes.
- **Never lose input**: if a write fails (offline, expired token), the
  operation stays queued on-device and the chip says so; it retries on
  reconnect/app-open. Event ids are minted at creation, so replays can
  never duplicate a watering.
- **Warnings** live in [shared/warnings.js](shared/warnings.js) — a pure
  module (plants + events + date in, typed warnings out) with `node:test`
  coverage, importable unchanged by the browser and by the Phase 2 GitHub
  Action.
- **Season**: summer watering rhythms apply May–September. The manual
  override in Settings affects watering intervals on that device only;
  calendar reminders (feeding transitions, autumn light) always follow the
  real month.

## Reference vs observed care

Every care parameter keeps two layers: what the **literature** says
(`care.reference`, with its source) and what **actually works in our
house** (`care.observed`, sparse, each value with an optional
`…_note` explaining why). All scheduling uses the observed value when
present — the reference is never overwritten, and the profile shows both
side by side ("Literature: every 7 days · Ours: every 14 days").

## Hand-editing the JSON (when you ever need to)

The app validates on load: structural problems show a helpful error screen
instead of rendering; suspicious-but-survivable ones (a typo'd observed
key, an event pointing at a renamed plant id) show a dismissible banner.

Rules that keep everything happy:

- `status` ∈ `active | gifted | deceased | wishlist` · event `type` ∈
  `watering | feeding | repotting | pruning | misting | treatment |
  cutting | note | photo` · `sun_need` ∈ `low | medium | high`.
- Plant `id`s are permanent — `events.plantId` and `parent` point at them.
- Event dates are local wall-clock strings (`2026-07-22T09:30:00`), no
  timezone suffix.
- To remove an observed override, **delete the key and its `…_note`
  sibling** — don't set it to `null`.
- Keep 2-space indentation; the app rewrites files canonically on its next
  commit anyway.

**Deleting the sample data**: replace the contents of `data/plants.json`
and `data/events.json` with `[]` (each file just `[]` and a newline),
commit, and delete the sample art in `img/*.svg` if you like. Phones pick
the change up automatically — a gardener device may briefly show its local
mirror, then reconcile on the next load/write.

**Photos** are display-only for now: commit an image to `img/` (GitHub's
web UI → *Add file → Upload files* works from a phone) and set the
plant's `photo` field — the form has a path field for it. Plants without a
photo get a drawn placeholder. In-app camera upload is a Phase 2 idea.

## Development

No build step — it's vanilla ES modules end to end.

```bash
npm test        # node:test suite for shared/, run in UTC and Europe/Madrid
npm run serve   # serves the PARENT directory on :8000
```

Then open `http://localhost:8000/<folder-name>/` — serving from the parent
mirrors the `/repo-name/` subpath of GitHub Pages, which catches absolute
path mistakes before they only break in production. The service worker
does not register on localhost, so development never fights a cache.

`IDEAS.md` at the repo root is a private notebook — it's in `.gitignore`
on purpose and never appears in the published site or in clones.

## Phase 2: push notifications via ntfy (planned)

A GitHub Action on a daily cron will import the same
[shared/warnings.js](shared/warnings.js) the app uses, and push anything
new to our phones via [ntfy.sh](https://ntfy.sh) (free, no signup):
subscribe to a private topic in the ntfy app, the Action `POST`s to
`https://ntfy.sh/<topic>`. Warning ids are stable across runs precisely so
the Action can diff against the previous day and only notify what's new.
This section will grow the actual setup steps when Phase 2 lands.
