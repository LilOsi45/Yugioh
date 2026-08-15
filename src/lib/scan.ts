import type { Card, Database } from './types';

/**
 * Card recognition reads the eight digit passcode printed at the bottom left of a
 * card, not the card name.
 *
 * Names are set in a stylised face and are often gold or silver foil, which OCR
 * handles badly. The passcode is plain digits, and — the part that matters — every
 * result can be checked against the card index. A misread produces a number that is
 * not a real passcode, so it fails closed instead of adding the wrong card.
 */

/** Passcodes are up to 8 digits; the print carries leading zeros. */
const DIGIT_RUN = /\d{6,8}/g;

/**
 * Pulls a known card out of raw OCR output. Kept free of camera and OCR machinery
 * so the matching rules can be tested directly.
 */
export function extractCard(text: string, db: Database): Card | null {
  // OCR happily inserts spaces inside a number, so try the cleaned string too.
  const candidates = [text, text.replace(/[^\d]/g, '')];
  for (const candidate of candidates) {
    for (const run of candidate.match(DIGIT_RUN) ?? []) {
      const card = db.byPasscode.get(Number.parseInt(run, 10));
      if (card) return card;
    }
  }
  return null;
}

/**
 * Otsu's method: picks the threshold that best separates the image into two
 * brightness groups. A fixed threshold loses the print whenever the card sits on a
 * dark border or in poor light, which is most of the time on a phone.
 *
 * Returns the last level belonging to the dark group, so callers must treat
 * `value <= threshold` as dark. Comparing with `<` puts the darkest pixels in the
 * light group and blanks the image.
 */
export function otsuThreshold(histogram: number[], total: number): number {
  let sum = 0;
  for (let level = 0; level < 256; level += 1) sum += level * histogram[level]!;

  let sumBackground = 0;
  let weightBackground = 0;
  let best = 0;
  let bestVariance = -1;

  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level]!;
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += level * histogram[level]!;
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = level;
    }
  }
  return best;
}

/** Greyscale, Otsu threshold, optionally inverted for light-on-dark print. */
export function preprocess(canvas: HTMLCanvasElement, invert = false): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;

  const histogram = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const grey = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) | 0;
    data[i] = grey;
    histogram[grey] = (histogram[grey] ?? 0) + 1;
  }

  const threshold = otsuThreshold(histogram, data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    const dark = data[i]! <= threshold;
    // Tesseract wants dark text on white.
    const value = dark === !invert ? 0 : 255;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export interface Scanner {
  read: (canvas: HTMLCanvasElement) => Promise<string>;
  stop: () => Promise<void>;
}

/**
 * Loads the OCR engine on demand — it is several megabytes, and most visits never
 * open the scanner.
 */
export async function createScanner(): Promise<Scanner> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  await worker.setParameters({
    tessedit_char_whitelist: '0123456789',
    // Treat the crop as a single line of text.
    tessedit_pageseg_mode: '7' as never,
  });

  return {
    read: async (canvas) => {
      const result = await worker.recognize(canvas);
      return result.data.text;
    },
    stop: async () => {
      await worker.terminate();
    },
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A band across the middle of the view. The user points it at the passcode rather
 * than framing the whole card in a fixed layout — aiming at one number is far
 * easier than lining a card up precisely, and it puts the digits large in frame,
 * which is what OCR actually needs.
 */
export const PASSCODE_REGION: Rect = { x: 0.06, y: 0.42, width: 0.88, height: 0.16 };

/**
 * Maps a rectangle expressed in fractions of the *displayed* element onto pixels of
 * the *source* video, for an element using `object-fit: cover`.
 *
 * These are not the same coordinate space: cover scales the video up until it fills
 * the element and crops the overflow. Ignoring that meant the guide box on screen
 * and the strip handed to OCR were different parts of the picture, so the scanner
 * read an empty patch no matter how carefully the card was lined up.
 */
export function coverSourceRect(
  videoWidth: number,
  videoHeight: number,
  elementWidth: number,
  elementHeight: number,
  guide: Rect,
): { sx: number; sy: number; sw: number; sh: number } {
  if (videoWidth <= 0 || videoHeight <= 0 || elementWidth <= 0 || elementHeight <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(0, videoWidth), sh: Math.max(0, videoHeight) };
  }

  const scale = Math.max(elementWidth / videoWidth, elementHeight / videoHeight);
  const offsetX = (videoWidth * scale - elementWidth) / 2;
  const offsetY = (videoHeight * scale - elementHeight) / 2;

  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const sx = clamp((guide.x * elementWidth + offsetX) / scale, videoWidth);
  const sy = clamp((guide.y * elementHeight + offsetY) / scale, videoHeight);
  return {
    sx,
    sy,
    sw: clamp((guide.width * elementWidth) / scale, videoWidth - sx),
    sh: clamp((guide.height * elementHeight) / scale, videoHeight - sy),
  };
}

export function cropRegion(
  source: HTMLVideoElement,
  region: Rect = PASSCODE_REGION,
  options: { invert?: boolean; scale?: number } = {},
): HTMLCanvasElement {
  const { invert = false, scale = 4 } = options;
  const { sx, sy, sw, sh } = coverSourceRect(
    source.videoWidth,
    source.videoHeight,
    source.clientWidth,
    source.clientHeight,
    region,
  );

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context && sw > 0 && sh > 0) {
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    preprocess(canvas, invert);
  }
  return canvas;
}
