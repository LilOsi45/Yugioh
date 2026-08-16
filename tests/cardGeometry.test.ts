import { describe, expect, it } from 'vitest';
import {
  boundingBoxOnCard,
  cardFrameFromLine,
  NAME_REGION,
  PASSCODE_ANCHOR,
  PASSCODE_ROW_HEIGHT,
  pointOnCard,
  RARITY_REGIONS,
  refineScale,
  regionsVisible,
  SET_CODE_BAND,
  SET_CODE_X,
} from '../src/lib/cardGeometry';

/**
 * A card 400 px wide lying flat in a 1280 × 720 frame, with its top left corner at
 * (300, 40). Everything below is measured against that.
 */
const WIDTH = 400;
const HEIGHT = WIDTH / (59 / 86);
const ORIGIN = { x: 300, y: 40 };
const ROW = HEIGHT * PASSCODE_ROW_HEIGHT;

function anchorAt(fraction: { x: number; y: number }) {
  return { x: ORIGIN.x + fraction.x * WIDTH, y: ORIGIN.y + fraction.y * HEIGHT };
}

/** A baseline running along the card's width, through the passcode. */
function flatBaseline() {
  const centre = anchorAt(PASSCODE_ANCHOR);
  return { x0: centre.x - 30, y0: centre.y, x1: centre.x + 30, y1: centre.y };
}

/** Turns a point about the card's top left corner, for the tilted cases. */
function turned(point: { x: number; y: number }, degrees: number) {
  const angle = (degrees * Math.PI) / 180;
  const dx = point.x - ORIGIN.x;
  const dy = point.y - ORIGIN.y;
  return {
    x: ORIGIN.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: ORIGIN.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

describe('cardFrameFromLine', () => {
  it('recovers the card from the passcode line alone', () => {
    const frame = cardFrameFromLine(anchorAt(PASSCODE_ANCHOR), flatBaseline(), ROW);
    expect(frame).not.toBeNull();
    expect(frame!.origin.x).toBeCloseTo(ORIGIN.x, 1);
    expect(frame!.origin.y).toBeCloseTo(ORIGIN.y, 1);
    expect(frame!.right.x).toBeCloseTo(WIDTH, 1);
    expect(frame!.down.y).toBeCloseTo(HEIGHT, 1);
  });

  it('follows a card lying at an angle, which is what the baseline is for', () => {
    const centre = turned(anchorAt(PASSCODE_ANCHOR), 12);
    const from = turned({ x: anchorAt(PASSCODE_ANCHOR).x - 30, y: anchorAt(PASSCODE_ANCHOR).y }, 12);
    const to = turned({ x: anchorAt(PASSCODE_ANCHOR).x + 30, y: anchorAt(PASSCODE_ANCHOR).y }, 12);
    const frame = cardFrameFromLine(centre, { x0: from.x, y0: from.y, x1: to.x, y1: to.y }, ROW)!;

    const expected = turned(anchorAt({ x: 0.5, y: 0.2 }), 12);
    const got = pointOnCard(frame, { x: 0.5, y: 0.2 });
    expect(got.x).toBeCloseTo(expected.x, 0);
    expect(got.y).toBeCloseTo(expected.y, 0);
  });

  it('refuses a line with no length or no height', () => {
    const centre = anchorAt(PASSCODE_ANCHOR);
    expect(cardFrameFromLine(centre, { x0: 10, y0: 10, x1: 10, y1: 10 }, ROW)).toBeNull();
    expect(cardFrameFromLine(centre, flatBaseline(), 0)).toBeNull();
  });
});

describe('refineScale', () => {
  const rough = cardFrameFromLine(anchorAt(PASSCODE_ANCHOR), flatBaseline(), ROW)!;
  const passcode = anchorAt(PASSCODE_ANCHOR);

  it('takes its size from the set code, whatever height that is printed at', () => {
    // The same set code, once under the artwork and once on the bottom line: the
    // card that comes out has to be the same size either way.
    const high = refineScale(rough, passcode, anchorAt({ x: SET_CODE_X, y: 0.645 }))!;
    const low = refineScale(rough, passcode, anchorAt({ x: SET_CODE_X, y: 0.957 }))!;
    expect(high.right.x).toBeCloseTo(low.right.x, 3);
    expect(high.down.y).toBeCloseTo(low.down.y, 3);
    expect(high.right.x).toBeCloseTo(WIDTH, 1);
  });

  it('corrects a row height that came out too small', () => {
    const small = cardFrameFromLine(anchorAt(PASSCODE_ANCHOR), flatBaseline(), ROW * 0.85)!;
    expect(small.right.x).toBeLessThan(WIDTH);
    const fixed = refineScale(small, passcode, anchorAt({ x: SET_CODE_X, y: 0.957 }))!;
    expect(fixed.right.x).toBeCloseTo(WIDTH, 1);
    expect(fixed.origin.y).toBeCloseTo(ORIGIN.y, 1);
  });

  it('refuses when the two ways of measuring the card disagree badly', () => {
    // A word half a card away from where the set code could be: one of the two
    // readings is not what it was taken for, so nothing is measured.
    expect(refineScale(rough, passcode, { x: passcode.x + 40, y: passcode.y })).toBeNull();
    expect(refineScale(rough, passcode, { x: passcode.x - 200, y: passcode.y })).toBeNull();
  });
});

describe('SET_CODE_BAND', () => {
  const frame = cardFrameFromLine(anchorAt(PASSCODE_ANCHOR), flatBaseline(), ROW)!;

  it('covers both places a card prints its set code', () => {
    const box = boundingBoxOnCard(frame, SET_CODE_BAND);
    for (const y of [0.645, 0.957]) {
      const point = anchorAt({ x: SET_CODE_X, y });
      expect(point.x).toBeGreaterThanOrEqual(box.x);
      expect(point.x).toBeLessThanOrEqual(box.x + box.width);
      expect(point.y).toBeGreaterThanOrEqual(box.y);
      expect(point.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it('leaves the artwork out, where foil turns into speckle', () => {
    expect(SET_CODE_BAND.y).toBeGreaterThan(0.5);
  });
});

describe('regionsVisible', () => {
  const frame = cardFrameFromLine(anchorAt(PASSCODE_ANCHOR), flatBaseline(), ROW)!;

  it('accepts a card that is fully inside the picture', () => {
    expect(regionsVisible(frame, 1280, 720, RARITY_REGIONS)).toBe(true);
  });

  it('rejects it when the top of the card is out of shot', () => {
    const box = boundingBoxOnCard(frame, NAME_REGION);
    expect(box.y).toBeLessThan(120);
    const centre = anchorAt(PASSCODE_ANCHOR);
    const high = cardFrameFromLine(
      { x: centre.x, y: centre.y - 120 },
      { x0: centre.x - 30, y0: centre.y - 120, x1: centre.x + 30, y1: centre.y - 120 },
      ROW,
    )!;
    expect(regionsVisible(high, 1280, 720, RARITY_REGIONS)).toBe(false);
  });

  it('rejects a card too far right to have its artwork in frame', () => {
    const centre = anchorAt(PASSCODE_ANCHOR);
    const shifted = cardFrameFromLine(
      { x: centre.x + 700, y: centre.y },
      { x0: centre.x + 670, y0: centre.y, x1: centre.x + 730, y1: centre.y },
      ROW,
    )!;
    expect(regionsVisible(shifted, 1280, 720, RARITY_REGIONS)).toBe(false);
  });
});
