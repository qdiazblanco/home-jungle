// Guards the hand-maintained twins that make the PWA shell atomic: the
// SHELL array in sw.js and the modulepreload list in index.html. Source-
// reading style, like purity.test.js: no browser needed.
//
// Rules enforced:
// - every SHELL path (except './') exists on disk;
// - every modulepreload href is precached (appears in SHELL);
// - every .js module under js/ and shared/ is in SHELL, and also
//   modulepreloaded UNLESS it is declared lazy below.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// Modules loaded on demand via dynamic import(): precached in SHELL so they
// work offline, but deliberately NOT modulepreloaded (off the critical path).
const LAZY = [];

// Modules that exist for the Actions runner only — the browser never imports
// them, so precaching/preloading them would waste every phone's cache.
const NODE_ONLY = ['shared/notify-digest.js'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const swSource = await readFile(join(root, 'sw.js'), 'utf8');
const htmlSource = await readFile(join(root, 'index.html'), 'utf8');

const shellMatch = swSource.match(/const SHELL = \[([\s\S]*?)\];/);
const shell = [...(shellMatch?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) =>
  m[1].replace(/^\.\//, ''),
);

const preloads = [...htmlSource.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map(
  (m) => m[1],
);

async function jsFilesUnder(dir) {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await jsFilesUnder(rel)));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const modules = [...(await jsFilesUnder('js')), ...(await jsFilesUnder('shared'))].filter(
  (file) => !NODE_ONLY.includes(file),
);

describe('app shell parity (sw.js SHELL vs index.html modulepreload)', () => {
  it('parsed both lists', () => {
    assert.ok(shell.length >= 20, `SHELL parse found only ${shell.length} entries`);
    assert.ok(preloads.length >= 20, `modulepreload parse found only ${preloads.length}`);
  });

  it('every SHELL path exists on disk', async () => {
    for (const path of shell) {
      if (path === '') continue; // './' — the navigation root
      await assert.doesNotReject(access(join(root, path)), `SHELL lists missing file ${path}`);
    }
  });

  it('every modulepreload href is precached in SHELL', () => {
    for (const href of preloads) {
      assert.ok(shell.includes(href), `${href} is modulepreloaded but not in the SW SHELL`);
    }
  });

  it('every js/ and shared/ module is precached in SHELL', () => {
    for (const file of modules) {
      assert.ok(shell.includes(file), `${file} is missing from the SW SHELL`);
    }
  });

  it('every eager module is modulepreloaded; lazy ones are not', () => {
    for (const file of modules) {
      if (LAZY.includes(file)) {
        assert.ok(
          !preloads.includes(file),
          `${file} is declared lazy but still modulepreloaded`,
        );
      } else {
        assert.ok(preloads.includes(file), `${file} is not in the modulepreload list`);
      }
    }
  });

  it('LAZY entries are real modules', () => {
    for (const file of LAZY) {
      assert.ok(modules.includes(file), `LAZY lists unknown module ${file}`);
    }
  });
});
