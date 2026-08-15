import { describe, expect, it } from 'vitest';
import { parseDeck, parseTextList, parseYdk, toYdke } from '../src/lib/import';
import {
  addDeck,
  applyScannedCard,
  deckProgress,
  parseLibrary,
  removeDeck,
  renameDeck,
  stillMissing,
  suggestDeckName,
  type SavedDeck,
} from '../src/lib/library';
import { displayName } from '../src/lib/dataset';
import { adaptiveThreshold, coverSourceRect, extractCard } from '../src/lib/scan';
import { deckNeeds } from '../src/lib/setFinder';
import { cardNamed, miniDatabase, NOW } from './helpers';

const db = miniDatabase();

const DECK = parseTextList(['3 Ash Blossom & Joyous Spring', '2 Called by the Grave', '1 Pot of Prosperity'].join('\n'), db);

describe('library storage', () => {
  it('adds a deck with a generated id', () => {
    const library = addDeck([], 'My deck', 'ydke://a!b!c!', NOW);
    expect(library).toHaveLength(1);
    expect(library[0]).toMatchObject({ name: 'My deck', ydke: 'ydke://a!b!c!' });
    expect(library[0]?.id).toBeTruthy();
  });

  it('renames instead of duplicating when the same decklist is saved twice', () => {
    const once = addDeck([], 'First', 'ydke://a!b!c!', NOW);
    const twice = addDeck(once, 'Second', 'ydke://a!b!c!', NOW);
    expect(twice).toHaveLength(1);
    expect(twice[0]?.name).toBe('Second');
    expect(twice[0]?.id).toBe(once[0]?.id);
  });

  it('puts the newest deck first', () => {
    const library = addDeck(addDeck([], 'Old', 'ydke://a!!!', NOW), 'New', 'ydke://b!!!', NOW);
    expect(library.map((deck) => deck.name)).toEqual(['New', 'Old']);
  });

  it('falls back to a placeholder for a blank name', () => {
    expect(addDeck([], '   ', 'ydke://a!!!', NOW)[0]?.name).toBe('Unbenanntes Deck');
  });

  it('removes and renames by id', () => {
    const library = addDeck([], 'Keep', 'ydke://a!!!', NOW);
    const id = library[0]!.id;
    expect(renameDeck(library, id, 'Renamed')[0]?.name).toBe('Renamed');
    expect(renameDeck(library, id, '  ')[0]?.name).toBe('Keep');
    expect(removeDeck(library, id)).toEqual([]);
  });

  it('ignores corrupt entries when reading storage', () => {
    const stored: unknown[] = [
      { id: 'a', name: 'Good', ydke: 'ydke://!!!', savedAt: '2026-01-01' },
      { id: 'b', name: 'No ydke' },
      'nonsense',
      null,
    ];
    const parsed = parseLibrary(JSON.stringify(stored));
    expect(parsed.map((deck: SavedDeck) => deck.name)).toEqual(['Good']);
    expect(parseLibrary('{}')).toEqual([]);
  });
});

describe('deckProgress', () => {
  it('reports nothing owned for an empty collection', () => {
    const progress = deckProgress(deckNeeds(DECK));
    expect(progress).toMatchObject({ required: 6, owned: 0, missingCards: 3, complete: false });
    expect(progress.ratio).toBe(0);
  });

  it('counts copies, not distinct cards', () => {
    const owned = new Map([[14558127, 2]]); // 2 of 3 Ash Blossom
    const progress = deckProgress(deckNeeds(DECK, owned));
    expect(progress).toMatchObject({ required: 6, owned: 2, missingCards: 3 });
    expect(progress.ratio).toBeCloseTo(2 / 6);
  });

  it('never counts spare copies beyond what the deck needs', () => {
    const owned = new Map([[14558127, 9]]);
    expect(deckProgress(deckNeeds(DECK, owned)).owned).toBe(3);
  });

  it('marks a deck complete once every copy is covered', () => {
    const owned = new Map([
      [14558127, 3],
      [24224830, 2],
      [84211599, 1],
    ]);
    const progress = deckProgress(deckNeeds(DECK, owned));
    expect(progress).toMatchObject({ complete: true, missingCards: 0 });
    expect(progress.ratio).toBe(1);
  });

  it('lists what is still missing, biggest gap first', () => {
    const owned = new Map([[14558127, 1]]);
    const missing = stillMissing(deckNeeds(DECK, owned));
    expect(missing.map((need) => [need.card.name, need.needed])).toEqual([
      ['Ash Blossom & Joyous Spring', 2],
      ['Called by the Grave', 2],
      ['Pot of Prosperity', 1],
    ]);
  });
});

describe('applyScannedCard', () => {
  const inDeck = cardNamed(db, 'Called by the Grave');
  const notInDeck = cardNamed(db, 'Cyber Dragon');

  it('counts a card the deck asks for', () => {
    const outcome = applyScannedCard(deckNeeds(DECK), new Map(), inDeck);
    expect(outcome.owned).toBe(1);
    expect(outcome.message).toContain('1/2');
  });

  it('counts up from what is already owned', () => {
    const owned = new Map([[inDeck.id, 1]]);
    const outcome = applyScannedCard(deckNeeds(DECK, owned), owned, inDeck);
    expect(outcome.owned).toBe(2);
    expect(outcome.message).toContain('2/2');
  });

  it('ignores a card the deck does not ask for', () => {
    const outcome = applyScannedCard(deckNeeds(DECK), new Map(), notInDeck);
    expect(outcome.owned).toBeNull();
    expect(outcome.message).toMatch(/nicht in diesem Deck, ignoriert/);
  });

  it('collects the others when asked to', () => {
    const owned = new Map([[notInDeck.id, 2]]);
    const outcome = applyScannedCard(deckNeeds(DECK, owned), owned, notInDeck, { keepOthers: true });
    expect(outcome.owned).toBe(3);
    expect(outcome.message).toMatch(/zur Sammlung/);
  });

  it('does not stack copies past what the deck needs', () => {
    const owned = new Map([[inDeck.id, 2]]);
    const outcome = applyScannedCard(deckNeeds(DECK, owned), owned, inDeck);
    expect(outcome.owned).toBeNull();
    expect(outcome.message).toMatch(/hast schon alle 2/);
  });
});

describe('suggestDeckName', () => {
  it('names a deck after its most expensive main deck card', () => {
    expect(suggestDeckName(DECK)).toBe('Pot of Prosperity-Deck');
  });

  it('handles an empty deck', () => {
    expect(suggestDeckName(parseYdk('', db))).toBe('Neues Deck');
  });
});

describe('extractCard', () => {
  it('finds a card from a clean passcode read', () => {
    expect(extractCard('14558127', db)?.name).toBe('Ash Blossom & Joyous Spring');
  });

  it('copes with the noise OCR puts around the digits', () => {
    expect(extractCard('  14558127  \n', db)?.name).toBe('Ash Blossom & Joyous Spring');
    expect(extractCard('1455 8127', db)?.name).toBe('Ash Blossom & Joyous Spring');
  });

  it('resolves an alt-artwork passcode to the same card', () => {
    expect(extractCard('14558128', db)?.name).toBe('Ash Blossom & Joyous Spring');
  });

  it('fails closed on a misread rather than guessing a card', () => {
    expect(extractCard('99999999', db)).toBeNull();
    expect(extractCard('', db)).toBeNull();
    expect(extractCard('no digits here', db)).toBeNull();
    // Too few digits to be a passcode.
    expect(extractCard('123', db)).toBeNull();
  });

  it('picks the real passcode out of several digit runs', () => {
    expect(extractCard('0000 99999999 14558127', db)?.name).toBe('Ash Blossom & Joyous Spring');
  });
});

describe('saved deck round trip', () => {
  it('restores the same decklist from the stored ydke', () => {
    const saved = addDeck([], suggestDeckName(DECK), toYdke(DECK), NOW);
    const restored = parseDeck(saved[0]!.ydke, db);

    const asPairs = (deck: typeof DECK) =>
      deck.entries.map((entry) => `${entry.section}:${entry.card.name}:${entry.copies}`).sort();
    expect(asPairs(restored)).toEqual(asPairs(DECK));
    expect(restored.unresolved).toEqual([]);
  });
});

describe('german card names', () => {
  it('shows the german name when there is one', () => {
    expect(displayName(cardNamed(db, 'Ash Blossom & Joyous Spring'))).toBe('Aschenblüte & Freudiger Frühling');
  });

  it('falls back to english for cards with no german entry', () => {
    const pot = cardNamed(db, 'Pot of Prosperity');
    expect(pot.nameDe).toBeNull();
    expect(displayName(pot)).toBe('Pot of Prosperity');
  });

  it('accepts a decklist typed in either language, or mixed', () => {
    const deck = parseTextList(
      ['3 Aschenblüte & Freudiger Frühling', '2 Vom Grab gerufen', '1 Pot of Prosperity'].join('\n'),
      db,
    );
    expect(deck.unresolved).toEqual([]);
    const copies = Object.fromEntries(deck.entries.map((entry) => [entry.card.name, entry.copies]));
    expect(copies).toEqual({
      'Ash Blossom & Joyous Spring': 3,
      'Called by the Grave': 2,
      'Pot of Prosperity': 1,
    });
  });

  it('resolves a german name with different punctuation and case', () => {
    expect(parseTextList('1 cyber drache', db).entries[0]?.card.name).toBe('Cyber Dragon');
    expect(parseTextList('1 CYBER-DRACHE', db).entries[0]?.card.name).toBe('Cyber Dragon');
  });

  it('ignores german entries whose passcode is not in the english dump', () => {
    expect(db.byName.has('kartediieesnichtgibt')).toBe(false);
  });
});

describe('coverSourceRect', () => {
  // A 390x520 view showing a 1920x1080 stream: object-fit cover scales to fill the
  // height and throws away most of the width. The guide box and the crop must still
  // describe the same part of the picture.
  const guide = { x: 0.06, y: 0.42, width: 0.88, height: 0.16 };

  it('crops the sides when the video is wider than the element', () => {
    const rect = coverSourceRect(1920, 1080, 390, 520, guide);
    // scale = max(390/1920, 520/1080) = 0.4815; visible width = 390/0.4815 = 810px
    expect(Math.round(rect.sw)).toBe(Math.round((0.88 * 390) / (520 / 1080)));
    expect(rect.sh).toBeCloseTo((0.16 * 520 * 1080) / 520, 5);
    // Horizontally centred: equal amounts cut from both sides.
    const cutLeft = rect.sx;
    const cutRight = 1920 - (rect.sx + rect.sw);
    expect(cutLeft).toBeGreaterThan(0);
    expect(cutRight).toBeGreaterThan(0);
    expect(cutLeft + rect.sw + cutRight).toBeCloseTo(1920, 5);
  });

  it('crops top and bottom when the video is taller than the element', () => {
    const rect = coverSourceRect(1080, 1920, 390, 200, { x: 0, y: 0, width: 1, height: 1 });
    expect(rect.sx).toBe(0);
    expect(rect.sw).toBe(1080);
    expect(rect.sy).toBeGreaterThan(0);
    expect(rect.sh).toBeLessThan(1920);
  });

  it('is the identity when the aspect ratios already match', () => {
    const rect = coverSourceRect(1000, 500, 200, 100, { x: 0.1, y: 0.2, width: 0.5, height: 0.5 });
    expect(rect).toMatchObject({ sx: 100, sy: 100, sw: 500, sh: 250 });
  });

  it('never returns a rect that runs off the source', () => {
    const rect = coverSourceRect(640, 480, 390, 520, { x: 0.9, y: 0.9, width: 0.5, height: 0.5 });
    expect(rect.sx + rect.sw).toBeLessThanOrEqual(640);
    expect(rect.sy + rect.sh).toBeLessThanOrEqual(480);
  });

  it('degrades safely before the video has dimensions', () => {
    expect(coverSourceRect(0, 0, 390, 520, guide)).toMatchObject({ sx: 0, sy: 0, sw: 0, sh: 0 });
  });
});

describe('adaptiveThreshold', () => {
  /**
   * The layout that defeated a global threshold: a bright zone (the effect box) and
   * a darker zone (the card border) side by side, each carrying dark print. A single
   * cut-off turns the whole darker zone to ink and loses the passcode printed on it.
   */
  function twoZoneImage(width: number, height: number) {
    const grey = new Float64Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bright = y < height / 2;
        grey[y * width + x] = bright ? 235 : 150; // effect box vs card border
      }
    }
    // A dark mark in each zone, standing for print.
    const mark = (cx: number, cy: number) => {
      for (let y = cy - 2; y <= cy + 2; y += 1) {
        for (let x = cx - 2; x <= cx + 2; x += 1) grey[y * width + x] = 30;
      }
    };
    mark(20, 10);
    mark(20, height - 10);
    return grey;
  }

  it('keeps print in both zones as ink and both backgrounds as paper', () => {
    const width = 80;
    const height = 40;
    const mask = adaptiveThreshold(twoZoneImage(width, height), width, height);

    expect(mask[10 * width + 20]).toBe(0); // print in the bright zone
    expect(mask[(height - 10) * width + 20]).toBe(0); // print in the darker zone
    expect(mask[5 * width + 60]).toBe(255); // bright background stays paper
    // The whole darker zone would go black under one global threshold; here it does not.
    expect(mask[(height - 5) * width + 60]).toBe(255);
  });

  it('leaves a flat image entirely as paper', () => {
    const grey = new Float64Array(40 * 40).fill(128);
    const mask = adaptiveThreshold(grey, 40, 40);
    expect([...mask].every((value) => value === 255)).toBe(true);
  });

  it('handles an empty image', () => {
    expect(adaptiveThreshold(new Float64Array(0), 0, 0)).toHaveLength(0);
  });
});
