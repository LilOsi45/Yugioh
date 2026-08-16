import { useMemo, useState } from 'react';
import { displayName } from '../lib/dataset';
import { formatEuro } from '../lib/pricing';
import { collectionValue, duplicates, PLAYSET, setProgress } from '../lib/stats';
import type { Collection } from '../lib/collection';
import type { Database } from '../lib/types';

interface Props {
  db: Database;
  collection: Collection;
}

type View = 'sets' | 'value' | 'spares';

const LABELS: Record<View, string> = {
  sets: 'Sets',
  value: 'Wert',
  spares: 'Dubletten',
};

/** How many rows each list shows before asking to be expanded. */
const PAGE = 15;

export function StatsPanel({ db, collection }: Props) {
  const [view, setView] = useState<View>('sets');
  const [expanded, setExpanded] = useState(false);

  const sets = useMemo(() => setProgress(collection, db), [collection, db]);
  const value = useMemo(() => collectionValue(collection, db), [collection, db]);
  const spares = useMemo(() => duplicates(collection, db), [collection, db]);

  if (collection.size === 0) return null;

  const limit = expanded ? Number.POSITIVE_INFINITY : PAGE;

  return (
    <section className="panel">
      <h2>Auswertung</h2>
      <p className="muted" style={{ fontSize: 13, margin: '0 0 8px' }}>
        {value.cards} Karten · {value.copies} Kopien · {formatEuro(value.totalCents)}
      </p>

      <div className="filters">
        {(['sets', 'value', 'spares'] as View[]).map((option) => (
          <button
            key={option}
            className="chip"
            aria-pressed={view === option}
            onClick={() => {
              setView(option);
              setExpanded(false);
            }}
          >
            {LABELS[option]}
          </button>
        ))}
      </div>

      {view === 'sets' &&
        (sets.length === 0 ? (
          <p className="empty">
            Noch kein Set erfasst. Beim Scannen wird der Set-Code mitgelesen — danach steht hier, wie weit
            jedes Set ist.
          </p>
        ) : (
          <>
            {sets.slice(0, limit).map((entry) => (
              <div className="line" key={entry.set.code}>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <strong>{entry.set.code}</strong>{' '}
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {entry.set.name}
                  </span>
                  <div className="bar" style={{ marginTop: 5 }}>
                    <div className="fill" style={{ width: `${Math.min(100, entry.ratio * 100)}%` }} />
                  </div>
                </span>
                <span className="num">
                  <strong>{entry.owned}</strong>
                  <span className="muted"> von {entry.set.numOfCards}</span>
                  <br />
                  <span className="muted" style={{ fontSize: 12 }}>
                    {formatEuro(entry.valueCents)}
                  </span>
                </span>
              </div>
            ))}
            {sets.length > PAGE && !expanded && (
              <button className="link" onClick={() => setExpanded(true)}>
                alle {sets.length} Sets zeigen
              </button>
            )}
          </>
        ))}

      {view === 'value' &&
        (value.top.length === 0 ? (
          <p className="empty">Für deine Karten kennt YGOPRODeck keine Preise.</p>
        ) : (
          value.top.map((entry) => (
            <div className="line" key={entry.card.id}>
              <span>
                {displayName(entry.card)}
                {entry.count > 1 && <span className="muted"> ×{entry.count}</span>}
              </span>
              <span className="num">{formatEuro(entry.valueCents)}</span>
            </div>
          ))
        ))}

      {view === 'spares' &&
        (spares.length === 0 ? (
          <p className="empty">Keine Karte öfter als {PLAYSET}× — nichts zum Abgeben.</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12.5, margin: '0 0 4px' }}>
              Kopien über {PLAYSET}×, also über ein volles Deckset hinaus.
            </p>
            {spares.slice(0, limit).map((entry) => (
              <div className="line" key={entry.card.id}>
                <span>
                  {displayName(entry.card)} <span className="muted">×{entry.count} übrig</span>
                </span>
                <span className="num">{formatEuro(entry.valueCents)}</span>
              </div>
            ))}
            {spares.length > PAGE && !expanded && (
              <button className="link" onClick={() => setExpanded(true)}>
                alle {spares.length} zeigen
              </button>
            )}
          </>
        ))}
    </section>
  );
}
