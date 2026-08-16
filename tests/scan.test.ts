import { describe, expect, it } from 'vitest';
import {
  AUTO_VARIANTS,
  CLEAR_AFTER_MS,
  extractSetCode,
  lineBand,
  matchPasscode,
  NO_MEMORY,
  PASS_VARIANTS,
  passVariant,
  SET_CODE_REGION,
  stepScan,
  videoSourceRect,
} from '../src/lib/scan';
import { cardNamed, miniDatabase, setNamed } from './helpers';
import type { Card } from '../src/lib/types';

const db = miniDatabase();
const ash = cardNamed(db, 'Ash Blossom & Joyous Spring'); // PHNI, OP27, RS26
const pot = cardNamed(db, 'Pot of Prosperity'); // LEDE only

describe('matchPasscode', () => {
  it('takes an exact reading as exact', () => {
    expect(matchPasscode('14558127', db)).toEqual({ card: ash, exact: true });
  });

  it('repairs a single misread digit when asked, and says that it did', () => {
    // 14558127 with the 5 read as a 6.
    expect(matchPasscode('14568127', db, { repair: true })).toEqual({ card: ash, exact: false });
  });

  it('puts back a digit the engine dropped', () => {
    expect(matchPasscode('1455812', db, { repair: true })).toEqual({ card: ash, exact: false });
  });

  it('never repairs unless asked, so the continuous scan cannot invent a card', () => {
    expect(matchPasscode('14568127', db)).toBeNull();
    expect(matchPasscode('1455812', db)).toBeNull();
  });

  it('refuses when the reading is too far gone', () => {
    expect(matchPasscode('99999999', db, { repair: true })).toBeNull();
    expect(matchPasscode('44558122', db, { repair: true })).toBeNull(); // two digits out
  });

  it('prefers an exact match over a repair', () => {
    // Both a real passcode and a repairable near-miss in one reading.
    expect(matchPasscode('99999999 14558127', db, { repair: true })?.exact).toBe(true);
  });
});

describe('extractSetCode', () => {
  it('reads the printing off the card', () => {
    expect(extractSetCode('PHNI-DE087', ash)).toBe('PHNI');
    expect(extractSetCode('14558127\nOP27-EN002 1st Edition', ash)).toBe('OP27');
  });

  it('survives stray characters the engine inserts', () => {
    // A real reading from a rendered card: an O appeared inside the language part.
    expect(extractSetCode('ATK1600DEF1200 68464358 PHNI-DEO087', ash)).toBe('PHNI');
    expect(extractSetCode('PHNI DE 087', ash)).toBe('PHNI');
  });

  it('tolerates the letter-digit confusions OCR makes', () => {
    // PHN1 for PHNI: only one of Ash's printings is that shape, so it is safe.
    expect(extractSetCode('PHN1-DE087', ash)).toBe('PHNI');
    expect(extractSetCode('R526-EN011', ash)).toBe('RS26');
  });

  it('refuses a set the scanned card was never printed in', () => {
    // LEDE is a real set in the index, but Ash Blossom is not in it.
    expect(extractSetCode('LEDE-EN077', ash)).toBeNull();
  });

  it('refuses a set that does not exist at all', () => {
    expect(extractSetCode('ZZZZ-EN001', pot)).toBeNull();
  });

  it('reads short card numbers too, not just the usual three digits', () => {
    expect(extractSetCode('OP27-EN2', ash)).toBe('OP27');
  });

  it('needs a card number after the code, so plain words cannot pose as one', () => {
    expect(extractSetCode('PHNI destroys a monster', ash)).toBeNull();
  });

  it('gives up when two printings look alike under confusion', () => {
    const op27 = setNamed(db, 'OP27');
    const twin: Card = {
      ...ash,
      printings: [
        { set: op27, rarity: 'Common' },
        { set: { ...op27, code: '0P27', name: 'Doppelgänger Pack' }, rarity: 'Common' },
      ],
    };
    // The read is exactly one of them, so that one wins.
    expect(extractSetCode('OP27-EN002', twin)).toBe('OP27');
    // This one matches neither exactly and both by shape: no way to choose.
    expect(extractSetCode('0PZ7-EN002', twin)).toBeNull();
  });

  it('returns nothing for a card with no printings', () => {
    expect(extractSetCode('PHNI-DE087', cardNamed(db, 'Triple Tactics Talent'))).toBeNull();
  });
});

describe('lineBand', () => {
  it('wraps the printed line the passcode was found on', () => {
    const band = lineBand(720, 600, 20);
    expect(band.x).toBe(0);
    expect(band.width).toBe(1);
    // 600 ± 44 px, as a fraction of the frame.
    expect(band.y * 720).toBeCloseTo(556, 0);
    expect(band.height * 720).toBeCloseTo(88, 0);
  });

  it('keeps a usable band when the reading is tiny', () => {
    expect(lineBand(720, 600, 1).height * 720).toBeCloseTo(16, 0);
  });

  it('stays inside the frame for a line at the very bottom', () => {
    const band = lineBand(720, 715, 20);
    expect(band.y).toBeGreaterThanOrEqual(0);
    expect(band.y + band.height).toBeLessThanOrEqual(1);
  });
});

describe('videoSourceRect', () => {
  it('measures in camera pixels, not in what the viewfinder shows', () => {
    // The whole lower band of a 1280x720 frame — including the sides that
    // object-fit: cover hides, which is where the set code ends up.
    expect(videoSourceRect(1280, 720, SET_CODE_REGION)).toEqual({
      sx: 0,
      sy: 324,
      sw: 1280,
      sh: 396,
    });
  });

  it('clamps to the frame instead of reading past its edge', () => {
    expect(videoSourceRect(100, 100, { x: 0.8, y: 0.8, width: 1, height: 1 })).toEqual({
      sx: 80,
      sy: 80,
      sw: 20,
      sh: 20,
    });
  });

  it('survives a stream that has not started yet', () => {
    expect(videoSourceRect(0, 0, SET_CODE_REGION)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('passVariant', () => {
  it('tries a different combination on every tick of a cycle', () => {
    const seen = new Set<string>();
    for (let tick = 0; tick < AUTO_VARIANTS; tick += 1) {
      const variant = passVariant(tick);
      seen.add(`${variant.wide}:${variant.invert}:${variant.bias}:${variant.mode.psm}`);
    }
    expect(seen.size).toBe(AUTO_VARIANTS);
  });

  it('starts with the whole frame, which is where a fully framed card is read', () => {
    expect(passVariant(0)).toEqual(PASS_VARIANTS[0]);
    expect(passVariant(0).invert).toBe(false);
    expect(passVariant(0).wide).toBe(true);
  });

  it('gets to the sharper viewfinder crop within one cycle, for a card held close', () => {
    const close = [];
    for (let tick = 0; tick < AUTO_VARIANTS; tick += 1) if (!passVariant(tick).wide) close.push(tick);
    expect(close.length).toBe(AUTO_VARIANTS / 2);
  });

  it('leaves the inverted crops to a tap, so an ordinary card is not made to wait', () => {
    for (let tick = 0; tick < AUTO_VARIANTS; tick += 1) expect(passVariant(tick).invert).toBe(false);
    expect(PASS_VARIANTS.some((variant) => variant.invert)).toBe(true);
    expect(PASS_VARIANTS.length).toBeGreaterThan(AUTO_VARIANTS);
  });

  it('repeats once the cycle is through, and survives a wrapped counter', () => {
    expect(passVariant(AUTO_VARIANTS)).toEqual(passVariant(0));
    expect(passVariant(AUTO_VARIANTS + 1)).toEqual(passVariant(1));
    expect(passVariant(-1)).toEqual(passVariant(AUTO_VARIANTS - 1));
  });
});

describe('stepScan', () => {
  const A = 14558127;
  const B = 97268402;

  it('counts a card the first time it comes into view', () => {
    expect(stepScan(NO_MEMORY, A, 1000).count).toBe(true);
  });

  it('does not count the same card again while it lies there', () => {
    let memory = stepScan(NO_MEMORY, A, 1000).memory;
    // Ten seconds of frames, all the same card: still one card.
    for (let now = 1700; now < 11000; now += 700) {
      const step = stepScan(memory, A, now);
      expect(step.count).toBe(false);
      memory = step.memory;
    }
  });

  it('counts the next card straight away, without waiting for a gap', () => {
    const memory = stepScan(NO_MEMORY, A, 1000).memory;
    expect(stepScan(memory, B, 1700).count).toBe(true);
  });

  it('counts the same card again once it has left the view', () => {
    let memory = stepScan(NO_MEMORY, A, 1000).memory;
    memory = stepScan(memory, null, 1700).memory;
    memory = stepScan(memory, null, 1700 + CLEAR_AFTER_MS).memory;
    expect(stepScan(memory, A, 3600).count).toBe(true);
  });

  it('survives a single unreadable frame in the middle of a card', () => {
    let memory = stepScan(NO_MEMORY, A, 1000).memory;
    memory = stepScan(memory, null, 1700).memory; // blur, glare, a hand in the way
    expect(stepScan(memory, A, 2400).count).toBe(false);
  });

  it('forgets nothing until the view has been clear long enough', () => {
    let memory = stepScan(NO_MEMORY, A, 1000).memory;
    memory = stepScan(memory, null, 1700).memory;
    expect(memory.cardId).toBe(A);
    memory = stepScan(memory, null, 1700 + CLEAR_AFTER_MS - 1).memory;
    expect(memory.cardId).toBe(A);
    memory = stepScan(memory, null, 1700 + CLEAR_AFTER_MS).memory;
    expect(memory.cardId).toBeNull();
  });
});
