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
  // Code spans are extracted to placeholders FIRST so the bold/italic/link
  // regexes can never transform text inside them (`a**b**c` stays literal),
  // then restored last. \x00 cannot appear in escaped text, so the
  // placeholder is collision-free.
  const codes = [];
  let out = escaped.replace(/`([^`]+)`/g, (m, code) => {
    codes.push(code);
    return `\x00${codes.length - 1}\x00`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text, href) =>
    isSafeHref(href) ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text,
  );
  out = out.replace(/\x00(\d+)\x00/g, (m, i) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

const HEADING_TAGS = { 1: 'h2', 2: 'h3', 3: 'h4' };

/** Render markdown to an HTML string (safe to assign to innerHTML). */
export function renderMarkdown(source) {
  if (typeof source !== 'string' || !source.trim()) return '';

  // NULs never appear in real notes; dropping them guarantees the code-span
  // placeholder in renderInline cannot collide with pasted input.
  const blocks = escapeHtml(source.replace(/\r\n/g, '\n').replace(/\x00/g, '')).split(/\n{2,}/);
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
