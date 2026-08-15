import type { Database, Deck, DeckSection } from '../types';
import { DeckAccumulator } from './deckBuilder';

/**
 * YDKE URLs (`ydke://<main>!<extra>!<side>!`) are what YGOPRODeck's "Copy YDKE URL"
 * button and most simulators hand you. Each section is base64 of little-endian
 * uint32 passcodes, so a deck round-trips through a single pasteable string — which
 * is also how this app puts a deck in its own share links.
 */

const SECTIONS: DeckSection[] = ['main', 'extra', 'side'];

function base64ToPasscodes(chunk: string): number[] {
  if (!chunk) return [];
  const binary = atob(chunk);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  if (bytes.length % 4 !== 0) {
    throw new Error('YDKE section is not a whole number of passcodes');
  }
  const view = new DataView(bytes.buffer);
  const passcodes: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4) {
    passcodes.push(view.getUint32(offset, true));
  }
  return passcodes;
}

function passcodesToBase64(passcodes: number[]): string {
  const bytes = new Uint8Array(passcodes.length * 4);
  const view = new DataView(bytes.buffer);
  passcodes.forEach((passcode, i) => view.setUint32(i * 4, passcode, true));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function parseYdke(url: string, db: Database): Deck {
  const deck = new DeckAccumulator();
  const body = url.trim().replace(/^ydke:\/\//i, '');
  const chunks = body.split('!');

  SECTIONS.forEach((section, index) => {
    const chunk = chunks[index];
    if (chunk === undefined) return;
    let passcodes: number[];
    try {
      passcodes = base64ToPasscodes(chunk);
    } catch {
      deck.reject(`Could not decode the ${section} deck section of this YDKE URL`);
      return;
    }
    for (const passcode of passcodes) {
      const card = db.byPasscode.get(passcode);
      if (!card) {
        deck.reject(`Unknown passcode ${passcode}`);
        continue;
      }
      deck.add(card, section);
    }
  });

  return deck.build('ydke');
}

/** Serializes a deck back into a YDKE URL, for share links and round-tripping. */
export function toYdke(deck: Deck): string {
  const sections = SECTIONS.map((section) => {
    const passcodes: number[] = [];
    for (const entry of deck.entries) {
      if (entry.section !== section) continue;
      for (let i = 0; i < entry.copies; i += 1) passcodes.push(entry.card.id);
    }
    return passcodesToBase64(passcodes);
  });
  return `ydke://${sections.join('!')}!`;
}

export function looksLikeYdke(text: string): boolean {
  return /^ydke:\/\//i.test(text.trim());
}
