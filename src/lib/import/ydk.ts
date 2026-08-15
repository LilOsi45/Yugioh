import type { Database, Deck, DeckSection } from '../types';
import { DeckAccumulator, defaultSection } from './deckBuilder';

/**
 * .ydk is the format every Yu-Gi-Oh! tool speaks — YGOPRODeck's "Download YDK",
 * EDOPro, DuelingBook exports. It is a flat list of eight digit passcodes split by
 * `#main` / `#extra` / `!side` markers, one copy per line.
 */
export function parseYdk(text: string, db: Database): Deck {
  const deck = new DeckAccumulator();
  let section: DeckSection | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const marker = line.toLowerCase();
    if (marker === '#main') {
      section = 'main';
      continue;
    }
    if (marker === '#extra') {
      section = 'extra';
      continue;
    }
    if (marker === '!side') {
      section = 'side';
      continue;
    }
    // `#created by ...` and friends are comments.
    if (line.startsWith('#') || line.startsWith('!')) continue;

    if (!/^\d+$/.test(line)) {
      deck.reject(line);
      continue;
    }

    const card = db.byPasscode.get(Number.parseInt(line, 10));
    if (!card) {
      deck.reject(`Unknown passcode ${line}`);
      continue;
    }
    deck.add(card, section ?? defaultSection(card));
  }

  return deck.build('ydk');
}

export function looksLikeYdk(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^#(main|extra)\b/im.test(trimmed) || /^!side\b/im.test(trimmed)) return true;
  // A bare passcode dump with no markers is still a .ydk body.
  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim());
  return lines.length > 0 && lines.every((line) => /^\s*\d{4,9}\s*$/.test(line));
}
