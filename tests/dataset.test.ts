import { describe, expect, it } from 'vitest';
import { buildIndex, setCodeFromCardNumber, type ApiCard, type ApiSet } from '../src/lib/buildIndex';
import { decodeDatabase } from '../src/lib/dataset';
import { normalizeName } from '../src/lib/normalize';
import { cardNamed, miniDatabase, NOW, setNamed } from './helpers';
import fixture from './fixtures/mini-db.json';

describe('setCodeFromCardNumber', () => {
  it('takes the prefix before the card number', () => {
    expect(setCodeFromCardNumber('LEDE-EN077')).toBe('LEDE');
    expect(setCodeFromCardNumber('SDY-006')).toBe('SDY');
  });

  it('handles a code with no card number', () => {
    expect(setCodeFromCardNumber('LOB')).toBe('LOB');
    expect(setCodeFromCardNumber('')).toBe('');
  });
});

describe('normalizeName', () => {
  it('collapses punctuation and case so pasted lists still match', () => {
    const canonical = normalizeName('Ash Blossom & Joyous Spring');
    expect(normalizeName('ash blossom joyous spring')).toBe(canonical);
    expect(normalizeName('Ash Blossom &amp; Joyous Spring')).toBe(canonical);
    expect(normalizeName('  ASH-BLOSSOM & JOYOUS SPRING  ')).toBe(canonical);
  });

  it('strips accents', () => {
    expect(normalizeName('Ménage')).toBe('menage');
  });
});

describe('buildIndex', () => {
  const index = buildIndex(fixture.cards as ApiCard[], fixture.sets as ApiSet[], NOW);

  it('keeps every card and set', () => {
    expect(index.cards).toHaveLength(10);
    expect(index.sets).toHaveLength(6);
  });

  it('records alt-artwork passcodes as aliases', () => {
    expect(index.aliases).toContainEqual([14558128, 0]);
    // The main passcode is not repeated as an alias.
    expect(index.aliases.some(([passcode]) => passcode === 14558127)).toBe(false);
  });

  it('deduplicates identical printings of the same card', () => {
    const darkMagician = index.cards.find((card) => card[0] === 46986414);
    expect(darkMagician?.[4]).toHaveLength(1);
  });

  it('converts cardmarket prices to cents and treats missing prices as unknown', () => {
    expect(index.cards.find((card) => card[0] === 84211599)?.[3]).toBe(2200);
    expect(index.cards.find((card) => card[0] === 25311006)?.[3]).toBe(0);
  });

  it('interns rarities and types instead of repeating the strings', () => {
    expect(index.rarities).toContain('Secret Rare');
    expect(new Set(index.rarities).size).toBe(index.rarities.length);
    expect(new Set(index.types).size).toBe(index.types.length);
  });
});

describe('decodeDatabase', () => {
  const db = miniDatabase();

  it('resolves printings back to full set objects', () => {
    const ash = cardNamed(db, 'Ash Blossom & Joyous Spring');
    expect(ash.printings.map((printing) => printing.set.code)).toEqual(['PHNI', 'OP27', 'RS26']);
    expect(ash.printings[2]?.rarity).toBe('Secret Rare');
  });

  it('looks cards up by main and alt-art passcode', () => {
    expect(db.byPasscode.get(14558127)?.name).toBe('Ash Blossom & Joyous Spring');
    expect(db.byPasscode.get(14558128)?.name).toBe('Ash Blossom & Joyous Spring');
    expect(db.byPasscode.get(999999)).toBeUndefined();
  });

  it('looks cards up by normalized name', () => {
    expect(db.byName.get(normalizeName('pot of prosperity'))?.id).toBe(84211599);
  });

  it('flags extra deck monsters', () => {
    expect(cardNamed(db, 'Cyber Dragon Infinity').extraDeck).toBe(true);
    expect(cardNamed(db, 'Accesscode Talker').extraDeck).toBe(true);
    expect(cardNamed(db, 'Cyber Dragon').extraDeck).toBe(false);
    expect(cardNamed(db, 'Called by the Grave').extraDeck).toBe(false);
  });

  it('classifies products so guaranteed buys are distinguishable from gambles', () => {
    expect(setNamed(db, 'SDCS').product).toBe('structure');
    expect(setNamed(db, 'SDCS').guaranteed).toBe(true);
    expect(setNamed(db, 'SR03').guaranteed).toBe(true);
    expect(setNamed(db, 'LEDE').product).toBe('booster');
    expect(setNamed(db, 'LEDE').guaranteed).toBe(false);
    expect(setNamed(db, 'OP27').product).toBe('promo');
  });

  it('rejects an index written by an incompatible build', () => {
    expect(() => decodeDatabase({ ...buildIndex([], [], NOW), v: 99 })).toThrow(/format version 99/);
  });
});
