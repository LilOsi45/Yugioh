import { useMemo, useState } from 'react';
import { normalizeName } from '../lib/normalize';
import type { Card, Database } from '../lib/types';

interface Props {
  db: Database;
  onPick: (card: Card) => void;
  placeholder?: string;
}

/**
 * Add a card by typing its name. Scanning will not always work — bad light, a
 * sleeved card, a worn passcode — so this always stays available next to it.
 */
export function CardSearch({ db, onPick, placeholder = 'Add a card by name' }: Props) {
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = normalizeName(query);
    if (needle.length < 3) return [];
    const starts: Card[] = [];
    const contains: Card[] = [];
    for (const [name, card] of db.byName) {
      if (name.startsWith(needle)) starts.push(card);
      else if (name.includes(needle)) contains.push(card);
      if (starts.length >= 8) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [query, db]);

  return (
    <div>
      <input
        className="search"
        type="search"
        value={query}
        placeholder={placeholder}
        onChange={(event) => setQuery(event.target.value)}
      />
      {matches.map((card) => (
        <button
          className="line"
          key={card.id}
          style={{ width: '100%', textAlign: 'left', background: 'none', borderRadius: 0 }}
          onClick={() => {
            onPick(card);
            setQuery('');
          }}
        >
          <span>{card.name}</span>
          <span className="num muted">+1</span>
        </button>
      ))}
      {query.length >= 3 && matches.length === 0 && <p className="empty">No card matches that.</p>}
    </div>
  );
}
