// Album <img> for photo events, shared by the plant profile and the
// gallery. Why it exists: a photo committed THIS session 404s on GitHub
// Pages until the deploy finishes (~1 min), so the capture flow registers
// the just-uploaded bytes here and every view serves the local object URL
// meanwhile — and a path that is genuinely missing (e.g. the other phone
// before the redeploy) degrades to a tinted-leaf placeholder, never a
// broken-image glyph.

import { el, icon } from '../ui.js';

// src path -> object URL, for photos committed this session (deploy gap).
const freshPhotoUrls = new Map();

/** Bridge a just-committed photo: serve `objectUrl` for `src` until reload. */
export function rememberFreshPhoto(src, objectUrl) {
  freshPhotoUrls.set(src, objectUrl);
}

/** Album <img> for a photo event: fresh local bytes when available, and a
 * tinted-leaf placeholder on 404 (mirrors plantPhoto). */
export function photoImg(event, attrs = {}) {
  const img = el('img', { src: freshPhotoUrls.get(event.src) ?? event.src, ...attrs });
  img.addEventListener('error', () => {
    const holder = el(
      'span',
      {
        class: 'photo-grid__missing',
        role: 'img',
        'aria-label': attrs.alt ?? 'Photo not available yet',
        title: 'Not published yet — it appears once the site redeploys.',
      },
      icon('leaf'),
    );
    img.replaceWith(holder);
  });
  return img;
}
