import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml } from '../shared/markdown.js';

describe('renderMarkdown — grammar', () => {
  it('renders paragraphs with <br> for single newlines', () => {
    assert.equal(renderMarkdown('one\ntwo\n\nthree'), '<p>one<br>two</p>\n<p>three</p>');
  });

  it('renders headings at h2–h4 (never h1)', () => {
    assert.equal(renderMarkdown('# Story'), '<h2>Story</h2>');
    assert.equal(renderMarkdown('## Quirks'), '<h3>Quirks</h3>');
    assert.equal(renderMarkdown('### Lessons'), '<h4>Lessons</h4>');
  });

  it('renders bullet lists', () => {
    assert.equal(
      renderMarkdown('- likes east light\n- hates drafts'),
      '<ul><li>likes east light</li><li>hates drafts</li></ul>',
    );
  });

  it('renders inline bold, italic and code', () => {
    assert.equal(
      renderMarkdown('**bold** and *italic* and `code`'),
      '<p><strong>bold</strong> and <em>italic</em> and <code>code</code></p>',
    );
  });

  it('renders http(s) links with rel=noopener', () => {
    assert.equal(
      renderMarkdown('[care guide](https://example.com/monstera)'),
      '<p><a href="https://example.com/monstera" target="_blank" rel="noopener">care guide</a></p>',
    );
  });

  it('returns empty string for empty or non-string input', () => {
    assert.equal(renderMarkdown(''), '');
    assert.equal(renderMarkdown('   \n  '), '');
    assert.equal(renderMarkdown(null), '');
  });
});

describe('renderMarkdown — hostile input', () => {
  it('escapes raw HTML so injected tags render as text', () => {
    const html = renderMarkdown('<img src=x onerror=alert(1)>');
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  });

  it('drops javascript: and data: links to plain text', () => {
    assert.equal(renderMarkdown('[click](javascript:alert%281%29)'), '<p>click</p>');
    assert.equal(renderMarkdown('[click](data:text/html,x)'), '<p>click</p>');
  });

  it('cannot break out of the href attribute (quotes are pre-escaped)', () => {
    const html = renderMarkdown('[x](https://a.b/"onmouseover="alert(1))');
    assert.ok(!html.includes('onmouseover="alert'));
  });

  it('escapes script tags inside code spans', () => {
    const html = renderMarkdown('`<script>alert(1)</script>`');
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('<code>&lt;script&gt;'));
  });
});

describe('escapeHtml', () => {
  it('escapes the five specials', () => {
    assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  });
});
