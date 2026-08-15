import { useState } from 'react';
import { displayName } from '../lib/dataset';
import { CARD_ASPECT, cardImageUrl } from '../lib/images';
import { deckSlots, type DeckSlot } from '../lib/library';
import { formatEuro } from '../lib/pricing';
import type { Collection } from '../lib/collection';
import type { Card, Deck, DeckSection } from '../lib/types';

interface Props {
  deck: Deck;
  collection?: Collection;
  /** Grey out copies the collection does not cover. Off for a plain deck view. */
  showOwnership?: boolean;
}

const SECTION_LABELS: Record<DeckSection, string> = {
  main: 'Main Deck',
  extra: 'Extra Deck',
  side: 'Side Deck',
};

function CardTile({ slot, showOwnership, onPick }: { slot: DeckSlot; showOwnership: boolean; onPick: (card: Card) => void }) {
  const [failed, setFailed] = useState(false);
  const missing = showOwnership && !slot.owned;

  return (
    <button
      className={missing ? 'tile missing' : 'tile'}
      title={displayName(slot.card)}
      onClick={() => onPick(slot.card)}
    >
      {failed ? (
        <span className="tile-fallback">{displayName(slot.card)}</span>
      ) : (
        <img
          src={cardImageUrl(slot.card)}
          alt={displayName(slot.card)}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
      {missing && <span className="tile-flag">fehlt</span>}
    </button>
  );
}

export function DeckView({ deck, collection = new Map(), showOwnership = false }: Props) {
  const [picked, setPicked] = useState<Card | null>(null);
  const slots = deckSlots(deck, collection);

  return (
    <section className="panel">
      {(['main', 'extra', 'side'] as DeckSection[]).map((section) => {
        const cards = slots[section];
        if (cards.length === 0) return null;
        const missing = cards.filter((slot) => !slot.owned).length;

        return (
          <div key={section} style={{ marginBottom: 14 }}>
            <h2 style={{ marginBottom: 8 }}>
              {SECTION_LABELS[section]}{' '}
              <span className="muted" style={{ fontWeight: 400 }}>
                ({cards.length} Karten{showOwnership && missing > 0 ? `, ${missing} fehlen` : ''})
              </span>
            </h2>
            <div className="deckgrid" style={{ ['--card-aspect' as string]: CARD_ASPECT }}>
              {cards.map((slot, index) => (
                <CardTile
                  key={`${slot.card.id}-${index}`}
                  slot={slot}
                  showOwnership={showOwnership}
                  onPick={setPicked}
                />
              ))}
            </div>
          </div>
        );
      })}

      {picked && (
        <div className="notice" style={{ marginTop: 0 }}>
          <strong>{displayName(picked)}</strong>
          <br />
          <span className="muted" style={{ fontSize: 12.5 }}>
            {picked.priceCents > 0 ? formatEuro(picked.priceCents) : 'kein Preis'} ·{' '}
            {picked.printings.length > 0
              ? [...new Set(picked.printings.map((printing) => printing.set.code))].slice(0, 6).join(', ')
              : 'keine Printings bekannt'}
          </span>
        </div>
      )}
    </section>
  );
}
