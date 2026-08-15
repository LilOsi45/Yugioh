import { useMemo, useState } from 'react';
import { displayName } from '../lib/dataset';
import { cardImageUrl } from '../lib/images';
import { formatEuro } from '../lib/pricing';
import {
  CATEGORY_LABELS,
  SORT_LABELS,
  filterEntries,
  groupByCategory,
  sortEntries,
  type CollectionEntry,
  type CollectionSort,
} from '../lib/collectionView';
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

const SORTS: CollectionSort[] = ['type', 'name', 'price', 'count'];

export function CollectionPanel({ db, collection, onOwnedChange, onReset, onImport }: Props) {
  const [scanning, setScanning] = useState(false);
  const [sort, setSort] = useState<CollectionSort>('type');
  const [query, setQuery] = useState('');

  const all = useMemo<CollectionEntry[]>(
    () =>
      [...collection]
        .map(([id, count]) => ({ card: db.byPasscode.get(id), count }))
        .filter((entry): entry is CollectionEntry => Boolean(entry.card)),
    [collection, db],
  );

  const shown = useMemo(() => sortEntries(filterEntries(all, query), sort), [all, query, sort]);
  // Only the type sort earns headings; the others are one continuous ranking.
  const groups = sort === 'type' ? groupByCategory(shown) : [{ category: null, entries: shown }];

  const copies = all.reduce((sum, entry) => sum + entry.count, 0);
  const valueCents = all.reduce((sum, entry) => sum + entry.card.priceCents * entry.count, 0);

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
          {all.length} Karten · {copies} Kopien · {formatEuro(valueCents)}
        </p>

        {!scanning && (
          <div className="row" style={{ marginTop: 0 }}>
            <button className="primary" onClick={() => setScanning(true)}>
              Karten scannen
            </button>
            <button className="link" onClick={onImport}>
              .ydk importieren
            </button>
            {all.length > 0 && (
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

        {all.length > 0 && (
          <>
            <input
              className="search"
              type="search"
              value={query}
              placeholder="In der Sammlung suchen"
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="filters" style={{ marginTop: 8 }}>
              {SORTS.map((option) => (
                <button
                  key={option}
                  className="chip"
                  aria-pressed={sort === option}
                  onClick={() => setSort(option)}
                >
                  {SORT_LABELS[option]}
                </button>
              ))}
            </div>
          </>
        )}

        {all.length === 0 ? (
          <p className="empty">Noch nichts da. Karte scannen oder nach Name hinzufügen.</p>
        ) : shown.length === 0 ? (
          <p className="empty">Nichts gefunden für „{query}".</p>
        ) : (
          groups.map((group) => (
            <div key={group.category ?? 'all'}>
              {group.category && (
                <h3 style={{ marginTop: 14 }}>
                  {CATEGORY_LABELS[group.category]}{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    ({group.entries.reduce((sum, entry) => sum + entry.count, 0)})
                  </span>
                </h3>
              )}
              {group.entries.map((entry) => (
                <div className="line owned-row" key={entry.card.id}>
                  <img className="owned-thumb" src={cardImageUrl(entry.card)} alt="" loading="lazy" decoding="async" />
                  <span>
                    {displayName(entry.card)}
                    <br />
                    <span className="muted" style={{ fontSize: 12.5 }}>
                      je {entry.card.priceCents > 0 ? formatEuro(entry.card.priceCents) : 'kein Preis'}
                      {entry.count > 1 && entry.card.priceCents > 0 && (
                        <> · {formatEuro(entry.card.priceCents * entry.count)} gesamt</>
                      )}
                    </span>
                  </span>
                  <span className="num">
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={entry.count}
                      onChange={(event) => onOwnedChange(entry.card.id, Number(event.target.value))}
                    />
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </section>
    </>
  );
}
