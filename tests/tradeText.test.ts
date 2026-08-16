import { describe, expect, it } from 'vitest';
import { needsAsText, sparesAsLocalText, sparesAsText } from '../src/lib/tradeText';
import { cardNamed, miniDatabase } from './helpers';
import type { CardNeed } from '../src/lib/setFinder';

const db = miniDatabase();
const ash = cardNamed(db, 'Ash Blossom & Joyous Spring'); // has a german name
const pot = cardNamed(db, 'Pot of Prosperity');

const need = (card: typeof ash, needed: number, required = needed): CardNeed => ({
  card,
  needed,
  required,
  owned: required - needed,
});

describe('needsAsText', () => {
  it('writes the lines a want list is pasted from', () => {
    expect(needsAsText([need(ash, 3), need(pot, 1)])).toBe(
      '3x Ash Blossom & Joyous Spring\n1x Pot of Prosperity',
    );
  });

  it('leaves out what is already covered', () => {
    expect(needsAsText([need(ash, 0, 3), need(pot, 1)])).toBe('1x Pot of Prosperity');
  });

  it('uses the english name, which is the one a stranger can look up', () => {
    expect(ash.nameDe).toBeTruthy();
    expect(needsAsText([need(ash, 1)])).not.toContain('Aschenblüte');
  });

  it('produces nothing for an empty list', () => {
    expect(needsAsText([])).toBe('');
  });
});

describe('sparesAsText', () => {
  const spares = [
    { card: ash, count: 2, valueCents: 1700 },
    { card: pot, count: 1, valueCents: 2200 },
  ];

  it('writes the same shape for the trade pile', () => {
    expect(sparesAsText(spares)).toBe('2x Ash Blossom & Joyous Spring\n1x Pot of Prosperity');
  });

  it('offers the local name for your own notes', () => {
    expect(sparesAsLocalText(spares)).toContain('Aschenblüte');
  });
});
