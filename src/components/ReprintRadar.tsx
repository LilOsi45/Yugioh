import { formatEuro } from '../lib/pricing';
import { displayName } from '../lib/dataset';
import { formatDaysUntil, type ReprintNews } from '../lib/reprints';

interface Props {
  upcoming: ReprintNews[];
  warnings: ReprintNews[];
}

export function ReprintRadar({ upcoming, warnings }: Props) {
  if (upcoming.length === 0) {
    return (
      <section className="panel">
        <h2>Reprints</h2>
        <p className="empty">Aktuell wird nichts aus deinem Deck neu aufgelegt.</p>
      </section>
    );
  }

  return (
    <details className="panel" open={warnings.length > 0}>
      <summary>
        Reprints <span className="count">{upcoming.length} kommen</span>
      </summary>
      <div className="body">
        {warnings.length > 0 && (
          <div className="notice" style={{ marginTop: 0, marginBottom: 10 }}>
            <strong>Warten lohnt sich.</strong> Teuer genug, dass ein Reprint den Preis drücken sollte.
          </div>
        )}
        {upcoming.map((news) => (
          <div className="line" key={`${news.card.id}-${news.printing.set.index}`}>
            <span>
              {displayName(news.card)}
              <br />
              <span className="muted" style={{ fontSize: 12.5 }}>
                {news.printing.set.code} · {news.printing.rarity} · {formatDaysUntil(news.daysUntil)}
              </span>
            </span>
            <span className="num">{news.card.priceCents > 0 ? formatEuro(news.card.priceCents) : '—'}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
