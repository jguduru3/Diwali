/**
 * A quick on-device check of a photo before it is uploaded: too dark, too bright (glare) or
 * blurry. It only advises: the person can retake the photo or use it anyway.
 */
export type PhotoIssue = 'dark' | 'bright' | 'blurry';

const SIDE = 256; // analysed size; enough to judge focus, fast on low-end phones
const DARK = 50; // mean luminance 0-255
const BRIGHT = 215;
const GLARE_SHARE = 0.25; // share of near-white pixels
const BLUR = 40; // variance of the Laplacian

/** Judges a grey image (one byte per pixel, row by row). */
export function assessGray(
  gray: ArrayLike<number>,
  width: number,
  height: number,
): PhotoIssue | null {
  const n = width * height;
  if (n === 0) return null;
  let sum = 0;
  let white = 0;
  for (let i = 0; i < n; i++) {
    const v = gray[i]!;
    sum += v;
    if (v >= 250) white++;
  }
  const mean = sum / n;
  if (mean < DARK) return 'dark';
  if (mean > BRIGHT || white / n > GLARE_SHARE) return 'bright';
  // Variance of the 4-neighbour Laplacian: sharp edges give large values, blur gives small ones.
  let lsum = 0;
  let lsq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const l = gray[i - width]! + gray[i + width]! + gray[i - 1]! + gray[i + 1]! - 4 * gray[i]!;
      lsum += l;
      lsq += l * l;
      count++;
    }
  }
  if (count === 0) return null;
  const lmean = lsum / count;
  return lsq / count - lmean * lmean < BLUR ? 'blurry' : null;
}

/** Checks an image file; PDFs, other files and browsers without canvas support pass. */
export async function checkPhoto(file: File): Promise<PhotoIssue | null> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap !== 'function') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0; i < gray.length; i++) {
      gray[i] = 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
    }
    return assessGray(gray, w, h);
  } catch {
    return null; // cannot decode here: the server checks type and size
  }
}
