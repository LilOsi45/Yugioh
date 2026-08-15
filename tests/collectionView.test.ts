import { describe, expect, it } from 'vitest';
import {
  cardCategory,
  CATEGORY_LABELS,
  filterEntries,
  groupByCategory,
  sortEntries,
  type CollectionEntry,
} from '../src/lib/collectionView';
import { cardNamed, miniDatabase } from './helpers';

const db = miniDatabase();

const entry = (name: string, count: number): CollectionEntry => ({ card: cardNamed(db, name), count });

const COLLECTION: CollectionEntry[] = [
  entry('Pot of Prosperity', 1), // Spell, 22.00
  entry('Cyber Dragon', 3), // Monster, 0.30
  entry('Accesscode Talker', 1), // Link -> extra, 9.00
  entry('Infinite Impermanence', 2), // Trap, 12.00
  entry('Ash Blossom & Joyous Spring', 3), // Monster, 8.50
  entry('Cyber Dragon Infinity', 1), // XYZ -> extra, 5.00
];

describe('cardCategory', () => {
  it('separates the piles a player actually keeps', () => {
    expect(cardCategory(cardNamed(db, 'Cyber Dragon'))).toBe('monster');
    expect(cardCategory(cardNamed(db, 'Pot of Prosperity'))).toBe('spell');
    expect(cardCategory(cardNamed(db, 'Infinite Impermanence'))).toBe('trap');
  });

  it('puts extra deck monsters in their own pile, not with the monsters', () => {
    expect(cardCategory(cardNamed(db, 'Cyber Dragon Infinity'))).toBe('extra');
    expect(cardCategory(cardNamed(db, 'Accesscode Talker'))).toBe('extra');
  });
});

describe('sortEntries', () => {
  it('sorts by german name where there is one', () => {
    const names = sortEntries(COLLECTION, 'name').map((item) => item.card.nameDe ?? item.card.name);
    expect(names[0]).toBe('Accesscode Talker'); // no german name, sorts by english
    expect(names).toContain('Aschenblüte & Freudiger Frühling');
    expect([...names]).toEqual([...names].sort((a, b) => a.localeCompare(b, 'de')));
  });

  it('sorts by total value, not unit price', () => {
    const sorted = sortEntries(COLLECTION, 'price');
    // 3x Ash at 8.50 = 25.50, then 2x Impermanence at 12.00 = 24.00, then the
    // single 22.00 Pot of Prosperity — unit price alone would invert the last two.
    expect(sorted.slice(0, 3).map((item) => item.card.name)).toEqual([
      'Ash Blossom & Joyous Spring',
      'Infinite Impermanence',
      'Pot of Prosperity',
    ]);
  });

  it('sorts by how many copies you hold', () => {
    const sorted = sortEntries(COLLECTION, 'count');
    expect(sorted.slice(0, 2).map((item) => item.count)).toEqual([3, 3]);
    expect(sorted.at(-1)?.count).toBe(1);
  });

  it('groups the types in a fixed order and sorts by name inside each', () => {
    const sorted = sortEntries(COLLECTION, 'type');
    const categories = sorted.map((item) => cardCategory(item.card));
    expect(categories).toEqual(['monster', 'monster', 'extra', 'extra', 'spell', 'trap']);
    // Alphabetical within the monsters.
    expect(sorted.slice(0, 2).map((item) => item.card.name)).toEqual([
      'Ash Blossom & Joyous Spring',
      'Cyber Dragon',
    ]);
  });

  it('leaves the original array alone', () => {
    const before = COLLECTION.map((item) => item.card.name);
    sortEntries(COLLECTION, 'name');
    expect(COLLECTION.map((item) => item.card.name)).toEqual(before);
  });
});

describe('groupByCategory', () => {
  it('returns labelled sections in a fixed order', () => {
    const groups = groupByCategory(sortEntries(COLLECTION, 'type'));
    expect(groups.map((group) => group.category)).toEqual(['monster', 'extra', 'spell', 'trap']);
    expect(groups.map((group) => CATEGORY_LABELS[group.category])).toEqual([
      'Monster',
      'Extra Deck',
      'Zauber',
      'Fallen',
    ]);
    expect(groups.reduce((sum, group) => sum + group.entries.length, 0)).toBe(COLLECTION.length);
  });

  it('omits categories with nothing in them', () => {
    const groups = groupByCategory([entry('Cyber Dragon', 1)]);
    expect(groups.map((group) => group.category)).toEqual(['monster']);
  });
});

describe('filterEntries', () => {
  it('finds a card by its german or english name', () => {
    expect(filterEntries(COLLECTION, 'aschen')).toHaveLength(1);
    expect(filterEntries(COLLECTION, 'ash blossom')).toHaveLength(1);
    expect(filterEntries(COLLECTION, 'Cyber')).toHaveLength(2); // Cyber Dragon + Infinity
  });

  it('ignores case, spacing and punctuation', () => {
    expect(filterEntries(COLLECTION, '  CYBER-DRACHE ')).toHaveLength(1);
  });

  it('returns everything for an empty query', () => {
    expect(filterEntries(COLLECTION, '   ')).toHaveLength(COLLECTION.length);
  });

  it('returns nothing when there is no match', () => {
    expect(filterEntries(COLLECTION, 'zzzz')).toEqual([]);
  });
});
