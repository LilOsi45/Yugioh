import { describe, expect, it } from 'vitest';
import { combinedNeeds } from '../src/lib/wants';
import { toYdke } from '../src/lib/import';
import { parseTextList } from '../src/lib/import';
import { cardNamed, miniDatabase } from './helpers';
import type { SavedDeck } from '../src/lib/library';

const db = miniDatabase();
const ash = cardNamed(db, 'Ash Blossom & Joyous Spring');
const pot = cardNamed(db, 'Pot of Prosperity');
const cyber = cardNamed(db, 'Cyber Dragon');

function deck(name: string, text: string): SavedDeck {
  return { id: name, name, ydke: toYdke(parseTextList(text, db)), savedAt: '' };
}

const DECK_A = deck('A', '3 Ash Blossom & Joyous Spring\n1 Pot of Prosperity');
const DECK_B = deck('B', '3 Ash Blossom & Joyous Spring\n3 Cyber Dragon');

describe('combinedNeeds', () => {
  it('takes the largest demand, not the sum — the same cards move between decks', () => {
    const needs = combinedNeeds([DECK_A, DECK_B], db, new Map());
    const ashNeed = needs.find((need) => need.card.id === ash.id);
    // Both decks want three; three cards cover both, not six.
    expect(ashNeed?.required).toBe(3);
    expect(ashNeed?.needed).toBe(3);
  });

  it('collects cards that only one deck asks for', () => {
    const needs = combinedNeeds([DECK_A, DECK_B], db, new Map());
    expect(needs.find((need) => need.card.id === pot.id)?.required).toBe(1);
    expect(needs.find((need) => need.card.id === cyber.id)?.required).toBe(3);
  });

  it('subtracts what you already own, once', () => {
    const needs = combinedNeeds([DECK_A, DECK_B], db, new Map([[ash.id, 2]]));
    expect(needs.find((need) => need.card.id === ash.id)).toMatchObject({ owned: 2, needed: 1 });
  });

  it('never asks for a negative number of cards', () => {
    const needs = combinedNeeds([DECK_A], db, new Map([[ash.id, 9]]));
    expect(needs.find((need) => need.card.id === ash.id)?.needed).toBe(0);
  });

  it('puts the most expensive gap first, since that is what a budget turns on', () => {
    // 3 Ash missing at 8,50 = 25,50 beats 1 Pot at 22,00.
    const needs = combinedNeeds([DECK_A], db, new Map()).filter((need) => need.needed > 0);
    expect(needs.map((need) => need.card.id)).toEqual([ash.id, pot.id]);
  });

  it('returns nothing for an empty library', () => {
    expect(combinedNeeds([], db, new Map())).toEqual([]);
  });
});
