import { describe, expect, it } from 'vitest';
import {
  combineLooks,
  decideRarity,
  measureLook,
  normalizeRarity,
  rankRarities,
  whiteBalance,
  type Look,
  type Pixels,
} from '../src/lib/rarity';

/** The pale cream of the card text box, which is what the white balance expects. */
const CREAM: Rgb = [232, 226, 208];
/** The tan strip a monster card's name is printed on. */
const NAME_STRIP: Rgb = [180, 150, 110];

type Rgb = [number, number, number];

function fill(width: number, height: number, colour: (x: number, y: number) => Rgb): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = colour(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** A name strip with letters of the given colour covering a quarter of it. */
function nameStrip(glyph: Rgb, strip: Rgb = NAME_STRIP): Pixels {
  return fill(40, 10, (x, y) => ((x + y) % 4 === 0 ? glyph : strip));
}

const textbox = (colour: Rgb = CREAM) => fill(8, 8, () => colour);

/** Printed artwork: colours that change gradually, the way a blurred picture does. */
const flatArt = fill(24, 24, (x, y) => [60 + x * 4, 90 + y * 3, 140]);

/** Foil: a fine rainbow grain, a different hue from one pixel to the next. */
const holoArt = fill(24, 24, (x, y) => {
  const noise = (x * 37 + y * 91) % 3;
  return noise === 0 ? [240, 40, 60] : noise === 1 ? [40, 230, 90] : [60, 70, 240];
});

const BLACK: Rgb = [22, 22, 24];
const GOLD: Rgb = [230, 180, 40];
const SILVER: Rgb = [226, 228, 230];

describe('whiteBalance', () => {
  it('leaves a correctly lit card alone', () => {
    const gain = whiteBalance(textbox());
    expect(gain.r).toBeCloseTo(1, 2);
    expect(gain.g).toBeCloseTo(1, 2);
    expect(gain.b).toBeCloseTo(1, 2);
  });

  it('takes the colour of warm lamplight back out', () => {
    // Warm light lifts red and drops blue; the correction has to do the opposite.
    const gain = whiteBalance(textbox([255, 226, 150]));
    expect(gain.r).toBeLessThan(1);
    expect(gain.b).toBeGreaterThan(1);
  });

  it('reads silver as silver under that light, not as gold', () => {
    const warm = (colour: Rgb): Rgb => [Math.min(255, colour[0] * 1.18), colour[1], colour[2] * 0.68];
    const look = measureLook(
      nameStrip(warm(SILVER), warm(NAME_STRIP)),
      flatArt,
      textbox(warm(CREAM)),
    );
    expect(look.nameSilver).toBeGreaterThan(0.8);
    expect(look.nameGold).toBeLessThan(0.2);
  });
});

describe('measureLook', () => {
  it('sees black print as black', () => {
    const look = measureLook(nameStrip(BLACK), flatArt, textbox());
    expect(look.nameDark).toBeGreaterThan(0.9);
    expect(look.nameGold).toBeLessThan(0.1);
  });

  it('sees gold foil as gold', () => {
    const look = measureLook(nameStrip(GOLD), flatArt, textbox());
    expect(look.nameGold).toBeGreaterThan(0.9);
  });

  it('sees silver foil as silver', () => {
    const look = measureLook(nameStrip(SILVER), flatArt, textbox());
    expect(look.nameSilver).toBeGreaterThan(0.9);
  });

  it('tells foil in the artwork from printed ink', () => {
    expect(measureLook(nameStrip(BLACK), holoArt, textbox()).artHolo).toBeGreaterThan(0.8);
    expect(measureLook(nameStrip(BLACK), flatArt, textbox()).artHolo).toBeLessThan(0.2);
  });
});

describe('combineLooks', () => {
  const still: Look = {
    nameDark: 1,
    nameGold: 0,
    nameSilver: 0,
    artHolo: 0.1,
    artChroma: 0.4,
  };

  it('counts a card whose colours swing between frames as foil', () => {
    // Ink does not change when the card tilts a little; foil does.
    const combined = combineLooks([still, { ...still, artChroma: 0.5 }]);
    expect(combined.artHolo).toBeGreaterThan(0.8);
  });

  it('leaves a card that looks the same in every frame alone', () => {
    expect(combineLooks([still, still, still]).artHolo).toBeCloseTo(0.1, 2);
  });
});

describe('decideRarity', () => {
  const commonLook = measureLook(nameStrip(BLACK), flatArt, textbox());
  const superLook = measureLook(nameStrip(BLACK), holoArt, textbox());
  const ultraLook = measureLook(nameStrip(GOLD), holoArt, textbox());
  const secretLook = measureLook(nameStrip(SILVER), holoArt, textbox());
  const rareLook = measureLook(nameStrip(SILVER), flatArt, textbox());

  it('needs no measurement when the set printed the card one way', () => {
    expect(decideRarity(['Secret Rare'], commonLook).rarity).toBe('Secret Rare');
  });

  it('separates Common from Super Rare — the everyday booster question', () => {
    expect(decideRarity(['Common', 'Super Rare'], commonLook).rarity).toBe('Common');
    expect(decideRarity(['Common', 'Super Rare'], superLook).rarity).toBe('Super Rare');
  });

  it('separates Rare from Secret Rare, both silver named', () => {
    expect(decideRarity(['Rare', 'Secret Rare'], rareLook).rarity).toBe('Rare');
    expect(decideRarity(['Rare', 'Secret Rare'], secretLook).rarity).toBe('Secret Rare');
  });

  it('picks gold out of a long list', () => {
    const candidates = ['Common', 'Rare', 'Super Rare', 'Ultra Rare', 'Secret Rare'];
    expect(decideRarity(candidates, ultraLook).rarity).toBe('Ultra Rare');
  });

  it('refuses to guess between Ultra and Ultimate, which differ by embossing', () => {
    const decision = decideRarity(['Ultra Rare', 'Ultimate Rare'], ultraLook);
    expect(decision.rarity).toBeNull();
    // Still useful: the two that are left are the two it could be.
    expect(decision.ranked).toHaveLength(2);
  });

  it('drops the impossible ones even when it cannot pick a winner', () => {
    const candidates = ['Common', 'Rare', 'Ultra Rare', 'Ultimate Rare'];
    const ranked = rankRarities(candidates, ultraLook);
    expect(ranked.slice(0, 2).map((guess) => guess.rarity).sort()).toEqual(['Ultimate Rare', 'Ultra Rare']);
    expect(ranked.at(-1)!.score).toBeLessThan(ranked[0]!.score);
  });

  it('never decides on its own when an unknown rarity is in the running', () => {
    const decision = decideRarity(['Common', 'Duel Terminal Normal Parallel Rare'], commonLook);
    expect(decision.rarity).toBeNull();
    // But it still ranks the one it recognises first, so the chip is the near one.
    expect(decision.ranked[0]!.rarity).toBe('Common');
  });

  it('reads a rarity written with a set-specific suffix as the plain one', () => {
    expect(normalizeRarity('Secret Rare (Alternate Art)')).toBe('secret rare');
    expect(decideRarity(['Common', 'Secret Rare (Alternate Art)'], secretLook).rarity).toBe(
      'Secret Rare (Alternate Art)',
    );
  });

  it('has nothing to say about an empty list', () => {
    expect(decideRarity([], commonLook)).toEqual({ rarity: null, ranked: [] });
  });
});
