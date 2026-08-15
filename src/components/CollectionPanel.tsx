import { useEffect, useMemo, useState } from 'react';
import { displayName } from '../lib/dataset';
import { cardImageUrl } from '../lib/images';
import { formatEuro } from '../lib/pricing';
import {
  CATEGORY_LABELS,
  SORT_LABELS,
  filterEntries,
  groupByCategory,
  groupBySet,
  sortEntries,
  type CollectionEntry,
  type CollectionSort,
} from '../lib/collectionView';
import { addCopies, setOwnedTotal, UNKNOWN_SET, type Collection } from '../lib/collection';
import { CardSearch } from './CardSearch';
import { Scanner, type ScanResult } from './Scanner';
import { useVirtualList } from './useVirtualList';
import type { Card, Database } from '../lib/types';

interface Props {
  db: Database;
  collection: Collection;
  onChange: (next: Collection) => void;
  onReset: () => void;
  onImport: () => void;
}

const SORTS: CollectionSort[] = ['set', 'type', 'name', 'price', 'count'];

/** Fixed row metrics, so the virtual list can place rows without measuring each one. */
const ROW_HEIGHT = 58;
const HEADING_HEIGHT = 36;

type ListItem =
  | { kind: 'heading'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; entry: CollectionEntry };

export function CollectionPanel({ db, collection, onChange, onReset, onImport }: Props) {
  const [scanning, setScanning] = useState(false);
  const [sort, setSort] = useState<CollectionSort>('set');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Filtering thousands of rows on every keystroke is what made typing lag.
  useEffect(() => {
    const timer = globalThis.setTimeout(() => setDebouncedQuery(query), 150);
    return () => globalThis.clearTimeout(timer);
  }, [query]);

  const all = useMemo<CollectionEntry[]>(() => {
    const entries: CollectionEntry[] = [];
    for (const [id, holding] of collection) {
      const card = db.byPasscode.get(id);
      if (card) entries.push({ card, count: holding.total, bySet: holding.bySet });
    }
    return entries;
  }, [collection, db]);

  const items = useMemo<ListItem[]>(() => {
    const shown = sortEntries(filterEntries(all, debouncedQuery), sort);
    const out: ListItem[] = [];

    if (sort === 'set') {
      for (const group of groupBySet(shown, db)) {
        const copies = group.entries.reduce((sum, entry) => sum + entry.count, 0);
        out.push({ kind: 'heading', key: `s:${group.code}`, label: group.name, count: copies });
        for (const entry of group.entries) out.push({ kind: 'row', key: `${group.code}:${entry.card.id}`, entry });
      }
    } else if (sort === 'type') {
      for (const group of groupByCategory(shown)) {
        const copies = group.entries.reduce((sum, entry) => sum + entry.count, 0);
        out.push({ kind: 'heading', key: `c:${group.category}`, label: CATEGORY_LABELS[group.category], count: copies });
        for (const entry of group.entries) out.push({ kind: 'row', key: String(entry.card.id), entry });
      }
    } else {
      for (const entry of shown) out.push({ kind: 'row', key: String(entry.card.id), entry });
    }
    return out;
  }, [all, debouncedQuery, sort, db]);

  const heights = useMemo(
    () => items.map((item) => (item.kind === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT)),
    [items],
  );
  const { ref, start, end, paddingTop, paddingBottom } = useVirtualList(heights);

  const copies = all.reduce((sum, entry) => sum + entry.count, 0);
  const valueCents = all.reduce((sum, entry) => sum + entry.card.priceCents * entry.count, 0);

  /** Scans carry the printing they were read from; typed entries do not. */
  function addScanned(result: ScanResult): string {
    const next = addCopies(collection, result.card.id, result.setCode ?? UNKNOWN_SET, 1);
    onChange(next);
    const total = next.get(result.card.id)?.total ?? 1;
    const where = result.setCode ? ` (${result.setCode})` : '';
    return `${displayName(result.card)}${where} — jetzt ${total}`;
  }

  function addByName(card: Card): string {
    return addScanned({ card, setCode: null });
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

      {scanning && (
        <Scanner
          db={db}
          onCard={addScanned}
          onUndo={(result) => onChange(addCopies(collection, result.card.id, result.setCode ?? UNKNOWN_SET, -1))}
          onClose={() => setScanning(false)}
        />
      )}

      <section className="panel">
        <h2>Nach Name hinzufügen</h2>
        <CardSearch db={db} onPick={addByName} />
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
                <button key={option} className="chip" aria-pressed={sort === option} onClick={() => setSort(option)}>
                  {SORT_LABELS[option]}
                </button>
              ))}
            </div>
          </>
        )}

        {all.length === 0 ? (
          <p className="empty">Noch nichts da. Karte scannen oder nach Name hinzufügen.</p>
        ) : items.length === 0 ? (
          <p className="empty">Nichts gefunden für „{debouncedQuery}".</p>
        ) : (
          <div ref={ref}>
            <div style={{ paddingTop, paddingBottom }}>
              {items.slice(start, end).map((item) =>
                item.kind === 'heading' ? (
                  <h3 className="coll-heading" key={item.key}>
                    {item.label}{' '}
                    <span className="muted" style={{ fontWeight: 400 }}>
                      ({item.count})
                    </span>
                  </h3>
                ) : (
                  <div className="line owned-row" key={item.key}>
                    <img
                      className="owned-thumb"
                      src={cardImageUrl(item.entry.card)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    <span className="owned-name">
                      {displayName(item.entry.card)}
                      <br />
                      <span className="muted" style={{ fontSize: 12.5 }}>
                        je{' '}
                        {item.entry.card.priceCents > 0 ? formatEuro(item.entry.card.priceCents) : 'kein Preis'}
                        {item.entry.count > 1 && item.entry.card.priceCents > 0 && (
                          <> · {formatEuro(item.entry.card.priceCents * item.entry.count)} gesamt</>
                        )}
                      </span>
                    </span>
                    <span className="num">
                      {sort === 'set' ? (
                        <strong>{item.entry.count}</strong>
                      ) : (
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={item.entry.count}
                          onChange={(event) =>
                            onChange(setOwnedTotal(collection, item.entry.card.id, Number(event.target.value)))
                          }
                        />
                      )}
                    </span>
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
