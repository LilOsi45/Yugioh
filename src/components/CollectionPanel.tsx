import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { displayName } from '../lib/dataset';
import { cardImageUrl } from '../lib/images';
import { formatEuro } from '../lib/pricing';
import {
  applyFilter,
  CATEGORY_LABELS,
  SORT_LABELS,
  filterEntries,
  setsInCollection,
  type CollectionFilter,
  groupByCategory,
  groupBySet,
  sortEntries,
  type CollectionEntry,
  type CollectionSort,
} from '../lib/collectionView';
import { addCopies, holdingKey, setOwnedTotal, UNKNOWN_SET, type Collection } from '../lib/collection';
import { CardSearch } from './CardSearch';
import { Scanner, type ScanResult } from './Scanner';
import { useVirtualList } from './useVirtualList';
import type { Card, Database } from '../lib/types';

interface Props {
  db: Database;
  collection: Collection;
  /** Shown in the backup line, so it is clear the decks travel with it. */
  deckCount: number;
  notice: string | null;
  onDismissNotice: () => void;
  onChange: (next: Collection) => void;
  onReset: () => void;
  onImport: () => void;
  onExport: () => void;
  /** What a scan session added, shown once it is closed. */
  onSummary: (line: string) => void;
  /** Rendered above the card list — anything below it is unreachable at 2000 rows. */
  children?: ReactNode;
}

const SORTS: CollectionSort[] = ['set', 'type', 'name', 'price', 'count'];

/** Fixed row metrics, so the virtual list can place rows without measuring each one. */
const ROW_HEIGHT = 58;
const HEADING_HEIGHT = 36;

type ListItem =
  | { kind: 'heading'; key: string; label: string; count: number }
  | { kind: 'row'; key: string; entry: CollectionEntry };

export function CollectionPanel({
  db,
  collection,
  deckCount,
  notice,
  onDismissNotice,
  onChange,
  onReset,
  onImport,
  onExport,
  onSummary,
  children,
}: Props) {
  const [scanning, setScanning] = useState(false);
  const [sort, setSort] = useState<CollectionSort>('set');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<CollectionFilter>({});

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
    const shown = sortEntries(applyFilter(filterEntries(all, debouncedQuery), filter), sort);
    const out: ListItem[] = [];

    if (sort === 'set') {
      for (const group of groupBySet(shown, db)) {
        const copies = group.entries.reduce((sum, entry) => sum + entry.count, 0);
        out.push({ kind: 'heading', key: `s:${group.code}`, label: group.name, count: copies });
        for (const entry of group.entries)
          out.push({ kind: 'row', key: `${group.code}:${entry.rarity ?? ''}:${entry.language ?? ''}:${entry.card.id}`, entry });
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
  }, [all, debouncedQuery, filter, sort, db]);

  const heights = useMemo(
    () => items.map((item) => (item.kind === 'heading' ? HEADING_HEIGHT : ROW_HEIGHT)),
    [items],
  );
  const { ref, start, end, paddingTop, paddingBottom } = useVirtualList(heights);

  const sets = useMemo(() => setsInCollection(all), [all]);
  const copies = all.reduce((sum, entry) => sum + entry.count, 0);
  const valueCents = all.reduce((sum, entry) => sum + entry.card.priceCents * entry.count, 0);

  /** Scans carry the printing they were read from; typed entries do not. */
  function addScanned(result: ScanResult): string {
    const key = result.setCode ? holdingKey(result.setCode, result.rarity, result.language) : UNKNOWN_SET;
    const next = addCopies(collection, result.card.id, key, 1);
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
              Datei einlesen
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

        {notice && (
          <div className="notice">
            {notice}{' '}
            <button className="link" onClick={onDismissNotice}>
              ok
            </button>
          </div>
        )}
      </section>

      {/* The collection lives only in this browser. Say so, and make the fix one tap
          away — hours of scanning are not something to lose to a cleared cache. */}
      <section className="panel">
        <h2>Backup</h2>
        <p className="muted" style={{ fontSize: 13, margin: '0 0 10px' }}>
          Deine Sammlung liegt nur in diesem Browser. Wird er geleert oder das Handy gewechselt, ist sie
          weg. Das Backup enthält {all.length} Karten und {deckCount} Decks.
        </p>
        <div className="row" style={{ marginTop: 0 }}>
          <button onClick={onExport} disabled={all.length === 0 && deckCount === 0}>
            Backup speichern
          </button>
          <button className="link" onClick={onImport}>
            Backup einlesen
          </button>
        </div>
      </section>

      {scanning && (
        <Scanner
          db={db}
          onCard={addScanned}
          onUndo={(result) =>
            onChange(
              addCopies(
                collection,
                result.card.id,
                result.setCode ? holdingKey(result.setCode, result.rarity, result.language) : UNKNOWN_SET,
                -1,
              ),
            )
          }
          onSummary={onSummary}
          onClose={() => setScanning(false)}
        />
      )}

      <section className="panel">
        <h2>Nach Name hinzufügen</h2>
        <CardSearch db={db} onPick={addByName} />
      </section>

      {children}

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

            {/* Narrowing, separate from sorting: at two thousand cards the useful
                questions are "what can I trade" and "what still needs sorting". */}
            <div className="filters" style={{ marginTop: 6 }}>
              <button
                className="chip"
                aria-pressed={Boolean(filter.doublesOnly)}
                onClick={() => setFilter((current) => ({ ...current, doublesOnly: !current.doublesOnly }))}
              >
                Doubles
              </button>
              <button
                className="chip"
                aria-pressed={Boolean(filter.withoutSet)}
                onClick={() => setFilter((current) => ({ ...current, withoutSet: !current.withoutSet }))}
              >
                Ohne Set
              </button>
              {(Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((category) => (
                <button
                  key={category}
                  className="chip"
                  aria-pressed={filter.category === category}
                  onClick={() =>
                    setFilter((current) => ({
                      ...current,
                      category: current.category === category ? null : category,
                    }))
                  }
                >
                  {CATEGORY_LABELS[category]}
                </button>
              ))}
              {sets.length > 0 && (
                <select
                  className="chip"
                  value={filter.setCode ?? ''}
                  onChange={(event) =>
                    setFilter((current) => ({ ...current, setCode: event.target.value || null }))
                  }
                >
                  <option value="">Alle Sets</option>
                  {sets.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              )}
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
                      {item.entry.rarity && <span className="muted"> · {item.entry.rarity}</span>}
                      {/* What a Cardmarket listing turns on, next to the rarity. */}
                      {item.entry.language && <span className="muted"> · {item.entry.language}</span>}
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
