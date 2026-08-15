import { useState } from 'react';
import { formatEuro } from '../lib/pricing';
import { displayName } from '../lib/dataset';
import { CardSearch } from './CardSearch';
import { Scanner } from './Scanner';
import type { Collection } from '../lib/collection';
import type { Card, Database } from '../lib/types';

interface Props {
  db: Database;
  collection: Collection;
  onOwnedChange: (cardId: number, owned: number) => void;
  onReset: () => void;
  onImport: () => void;
}

export function CollectionPanel({ db, collection, onOwnedChange, onReset, onImport }: Props) {
  const [scanning, setScanning] = useState(false);

  const entries = [...collection]
    .map(([id, count]) => ({ card: db.byPasscode.get(id), count, id }))
    .filter((entry): entry is { card: Card; count: number; id: number } => Boolean(entry.card))
    .sort((a, b) => b.card.priceCents * b.count - a.card.priceCents * a.count);

  const copies = entries.reduce((sum, entry) => sum + entry.count, 0);
  const valueCents = entries.reduce((sum, entry) => sum + entry.card.priceCents * entry.count, 0);

  function addCard(card: Card): string {
    const owned = (collection.get(card.id) ?? 0) + 1;
    onOwnedChange(card.id, owned);
    return `${displayName(card)} — jetzt ${owned}`;
  }

  return (
    <>
      <section className="panel">
        <h2>Deine Sammlung</h2>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
          {entries.length} Karten · {copies} Kopien · {formatEuro(valueCents)}
        </p>

        {!scanning && (
          <div className="row" style={{ marginTop: 0 }}>
            <button className="primary" onClick={() => setScanning(true)}>
              Karten scannen
            </button>
            <button className="link" onClick={onImport}>
              .ydk importieren
            </button>
            {entries.length > 0 && (
              <button
                className="link"
                onClick={() => {
                  if (globalThis.confirm('Ganze Sammlung löschen?')) onReset();
                }}
              >
                Leeren
              </button>
            )}
          </div>
        )}
      </section>

      {scanning && <Scanner db={db} onCard={addCard} onClose={() => setScanning(false)} />}

      <section className="panel">
        <h2>Nach Name hinzufügen</h2>
        <CardSearch db={db} onPick={addCard} />
      </section>

      <section className="panel">
        <h2>Deine Karten</h2>
        {entries.length === 0 ? (
          <p className="empty">Noch nichts da. Karte scannen oder nach Name hinzufügen.</p>
        ) : (
          entries.map((entry) => (
            <div className="line" key={entry.id}>
              <span>
                {displayName(entry.card)}
                <br />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  je {entry.card.priceCents > 0 ? formatEuro(entry.card.priceCents) : 'kein Preis'}
                </span>
              </span>
              <span className="num">
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={entry.count}
                  onChange={(event) => onOwnedChange(entry.id, Number(event.target.value))}
                />
              </span>
            </div>
          ))
        )}
      </section>
    </>
  );
}
