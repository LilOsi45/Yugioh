import { describe, expect, it } from 'vitest';
import { withSessionSet } from '../src/components/Scanner';
import { cardNamed, miniDatabase } from './helpers';

const db = miniDatabase();
const ash = cardNamed(db, 'Ash Blossom & Joyous Spring'); // PHNI, OP27, RS26
const pot = cardNamed(db, 'Pot of Prosperity'); // LEDE only

describe('withSessionSet', () => {
  it('fills in the set the whole binder is from', () => {
    expect(withSessionSet({ card: ash, setCode: null }, 'PHNI').setCode).toBe('PHNI');
  });

  it('never overwrites a set that was actually read', () => {
    expect(withSessionSet({ card: ash, setCode: 'OP27' }, 'PHNI').setCode).toBe('OP27');
  });

  it('leaves a card alone that was never printed in that set', () => {
    // A stray card in the stack must not be booked under a printing nobody owns.
    expect(withSessionSet({ card: pot, setCode: null }, 'PHNI').setCode).toBeNull();
  });

  it('does nothing without a session set', () => {
    expect(withSessionSet({ card: ash, setCode: null }, null).setCode).toBeNull();
  });
});
