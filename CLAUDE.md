# Kipe's Home Jungle — working memory

Static PWA on GitHub Pages, no backend: plant data is JSON in this repo,
reads are fetches, writes are commits made from the browser through the
GitHub contents API behind a fine-grained PAT. The git history IS the care
diary. Vanilla ES modules, zero dependencies, no build step.

## Commands

- `npm test` — `node --test` twice: `TZ=UTC` and `TZ=Europe/Madrid`. Both
  legs must pass before EVERY commit.
- `npm run serve` — serves the parent dir; browse `localhost:8000/home-jungle/`.

## Hard invariants (regressions here are worse than missing features)

- **Write base**: a `{content, sha}` pair always comes from ONE API response
  (or the mirror, whose sha came from one). Pages-served JSON is display-only,
  never a write base.
- **Ops are idempotent and replayable**: event ids minted at enqueue; replay
  onto fresh data merges, never duplicates. The ops queue carries JSON only —
  never binary (photos PUT directly, then log the event).
- **Never rename** `digital-garden:*` localStorage keys (`QUEUE_KEY`,
  `MIRROR_KEY`, settings, map-view) or existing op type strings — queued ops
  on the gardeners' phones must still replay.
- **Schema changes touch three places together**: key orders in
  `js/github.js`, checks in `shared/validate.js`, and `test/serialize.test.js`.
- **`shared/` stays pure**: no browser globals, no I/O, no internal
  `Date.now()` — time flows in as `"YYYY-MM-DD"`. `test/purity.test.js`
  enforces this statically (its regex also bans the *words* window/process/…
  even in comments). Scheduling/warning logic goes in `shared/`; DOM in `js/`.
- **Reference vs observed care**: the literature value is never overwritten;
  scheduling always follows observed (`shared/effective-care.js` is the only
  merge point). Quick edits write `care.observed.*` only.
- **Escape-first markdown**: raw user input never reaches `innerHTML`
  (`el()`'s `html:` attr is only fed from `shared/markdown.js` or icon consts).
- **Shell parity**: every eagerly-loaded module appears in BOTH the
  `index.html` modulepreload list and the `sw.js` `SHELL` array; lazy modules
  are in `SHELL` only and in `test/shell.test.js`'s `LAZY` list.
- **SW never intercepts `data/*.json`** or api.github.com; the store owns
  data freshness. Logged waterings must never trigger update prompts.
- **Accessibility**: color never the only signal (icon + text too), ≥44px tap
  targets, visible focus, `prefers-reduced-motion`, AA contrast with ratios
  annotated as comments in `css/tokens.css`.
- **DOM gotcha (bit twice)**: `el()` flattens array children, native
  `append()` stringifies arrays — always spread arrays into append calls.

## Workflow

- Branch off `main` first; Pepa commits from the live app — `git pull
  --rebase` before pushing.
- One commit per task, imperative subject, `npm test` green before each.
- `token.txt`, `BRIEF.md`, `GUIDE.md`, `IDEAS.md` are private/gitignored:
  never commit, read, or overwrite them (`git check-ignore token.txt` before
  bulk staging).
- Short "why" comments, top-of-file invariant notes on new modules, no
  drive-by refactors of untouched code.
