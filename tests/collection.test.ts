import { describe, expect, it } from 'vitest';
import {
  addCopies,
  collectionFromDeck,
  collectionTotals,
  holdingKey,
  mergeCollections,
  parseHoldingKey,
  parseCollection,
  pruneCollection,
  serializeCollection,
  setOwnedTotal,
  UNKNOWN_SET,
  type Collection,
} from '../src/lib/collection';
import { parseYdk } from '../src/lib/import';
import { miniDatabase } from './helpers';

const db = miniDatabase();
const ASH = 14558127;

/** Readable view of one card's holding: `[total, {SET: count}]`. */
function holding(collection: Collection, cardId: number) {
  const entry = collection.get(cardId);
  return entry ? { total: entry.total, bySet: Object.fromEntries(entry.bySet) } : null;
}

describe('addCopies', () => {
  it('counts copies per printing and keeps the total in step', () => {
    let collection: Collection = new Map();
    collection = addCopies(collection, ASH, 'PHNI');
    collection = addCopies(collection, ASH, 'PHNI');
    collection = addCopies(collection, ASH, 'OP27');
    expect(holding(collection, ASH)).toEqual({ total: 3, bySet: { PHNI: 2, OP27: 1 } });
  });

  it('files copies without a known printing separately', () => {
    const collection = addCopies(addCopies(new Map(), ASH, 'PHNI'), ASH);
    expect(holding(collection, ASH)).toEqual({ total: 2, bySet: { PHNI: 1, [UNKNOWN_SET]: 1 } });
  });

  it('takes a copy back off for undo, dropping the card at zero', () => {
    const one = addCopies(new Map(), ASH, 'PHNI');
    const none = addCopies(one, ASH, 'PHNI', -1);
    expect(none.has(ASH)).toBe(false);
    // The original is untouched, so React state updates stay predictable.
    expect(one.get(ASH)?.total).toBe(1);
  });
});

describe('setOwnedTotal', () => {
  it('adds the difference to the unknown pile, since a typed number names no set', () => {
    const collection = setOwnedTotal(addCopies(new Map(), ASH, 'PHNI'), ASH, 3);
    expect(holding(collection, ASH)).toEqual({ total: 3, bySet: { PHNI: 1, [UNKNOWN_SET]: 2 } });
  });

  it('gives up unrecorded copies first when shrinking', () => {
    let collection = addCopies(addCopies(new Map(), ASH, 'PHNI'), ASH, UNKNOWN_SET, 2);
    collection = setOwnedTotal(collection, ASH, 1);
    expect(holding(collection, ASH)).toEqual({ total: 1, bySet: { PHNI: 1 } });
  });

  it('trims the largest recorded printing when it has to cut into set information', () => {
    let collection = addCopies(new Map(), ASH, 'PHNI', 3);
    collection = addCopies(collection, ASH, 'OP27', 1);
    collection = setOwnedTotal(collection, ASH, 2);
    expect(holding(collection, ASH)).toEqual({ total: 2, bySet: { PHNI: 1, OP27: 1 } });
  });

  it('removes the card at zero', () => {
    expect(setOwnedTotal(addCopies(new Map(), ASH, 'PHNI'), ASH, 0).has(ASH)).toBe(false);
  });
});

describe('storage', () => {
  it('round-trips the set breakdown', () => {
    const collection = addCopies(addCopies(new Map(), ASH, 'PHNI'), ASH, 'OP27');
    expect(holding(parseCollection(serializeCollection(collection)), ASH)).toEqual({
      total: 2,
      bySet: { PHNI: 1, OP27: 1 },
    });
  });

  it('reads the original passcode-to-count format, so nothing is lost on upgrade', () => {
    const migrated = parseCollection('{"14558127":3,"97268402":1}');
    expect(holding(migrated, ASH)).toEqual({ total: 3, bySet: { [UNKNOWN_SET]: 3 } });
    expect(collectionTotals(migrated).get(97268402)).toBe(1);
  });

  it('ignores corrupt entries in either format', () => {
    const parsed = parseCollection('{"12":0,"abc":2,"34":"x","56":1,"78":{"PHNI":"nope","OP27":2}}');
    expect([...collectionTotals(parsed)]).toEqual([
      [56, 1],
      [78, 2],
    ]);
  });
});

describe('collection maths', () => {
  it('imports a decklist, which carries no set information', () => {
    const owned = collectionFromDeck(parseYdk('#main\n14558127\n14558127\n!side\n14558127\n', db));
    expect(holding(owned, ASH)).toEqual({ total: 3, bySet: { [UNKNOWN_SET]: 3 } });
  });

  it('adds up per printing when merging two collections', () => {
    const merged = mergeCollections(
      addCopies(new Map(), ASH, 'PHNI', 2),
      addCopies(addCopies(new Map(), ASH, 'PHNI'), ASH, 'OP27', 4),
    );
    expect(holding(merged, ASH)).toEqual({ total: 7, bySet: { PHNI: 3, OP27: 4 } });
  });

  it('flattens to plain totals for the deck maths', () => {
    const collection = addCopies(addCopies(new Map(), ASH, 'PHNI', 2), ASH, 'OP27');
    expect([...collectionTotals(collection)]).toEqual([[ASH, 3]]);
  });

  it('drops passcodes the card index no longer knows', () => {
    const collection = addCopies(addCopies(new Map(), ASH, 'PHNI'), 999999999, 'PHNI');
    expect([...pruneCollection(collection, db).keys()]).toEqual([ASH]);
  });
});

describe('holding keys', () => {
  it('keeps the plain set code when no rarity is known', () => {
    expect(holdingKey('PHNI')).toBe('PHNI');
    expect(holdingKey('PHNI', null)).toBe('PHNI');
    expect(parseHoldingKey('PHNI')).toEqual({ setCode: 'PHNI', rarity: null, language: null });
  });

  it('carries the rarity alongside the set', () => {
    expect(holdingKey('PHNI', 'Secret Rare')).toBe('PHNI|Secret Rare');
    expect(parseHoldingKey('PHNI|Secret Rare')).toEqual({
      setCode: 'PHNI',
      rarity: 'Secret Rare',
      language: null,
    });
  });

  it('carries the language as a third field', () => {
    // What a Cardmarket listing turns on: a German and an English copy are two
    // different things to sell and cannot share a count.
    expect(holdingKey('PHNI', 'Secret Rare', 'DE')).toBe('PHNI|Secret Rare|DE');
    expect(parseHoldingKey('PHNI|Secret Rare|DE')).toEqual({
      setCode: 'PHNI',
      rarity: 'Secret Rare',
      language: 'DE',
    });
  });

  it('records a language even when the rarity is unknown', () => {
    expect(holdingKey('PHNI', null, 'EN')).toBe('PHNI||EN');
    expect(parseHoldingKey('PHNI||EN')).toEqual({ setCode: 'PHNI', rarity: null, language: 'EN' });
  });

  it('reads collections saved before rarity or language existed', () => {
    // The stored shape never changed, so an old file needs no migration: a key with
    // fewer fields simply means those were never recorded.
    const old = parseCollection('{"14558127":{"PHNI":2}}');
    expect(parseHoldingKey([...old.get(ASH)!.bySet.keys()][0]!)).toEqual({
      setCode: 'PHNI',
      rarity: null,
      language: null,
    });
    expect(parseHoldingKey('PHNI|Common')).toEqual({
      setCode: 'PHNI',
      rarity: 'Common',
      language: null,
    });
  });

  it('counts the same card at two rarities as separate piles of one holding', () => {
    let collection: Collection = addCopies(new Map(), ASH, holdingKey('PHNI', 'Common'), 2);
    collection = addCopies(collection, ASH, holdingKey('PHNI', 'Secret Rare'));
    expect(holding(collection, ASH)).toEqual({
      total: 3,
      bySet: { 'PHNI|Common': 2, 'PHNI|Secret Rare': 1 },
    });
  });

  it('splits into exactly three fields', () => {
    // Set codes and rarities are letters, digits and spaces, so the separator cannot
    // occur inside one; anything past the third field is not ours and is dropped.
    expect(parseHoldingKey('A|B|C')).toEqual({ setCode: 'A', rarity: 'B', language: 'C' });
  });
});
