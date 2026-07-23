// Tiny escape-first markdown renderer for plant notes (string → HTML string).
//
// Deliberately small grammar, documented in the README's hand-editing guide:
//   - paragraphs (blank-line separated; single newlines become <br>)
//   - # / ## / ### headings  → h2 / h3 / h4
//   - "- " bullet lists
//   - **bold**, *italic*, `code`
//   - [links](https://…) — http/https only; anything else renders as text
//
// Safety model: ALL input is HTML-escaped first, then markdown transforms
// run on the escaped text and only emit our own fixed tags. Raw input never
// reaches innerHTML, so notes like <img onerror=…> render as visible text.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function isSafeHref(href) {
  return /^https?:\/\//i.test(href);
}

function renderInline(escaped) {
  let out = escaped;
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text, href) =>
    isSafeHref(href) ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text,
  );
  return out;
}

const HEADING_TAGS = { 1: 'h2', 2: 'h3', 3: 'h4' };

/** Render markdown to an HTML string (safe to assign to innerHTML). */
export function renderMarkdown(source) {
  if (typeof source !== 'string' || !source.trim()) return '';

  const blocks = escapeHtml(source.replace(/\r\n/g, '\n')).split(/\n{2,}/);
  const html = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;

    const heading = lines[0].match(/^(#{1,3})\s+(.*)$/);
    if (heading && lines.length === 1) {
      const tag = HEADING_TAGS[heading[1].length];
      html.push(`<${tag}>${renderInline(heading[2])}</${tag}>`);
      continue;
    }

    if (lines.every((l) => /^-\s+/.test(l.trim()))) {
      const items = lines
        .map((l) => `<li>${renderInline(l.trim().replace(/^-\s+/, ''))}</li>`)
        .join('');
      html.push(`<ul>${items}</ul>`);
      continue;
    }

    html.push(`<p>${lines.map((l) => renderInline(l)).join('<br>')}</p>`);
  }

  return html.join('\n');
}
