import { describe, expect, it } from 'vitest';
import { countCards, parseDeck, parseTextList, parseYdk, parseYdke, toYdke } from '../src/lib/import';
import { miniDatabase } from './helpers';

const db = miniDatabase();

const YDK = `#created by ygo-set-finder
#main
14558127
14558127
14558127
10045474
25311006
#extra
10443957
86066372
!side
97268402
`;

describe('parseYdk', () => {
  const deck = parseYdk(YDK, db);

  it('merges copies and keeps sections', () => {
    const ash = deck.entries.find((entry) => entry.card.name === 'Ash Blossom & Joyous Spring');
    expect(ash?.copies).toBe(3);
    expect(ash?.section).toBe('main');
    expect(deck.entries.filter((entry) => entry.section === 'extra')).toHaveLength(2);
    expect(deck.entries.filter((entry) => entry.section === 'side')).toHaveLength(1);
    expect(countCards(deck)).toBe(8);
    expect(countCards(deck, 'main')).toBe(5);
  });

  it('ignores comments and reports unknown passcodes', () => {
    const withJunk = parseYdk('#created by someone\n#main\n14558127\n11111111\n', db);
    expect(withJunk.entries).toHaveLength(1);
    expect(withJunk.unresolved).toEqual(['Unknown passcode 11111111']);
  });

  it('resolves alt-artwork passcodes to the same card', () => {
    const deckWithAlt = parseYdk('#main\n14558127\n14558128\n', db);
    expect(deckWithAlt.entries).toHaveLength(1);
    expect(deckWithAlt.entries[0]?.copies).toBe(2);
    expect(deckWithAlt.unresolved).toEqual([]);
  });

  it('falls back to card type when the file has no section markers', () => {
    const bare = parseYdk('14558127\n10443957\n', db);
    expect(bare.entries.find((entry) => entry.card.name === 'Cyber Dragon Infinity')?.section).toBe('extra');
    expect(bare.entries.find((entry) => entry.card.name === 'Ash Blossom & Joyous Spring')?.section).toBe('main');
  });
});

describe('YDKE round trip', () => {
  it('parses a YDKE URL', () => {
    const url = toYdke(parseYdk(YDK, db));
    const deck = parseYdke(url, db);
    expect(countCards(deck)).toBe(8);
    expect(deck.entries.find((entry) => entry.card.name === 'Ash Blossom & Joyous Spring')?.copies).toBe(3);
    expect(deck.entries.find((entry) => entry.card.name === 'Effect Veiler')?.section).toBe('side');
    expect(deck.unresolved).toEqual([]);
  });

  it('produces the canonical three-section shape', () => {
    expect(toYdke(parseYdk(YDK, db))).toMatch(/^ydke:\/\/[^!]*![^!]*![^!]*!$/);
  });

  it('survives an empty deck', () => {
    expect(toYdke(parseYdk('', db))).toBe('ydke://!!!');
    expect(parseYdke('ydke://!!!', db).entries).toEqual([]);
  });

  it('reports a corrupted section instead of throwing', () => {
    const deck = parseYdke('ydke://AAA!!!', db);
    expect(deck.unresolved[0]).toMatch(/could not decode/i);
  });
});

describe('parseTextList', () => {
  it('understands the quantity notations people actually paste', () => {
    const deck = parseTextList(
      [
        '3x Ash Blossom & Joyous Spring',
        '2 Called by the Grave',
        'Pot of Prosperity x1',
        'Infinite Impermanence (2)',
        '- Cyber Dragon',
      ].join('\n'),
      db,
    );
    const copies = Object.fromEntries(deck.entries.map((entry) => [entry.card.name, entry.copies]));
    expect(copies).toEqual({
      'Ash Blossom & Joyous Spring': 3,
      'Called by the Grave': 2,
      'Pot of Prosperity': 1,
      'Infinite Impermanence': 2,
      'Cyber Dragon': 1,
    });
    expect(deck.unresolved).toEqual([]);
  });

  it('follows section headers without swallowing cards that look like headers', () => {
    const deck = parseTextList(
      ['Main Deck (3)', 'Monsters (1)', '1 Cyber Dragon', 'Extra Deck', '1 Cyber Dragon Infinity', 'Side Deck', '1 Effect Veiler'].join(
        '\n',
      ),
      db,
    );
    expect(deck.entries.find((entry) => entry.card.name === 'Cyber Dragon')?.section).toBe('main');
    expect(deck.entries.find((entry) => entry.card.name === 'Cyber Dragon Infinity')?.section).toBe('extra');
    expect(deck.entries.find((entry) => entry.card.name === 'Effect Veiler')?.section).toBe('side');
    expect(deck.unresolved).toEqual([]);
  });

  it('strips trailing set codes from tournament lists', () => {
    const deck = parseTextList('3 Ash Blossom & Joyous Spring [PHNI-EN087]', db);
    expect(deck.entries[0]?.copies).toBe(3);
  });

  it('keeps unmatched lines so the user can fix them', () => {
    const deck = parseTextList('3 Ash Blossom & Joyous Spring\n2 Totally Not A Card', db);
    expect(deck.entries).toHaveLength(1);
    expect(deck.unresolved).toEqual(['2 Totally Not A Card']);
  });
});

describe('parseDeck format detection', () => {
  it('routes each input to the right parser', () => {
    expect(parseDeck(YDK, db).source).toBe('ydk');
    expect(parseDeck('14558127\n14558127\n', db).source).toBe('ydk');
    expect(parseDeck(toYdke(parseYdk(YDK, db)), db).source).toBe('ydke');
    expect(parseDeck('3x Ash Blossom & Joyous Spring', db).source).toBe('text');
  });
});
