// Guards the "pure browser+Node" contract for shared/: every module must
// import cleanly under Node (the Phase 2 Action's runtime) and must not
// reference browser globals or do I/O anywhere in its source.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const sharedDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'shared');
const files = (await readdir(sharedDir)).filter((f) => f.endsWith('.js'));

const FORBIDDEN = /\b(window|document|localStorage|sessionStorage|navigator|location|fetch|XMLHttpRequest|indexedDB|require|process)\b/;

describe('shared/ purity', () => {
  it('found the shared modules', () => {
    assert.ok(files.length >= 7, `only found: ${files.join(', ')}`);
  });

  for (const file of files) {
    it(`${file} imports cleanly in Node`, async () => {
      await import(`../shared/${file}`);
    });

    it(`${file} references no browser globals or I/O`, async () => {
      const source = await readFile(join(sharedDir, file), 'utf8');
      const match = source.match(FORBIDDEN);
      assert.equal(match, null, match && `found "${match[0]}"`);
    });
  }
});
