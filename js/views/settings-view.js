// Settings (MVP 7): GitHub token (with the generation guide), author,
// manual season override, repo coordinates — plus the door between visitor
// and gardener mode.

import * as store from '../store.js';
import * as gh from '../github.js';
import { getSettings, saveSettings, isGardener, repoCoords } from '../settings.js';
import { el, icon, clear, confirmDialog } from '../ui.js';
import { KNOWN_GARDENERS } from '../components/author-gate.js';

export function render(container) {
  const root = el('div');
  container.appendChild(root);
  const draw = () => {
    clear(root);
    drawContent(root, draw);
  };
  draw();
}

function drawContent(root, draw) {
  const settings = getSettings();
  const coords = repoCoords();
  const gardener = isGardener();

  root.appendChild(el('h1', {}, 'Settings'));

  /* ================= access ================= */

  root.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Access')));
  const accessCard = el('div', { class: 'card' });

  if (gardener) {
    accessCard.appendChild(
      el(
        'p',
        {},
        icon('check'),
        ' ',
        el('strong', {}, 'Gardener mode'),
        ' — this device can water, log and edit.',
      ),
    );
    accessCard.appendChild(
      el(
        'div',
        { class: 'sheet__actions' },
        el(
          'button',
          {
            class: 'btn btn--danger',
            onclick: async () => {
              const pending = gh.pendingOps().length;
              if (pending) {
                const sure = await confirmDialog({
                  title: `${pending} unsaved ${pending === 1 ? 'change' : 'changes'}`,
                  message:
                    'Removing the token now would discard queued changes that have not reached GitHub yet. Let them sync first, or discard them.',
                  confirmLabel: `Discard ${pending} and remove token`,
                  danger: true,
                });
                if (!sure) return;
                gh.clearQueue();
              } else {
                const sure = await confirmDialog({
                  title: 'Switch to visitor mode?',
                  message: 'The token is removed from this device only. You can paste it again anytime.',
                  confirmLabel: 'Remove token',
                  danger: true,
                });
                if (!sure) return;
              }
              saveSettings({ token: '' });
              store.load();
              draw();
            },
          },
          'Remove token from this device',
        ),
      ),
    );
  } else {
    accessCard.appendChild(
      el(
        'p',
        { class: 'small' },
        el('strong', {}, 'Visitor mode'),
        ' — browsing only. Paste the garden token to unlock editing on this device.',
      ),
    );

    const tokenInput = el('input', {
      type: 'password',
      placeholder: 'github_pat_…',
      autocomplete: 'off',
      'aria-label': 'GitHub fine-grained personal access token',
    });
    const feedback = el('p', { class: 'small', style: 'min-height:1.2em' });

    accessCard.append(
      el('div', { class: 'field' }, el('label', {}, 'Personal access token'), tokenInput),
      feedback,
      el(
        'div',
        { class: 'sheet__actions' },
        el(
          'button',
          {
            class: 'btn btn--primary',
            onclick: async (e) => {
              const token = tokenInput.value.trim();
              if (!token) return;
              const button = e.currentTarget;
              button.disabled = true;
              feedback.textContent = 'Checking the token against the repository…';
              saveSettings({ token });
              try {
                const probe = await gh.probeRepo();
                if (probe.permissions && probe.permissions.push === false) {
                  throw new gh.ApiError('auth', 'This token cannot write to the repository.');
                }
                gh.resumeAfterAuthFix();
                feedback.textContent = `Connected to ${probe.fullName} — welcome, gardener.`;
                await store.load();
                draw();
              } catch (err) {
                saveSettings({ token: '' });
                feedback.textContent =
                  err.kind === 'not-found'
                    ? 'The token was rejected or cannot see this repository — check the repo access you granted it.'
                    : `Could not validate the token: ${err.message}`;
                button.disabled = false;
              }
            },
          },
          'Unlock gardener mode',
        ),
      ),
    );

    accessCard.appendChild(tokenGuide(coords));
  }
  root.appendChild(accessCard);

  /* ================= author ================= */

  root.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Gardener')));
  const authorCard = el('div', { class: 'card' });
  const authorSeg = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Author' });
  const drawAuthors = () => {
    authorSeg.textContent = '';
    for (const name of KNOWN_GARDENERS) {
      authorSeg.appendChild(
        el(
          'button',
          {
            'aria-pressed': String(getSettings().author === name),
            onclick: () => {
              saveSettings({ author: name });
              drawAuthors();
            },
          },
          name,
        ),
      );
    }
  };
  drawAuthors();
  const otherAuthor = el('input', {
    type: 'text',
    placeholder: 'Someone else…',
    value: KNOWN_GARDENERS.includes(settings.author) ? '' : settings.author,
    onchange: (e) => {
      const name = e.target.value.trim();
      if (name) {
        saveSettings({ author: name });
        drawAuthors();
      }
    },
  });
  authorCard.append(
    el('p', { class: 'small muted' }, 'Logged events and git commits carry this name.'),
    el('div', { class: 'field-row' }, authorSeg, otherAuthor),
  );
  root.appendChild(authorCard);

  /* ================= season ================= */

  root.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Season')));
  const seasonCard = el('div', { class: 'card' });
  const seasonSeg = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Season override' });
  const seasons = [
    ['auto', 'Auto'],
    ['summer', 'Force summer'],
    ['winter', 'Force winter'],
  ];
  const drawSeasons = () => {
    seasonSeg.textContent = '';
    for (const [value, label] of seasons) {
      seasonSeg.appendChild(
        el(
          'button',
          {
            'aria-pressed': String(getSettings().seasonOverride === value),
            onclick: () => {
              saveSettings({ seasonOverride: value });
              drawSeasons();
            },
          },
          label,
        ),
      );
    }
  };
  drawSeasons();
  seasonCard.append(
    el('p', { class: 'small muted' },
      'Auto: summer rhythm May–September. The override changes watering rhythms only, ',
      'on this device only — calendar reminders (feeding, autumn light) follow the real month.'),
    seasonSeg,
  );
  root.appendChild(seasonCard);

  /* ================= repository ================= */

  root.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Repository')));
  const repoCard = el('div', { class: 'card' });
  repoCard.appendChild(
    el(
      'p',
      { class: 'small' },
      coords
        ? ['Data lives in ', el('code', {}, `${coords.owner}/${coords.repo}`), ` on branch ${coords.branch}.`]
        : 'Could not derive the repository from this URL — set it below.',
    ),
  );
  repoCard.appendChild(
    el(
      'details',
      {},
      el('summary', { class: 'small' }, 'Override owner / repo / branch'),
      el(
        'div',
        { class: 'field-row', style: 'margin-top: 0.75rem' },
        el('div', { class: 'field' }, el('label', {}, 'Owner'),
          el('input', { type: 'text', value: settings.owner, placeholder: 'auto',
            onchange: (e) => saveSettings({ owner: e.target.value.trim() }) })),
        el('div', { class: 'field' }, el('label', {}, 'Repo'),
          el('input', { type: 'text', value: settings.repo, placeholder: 'auto',
            onchange: (e) => saveSettings({ repo: e.target.value.trim() }) })),
      ),
      el('div', { class: 'field' }, el('label', {}, 'Branch'),
        el('input', { type: 'text', value: settings.branch, placeholder: 'main',
          onchange: (e) => saveSettings({ branch: e.target.value.trim() }) })),
    ),
  );
  root.appendChild(repoCard);

  /* ================= data ================= */

  root.appendChild(el('div', { class: 'section-title' }, el('h2', {}, 'Data')));
  const state = store.getState();
  root.appendChild(
    el(
      'div',
      { class: 'card' },
      el('p', { class: 'small muted' },
        `Loaded from ${state.source === 'api' ? 'the GitHub API' : state.source === 'mirror' ? 'the on-device mirror (offline?)' : 'the published site'}.`),
      state.issues.length
        ? el('div', {},
            el('p', { class: 'small' }, el('strong', {}, `${state.issues.length} data wrinkles:`)),
            el('pre', {}, state.issues.map((i) => `• ${i.path}: ${i.message}`).join('\n')))
        : null,
      el(
        'div',
        { class: 'sheet__actions' },
        el('button', { class: 'btn', onclick: () => store.load() }, 'Reload data'),
        coords
          ? el(
              'a',
              {
                class: 'btn',
                href: `https://github.com/${coords.owner}/${coords.repo}`,
                target: '_blank',
                rel: 'noopener',
              },
              icon('external'),
              'Open repo',
            )
          : null,
      ),
    ),
  );
}

/* ================= token guide ================= */

function tokenGuide(coords) {
  const repoName = coords ? `${coords.owner}/${coords.repo}` : 'your-user/your-garden-repo';
  return el(
    'details',
    { style: 'margin-top: 1rem' },
    el('summary', {}, 'How to create the token (once per device pair)'),
    el(
      'ol',
      { class: 'guide-steps small' },
      el('li', {}, 'On GitHub: ', el('strong', {}, 'Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token'),
        ' (', el('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, 'direct link'), ').'),
      el('li', {}, 'Name it something like “digital-garden phone”.'),
      el('li', {}, 'Set the expiration you are comfortable with (you will paste a fresh one when it expires — the app will tell you).'),
      el('li', {}, 'Repository access: ', el('strong', {}, 'Only select repositories'), ' → ', el('code', {}, repoName), '.'),
      el('li', {}, 'Permissions → Repository permissions → ', el('strong', {}, 'Contents: Read and write'), '. Nothing else.'),
      el('li', {}, 'Generate, copy the ', el('code', {}, 'github_pat_…'), ' value and paste it above.'),
    ),
    el(
      'p',
      { class: 'small muted' },
      'The token only ever lives in this device’s browser storage and is only sent to api.github.com. ',
      'Worst case if it leaks: commits to this one repository, all reversible through git history. ',
      'Mind that every page under this GitHub Pages account shares browser storage — avoid hosting ',
      'untrusted JavaScript on other project sites of the same account.',
    ),
  );
}
