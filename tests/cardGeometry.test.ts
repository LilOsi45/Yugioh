import { describe, expect, it } from 'vitest';
import {
  boundingBoxOnCard,
  cardFrameFromAnchors,
  NAME_REGION,
  PASSCODE_ANCHOR,
  pointOnCard,
  RARITY_REGIONS,
  regionsVisible,
  SET_CODE_ANCHOR,
} from '../src/lib/cardGeometry';

/**
 * A card 400 px wide lying flat in a 1280 × 720 frame, with its top left corner at
 * (300, 40). Everything below is measured against that.
 */
const WIDTH = 400;
const HEIGHT = WIDTH / (59 / 86);
const ORIGIN = { x: 300, y: 40 };

function anchorAt(fraction: { x: number; y: number }) {
  return { x: ORIGIN.x + fraction.x * WIDTH, y: ORIGIN.y + fraction.y * HEIGHT };
}

describe('cardFrameFromAnchors', () => {
  it('recovers the card from the two readings on its bottom edge', () => {
    const frame = cardFrameFromAnchors(anchorAt(PASSCODE_ANCHOR), anchorAt(SET_CODE_ANCHOR));
    expect(frame).not.toBeNull();
    expect(frame!.origin.x).toBeCloseTo(ORIGIN.x, 1);
    expect(frame!.origin.y).toBeCloseTo(ORIGIN.y, 1);
    expect(frame!.right.x).toBeCloseTo(WIDTH, 1);
    expect(frame!.down.y).toBeCloseTo(HEIGHT, 1);
  });

  it('puts the far corner of the card where it belongs', () => {
    const frame = cardFrameFromAnchors(anchorAt(PASSCODE_ANCHOR), anchorAt(SET_CODE_ANCHOR))!;
    const corner = pointOnCard(frame, { x: 1, y: 1 });
    expect(corner.x).toBeCloseTo(ORIGIN.x + WIDTH, 1);
    expect(corner.y).toBeCloseTo(ORIGIN.y + HEIGHT, 1);
  });

  it('follows a card held at an angle', () => {
    // The same card turned by 10 degrees about its top left corner.
    const angle = (10 * Math.PI) / 180;
    const turn = (point: { x: number; y: number }) => {
      const dx = point.x - ORIGIN.x;
      const dy = point.y - ORIGIN.y;
      return {
        x: ORIGIN.x + dx * Math.cos(angle) - dy * Math.sin(angle),
        y: ORIGIN.y + dx * Math.sin(angle) + dy * Math.cos(angle),
      };
    };
    const frame = cardFrameFromAnchors(turn(anchorAt(PASSCODE_ANCHOR)), turn(anchorAt(SET_CODE_ANCHOR)))!;
    const expected = turn(anchorAt({ x: 0.5, y: 0.2 }));
    const got = pointOnCard(frame, { x: 0.5, y: 0.2 });
    expect(got.x).toBeCloseTo(expected.x, 0);
    expect(got.y).toBeCloseTo(expected.y, 0);
  });

  it('refuses two readings that are practically on top of each other', () => {
    expect(cardFrameFromAnchors({ x: 100, y: 100 }, { x: 108, y: 101 })).toBeNull();
  });

  it('refuses a pair that would mean the card stands on its head', () => {
    // The set code far above the passcode: whatever those two words are, they are
    // not the bottom line of a card that was just read.
    expect(cardFrameFromAnchors({ x: 100, y: 400 }, { x: 300, y: 100 })).toBeNull();
  });
});

describe('regionsVisible', () => {
  const frame = cardFrameFromAnchors(anchorAt(PASSCODE_ANCHOR), anchorAt(SET_CODE_ANCHOR))!;

  it('accepts a card that is fully inside the picture', () => {
    expect(regionsVisible(frame, 1280, 720, RARITY_REGIONS)).toBe(true);
  });

  it('rejects it when the top of the card is out of shot', () => {
    // The name sits near the top edge; a frame that starts below it cannot show it.
    const box = boundingBoxOnCard(frame, NAME_REGION);
    expect(box.y).toBeLessThan(120);
    const cropped = cardFrameFromAnchors(
      { x: anchorAt(PASSCODE_ANCHOR).x, y: anchorAt(PASSCODE_ANCHOR).y - 120 },
      { x: anchorAt(SET_CODE_ANCHOR).x, y: anchorAt(SET_CODE_ANCHOR).y - 120 },
    )!;
    expect(regionsVisible(cropped, 1280, 720, RARITY_REGIONS)).toBe(false);
  });

  it('rejects a card too far right to have its artwork in frame', () => {
    const shifted = cardFrameFromAnchors(
      { x: anchorAt(PASSCODE_ANCHOR).x + 700, y: anchorAt(PASSCODE_ANCHOR).y },
      { x: anchorAt(SET_CODE_ANCHOR).x + 700, y: anchorAt(SET_CODE_ANCHOR).y },
    )!;
    expect(regionsVisible(shifted, 1280, 720, RARITY_REGIONS)).toBe(false);
  });
});
