import { formatEuro } from '../lib/pricing';
import { formatDaysUntil, type ReprintNews } from '../lib/reprints';
import type { CardNeed } from '../lib/setFinder';

interface Props {
  needs: CardNeed[];
  onOwnedChange: (cardId: number, owned: number) => void;
  onResetCollection: () => void;
  onImportCollection: () => void;
  upcoming: ReprintNews[];
  ownedCount: number;
}

/** Earliest upcoming reprint per card, for the inline badge. */
function reprintIndex(upcoming: ReprintNews[]): Map<number, ReprintNews> {
  const map = new Map<number, ReprintNews>();
  for (const news of upcoming) {
    if (!map.has(news.card.id)) map.set(news.card.id, news);
  }
  return map;
}

export function DeckTable({ needs, onOwnedChange, onResetCollection, onImportCollection, upcoming, ownedCount }: Props) {
  const reprints = reprintIndex(upcoming);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Cards</h2>
        <p>
          Set what you already own — everything above recalculates for the cards that are actually missing. Saved in
          this browser.
        </p>
        <button className="link" onClick={onImportCollection}>
          Import a .ydk as owned
        </button>
        {ownedCount > 0 && (
          <button className="link" onClick={onResetCollection}>
            Reset collection
          </button>
        )}
      </div>

      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Card</th>
              <th className="num">In deck</th>
              <th className="num">Owned</th>
              <th className="num">Missing</th>
              <th className="num">Price</th>
              <th>Printed in</th>
            </tr>
          </thead>
          <tbody>
            {needs.map((need) => {
              const reprint = reprints.get(need.card.id);
              return (
                <tr key={need.card.id}>
                  <td>
                    {need.card.name}
                    {reprint && (
                      <>
                        {' '}
                        <span className="badge wait" title={`${reprint.printing.set.name} (${reprint.releaseDate})`}>
                          reprint {formatDaysUntil(reprint.daysUntil)}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="num">{need.required}</td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={need.owned}
                      onChange={(event) => onOwnedChange(need.card.id, Number(event.target.value))}
                    />
                  </td>
                  <td className="num">
                    {need.needed === 0 ? <span className="muted">done</span> : <strong>{need.needed}</strong>}
                  </td>
                  <td className="num muted">{need.card.priceCents > 0 ? formatEuro(need.card.priceCents) : '—'}</td>
                  <td className="muted">
                    {need.card.printings.length === 0
                      ? 'no printings on record'
                      : [...new Set(need.card.printings.map((printing) => printing.set.code))].join(', ')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
