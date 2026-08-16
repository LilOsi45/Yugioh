import { describe, expect, it } from 'vitest';
import { addCopies, UNKNOWN_SET, type Collection } from '../src/lib/collection';
import { collectionValue, duplicates, setProgress } from '../src/lib/stats';
import { cardNamed, miniDatabase } from './helpers';

const db = miniDatabase();
const ash = cardNamed(db, 'Ash Blossom & Joyous Spring').id; // 8,50, in PHNI/OP27/RS26
const cyber = cardNamed(db, 'Cyber Dragon').id; // 0,30, in SDCS/PHNI
const pot = cardNamed(db, 'Pot of Prosperity').id; // 22,00, LEDE

function build(entries: [number, string, number][]): Collection {
  let collection: Collection = new Map();
  for (const [id, code, count] of entries) collection = addCopies(collection, id, code, count);
  return collection;
}

describe('setProgress', () => {
  it('counts distinct cards against the size of the set', () => {
    const progress = setProgress(build([[ash, 'PHNI', 2], [cyber, 'PHNI', 1]]), db);
    // Phantom Nightmare holds 100 cards in the fixture; two of them are here.
    expect(progress[0]?.set.code).toBe('PHNI');
    expect(progress[0]).toMatchObject({ owned: 2, copies: 3, ratio: 0.02 });
  });

  it('values a set by the copies actually held', () => {
    // 2 Ash at 8,50 plus 1 Cyber Dragon at 0,30.
    expect(setProgress(build([[ash, 'PHNI', 2], [cyber, 'PHNI', 1]]), db)[0]?.valueCents).toBe(1730);
  });

  it('puts the fullest set first', () => {
    // OP27 has 26 cards, PHNI has 100: one card of each makes OP27 further along.
    const progress = setProgress(build([[ash, 'PHNI', 1], [ash, 'OP27', 1]]), db);
    expect(progress.map((entry) => entry.set.code)).toEqual(['OP27', 'PHNI']);
  });

  it('ignores copies whose printing was never recorded', () => {
    expect(setProgress(build([[ash, UNKNOWN_SET, 3]]), db)).toEqual([]);
  });
});

describe('duplicates', () => {
  it('counts only what is left over after a playset', () => {
    const spares = duplicates(build([[ash, 'PHNI', 5], [cyber, 'SDCS', 3]]), db);
    // Three Ash are a playset, so two are spare; Cyber Dragon has nothing spare.
    expect(spares).toHaveLength(1);
    expect(spares[0]).toMatchObject({ count: 2, valueCents: 1700 });
  });

  it('counts copies across sets together, since a spare is a spare', () => {
    expect(duplicates(build([[ash, 'PHNI', 2], [ash, 'OP27', 2]]), db)[0]?.count).toBe(1);
  });

  it('sorts by what the spares are worth', () => {
    const spares = duplicates(build([[cyber, 'SDCS', 9], [pot, 'LEDE', 4]]), db);
    // One spare Pot at 22,00 beats six spare Cyber Dragons at 0,30.
    expect(spares.map((entry) => entry.card.id)).toEqual([pot, cyber]);
  });
});

describe('collectionValue', () => {
  it('adds up cards, copies and money', () => {
    const value = collectionValue(build([[ash, 'PHNI', 3], [pot, 'LEDE', 1]]), db);
    expect(value).toMatchObject({ cards: 2, copies: 4, totalCents: 2550 + 2200 });
  });

  it('ranks by total value, so a stack of cheap cards can outweigh one pricey one', () => {
    const value = collectionValue(build([[pot, 'LEDE', 1], [ash, 'PHNI', 3]]), db);
    expect(value.top.map((entry) => entry.card.id)).toEqual([ash, pot]); // 25,50 vs 22,00
  });

  it('leaves out cards YGOPRODeck has no price for', () => {
    const value = collectionValue(build([[cardNamed(db, 'Triple Tactics Talent').id, 'PHNI', 1]]), db);
    expect(value.cards).toBe(1);
    expect(value.top).toEqual([]);
  });
});
