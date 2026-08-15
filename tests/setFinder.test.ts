import { describe, expect, it } from 'vitest';
import { buildBuyPlan } from '../src/lib/buyPlan';
import { collectionFromDeck, mergeCollections, parseCollection, serializeCollection, withOwned } from '../src/lib/collection';
import { parseTextList, parseYdk } from '../src/lib/import';
import { deckBudget, formatEuro } from '../src/lib/pricing';
import { formatDaysUntil, recentReprints, upcomingReprints, waitWarnings } from '../src/lib/reprints';
import { deckNeeds, rankSets } from '../src/lib/setFinder';
import { miniDatabase, NOW } from './helpers';

const db = miniDatabase();

/**
 * A deck spanning every interesting case in the fixture: cards in guaranteed
 * products, cards only in boosters, a card with an upcoming reprint, and a card
 * with no printings at all.
 */
const DECK_TEXT = [
  '3 Ash Blossom & Joyous Spring',
  '3 Effect Veiler',
  '3 Cyber Dragon',
  '2 Infinite Impermanence',
  '2 Called by the Grave',
  '1 Pot of Prosperity',
  '1 Triple Tactics Talent',
  'Extra Deck',
  '1 Cyber Dragon Infinity',
  '1 Accesscode Talker',
].join('\n');

const deck = parseTextList(DECK_TEXT, db);

describe('deckNeeds', () => {
  it('reports every card as needed when the collection is empty', () => {
    const needs = deckNeeds(deck);
    expect(needs).toHaveLength(9);
    expect(needs.reduce((sum, need) => sum + need.needed, 0)).toBe(17);
  });

  it('subtracts owned copies and never goes negative', () => {
    const owned = new Map([
      [14558127, 2], // 2 of 3 Ash Blossom
      [84211599, 5], // more Pot of Prosperity than the deck runs
    ]);
    const needs = deckNeeds(deck, owned);
    const ash = needs.find((need) => need.card.id === 14558127);
    expect(ash).toMatchObject({ required: 3, owned: 2, needed: 1 });
    expect(needs.find((need) => need.card.id === 84211599)?.needed).toBe(0);
  });

  it('merges a card that appears in both main and side deck', () => {
    const withSide = parseYdk('#main\n14558127\n14558127\n!side\n14558127\n', db);
    expect(deckNeeds(withSide)[0]).toMatchObject({ required: 3, needed: 3 });
    expect(deckNeeds(withSide, new Map(), { includeSide: false })[0]).toMatchObject({ required: 2 });
  });
});

describe('rankSets', () => {
  const needs = deckNeeds(deck);

  it('ranks sets by how many distinct deck cards they cover, breaking ties on copies', () => {
    const ranked = rankSets(needs, { now: NOW });
    // PHNI, SDCS and LEDE all cover three distinct cards; PHNI covers the most
    // copies of them (Ash x3, Cyber Dragon x3, Accesscode x1).
    expect(ranked.slice(0, 3).map((coverage) => coverage.set.code)).toEqual(['PHNI', 'SDCS', 'LEDE']);
    expect(ranked[0]?.distinctCards).toBe(3);
    expect(ranked[0]?.copies).toBe(3 + 3 + 1);
    expect(ranked[1]?.copies).toBe(3 + 2 + 1); // SDCS: Cyber Dragon x3, Impermanence x2, CDI x1
  });

  it('counts a card printed twice in one set only once', () => {
    const ranked = rankSets(deckNeeds(parseTextList('1 Dark Magician', db)), { now: NOW });
    const sdcs = ranked.find((coverage) => coverage.set.code === 'SDCS');
    expect(sdcs?.distinctCards).toBe(1);
    expect(sdcs?.cards[0]?.rarities).toEqual(['Common']);
  });

  it('hides unreleased sets unless asked for them', () => {
    expect(rankSets(needs, { now: NOW }).some((coverage) => coverage.set.code === 'RS26')).toBe(false);
    expect(rankSets(needs, { now: NOW, includeUnreleased: true }).some((coverage) => coverage.set.code === 'RS26')).toBe(
      true,
    );
  });

  it('can restrict the list to products with fixed contents', () => {
    const ranked = rankSets(needs, { now: NOW, guaranteedOnly: true });
    expect(ranked.map((coverage) => coverage.set.code).sort()).toEqual(['SDCS', 'SR03']);
    expect(ranked.every((coverage) => coverage.set.guaranteed)).toBe(true);
  });

  it('can drop sets nobody stocks any more', () => {
    // SDCS released 2021 — out of print relative to the frozen NOW.
    const ranked = rankSets(needs, { now: NOW, includeOutOfPrint: false });
    expect(ranked.some((coverage) => coverage.set.code === 'SDCS')).toBe(false);
  });

  it('sums the cardmarket value of the copies it covers', () => {
    const ranked = rankSets(deckNeeds(parseTextList('2 Pot of Prosperity', db)), { now: NOW });
    expect(ranked[0]?.valueCents).toBe(2 * 2200);
  });

  it('ignores cards that are already covered by the collection', () => {
    const owned = new Map([[70095154, 3]]); // all the Cyber Dragons
    const ranked = rankSets(deckNeeds(deck, owned), { now: NOW });
    const sdcs = ranked.find((coverage) => coverage.set.code === 'SDCS');
    expect(sdcs?.cards.some((entry) => entry.card.name === 'Cyber Dragon')).toBe(false);
  });
});

describe('buildBuyPlan', () => {
  const needs = deckNeeds(deck);

  it('orders purchases so each step adds cards the earlier ones missed', () => {
    const plan = buildBuyPlan(needs, { now: NOW });
    expect(plan.steps.map((step) => step.set.code)).toEqual(['SDCS', 'SR03']);
    expect(plan.steps[0]?.cumulativeCards).toBe(3); // Cyber Dragon, Impermanence, Cyber Dragon Infinity
    expect(plan.steps[1]?.cumulativeCards).toBe(5); // plus Effect Veiler, Called by the Grave

    const stepOne = new Set(plan.steps[0]!.newCards.map((entry) => entry.card.id));
    const stepTwo = plan.steps[1]!.newCards.map((entry) => entry.card.id);
    expect(stepTwo.some((id) => stepOne.has(id))).toBe(false);
  });

  it('defaults to guaranteed products so it never promises a booster pull', () => {
    const plan = buildBuyPlan(needs, { now: NOW });
    expect(plan.steps.every((step) => step.set.guaranteed)).toBe(true);
  });

  it('includes boosters when explicitly asked', () => {
    const plan = buildBuyPlan(needs, { now: NOW, guaranteedOnly: false });
    expect(plan.steps.some((step) => !step.set.guaranteed)).toBe(true);
  });

  it('lists what no product covers, so those become singles', () => {
    const plan = buildBuyPlan(needs, { now: NOW });
    const names = plan.remaining.map((need) => need.card.name);
    expect(names).toContain('Pot of Prosperity'); // booster-only
    expect(names).toContain('Triple Tactics Talent'); // no printings at all
    expect(plan.coveredCards + plan.remaining.length).toBe(plan.totalCards);
  });

  it('reports the singles cost the plan avoids', () => {
    const plan = buildBuyPlan(needs, { now: NOW });
    const expected = plan.steps.reduce((sum, step) => sum + step.newValueCents, 0);
    expect(plan.valueCents).toBe(expected);
  });

  it('respects maxSteps', () => {
    expect(buildBuyPlan(needs, { now: NOW, maxSteps: 1 }).steps).toHaveLength(1);
  });

  it('returns an empty plan when nothing is needed', () => {
    const plan = buildBuyPlan([], { now: NOW });
    expect(plan).toMatchObject({ steps: [], coveredCards: 0, totalCards: 0, remaining: [] });
  });
});

describe('reprints', () => {
  const needs = deckNeeds(deck);

  it('finds printings in sets that have not been released yet', () => {
    const upcoming = upcomingReprints(needs, NOW);
    expect(upcoming.map((news) => news.card.name)).toEqual(['Ash Blossom & Joyous Spring', 'Effect Veiler']);
    expect(upcoming[0]?.printing.set.code).toBe('RS26');
    expect(upcoming[0]?.daysUntil).toBe(97);
  });

  it('warns only about cards expensive enough to be worth waiting for', () => {
    const warnings = waitWarnings(needs, NOW);
    expect(warnings.map((news) => news.card.name)).toEqual(['Ash Blossom & Joyous Spring']);
  });

  it('flags recently released sets as a reason prices may still be falling', () => {
    const recent = recentReprints(needs, NOW, 250);
    expect(recent.map((news) => news.printing.set.code)).toContain('PHNI');
    expect(recent.every((news) => news.daysUntil <= 0)).toBe(true);
  });

  it('phrases the countdown for humans', () => {
    expect(formatDaysUntil(0)).toBe('released');
    expect(formatDaysUntil(1)).toBe('tomorrow');
    expect(formatDaysUntil(12)).toBe('in 12 days');
    expect(formatDaysUntil(97)).toBe('in about 3 months');
  });
});

describe('deckBudget', () => {
  it('separates what the deck costs from what is left to buy', () => {
    const owned = new Map([[84211599, 1]]); // the Pot of Prosperity
    const budget = deckBudget(deckNeeds(deck, owned));
    expect(budget.ownedCents).toBe(2200);
    expect(budget.fullDeckCents - budget.missingCents).toBe(2200);
  });

  it('sets aside cards with no price data instead of counting them as free', () => {
    const budget = deckBudget(deckNeeds(deck));
    expect(budget.unpriced.map((card) => card.name)).toEqual(['Triple Tactics Talent']);
  });

  it('ranks the biggest items by total outlay, not unit price', () => {
    const budget = deckBudget(deckNeeds(deck));
    // 3x Ash at 8.50 = 25.50 outranks 1x Pot of Prosperity at 22.00
    expect(budget.biggestItems[0]?.card.name).toBe('Ash Blossom & Joyous Spring');
    expect(budget.biggestItems[1]?.card.name).toBe('Infinite Impermanence'); // 2 x 12.00
  });

  it('formats euros', () => {
    expect(formatEuro(2550)).toBe('€25.50');
    expect(formatEuro(0)).toBe('€0.00');
  });
});

describe('collection', () => {
  it('imports a decklist as owned cards', () => {
    const owned = collectionFromDeck(parseYdk('#main\n14558127\n14558127\n!side\n14558127\n', db));
    expect(owned.get(14558127)).toBe(3);
  });

  it('updates and removes copies immutably', () => {
    const base = new Map([[1, 2]]);
    expect(withOwned(base, 1, 3).get(1)).toBe(3);
    expect(withOwned(base, 1, 0).has(1)).toBe(false);
    expect(base.get(1)).toBe(2);
  });

  it('adds up when merging two collections', () => {
    const merged = mergeCollections(new Map([[1, 2]]), new Map([[1, 1], [2, 4]]));
    expect([...merged]).toEqual([[1, 3], [2, 4]]);
  });

  it('round-trips through storage and ignores corrupt entries', () => {
    const collection = new Map([[14558127, 3]]);
    expect([...parseCollection(serializeCollection(collection))]).toEqual([[14558127, 3]]);
    expect([...parseCollection('{"12":0,"abc":2,"34":"x","56":1}')]).toEqual([[56, 1]]);
  });
});
