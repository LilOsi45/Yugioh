export type Tab = 'analyse' | 'decks' | 'collection';

const TABS: { id: Tab; label: string }[] = [
  { id: 'analyse', label: 'Analyse' },
  { id: 'decks', label: 'Decks' },
  { id: 'collection', label: 'Collection' },
];

interface Props {
  active: Tab;
  onChange: (tab: Tab) => void;
  deckCount: number;
  cardCount: number;
}

export function Tabs({ active, onChange, deckCount, cardCount }: Props) {
  const counts: Record<Tab, number | null> = { analyse: null, decks: deckCount, collection: cardCount };

  return (
    <nav className="tabs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className="tab"
          aria-current={active === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {counts[tab.id] ? <span className="tab-count">{counts[tab.id]}</span> : null}
        </button>
      ))}
    </nav>
  );
}
