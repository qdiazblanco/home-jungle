// Photo capture: downscale + compress in the browser, hard, because these
// files are committed straight into the repo (GitHub Pages does not resolve
// LFS — plain files only).
//
// Invariants:
// - Image blobs NEVER enter the ops queue (it stays JSON-only). The caller
//   PUTs the image first and only after success enqueues the photo event
//   that references it — so a failed upload leaves no dangling event.
// - Offline or visitor mode never queues a photo; the capture control is
//   the caller's responsibility to gate honestly.

const MAX_EDGE = 1600;
const TARGET_BYTES = 450 * 1024;

async function decodeImage(file) {
  if ('createImageBitmap' in window) {
    // from-image: respect the EXIF orientation phones stamp on captures.
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode the image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(image) {
  const w = image.width ?? image.naturalWidth;
  const h = image.height ?? image.naturalHeight;
  const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();
  return canvas;
}

const toBlob = (canvas, type, quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

async function encodeCanvas(canvas, quality) {
  // Feature-detect the OUTPUT: Safari accepts the 'image/webp' argument but
  // silently hands back PNG — only the blob's actual type can be trusted.
  const webp = await toBlob(canvas, 'image/webp', quality);
  if (webp?.type === 'image/webp') return { blob: webp, ext: 'webp' };
  const jpeg = await toBlob(canvas, 'image/jpeg', quality);
  if (!jpeg) throw new Error('Could not encode the image.');
  return { blob: jpeg, ext: 'jpg' };
}

/**
 * @param {File} file from an <input type="file" accept="image/*">
 * @returns {{ bytes: ArrayBuffer, ext: 'webp'|'jpg', oversized: boolean }}
 *   oversized: still above the size target after the second pass — the
 *   caller should mention it (snackbar) but proceed regardless.
 */
export async function compressPhoto(file) {
  const canvas = drawScaled(await decodeImage(file));
  let { blob, ext } = await encodeCanvas(canvas, 0.8);
  let oversized = false;
  if (blob.size > TARGET_BYTES) {
    ({ blob, ext } = await encodeCanvas(canvas, 0.65));
    if (blob.size > TARGET_BYTES) {
      oversized = true;
      console.warn(`Photo still ${Math.round(blob.size / 1024)} KB after re-encoding — committing anyway.`);
    }
  }
  return { bytes: await blob.arrayBuffer(), ext, oversized };
}
