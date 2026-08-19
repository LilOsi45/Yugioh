import { CARD_ASPECT, type CardFrame } from './cardGeometry';

/**
 * Finds the card in the picture instead of asking the user to put it somewhere.
 *
 * Every failure so far has the same shape. The crops were addressed to a rectangle
 * the app *hoped* the card was in — a band at the bottom of the frame, then the
 * viewfinder outline — and when the card was a little closer or a little higher, the
 * strip meant for the eight digit number landed one line up, in the effect text. The
 * readings say it plainly: `328154153381140`, `14747213920821000551234370`. Those are
 * rules text read as digits, not a misread number.
 *
 * A card on a table is a big bright rectangle with four hard edges, and that is
 * something a picture can be asked about rather than assumed. Once the rectangle is
 * known, everything else — the number, the set code, the name, the artwork — is at a
 * fixed place *on the card*, and how the phone was held stops mattering.
 *
 * Deliberately axis aligned. A quadrilateral fit would also handle a card photographed
 * at an angle, but it is a lot more machinery for a case that barely occurs: people
 * hold the phone flat above the card. A slight tilt still lands inside the bands,
 * because the bands are cut with margin.
 */

/** A grey picture, small: detection runs on a thumbnail, never on the full frame. */
export interface Grey {
  data: Float64Array;
  width: number;
  height: number;
}

export interface DetectedCard {
  /** In pixels of the *grey* picture it was found in. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the card lies on its side, so the long edge runs across the picture. */
  sideways: boolean;
  score: number;
  /** How many of the four edges could be checked against what lies outside them. */
  judged: number;
}

/**
 * How far off the printed 59:86 shape a rectangle may be and still be a card.
 *
 * Not as generous as it looks. A card has a second rectangle printed inside it — the
 * artwork — and measured on the drawn test card that block comes out at 1.19 wide to
 * tall, which is 0.18 away from a card lying on its side. At 0.22 the search took the
 * artwork for the card and read the rules text; anything under 0.2 rules it out while
 * still allowing the tilt of a phone held by hand.
 */
export const ASPECT_TOLERANCE = 0.15;
/**
 * How much of the picture's *short* side the card has to span.
 *
 * Measured against the short side rather than both, because an upright card in a
 * landscape picture is naturally narrow: at 0.3 of the width, a perfectly readable
 * card three quarters the height of the frame was thrown out.
 */
export const MIN_CARD_SHARE = 0.28;

/**
 * Edge strength per column (or per row), which is where the card's borders show up.
 *
 * The card's left and right edges are long, straight, high contrast lines; summed down
 * a column they beat anything the table has. Printed text inside the card produces
 * plenty of local contrast too, but it is scattered over many columns rather than
 * piled into one.
 */
export function edgeEnergy(grey: Grey, axis: 'x' | 'y'): Float64Array {
  const { data, width, height } = grey;
  const along = axis === 'x' ? width : height;
  const across = axis === 'x' ? height : width;
  const energy = new Float64Array(along);
  for (let a = 1; a < along - 1; a += 1) {
    let sum = 0;
    for (let b = 0; b < across; b += 1) {
      const before = axis === 'x' ? data[b * width + (a - 1)]! : data[(a - 1) * width + b]!;
      const after = axis === 'x' ? data[b * width + (a + 1)]! : data[(a + 1) * width + b]!;
      sum += Math.abs(after - before);
    }
    energy[a] = sum / across;
  }
  return energy;
}

/**
 * The strongest few edges, kept apart so one thick border does not fill the list.
 *
 * A card's border is several pixels wide even in a thumbnail, so its peak has
 * shoulders; without the separation the six best candidates would all be the same
 * edge and the card would never be bracketed.
 */
export function topPeaks(energy: Float64Array, count: number, separation: number): number[] {
  const order = Array.from(energy.keys()).sort((a, b) => energy[b]! - energy[a]!);
  const peaks: number[] = [];
  for (const index of order) {
    if (energy[index]! <= 0) break;
    if (peaks.some((peak) => Math.abs(peak - index) < separation)) continue;
    peaks.push(index);
    if (peaks.length >= count) break;
  }
  return peaks.sort((a, b) => a - b);
}

/**
 * How much brighter (or darker) the card has to be than what surrounds it, in grey
 * levels, at every one of its four edges.
 *
 * This is what tells a card from a coincidence. Edge strength and card proportions
 * alone are not enough: measured against the drawn test picture, a rectangle spanning
 * most of the frame came out card shaped at exactly 1.458 and won on size, and the
 * scanner then read the table. A real card steps away from its background all the way
 * round; a rectangle bounded by noise steps nowhere.
 */
export const MIN_BORDER_STEP = 6;

/**
 * How good a rectangle enclosing the best one still has to be to be preferred to it.
 * Low on purpose: the card's own border is softer than the artwork's, so it will
 * always score worse — that is precisely why it needs to be picked anyway.
 */
export const OUTER_MIN_SCORE = 0.15;

/**
 * The smallest brightness step across the four edges of a rectangle, signed so that
 * the card may be either lighter or darker than the surface it lies on.
 *
 * An edge that runs off the picture cannot be judged and is skipped rather than
 * failed — a card held right up to the lens is still a card.
 */
export function borderStep(
  grey: Grey,
  box: { x: number; y: number; width: number; height: number },
): { step: number; judged: number } {
  const { data, width, height } = grey;
  const band = Math.max(1, Math.round(Math.min(box.width, box.height) * 0.04));
  const mean = (x0: number, y0: number, x1: number, y1: number): number | null => {
    const left = Math.max(0, Math.round(x0));
    const top = Math.max(0, Math.round(y0));
    const right = Math.min(width, Math.round(x1));
    const bottom = Math.min(height, Math.round(y1));
    if (right <= left || bottom <= top) return null;
    let sum = 0;
    for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) sum += data[y * width + x]!;
    return sum / ((right - left) * (bottom - top));
  };

  const { x, y } = box;
  const right = x + box.width;
  const bottom = y + box.height;
  const pairs: [number | null, number | null][] = [
    [mean(x + 1, y + band, x + 1 + band, bottom - band), mean(x - 1 - band, y + band, x - 1, bottom - band)],
    [mean(right - 1 - band, y + band, right - 1, bottom - band), mean(right + 1, y + band, right + 1 + band, bottom - band)],
    [mean(x + band, y + 1, right - band, y + 1 + band), mean(x + band, y - 1 - band, right - band, y - 1)],
    [mean(x + band, bottom - 1 - band, right - band, bottom - 1), mean(x + band, bottom + 1, right - band, bottom + 1 + band)],
  ];

  const steps = pairs
    .filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null)
    .map(([inside, outside]) => inside - outside);
  if (steps.length === 0) return { step: 0, judged: 0 };
  // One sign for the whole rectangle: a card is lighter than the table or darker, not
  // both, and a rectangle that steps up on one side and down on the other is an edge
  // of something else passing through.
  const lighter = steps.reduce((sum, step) => sum + step, 0) >= 0;
  return { step: Math.min(...steps.map((step) => (lighter ? step : -step))), judged: steps.length };
}

/**
 * Picks the pair of vertical and pair of horizontal edges that best make a card.
 *
 * Scored on two things at once: how strong the four edges are, and how close the
 * rectangle they bound comes to a card's proportions. Either alone goes wrong — the
 * strongest edges in a picture can be a table joint and a shadow, and a perfectly
 * card-shaped rectangle can be nothing at all.
 */
export function detectCard(grey: Grey): DetectedCard | null {
  const { width, height } = grey;
  if (width < 16 || height < 16) return null;

  const columns = edgeEnergy(grey, 'x');
  const rows = edgeEnergy(grey, 'y');
  /*
   * Ten candidates a side, kept only a little apart. Six at eight percent looked
   * tidier and lost the card: on a small card the artwork's left edge sits a couple of
   * thumbnail pixels inside the card's own, wins the slot, and the card's edge is
   * never offered at all. The aspect and border tests below throw out the extra
   * candidates cheaply, so the wider net costs almost nothing.
   */
  const xs = topPeaks(columns, 10, Math.max(2, width * 0.025));
  const ys = topPeaks(rows, 10, Math.max(2, height * 0.025));

  const short = Math.min(width, height) * MIN_CARD_SHARE;
  const minWidth = short;
  const minHeight = short;

  const valid: DetectedCard[] = [];
  for (let i = 0; i < xs.length; i += 1) {
    for (let j = i + 1; j < xs.length; j += 1) {
      const left = xs[i]!;
      const right = xs[j]!;
      if (right - left < minWidth) continue;
      for (let k = 0; k < ys.length; k += 1) {
        for (let l = k + 1; l < ys.length; l += 1) {
          const top = ys[k]!;
          const bottom = ys[l]!;
          if (bottom - top < minHeight) continue;

          const ratio = (right - left) / (bottom - top);
          // Upright or on its side; both are how cards end up on a table.
          const upright = Math.abs(ratio - CARD_ASPECT) / CARD_ASPECT;
          const turned = Math.abs(ratio - 1 / CARD_ASPECT) * CARD_ASPECT;
          const off = Math.min(upright, turned);
          if (off > ASPECT_TOLERANCE) continue;

          const strength =
            columns[left]! + columns[right]! + rows[top]! + rows[bottom]!;
          // Shape first, then edge strength: a rectangle that is exactly card shaped
          // is far more likely to be the card than one that is merely high contrast.
          /*
           * Bigger wins, all else equal. A card has a second card-shaped rectangle
           * printed inside it — the artwork — whose edges are perfectly sharp, and
           * without this the search would happily settle on that and read the rules
           * text as the number, which is the failure this whole file exists to end.
           */
          const share = ((right - left) * (bottom - top)) / (width * height);
          const box = { x: left, y: top, width: right - left, height: bottom - top };
          const { step, judged } = borderStep(grey, box);
          if (step < MIN_BORDER_STEP) continue;
          const score = strength * (1 - off / ASPECT_TOLERANCE) * Math.sqrt(share) * Math.min(step, 60);
          valid.push({ ...box, sideways: turned < upright, score, judged });
        }
      }
    }
  }
  if (valid.length === 0) return null;

  /*
   * The outermost one wins, not the best scoring one.
   *
   * A card contains a second card-shaped rectangle with a harder edge than its own —
   * the artwork, printed dark against cream — and on a small card in a big picture it
   * outscores the card itself. Containment settles it in the one direction that is
   * always true: the artwork is inside the card, and a card is inside nothing.
   */
  const best = valid.reduce((a, b) => (b.score > a.score ? b : a));
  const around = valid.filter(
    (candidate) =>
      // All four edges checked, otherwise a rectangle can grow out of the picture: an
      // edge that runs off it is not judged, and three easy sides then carry a box
      // that swallowed part of the background.
      candidate.judged === 4 &&
      candidate.score >= best.score * OUTER_MIN_SCORE &&
      candidate.x <= best.x + 1 &&
      candidate.y <= best.y + 1 &&
      candidate.x + candidate.width >= best.x + best.width - 1 &&
      candidate.y + candidate.height >= best.y + best.height - 1,
  );
  return around.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a), best);
}

/**
 * The detected rectangle as a card frame in *full frame* pixels.
 *
 * A sideways card is turned back here rather than later: the frame's axes are the
 * card's own, so `PASSCODE_LINE` and the rest keep meaning what they say however the
 * card was lying.
 */
export function frameFromDetection(
  card: DetectedCard,
  greyWidth: number,
  greyHeight: number,
  frameWidth: number,
  frameHeight: number,
  turnedRight = true,
): CardFrame {
  const kx = frameWidth / Math.max(1, greyWidth);
  const ky = frameHeight / Math.max(1, greyHeight);
  const x = card.x * kx;
  const y = card.y * ky;
  const w = card.width * kx;
  const h = card.height * ky;

  if (!card.sideways) {
    return { origin: { x, y }, right: { x: w, y: 0 }, down: { x: 0, y: h } };
  }
  // Lying on its side: the card's own width runs down the picture. Which way up it is
  // cannot be told from the outline alone, so the caller gets to try both.
  return turnedRight
    ? { origin: { x: x + w, y }, right: { x: 0, y: h }, down: { x: -w, y: 0 } }
    : { origin: { x, y: y + h }, right: { x: 0, y: -h }, down: { x: w, y: 0 } };
}

/**
 * A card is 59 x 86 mm; the sleeve around it is 66 x 91. Both are rectangles with a
 * hard edge, both are close enough to a card's proportions to pass, and the sleeve is
 * the bigger of the two — which is exactly what the search prefers.
 *
 * Reported from real use: sleeved cards read almost not at all. The reason is not the
 * plastic but those few millimetres. Everything is addressed in card fractions, so
 * locking onto the sleeve shifts the number's strip by about six percent of the card's
 * height — and the strip is a tenth of it. The number ends up just outside.
 *
 * Which of the two rectangles was found cannot be told from the outline, so both are
 * tried. A penny sleeve is open at the top and the card sits at its bottom, so the
 * inset is not centred vertically.
 */
export const SLEEVE_WIDTH_SHARE = 59 / 66;
export const SLEEVE_HEIGHT_SHARE = 86 / 91;

export function insideSleeve(card: DetectedCard): DetectedCard {
  const width = card.width * SLEEVE_WIDTH_SHARE;
  const height = card.height * SLEEVE_HEIGHT_SHARE;
  return card.sideways
    ? {
        ...card,
        // Turned a quarter, the sleeve's opening is at one side rather than the top.
        x: card.x + (card.width - height) / 2,
        y: card.y + (card.height - width) / 2,
        width: card.width * SLEEVE_HEIGHT_SHARE,
        height: card.height * SLEEVE_WIDTH_SHARE,
      }
    : {
        ...card,
        x: card.x + (card.width - width) / 2,
        y: card.y + (card.height - height),
        width,
        height,
      };
}
