import { formatEuro } from '../lib/pricing';
import { formatDaysUntil, type ReprintNews } from '../lib/reprints';

interface Props {
  upcoming: ReprintNews[];
  warnings: ReprintNews[];
  recent: ReprintNews[];
}

export function ReprintRadar({ upcoming, warnings, recent }: Props) {
  const hasAnything = upcoming.length > 0 || recent.length > 0;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Reprint radar</h2>
        <p>Announced sets carry a future release date, so an upcoming printing is an upcoming reprint.</p>
      </div>

      {warnings.length > 0 && (
        <div className="notice">
          <strong>Worth waiting for.</strong> These are pricey enough that an imminent reprint should move the price:
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {warnings.map((news) => (
              <li key={`${news.card.id}-${news.printing.set.index}`}>
                {news.card.name} — {formatEuro(news.card.priceCents)} now, reprinted in {news.printing.set.name}{' '}
                {formatDaysUntil(news.daysUntil)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasAnything && <p className="empty">Nothing in your deck is being reprinted right now.</p>}

      {upcoming.length > 0 && (
        <>
          <h3>Coming up</h3>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Card</th>
                  <th>Set</th>
                  <th>Rarity</th>
                  <th className="num">Price now</th>
                  <th>Release</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.map((news) => (
                  <tr key={`${news.card.id}-${news.printing.set.index}`}>
                    <td>{news.card.name}</td>
                    <td>
                      {news.printing.set.name} <span className="muted nowrap">{news.printing.set.code}</span>
                    </td>
                    <td className="muted">{news.printing.rarity}</td>
                    <td className="num">{news.card.priceCents > 0 ? formatEuro(news.card.priceCents) : '—'}</td>
                    <td className="nowrap">
                      {news.releaseDate} <span className="muted">({formatDaysUntil(news.daysUntil)})</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h3 style={{ marginTop: 18 }}>Just reprinted</h3>
          <p className="cards-inline">
            Released in the last few months, so singles may still be settling downwards:{' '}
            {recent.map((news) => `${news.card.name} (${news.printing.set.code})`).join(', ')}
          </p>
        </>
      )}
    </section>
  );
}
