import { useState } from 'react';
import { applyScannedCard, deckProgress, stillMissing, type SavedDeck } from '../lib/library';
import { parseDeck } from '../lib/import';
import { displayName } from '../lib/dataset';
import { deckNeeds } from '../lib/setFinder';
import { CardSearch } from './CardSearch';
import { Scanner } from './Scanner';
import type { Collection } from '../lib/collection';
import type { Card, Database } from '../lib/types';

interface Props {
  saved: SavedDeck;
  db: Database;
  collection: Collection;
  onOwnedChange: (cardId: number, owned: number) => void;
  onBack: () => void;
}

/**
 * Building a specific deck: scan cards, and only the ones this deck asks for count.
 * Anything else is reported and left alone, so working through a pile of cards does
 * not quietly fill the collection with everything on the table.
 */
export function BuildMode({ saved, db, collection, onOwnedChange, onBack }: Props) {
  const [scanning, setScanning] = useState(false);
  const [keepOthers, setKeepOthers] = useState(false);

  const deck = parseDeck(saved.ydke, db);
  const needs = deckNeeds(deck, collection);
  const progress = deckProgress(needs);
  const missing = stillMissing(needs);
  const percent = Math.round(progress.ratio * 100);

  /** Returns the line shown to the user, so the scanner can echo what happened. */
  function addCard(card: Card): string {
    const outcome = applyScannedCard(needs, collection, card, { keepOthers });
    if (outcome.owned !== null) onOwnedChange(card.id, outcome.owned);
    return outcome.message;
  }

  return (
    <>
      <div className="deckbar">
        <button className="link" onClick={onBack}>
          ← Decks
        </button>
        <strong>{saved.name}</strong>
      </div>

      <section className="panel">
        <h2>{progress.complete ? 'Deck vollständig' : `${progress.missingCards} Karten fehlen noch`}</h2>
        <div className="bar">
          <div className="fill" style={{ width: `${percent}%` }} />
        </div>
        <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
          {progress.owned} von {progress.required} Kopien · {percent}%
        </p>

        {!scanning && (
          <div className="row">
            <button className="primary" onClick={() => setScanning(true)}>
              Karten scannen
            </button>
          </div>
        )}

        <label className="check" style={{ marginTop: 10, display: 'flex', gap: 7, fontSize: 13 }}>
          <input type="checkbox" checked={keepOthers} onChange={(event) => setKeepOthers(event.target.checked)} />
          <span className="muted">Karten sammeln, die nicht in diesem Deck sind</span>
        </label>
      </section>

      {scanning && <Scanner db={db} onCard={addCard} onClose={() => setScanning(false)} />}

      <section className="panel">
        <h2>Fehlt noch</h2>
        <CardSearch db={db} onPick={(card) => addCard(card)} placeholder="Gefunden? Nach Name hinzufügen" />

        {missing.length === 0 ? (
          <p className="empty" style={{ marginTop: 10 }}>
            Alles da. Bau es.
          </p>
        ) : (
          missing.map((need) => (
            <div className="line" key={need.card.id}>
              <span>{displayName(need.card)}</span>
              <span className="num">
                <strong>{need.needed}</strong>
                <span className="muted"> von {need.required}</span>
              </span>
            </div>
          ))
        )}
      </section>
    </>
  );
}
