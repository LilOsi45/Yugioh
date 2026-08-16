import type { Rect } from './scan';

/**
 * Where things sit on a Yu-Gi-Oh card, and how to find them in a camera frame.
 *
 * The rarity cannot be read as text — measured against the live data, a card printed
 * at seven rarities carries the *same* code seven times (`RA04-EN087`). What does
 * differ is how the card looks: the name is black, silver or gold foil, and the
 * artwork of a rare printing throws rainbow highlights. To measure that, the app has
 * to know which pixels of the frame are the name and which are the artwork.
 *
 * The anchor for all of it is the passcode, which the scanner reads anyway. Its line
 * gives the angle the card lies at and roughly how big it is; the set code, once
 * found, sharpens the size.
 */

export interface Point {
  x: number;
  y: number;
}

/** A card is 59 × 86 mm. */
export const CARD_ASPECT = 59 / 86;

/** The passcode, bottom left, in card coordinates (0..1 from the top left corner). */
export const PASSCODE_ANCHOR: Point = { x: 0.115, y: 0.957 };

/**
 * Where the set code sits: right hand side, just above the card text box.
 *
 * Confirmed off a real card rather than assumed — `MAGO-DE009` sits in the middle
 * right of the card above the text box, a long way from the passcode down in the
 * bottom left corner. An earlier version looked for it on the passcode's own line and
 * so could never find it.
 *
 * Only the width is *relied* on: it is the same on every card and it is what the
 * card's size is worked out from. The height only steers where to look.
 */
export const SET_CODE_X = 0.855;
export const SET_CODE_Y = 0.645;

/**
 * How tall the passcode's row is, as a fraction of the card.
 *
 * A rough figure, and knowingly so: it is measured by the text engine, which counts
 * ascenders and descenders differently depending on how the crop was thresholded.
 * It is used for two things that tolerate it — cutting a band that covers nearly half
 * the card, and sanity-checking a better estimate — never for aiming at the name.
 */
export const PASSCODE_ROW_HEIGHT = 0.016;

/**
 * Where the set code is hunted for, in card coordinates. Two bands, tried in order.
 *
 * The first is the strip it is actually printed in — right hand side, just above the
 * text box — with little else in it, so the reading comes back clean. The second is
 * the whole lower half, to absorb a card whose size was mis-estimated and cards that
 * print the code somewhere else. Neither reaches up into the artwork, and that is
 * deliberate: holographic foil thresholds into a field of speckle that a set code
 * disappears into.
 */
export const SET_CODE_BANDS: Rect[] = [
  { x: 0.35, y: 0.58, width: 0.65, height: 0.12 },
  { x: 0, y: 0.5, width: 1, height: 0.5 },
];

/** The card name, in the coloured strip above the artwork. */
export const NAME_REGION: Rect = { x: 0.075, y: 0.032, width: 0.62, height: 0.062 };

/** The artwork window — where foil shows as rainbow speckle. */
export const ART_REGION: Rect = { x: 0.14, y: 0.19, width: 0.72, height: 0.4 };

/**
 * The card text box. Pale cream on every card ever printed, which makes it the one
 * thing in the picture whose true colour is known — the reference the other two
 * regions are white balanced against.
 */
export const TEXTBOX_REGION: Rect = { x: 0.1, y: 0.7, width: 0.8, height: 0.16 };

/** The regions the rarity measurement needs, all of them. */
export const RARITY_REGIONS: Rect[] = [NAME_REGION, ART_REGION, TEXTBOX_REGION];

/**
 * A card located in frame pixels: where its top left corner is, and which way its
 * edges run. `right` spans the full card width, `down` the full height.
 */
export interface CardFrame {
  origin: Point;
  right: Point;
  down: Point;
}

function frameAt(centre: Point, right: Point, down: Point, anchor: Point): CardFrame {
  return {
    origin: {
      x: centre.x - right.x * anchor.x - down.x * anchor.y,
      y: centre.y - right.y * anchor.x - down.y * anchor.y,
    },
    right,
    down,
  };
}

/**
 * Builds the card's frame from the passcode's line alone.
 *
 * The text engine reports a baseline for every line it reads, and how tall the row
 * is. That is enough on its own: the baseline gives the angle the card lies at, the
 * row height gives roughly how big it is, and the passcode's known place on the card
 * gives the position. One reading, no second anchor — which matters because the set
 * code cannot be the second anchor when finding *it* is what the geometry is for.
 *
 * The size is the weak part, so this is used to cut a generous band and nothing
 * finer. `refineScale` sharpens it once a second word is in hand.
 */
export function cardFrameFromLine(
  centre: Point,
  baseline: { x0: number; y0: number; x1: number; y1: number },
  rowHeight: number,
): CardFrame | null {
  const dx = baseline.x1 - baseline.x0;
  const dy = baseline.y1 - baseline.y0;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0 || !(rowHeight > 0)) return null;

  const height = rowHeight / PASSCODE_ROW_HEIGHT;
  const width = height * CARD_ASPECT;
  const right: Point = { x: (dx / length) * width, y: (dy / length) * width };
  const down: Point = { x: (-right.y / width) * height, y: (right.x / width) * height };
  return frameAt(centre, right, down, PASSCODE_ANCHOR);
}

/**
 * How far the two ways of measuring the card may disagree before neither is used.
 *
 * Wide on purpose. The row height the text engine reports is not a measurement of the
 * print — it depends on how the crop was thresholded and on how much space the engine
 * gives ascenders — so the two numbers routinely differ by half. What this has to
 * catch is the other case: a word picked up that is not the set code at all, which
 * lands nowhere near. A factor of three separates those two cleanly.
 */
const SCALE_TOLERANCE = 3;

/**
 * Sharpens a frame using the set code, whose place across the card is known.
 *
 * Only the separation *along the card's width* is used, for the reason given at
 * `SET_CODE_X`: that distance is long and the same on every card, while the height
 * the set code is printed at is not something this code is willing to assume.
 *
 * Returns null when the two ways of measuring the card disagree badly. That means one
 * of the readings is not what it was taken for, and a frame built on it would sample
 * the wrong pixels — better to ask the user than to record a confident wrong answer.
 */
export function refineScale(rough: CardFrame, passcode: Point, setCode: Point): CardFrame | null {
  const width = Math.hypot(rough.right.x, rough.right.y);
  if (width <= 0) return null;
  const along =
    ((setCode.x - passcode.x) * rough.right.x + (setCode.y - passcode.y) * rough.right.y) / width;

  const measured = along / (SET_CODE_X - PASSCODE_ANCHOR.x);
  if (!(measured > 0)) return null;
  const ratio = measured / width;
  if (ratio < 1 / SCALE_TOLERANCE || ratio > SCALE_TOLERANCE) return null;

  const right: Point = { x: rough.right.x * ratio, y: rough.right.y * ratio };
  const down: Point = { x: rough.down.x * ratio, y: rough.down.y * ratio };
  return frameAt(passcode, right, down, PASSCODE_ANCHOR);
}

/** A point of the card, in frame pixels. */
export function pointOnCard(frame: CardFrame, at: Point): Point {
  return {
    x: frame.origin.x + frame.right.x * at.x + frame.down.x * at.y,
    y: frame.origin.y + frame.right.y * at.x + frame.down.y * at.y,
  };
}

/**
 * An upright box in frame pixels around a region of the card.
 *
 * Upright rather than turned: the crop it feeds is itself turned to whichever quarter
 * the card lies at, so what is left is a small tilt, and the extra card it drags in is
 * print of the same kind.
 */
export function boundingBoxOnCard(
  frame: CardFrame,
  region: Rect,
): { x: number; y: number; width: number; height: number } {
  const corners = [
    { x: region.x, y: region.y },
    { x: region.x + region.width, y: region.y },
    { x: region.x, y: region.y + region.height },
    { x: region.x + region.width, y: region.y + region.height },
  ].map((corner) => pointOnCard(frame, corner));

  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * True when every region the rarity needs is actually inside the picture.
 *
 * The top of the card — where the name is — is regularly outside the sensor when
 * someone frames on the bottom edge. That is not a failure to report as an error; it
 * simply means this card's rarity cannot be measured, and the choice stays with the
 * user.
 */
export function regionsVisible(
  frame: CardFrame,
  width: number,
  height: number,
  regions: Rect[],
): boolean {
  return regions.every((region) => {
    const box = boundingBoxOnCard(frame, region);
    return (
      box.width >= 4 &&
      box.height >= 4 &&
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= width &&
      box.y + box.height <= height
    );
  });
}
