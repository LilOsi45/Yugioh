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
 * It gets that for free from work already done: the passcode is read at the bottom
 * left of the card and the set code at the bottom right. Two known points on a
 * rectangle of known proportions fix its position, size and angle completely.
 */

export interface Point {
  x: number;
  y: number;
}

/** A card is 59 × 86 mm. */
export const CARD_ASPECT = 59 / 86;

/**
 * The two anchors in card coordinates (0..1 from the top left corner).
 *
 * Both sit on the bottom line of the card: the eight digit passcode on the left, the
 * set code on the right. Taken at the *centre* of each reading, which is what a word
 * box gives.
 */
export const PASSCODE_ANCHOR: Point = { x: 0.115, y: 0.957 };
export const SET_CODE_ANCHOR: Point = { x: 0.855, y: 0.957 };

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

/**
 * A card located in frame pixels: where its top left corner is, and which way its
 * edges run. `right` spans the full card width, `down` the full height.
 */
export interface CardFrame {
  origin: Point;
  right: Point;
  down: Point;
}

/** Below this the two readings are too close together to be a real card. */
const MIN_ANCHOR_DISTANCE = 24;

/**
 * How far the card may be turned before the geometry is dropped. Text much more
 * slanted than this would not have been read in the first place, so a large angle
 * means the two boxes are not the two anchors.
 */
const MAX_TILT = Math.tan((30 * Math.PI) / 180);

/**
 * Builds the card's frame from the two readings.
 *
 * The direction from passcode to set code is the card's own x axis; its y axis is
 * the perpendicular pointing into the card body. Of the two perpendiculars the one
 * pointing *down* in the picture is taken: both anchors sit at the bottom of the
 * card, and a card turned far enough for that to be wrong would have been unreadable
 * anyway — text upside down is not recognised.
 *
 * Returns null rather than a guess whenever the two points cannot be those anchors.
 */
export function cardFrameFromAnchors(passcode: Point, setCode: Point): CardFrame | null {
  const dx = setCode.x - passcode.x;
  const dy = setCode.y - passcode.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance < MIN_ANCHOR_DISTANCE) return null;
  if (Math.abs(dy) > Math.abs(dx) * MAX_TILT) return null;

  // The anchors span this fraction of the card width, so the full width follows.
  const span = SET_CODE_ANCHOR.x - PASSCODE_ANCHOR.x;
  const right: Point = { x: dx / span, y: dy / span };

  // Perpendicular, scaled from width to height, pointing down the picture.
  const sign = right.x >= 0 ? 1 : -1;
  const down: Point = { x: (-right.y * sign) / CARD_ASPECT, y: (right.x * sign) / CARD_ASPECT };

  return {
    origin: {
      x: passcode.x - right.x * PASSCODE_ANCHOR.x - down.x * PASSCODE_ANCHOR.y,
      y: passcode.y - right.y * PASSCODE_ANCHOR.x - down.y * PASSCODE_ANCHOR.y,
    },
    right,
    down,
  };
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
 * Upright rather than turned: sampling colour does not need the rotation undone, and
 * the small amount of neighbouring card a tilted region drags in is background of the
 * same print. Keeping it axis aligned means an ordinary `drawImage` can cut it.
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
 * The scanner is framed on the bottom of the card, so the top — where the name is —
 * is regularly outside the sensor. That is not a failure to report as an error; it
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

/** The regions the rarity measurement needs, all of them. */
export const RARITY_REGIONS: Rect[] = [NAME_REGION, ART_REGION, TEXTBOX_REGION];
