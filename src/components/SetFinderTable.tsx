import { useState } from 'react';
import { AVAILABILITY_LABELS, PRODUCT_LABELS } from '../lib/setClassification';
import { formatEuro } from '../lib/pricing';
import type { SetCoverage } from '../lib/setFinder';

interface Props {
  coverage: SetCoverage[];
  totalNeeded: number;
}

export function SetFinderTable({ coverage, totalNeeded }: Props) {
  const [expanded, setExpanded] = useState<number | null>(coverage[0]?.set.index ?? null);

  if (coverage.length === 0) {
    return (
      <section className="panel">
        <div className="panel-head">
          <h2>Sets covering your deck</h2>
        </div>
        <p className="empty">No set matches the current filters. Try allowing boosters or out-of-print sets.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Sets covering your deck</h2>
        <p>
          Ranked by how many of your {totalNeeded} missing cards each set contains. Click a row for the card list and
          rarities.
        </p>
      </div>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Set</th>
              <th>Product</th>
              <th className="num">Cards</th>
              <th className="num">Copies</th>
              <th className="num">Value</th>
              <th>Released</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((entry, index) => {
              const open = expanded === entry.set.index;
              return [
                <tr
                  key={entry.set.index}
                  className="expandable"
                  onClick={() => setExpanded(open ? null : entry.set.index)}
                >
                  <td className="num muted">{index + 1}</td>
                  <td>
                    <strong>{entry.set.name}</strong>{' '}
                    <span className="muted nowrap">{entry.set.code}</span>
                  </td>
                  <td>
                    <span className={entry.set.guaranteed ? 'badge guaranteed' : 'badge random'}>
                      {PRODUCT_LABELS[entry.set.product]}
                    </span>
                  </td>
                  <td className="num">
                    <strong>{entry.distinctCards}</strong>
                    <span className="muted"> / {totalNeeded}</span>
                  </td>
                  <td className="num">{entry.copies}</td>
                  <td className="num">{entry.valueCents > 0 ? formatEuro(entry.valueCents) : '—'}</td>
                  <td className="nowrap muted">
                    {entry.set.tcgDate ?? 'unknown'}
                    <br />
                    <span className="badge">{AVAILABILITY_LABELS[entry.availability]}</span>
                  </td>
                </tr>,
                open && (
                  <tr key={`${entry.set.index}-detail`} className="detail">
                    <td colSpan={7}>
                      <table>
                        <tbody>
                          {entry.cards.map((covered) => (
                            <tr key={covered.card.id}>
                              <td>{covered.card.name}</td>
                              <td className="muted">{covered.rarities.join(', ')}</td>
                              <td className="num muted">{covered.needed}x needed</td>
                              <td className="num muted">
                                {covered.card.priceCents > 0 ? formatEuro(covered.card.priceCents) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!entry.set.guaranteed && (
                        <p className="cards-inline">
                          Contents are random — buying this set is a chance at these cards, not a guarantee.
                        </p>
                      )}
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
