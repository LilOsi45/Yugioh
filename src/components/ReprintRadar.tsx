import { formatEuro } from '../lib/pricing';
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
        <p className="empty">Nothing in your deck is being reprinted right now.</p>
      </section>
    );
  }

  return (
    <details className="panel" open={warnings.length > 0}>
      <summary>
        Reprints <span className="count">{upcoming.length} coming</span>
      </summary>
      <div className="body">
        {warnings.length > 0 && (
          <div className="notice" style={{ marginTop: 0, marginBottom: 10 }}>
            <strong>Worth waiting for.</strong> Pricey enough that a reprint should move the price.
          </div>
        )}
        {upcoming.map((news) => (
          <div className="line" key={`${news.card.id}-${news.printing.set.index}`}>
            <span>
              {news.card.name}
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
