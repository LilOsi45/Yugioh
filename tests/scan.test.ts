import { describe, expect, it } from 'vitest';
import { CLEAR_AFTER_MS, extractSetCode, NO_MEMORY, stepScan } from '../src/lib/scan';
import { cardNamed, miniDatabase, setNamed } from './helpers';
import type { Card } from '../src/lib/types';

const db = miniDatabase();
const ash = cardNamed(db, 'Ash Blossom & Joyous Spring'); // PHNI, OP27, RS26
const pot = cardNamed(db, 'Pot of Prosperity'); // LEDE only

describe('extractSetCode', () => {
  it('reads the printing off the card', () => {
    expect(extractSetCode('PHNI-DE087', ash)).toBe('PHNI');
    expect(extractSetCode('14558127\nOP27-EN002 1st Edition', ash)).toBe('OP27');
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

  it('needs the dash, so effect-text numbers cannot pose as a set code', () => {
    expect(extractSetCode('PHNI 087 destroy 2 cards', ash)).toBeNull();
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
