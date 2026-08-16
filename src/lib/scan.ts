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

export interface PasscodeMatch {
  card: Card;
  /** False when a digit had to be corrected to reach a known passcode. */
  exact: boolean;
}

/** Every 8-digit string one substitution away from `run`. */
function substitutions(run: string): string[] {
  const out: string[] = [];
  for (let position = 0; position < run.length; position += 1) {
    for (let digit = 0; digit <= 9; digit += 1) {
      const replacement = String(digit);
      if (replacement === run[position]) continue;
      out.push(run.slice(0, position) + replacement + run.slice(position + 1));
    }
  }
  return out;
}

/** Every 8-digit string reachable by putting one digit back into a 7-digit run. */
function insertions(run: string): string[] {
  const out: string[] = [];
  for (let position = 0; position <= run.length; position += 1) {
    for (let digit = 0; digit <= 9; digit += 1) {
      out.push(run.slice(0, position) + String(digit) + run.slice(position));
    }
  }
  return out;
}

/**
 * Like `extractCard`, but optionally willing to repair a single misread digit.
 *
 * Camera text recognition rarely returns a passcode perfectly wrong — it returns it
 * *almost* right, one digit off or one digit dropped, and the exact match then finds
 * nothing at all. Only about 14.500 of the 100 million eight-digit numbers are real
 * passcodes, so a near miss usually has exactly one real card near it; when more
 * than one is near, this gives up rather than guess.
 *
 * `repair` is off by default, and the continuous scan leaves it off on purpose. The
 * same arithmetic that makes a repair usually right also means roughly one in a
 * hundred junk readings lands next to some real passcode by chance — harmless when a
 * person just tapped and is looking at the answer, but the continuous scan reads
 * junk all day long, and a wrong card added unnoticed is worse than a card missed.
 */
export function matchPasscode(
  text: string,
  db: Database,
  options: { repair?: boolean } = {},
): PasscodeMatch | null {
  const exact = extractCard(text, db);
  if (exact) return { card: exact, exact: true };
  if (!options.repair) return null;

  const digitsOnly = text.replace(/\D/g, '');
  for (const candidate of [text, digitsOnly]) {
    for (const run of candidate.match(/\d{7,8}/g) ?? []) {
      const neighbours = run.length === 8 ? substitutions(run) : insertions(run);
      const found = new Map<number, Card>();
      for (const neighbour of neighbours) {
        const card = db.byPasscode.get(Number.parseInt(neighbour, 10));
        if (card) found.set(card.id, card);
        // Two different cards nearby means the read is not good enough to act on.
        if (found.size > 1) break;
      }
      const only = [...found.values()][0];
      if (found.size === 1 && only) return { card: only, exact: false };
    }
  }
  return null;
}

/**
 * The set code printed next to the passcode: `PHNI-DE087`, `LOB-EN001`, `OP27-DE001`.
 * A set code is never alone: the card number follows it within a few characters.
 * That, not the dash, is what separates `PHNI-DE087` from a word in the effect text.
 */
const NUMBER_AFTER_CODE = 6;

/** Shortest code we will look for inside a longer reading, to keep chance out. */
const MIN_LOOSE_CODE = 3;

/**
 * Characters OCR mixes up when it only has letter shapes to go on. Comparing two
 * codes through this map lets `PHN1` match `PHNI` — but only when exactly one
 * printing of the card is that close, so an ambiguous read is dropped.
 */
const CONFUSIONS: Record<string, string> = {
  O: '0',
  Q: '0',
  D: '0',
  I: '1',
  L: '1',
  S: '5',
  B: '8',
  Z: '2',
  G: '6',
};

function shape(code: string): string {
  return [...code].map((character) => CONFUSIONS[character] ?? character).join('');
}

/**
 * Reads which printing the scanned card is, from the same crop as the passcode.
 *
 * Searches the reading for the codes of the sets *this card* was printed in, rather
 * than pulling out anything code-shaped and checking it afterwards. That way round
 * survives the mess camera text recognition actually produces: a real read came back
 * as `PHNI-DEO087`, and one stray letter was enough to make a strict `CODE-XX000`
 * pattern find nothing at all. The card's own printings are a handful of short
 * strings, so looking for them directly is both more forgiving and no less safe —
 * the answer still has to be a set this card exists in.
 *
 * Ambiguity loses: if two printings both look like the reading, none is recorded.
 * An unrecorded printing is a small gap, a wrong one is bad data forever.
 */
export function extractSetCode(text: string, card: Card): string | null {
  const cleaned = text.toUpperCase().replace(/[^A-Z0-9]/g, '');

  /** Codes found in the reading, either as printed or through OCR's confusions. */
  function search(haystack: string, asShape: boolean): Set<string> {
    const hits = new Set<string>();
    for (const printing of card.printings) {
      const code = printing.set.code;
      const upper = code.toUpperCase();
      if (upper.length < MIN_LOOSE_CODE) {
        // Too short to hunt for inside a noisy reading; demand it stands alone.
        if (new RegExp(`\\b${upper}\\s*-`).test(text.toUpperCase())) hits.add(code);
        continue;
      }
      const index = haystack.indexOf(asShape ? shape(upper) : upper);
      if (index === -1) continue;
      // The card number has to follow, or this is just letters that line up.
      const tail = cleaned.slice(index + upper.length, index + upper.length + NUMBER_AFTER_CODE);
      if (/\d/.test(tail)) hits.add(code);
    }
    return hits;
  }

  // A code that is in the reading exactly beats one that only resembles it: two
  // printings can look alike under confusion, but only one can be spelled right.
  for (const hits of [search(cleaned, false), search(shape(cleaned), true)]) {
    const [only] = hits;
    if (hits.size === 1 && only) return only;
    if (hits.size > 1) return null;
  }
  return null;
}

/** What the continuous scanner remembers between frames. */
export interface ScanMemory {
  /** The card counted last, held until the frame has been clear for a moment. */
  cardId: number | null;
  /** When the view first came back empty; null while a card is still in it. */
  emptySince: number | null;
}

export const NO_MEMORY: ScanMemory = { cardId: null, emptySince: null };

/** How long the view must stay empty before the same card may be counted again. */
export const CLEAR_AFTER_MS = 1200;

/**
 * Decides whether a recognised card is a *new* card, reading several frames a
 * second.
 *
 * A card lying in front of the lens is the same card in every frame, so counting
 * needs a rule for "this one is already in". Time alone is the wrong rule: it makes
 * a card left on the table count again every few seconds. What actually separates
 * two cards is that the view clears in between, so that is what is tracked — with a
 * short grace period, because one blurred frame in the middle of a card must not
 * read as the card being taken away.
 *
 * A different card always counts immediately: swapping one for the other is the
 * normal way through a pile, and waiting would drop cards.
 */
export function stepScan(
  memory: ScanMemory,
  cardId: number | null,
  now: number,
  clearAfter = CLEAR_AFTER_MS,
): { memory: ScanMemory; count: boolean } {
  if (cardId === null) {
    const emptySince = memory.emptySince ?? now;
    const forgotten = now - emptySince >= clearAfter;
    return { memory: { cardId: forgotten ? null : memory.cardId, emptySince }, count: false };
  }
  if (memory.cardId === cardId) return { memory: { cardId, emptySince: null }, count: false };
  return { memory: { cardId, emptySince: null }, count: true };
}

export interface ThresholdOptions {
  /** Neighbourhood radius as a fraction of the smaller image side. */
  window?: number;
  /** A pixel is ink when it is darker than `bias` times its local mean. */
  bias?: number;
}

/**
 * Local (adaptive) thresholding: every pixel is compared with the mean of its
 * neighbourhood rather than one cut-off for the whole image.
 *
 * A card bottom holds two very different brightness zones — the near-white effect
 * box and the darker card border the passcode is printed on. Measured against that
 * layout, a single global threshold (Otsu included) pushes the whole border to
 * black and swallows the number; local thresholding read it every time.
 *
 * Uses an integral image, so cost is independent of the window size.
 */
export function adaptiveThreshold(
  grey: ArrayLike<number>,
  width: number,
  height: number,
  options: ThresholdOptions = {},
): Uint8Array {
  const { window = 0.08, bias = 0.95 } = options;
  const out = new Uint8Array(width * height);
  if (width <= 0 || height <= 0) return out;

  // integral[(y+1)*(w+1) + x+1] = sum of all pixels above and left of (x, y).
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += grey[y * width + x] ?? 0;
      integral[(y + 1) * stride + x + 1] = (integral[y * stride + x + 1] ?? 0) + rowSum;
    }
  }

  const radius = Math.max(4, Math.floor(Math.min(width, height) * window));
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        (integral[(y1 + 1) * stride + x1 + 1] ?? 0) -
        (integral[y0 * stride + x1 + 1] ?? 0) -
        (integral[(y1 + 1) * stride + x0] ?? 0) +
        (integral[y0 * stride + x0] ?? 0);
      const mean = sum / area;
      out[y * width + x] = (grey[y * width + x] ?? 0) < mean * bias ? 0 : 255;
    }
  }
  return out;
}

/**
 * How hard to cut when deciding what is ink.
 *
 * Two settings, because no single one wins: a sharp frame reads best when the cut
 * sits just under the local mean, while a soft or dim one needs a cut slightly above
 * it or the already-faint strokes are thinned away to nothing. The scanner tries
 * both rather than betting on the light being good.
 */
export const THRESHOLD_BIASES = [0.95, 1.02];

/** Greyscale, adaptive threshold, optionally inverted for light-on-dark print. */
export function preprocess(canvas: HTMLCanvasElement, invert = false, bias = THRESHOLD_BIASES[0]!): void {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const pixels = data.length / 4;

  const grey = new Float64Array(pixels);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    grey[p] = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114;
  }

  const mask = adaptiveThreshold(grey, canvas.width, canvas.height, { bias });
  for (let p = 0; p < pixels; p += 1) {
    // Tesseract wants dark text on white.
    const value = invert ? 255 - mask[p]! : mask[p]!;
    const i = p * 4;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export interface OcrMode {
  /** Tesseract page segmentation mode. */
  psm: string;
  /** Characters the engine may return; empty allows everything. */
  whitelist: string;
}

/**
 * Modes tried per scan, in order, stopping at the first real passcode.
 *
 * Measured against rendered card bottoms at two print sizes: mode 6 (uniform text
 * block) and 11 (sparse text) found the passcode in every case, while mode 7
 * (single text line) found it only when the crop held exactly one line — which a
 * card bottom never does, since the copyright and edition sit on the same strip.
 * Shipping mode 7 was why scans came back empty despite a legible crop.
 */
export const OCR_MODES: OcrMode[] = [
  { psm: '6', whitelist: '0123456789' },
  { psm: '11', whitelist: '0123456789' },
];

export interface PassVariant {
  /**
   * Read the whole camera frame instead of the viewfinder box. The box shows only
   * the middle strip of what the camera captures, so a card held slightly off
   * centre has its number outside it — visible to the sensor, invisible to the box.
   */
  wide: boolean;
  /** Invert the crop, for cards printing light on a dark border. */
  invert: boolean;
  bias: number;
  mode: OcrMode;
}

/**
 * Every combination worth trying, most likely first.
 *
 * A tap works through the whole list; the continuous scan takes one per tick. The
 * whole frame comes first: the viewfinder now outlines the entire card, so the number
 * usually sits outside the middle strip the box shows. The sharper box crop follows
 * for cards held close, and inversion last because it only helps light-on-dark print.
 */
export const PASS_VARIANTS: PassVariant[] = [false, true].flatMap((invert) =>
  [true, false].flatMap((wide) =>
    THRESHOLD_BIASES.flatMap((bias) => OCR_MODES.map((mode) => ({ wide, invert, bias, mode }))),
  ),
);

/**
 * How many of the variants the continuous scan rotates through: everything except
 * the inverted crops, which stay a tap away so an ordinary card is not made to wait
 * behind them.
 */
export const AUTO_VARIANTS = 2 * THRESHOLD_BIASES.length * OCR_MODES.length;

/**
 * Which single combination the continuous scanner tries on a given tick.
 *
 * Trying everything on every tick is what a tap does, and on a phone that takes
 * several seconds — far longer than the scan interval, so the scanner would spend
 * its whole life inside one attempt. Rotating keeps each attempt short while still
 * covering the ground within a few seconds.
 *
 * The rotation deliberately stops short of the inverted crops: those exist for an
 * unusual kind of printing, and spending half of every cycle on them would double
 * how long an ordinary card waits. A tap still tries them.
 */
export function passVariant(tick: number): PassVariant {
  const index = ((tick % AUTO_VARIANTS) + AUTO_VARIANTS) % AUTO_VARIANTS;
  return PASS_VARIANTS[index]!;
}

/**
 * Second pass, run only once a card is already identified: the same crop again, but
 * with letters allowed, to read the set code beside the passcode. Kept separate
 * because allowing letters in the passcode pass would only give the digit matcher
 * more ways to go wrong.
 */
export const SET_CODE_MODE: OcrMode = {
  psm: '6',
  whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-',
};

/** The same, for sparse text: the set code alone on an otherwise empty band. */
export const SET_CODE_SPARSE_MODE: OcrMode = { ...SET_CODE_MODE, psm: '11' };

/** Where a single word sat in the picture that was read, in that picture's pixels. */
export interface WordBox {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A printed line, with the two things about it that say how the card lies: the
 * baseline the engine fitted through it, and how tall its rows are.
 */
export interface LineBox {
  text: string;
  words: WordBox[];
  baseline: { x0: number; y0: number; x1: number; y1: number };
  rowHeight: number;
}

export interface Reading {
  text: string;
  /** Only filled in when the caller asked for boxes. */
  words: WordBox[];
  lines: LineBox[];
}

export interface Scanner {
  read: (canvas: HTMLCanvasElement, mode: OcrMode, withBoxes?: boolean) => Promise<Reading>;
  stop: () => Promise<void>;
}

/**
 * Loads the OCR engine on demand — it is several megabytes, and most visits never
 * open the scanner.
 */
export async function createScanner(): Promise<Scanner> {
  const { createWorker } = await import('tesseract.js');
  /*
   * Served by this app rather than a CDN, so the service worker can cache it and
   * scanning keeps working without a signal. `gzip: false` is wrong for the file
   * name we ship — it *is* gzipped — so the name carries the extension and the flag
   * stays at its default.
   */
  const base = `${import.meta.env.BASE_URL}ocr/`;
  const worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
  });

  // Switching parameters costs a round trip to the worker; consecutive reads in the
  // same mode are common, so remember what is already set.
  let current = '';

  return {
    /*
     * Word boxes are asked for only where they are used — locating the card for the
     * rarity — because they make the worker serialise its whole layout tree back, and
     * the passcode pass runs several times a second.
     */
    read: async (canvas, mode, withBoxes = false) => {
      const wanted = `${mode.psm}:${mode.whitelist}`;
      if (wanted !== current) {
        await worker.setParameters({
          tessedit_char_whitelist: mode.whitelist,
          tessedit_pageseg_mode: mode.psm as never,
        });
        current = wanted;
      }
      const result = await worker.recognize(canvas, {}, { text: true, blocks: withBoxes });
      const words: WordBox[] = [];
      const lines: LineBox[] = [];
      for (const block of result.data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            const inLine = line.words.map((word) => ({ text: word.text, ...word.bbox }));
            words.push(...inLine);
            lines.push({
              text: line.text,
              words: inLine,
              baseline: line.baseline,
              rowHeight: line.rowAttributes?.rowHeight ?? line.bbox.y1 - line.bbox.y0,
            });
          }
        }
      }
      return { text: result.data.text, words, lines };
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
 * A generous window over the lower part of the view: the passcode sits on the
 * bottom edge of a card, below the effect text.
 *
 * An earlier version used a thin band across the middle, which asked the user to
 * place one small number precisely and, in testing, never contained the passcode at
 * all. A large window only asks that the bottom of the card is in the bottom of the
 * frame, and the extra text it picks up is harmless — every reading is checked
 * against the card index anyway.
 */
export const PASSCODE_REGION: Rect = { x: 0.05, y: 0.55, width: 0.9, height: 0.42 };

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

/**
 * The band the set code is hunted in: the lower part of the *whole camera frame*.
 *
 * The passcode sits bottom left of a card and the set code bottom right, and the
 * viewfinder shows only the middle strip of the sensor (`object-fit: cover` throws
 * away roughly 60 % of the width). Framing so the number is comfortably inside the
 * box therefore pushes the set code out of the picture — which is exactly the
 * "passcode yes, set no" that came back from real use. The pixels exist; they were
 * only being cropped away, so this pass reads them straight from the frame.
 */
export const SET_CODE_REGION: Rect = { x: 0, y: 0.45, width: 1, height: 0.55 };

/**
 * The strip of the frame the passcode is looked for in, turned with the card.
 *
 * Two widths, and the narrow one matters more than it looks. The passcode sits in the
 * last tenth of a card, well below the artwork — and the artwork is the enemy here:
 * measured on a turned foil card, a band that reached up into it dropped the scan rate
 * from about 65 attempts a minute to 15 and returned readings like `5555555555`.
 * Holographic foil thresholds into thousands of tiny shapes, and the engine works
 * through every one of them. Keeping the band below the artwork is what makes a foil
 * card readable at all; the wider band stays as a second try for a card held further
 * up the frame.
 *
 * Which side of the frame ends up at the bottom of a turned crop follows from how the
 * crop is drawn: at a quarter turn the right, at three quarters the left, upside down
 * the top.
 */
/** How much of the frame each search takes: the passcode alone, or down to the set code. */
export const TIGHT_BAND = 0.3;
export const WIDE_BAND = 0.55;
export const SET_CODE_SPAN = 0.45;

export function passcodeBand(turn: Turn, span = 0.55): Rect {
  switch (turn) {
    case 90:
      return { x: 1 - span, y: 0, width: span, height: 1 };
    case 180:
      return { x: 0, y: 0, width: 1, height: span };
    case 270:
      return { x: 0, y: 0, width: span, height: 1 };
    default:
      return { x: 0, y: 1 - span, width: 1, height: span };
  }
}

/**
 * Crops a rectangle given in fractions of the *video frame*, ignoring how much of
 * that frame the element happens to show.
 */
export function videoSourceRect(
  videoWidth: number,
  videoHeight: number,
  region: Rect,
): { sx: number; sy: number; sw: number; sh: number } {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const sx = clamp(region.x * videoWidth, Math.max(0, videoWidth));
  const sy = clamp(region.y * videoHeight, Math.max(0, videoHeight));
  return {
    sx,
    sy,
    sw: clamp(region.width * videoWidth, videoWidth - sx),
    sh: clamp(region.height * videoHeight, videoHeight - sy),
  };
}

/**
 * One still picture, and the size of the element that was showing it.
 *
 * Every crop of a scan comes from the same still rather than from the running video.
 * The readings of a single attempt then belong to the same moment — which they have
 * to, now that the passcode and the set code are not just read but *located*, and
 * their positions used to work out where the rest of the card is.
 */
export interface Frame {
  image: CanvasImageSource;
  width: number;
  height: number;
  elementWidth: number;
  elementHeight: number;
}

export function captureFrame(video: HTMLVideoElement): Frame {
  const width = Math.max(1, video.videoWidth);
  const height = Math.max(1, video.videoHeight);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context) context.drawImage(video, 0, 0, width, height);
  return {
    image: canvas,
    width,
    height,
    elementWidth: video.clientWidth,
    elementHeight: video.clientHeight,
  };
}

/**
 * How far the crop is turned before the engine sees it.
 *
 * Text recognition reads horizontal text and nothing else. A card lying on the table
 * with the phone held over it is turned by a quarter, a half or three quarters as
 * often as not, and in that state the passcode runs *down* the picture — invisible to
 * the engine, however sharp the image is. Turning the crop is what makes those cards
 * readable at all.
 */
export type Turn = 0 | 90 | 180 | 270;

/** Tried in this order, starting from whichever turn last worked. */
export const TURNS: Turn[] = [0, 90, 270, 180];

/** Misses at one turn before the next is given a go. */
export const PROBE_AFTER = 2;

/**
 * Which turn to try, given how many attempts in a row have found nothing.
 *
 * The turn is a property of how the cards are being handled, not of the card: someone
 * working through a stack puts them down the same way every time. So the last turn
 * that worked is tried first and keeps being tried, and only a run of misses starts
 * looking elsewhere — which means the search costs something once per session rather
 * than once per card.
 */
export function turnForMisses(misses: number, preferred: Turn): Turn {
  if (misses < PROBE_AFTER) return preferred;
  const from = Math.max(0, TURNS.indexOf(preferred));
  const step = Math.floor(misses / PROBE_AFTER) % TURNS.length;
  return TURNS[(from + step) % TURNS.length]!;
}

/** A crop, together with what it would take to find a point in it again in the frame. */
export interface Crop {
  canvas: HTMLCanvasElement;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  scale: number;
  turn: Turn;
}

/**
 * Where a point of the crop sits in the whole frame.
 *
 * The inverse of how the crop was drawn, turn included — without it every position
 * read off a turned crop would point somewhere else entirely, and the card geometry
 * built on those positions would describe a card that is not there.
 */
export function pointInFrame(point: { x: number; y: number }, crop: Crop): { x: number; y: number } {
  const wide = crop.sw * crop.scale;
  const tall = crop.sh * crop.scale;
  let u: number;
  let v: number;
  switch (crop.turn) {
    case 90:
      // Drawn as (u, v) -> (sh*scale - v, u).
      u = point.y;
      v = tall - point.x;
      break;
    case 180:
      u = wide - point.x;
      v = tall - point.y;
      break;
    case 270:
      // Drawn as (u, v) -> (v, sw*scale - u).
      u = wide - point.y;
      v = point.x;
      break;
    default:
      u = point.x;
      v = point.y;
  }
  return { x: crop.sx + u / crop.scale, y: crop.sy + v / crop.scale };
}

/** Where a word sat in the whole frame, given the crop it was read from. */
export function wordCentre(word: WordBox, crop: Crop): { x: number; y: number } {
  return pointInFrame({ x: (word.x0 + word.x1) / 2, y: (word.y0 + word.y1) / 2 }, crop);
}

export interface CropOptions {
  invert?: boolean;
  scale?: number;
  bias?: number;
  turn?: Turn;
}

function drawCrop(
  frame: Frame,
  rect: { sx: number; sy: number; sw: number; sh: number },
  options: { invert: boolean; scale: number; turn: Turn; bias: number | undefined },
): Crop {
  const { invert, scale, turn, bias } = options;
  const wide = Math.max(1, Math.round(rect.sw * scale));
  const tall = Math.max(1, Math.round(rect.sh * scale));
  const turned = turn === 90 || turn === 270;

  const canvas = document.createElement('canvas');
  canvas.width = turned ? tall : wide;
  canvas.height = turned ? wide : tall;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context && rect.sw > 0 && rect.sh > 0) {
    context.imageSmoothingQuality = 'high';
    if (turn === 90) {
      context.translate(canvas.width, 0);
      context.rotate(Math.PI / 2);
    } else if (turn === 180) {
      context.translate(canvas.width, canvas.height);
      context.rotate(Math.PI);
    } else if (turn === 270) {
      context.translate(0, canvas.height);
      context.rotate(-Math.PI / 2);
    }
    context.drawImage(frame.image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, wide, tall);
    context.setTransform(1, 0, 0, 1, 0, 0);
    preprocess(canvas, invert, bias);
  }
  return { canvas, sx: rect.sx, sy: rect.sy, sw: rect.sw, sh: rect.sh, scale, turn };
}

/** Crop a rectangle given straight in frame pixels. */
export function cropPixels(
  frame: Frame,
  rect: { sx: number; sy: number; sw: number; sh: number },
  options: CropOptions = {},
): Crop {
  const { invert = false, scale = 3, bias, turn = 0 } = options;
  const sx = Math.max(0, Math.min(rect.sx, frame.width));
  const sy = Math.max(0, Math.min(rect.sy, frame.height));
  return drawCrop(
    frame,
    { sx, sy, sw: Math.min(rect.sw, frame.width - sx), sh: Math.min(rect.sh, frame.height - sy) },
    { invert, scale, turn, bias },
  );
}

/** Crop in frame coordinates — everything the camera sees, not just the viewfinder. */
export function cropVideoRegion(
  frame: Frame,
  region: Rect = SET_CODE_REGION,
  options: CropOptions = {},
): Crop {
  const { invert = false, scale = 2, bias, turn = 0 } = options;
  return drawCrop(frame, videoSourceRect(frame.width, frame.height, region), { invert, scale, turn, bias });
}

export function cropRegion(
  frame: Frame,
  region: Rect = PASSCODE_REGION,
  options: CropOptions = {},
): Crop {
  const { invert = false, scale = 4, bias, turn = 0 } = options;
  const rect = coverSourceRect(
    frame.width,
    frame.height,
    frame.elementWidth,
    frame.elementHeight,
    region,
  );
  return drawCrop(frame, rect, { invert, scale, turn, bias });
}

/**
 * Pixels of an upright box of the frame, in colour and untouched.
 *
 * Everything else here hands OCR a black-and-white picture; the rarity needs the
 * opposite — the colours exactly as the camera saw them, since gold against silver is
 * the whole question.
 */
export function samplePixels(
  frame: Frame,
  box: { x: number; y: number; width: number; height: number },
  maxSide = 64,
): ImageData | null {
  const width = Math.round(Math.min(maxSide, Math.max(1, box.width)));
  const height = Math.round(Math.min(maxSide, Math.max(1, box.height)));
  if (box.width < 2 || box.height < 2) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingQuality = 'high';
  context.drawImage(frame.image, box.x, box.y, box.width, box.height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}

/**
 * A patch out of the middle of a region, at the camera's own resolution.
 *
 * The difference from `samplePixels` is the whole point of it: shrinking a region
 * averages neighbouring pixels together, which is right for finding the colour of
 * printed letters and fatal for foil. Measured on a rainbow test card, scaling the
 * artwork down to 64 px turned brilliant speckle into flat grey — colourfulness
 * dropped to 0.09, *below* the plain painted card's 0.50, because red, green and blue
 * neighbours average to nothing. Foil is only foil at full resolution.
 */
export function samplePatch(
  frame: Frame,
  box: { x: number; y: number; width: number; height: number },
  side = 96,
): ImageData | null {
  const width = Math.round(Math.min(side, box.width));
  const height = Math.round(Math.min(side, box.height));
  if (width < 8 || height < 8) return null;
  const sx = box.x + (box.width - width) / 2;
  const sy = box.y + (box.height - height) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = false;
  context.drawImage(frame.image, sx, sy, width, height, 0, 0, width, height);
  return context.getImageData(0, 0, width, height);
}
