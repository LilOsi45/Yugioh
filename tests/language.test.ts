import { describe, expect, it } from 'vitest';
import { guessLanguage, normalizeName, similarity } from '../src/lib/language';

// A real pair from the index, and the card the device was scanning when the language
// came back empty.
const EN = 'Worldsea Dragon Zealantis';
const DE = 'Weltmeerdrache Zealantis';

describe('normalizeName', () => {
  it('folds a name to what a camera can be expected to agree on', () => {
    expect(normalizeName('Geisterghoster & Schneehase!')).toBe('GEISTERGHOSTERSCHNEEHASE');
    expect(normalizeName('Aschenblüte & Freudiger Frühling')).toBe('ASCHENBLUTEFREUDIGERFRUHLING');
    expect(normalizeName('Weiß')).toBe('WEISS');
  });
});

describe('similarity', () => {
  it('is 1 for the same name however it was written', () => {
    expect(similarity('Pot of Prosperity', 'POT OF PROSPERITY!')).toBe(1);
  });

  it('stays high through the letters OCR drops', () => {
    // A real kind of miss: two letters gone, one wrong.
    expect(similarity('Weltmeerdache Zealantls', DE)).toBeGreaterThan(0.75);
  });

  it('does not reward the same letters in another order', () => {
    // The same six letters, no shared pair.
    expect(similarity('Dragon', 'Nogard')).toBe(0);
  });

  it('is near nothing for unrelated names', () => {
    expect(similarity(EN, 'Aschenblüte & Freudiger Frühling')).toBeLessThan(0.2);
  });
});

describe('guessLanguage', () => {
  it('picks the German printing off the German name', () => {
    expect(guessLanguage('WELTMEERDRACHE ZEALANTIS', EN, DE).language).toBe('DE');
  });

  it('picks the English printing off the English name', () => {
    expect(guessLanguage('WORLDSEA DRAGON ZEALANTIS', EN, DE).language).toBe('EN');
  });

  it('still decides when the reading is damaged', () => {
    expect(guessLanguage('WELTMEEROBACHE ZEALANT1S', EN, DE).language).toBe('DE');
  });

  it('says nothing when the card was never translated', () => {
    // Both fields carry the English name; only the set code can separate those.
    expect(guessLanguage('POT OF PROSPERITY', 'Pot of Prosperity', 'Pot of Prosperity').language).toBeNull();
  });

  it('says nothing when the index has no German name', () => {
    expect(guessLanguage('POT OF PROSPERITY', 'Pot of Prosperity', null).language).toBeNull();
  });

  it('says nothing when the reading is too poor to favour either', () => {
    expect(guessLanguage('XQZ MMM', EN, DE).language).toBeNull();
    expect(guessLanguage('', EN, DE).language).toBeNull();
  });

  it('says nothing on a near tie rather than guessing', () => {
    // Names that share most of their shape: a reading cannot separate them.
    expect(guessLanguage('DRACHE ZEALANTIS', 'Drache Zealantis X', 'Drache Zealantis Y').language).toBeNull();
  });
});
