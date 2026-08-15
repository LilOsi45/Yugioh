import { formatEuro } from '../lib/pricing';
import { displayName } from '../lib/dataset';
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

export function DeckList({
  needs,
  onOwnedChange,
  onResetCollection,
  onImportCollection,
  upcoming,
  ownedCount,
}: Props) {
  const reprints = reprintIndex(upcoming);
  const missing = needs.filter((need) => need.needed > 0).length;

  return (
    <details className="panel">
      <summary>
        Karten &amp; Sammlung <span className="count">{missing} fehlen</span>
      </summary>
      <div className="body">
        <div className="row" style={{ marginTop: 0, marginBottom: 6 }}>
          <button className="link" onClick={onImportCollection}>
            .ydk als Besitz importieren
          </button>
          {ownedCount > 0 && (
            <button className="link" onClick={onResetCollection}>
              Zurücksetzen
            </button>
          )}
        </div>

        {needs.map((need) => {
          const reprint = reprints.get(need.card.id);
          return (
            <div className="line" key={need.card.id}>
              <span>
                {displayName(need.card)}
                <br />
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {need.required}x gebraucht · {need.card.priceCents > 0 ? formatEuro(need.card.priceCents) : 'kein Preis'}
                  {reprint && (
                    <>
                      {' '}
                      <span className="badge wait">Reprint {formatDaysUntil(reprint.daysUntil)}</span>
                    </>
                  )}
                </span>
              </span>
              <span className="num">
                <label>
                  <span className="muted" style={{ fontSize: 12 }}>
                    hab{' '}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={need.owned}
                    onChange={(event) => onOwnedChange(need.card.id, Number(event.target.value))}
                  />
                </label>
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
