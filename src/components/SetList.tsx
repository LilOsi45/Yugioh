import { useState } from 'react';
import { AVAILABILITY_LABELS, PRODUCT_LABELS } from '../lib/setClassification';
import { formatEuro } from '../lib/pricing';
import { displayName } from '../lib/dataset';
import type { SetCoverage } from '../lib/setFinder';
import { Filters, type FilterState } from './Filters';

/** Real data matches around a hundred sets; nobody scrolls that on a phone. */
const INITIAL_VISIBLE = 8;

interface Props {
  coverage: SetCoverage[];
  totalNeeded: number;
  filters: FilterState;
  onFiltersChange: (value: FilterState) => void;
}

export function SetList({ coverage, totalNeeded, filters, onFiltersChange }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? coverage : coverage.slice(0, INITIAL_VISIBLE);

  return (
    <section className="panel">
      <h2>Sets für dein Deck</h2>
      <Filters value={filters} onChange={onFiltersChange} />

      {coverage.length === 0 ? (
        <p className="empty">Kein Set passt zu diesen Filtern.</p>
      ) : (
        <>
          {visible.map((entry) => {
            const open = expanded === entry.set.index;
            return (
              <button
                key={entry.set.index}
                className="set"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : entry.set.index)}
              >
                <div className="cover">
                  <b>{entry.distinctCards}</b>
                  <span>von {totalNeeded}</span>
                </div>

                <div>
                  <div className="name">
                    {entry.set.name} <span className="code">{entry.set.code}</span>
                  </div>
                  <div className="meta">
                    <span className={entry.set.guaranteed ? 'badge guaranteed' : 'badge random'}>
                      {PRODUCT_LABELS[entry.set.product]}
                    </span>
                    <span>{AVAILABILITY_LABELS[entry.availability]}</span>
                    {entry.valueCents > 0 && <span>· {formatEuro(entry.valueCents)} an Einzelkarten</span>}
                  </div>
                </div>

                {open && (
                  <div className="set-detail">
                    {entry.cards.map((covered) => (
                      <div className="line" key={covered.card.id}>
                        <span>
                          {covered.needed}x {displayName(covered.card)}
                        </span>
                        <span className="rarity">{covered.rarities.join(', ')}</span>
                      </div>
                    ))}
                    {!entry.set.guaranteed && (
                      <p className="muted" style={{ margin: '8px 0 0' }}>
                        Zufallsinhalt — eine Chance auf diese Karten, keine Garantie.
                      </p>
                    )}
                  </div>
                )}
              </button>
            );
          })}

          {coverage.length > INITIAL_VISIBLE && (
            <div className="row">
              <button className="link" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Weniger zeigen' : `Alle ${coverage.length} Sets zeigen`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
