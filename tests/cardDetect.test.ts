import { describe, expect, it } from 'vitest';
import {
  detectCard,
  edgeEnergy,
  frameFromDetection,
  topPeaks,
  type Grey,
} from '../src/lib/cardDetect';
import { pointOnCard, PASSCODE_ANCHOR } from '../src/lib/cardGeometry';

/**
 * A card on a table: a bright rectangle on a duller ground, with printing inside it
 * so the search cannot get away with simply finding "the bright bit".
 */
function tableWithCard(
  width: number,
  height: number,
  card: { x: number; y: number; width: number; height: number },
): Grey {
  const data = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside =
        x >= card.x && x < card.x + card.width && y >= card.y && y < card.y + card.height;
      // Sensor noise on both, so nothing is unrealistically flat.
      let value = (inside ? 205 : 120) + (((x * 7919 + y * 104729) % 5) - 2);
      if (inside) {
        // Rules text: lots of local contrast, spread over many columns and rows.
        const inText = y > card.y + card.height * 0.7 && y < card.y + card.height * 0.92;
        if (inText && (x + y) % 3 === 0) value -= 90;
        // Artwork: a darker block in the middle of the card.
        const inArt =
          y > card.y + card.height * 0.18 &&
          y < card.y + card.height * 0.6 &&
          x > card.x + card.width * 0.12 &&
          x < card.x + card.width * 0.88;
        if (inArt) value -= 45;
      }
      data[y * width + x] = value;
    }
  }
  return { data, width, height };
}

describe('edgeEnergy and topPeaks', () => {
  const grey = tableWithCard(120, 160, { x: 25, y: 12, width: 68, height: 99 });

  it('puts its strongest columns on the card edges', () => {
    const peaks = topPeaks(edgeEnergy(grey, 'x'), 2, 8);
    expect(peaks.map((p) => Math.abs(p - 25) <= 1 || Math.abs(p - 93) <= 1)).toEqual([true, true]);
  });

  it('keeps peaks apart so one border cannot fill the list', () => {
    const energy = new Float64Array(50);
    energy[10] = 9;
    energy[11] = 8; // the same edge, one pixel over
    energy[40] = 7;
    expect(topPeaks(energy, 3, 5)).toEqual([10, 40]);
  });
});

describe('detectCard', () => {
  it('finds an upright card and gets its box right', () => {
    const found = detectCard(tableWithCard(120, 160, { x: 25, y: 12, width: 68, height: 99 }));
    expect(found).not.toBeNull();
    expect(found!.x).toBeCloseTo(25, -0.5);
    expect(found!.y).toBeCloseTo(12, -0.5);
    expect(Math.abs(found!.width - 68)).toBeLessThanOrEqual(2);
    expect(Math.abs(found!.height - 99)).toBeLessThanOrEqual(2);
    expect(found!.sideways).toBe(false);
    expect(found!.judged).toBe(4);
  });

  it('finds a card lying on its side and says so', () => {
    const found = detectCard(tableWithCard(160, 120, { x: 15, y: 14, width: 99, height: 68 }));
    expect(found).not.toBeNull();
    expect(found!.sideways).toBe(true);
  });

  it('refuses a rectangle that is not card shaped', () => {
    // A square sheet of paper: strong edges, wrong proportions, nothing printed on it.
    const data = new Float64Array(120 * 160).fill(120);
    for (let y = 30; y < 110; y += 1) for (let x = 20; x < 100; x += 1) data[y * 120 + x] = 205;
    expect(detectCard({ data, width: 120, height: 160 })).toBeNull();
  });

  it('takes the card itself, not the artwork printed inside it', () => {
    const found = detectCard(tableWithCard(120, 160, { x: 25, y: 12, width: 68, height: 99 }));
    // The artwork block is card shaped too, and its edges are sharper than the card's.
    expect(found!.width).toBeGreaterThan(60);
  });

  it('refuses an empty table rather than inventing a card', () => {
    const flat = new Float64Array(120 * 160).fill(130);
    expect(detectCard({ data: flat, width: 120, height: 160 })).toBeNull();
  });
});

describe('frameFromDetection', () => {
  const detected = { x: 10, y: 20, width: 60, height: 87, sideways: false, score: 1, judged: 4 };

  it('scales the thumbnail box back onto the full frame', () => {
    const frame = frameFromDetection(detected, 120, 160, 1200, 1600);
    expect(frame.origin).toEqual({ x: 100, y: 200 });
    expect(frame.right).toEqual({ x: 600, y: 0 });
    expect(frame.down).toEqual({ x: 0, y: 870 });
  });

  it('puts the number where it belongs on a card lying sideways', () => {
    const sideways = { x: 10, y: 10, width: 87, height: 60, sideways: true, score: 1, judged: 4 };
    const frame = frameFromDetection(sideways, 120, 120, 120, 120, true);
    const at = pointOnCard(frame, PASSCODE_ANCHOR);
    // Bottom left of the card is, with the card turned a quarter to the right, the
    // top left of the picture — not the bottom left of it.
    expect(at.x).toBeGreaterThan(10);
    expect(at.x).toBeLessThan(20);
    expect(at.y).toBeLessThan(30);
  });
});
