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

/** Boosts contrast on the cropped strip; phone shots of tiny print are low contrast. */
export function preprocess(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;

  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const grey = (data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114) | 0;
    data[i] = grey;
    if (grey < min) min = grey;
    if (grey > max) max = grey;
  }

  const span = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const stretched = ((data[i]! - min) / span) * 255;
    const value = stretched < 128 ? 0 : 255;
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

/**
 * Where the passcode sits on a card, as fractions of the guide box the user lines
 * the card up with. The crop is deliberately generous — a tight box misses when the
 * card is held at a slight angle.
 */
export const PASSCODE_REGION = { x: 0.02, y: 0.9, width: 0.45, height: 0.09 } as const;

export function cropRegion(
  source: HTMLVideoElement,
  region: { x: number; y: number; width: number; height: number } = PASSCODE_REGION,
  scale = 4,
): HTMLCanvasElement {
  const sourceWidth = source.videoWidth;
  const sourceHeight = source.videoHeight;
  const sx = sourceWidth * region.x;
  const sy = sourceHeight * region.y;
  const sw = sourceWidth * region.width;
  const sh = sourceHeight * region.height;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context) {
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    preprocess(canvas);
  }
  return canvas;
}
