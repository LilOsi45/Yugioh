import { useRef, useState, type DragEvent } from 'react';
import type { Deck } from '../lib/types';

const EXAMPLE = `Paste a ydke:// URL, a .ydk file, or a list:
3 Ash Blossom & Joyous Spring
2 Infinite Impermanence`;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  deck: Deck | null;
  onCancel: (() => void) | null;
}

export function ImportPanel({ value, onChange, onSubmit, deck, onCancel }: Props) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function readFile(file: File) {
    onChange(await file.text());
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void readFile(file);
  }

  return (
    <section className="panel">
      <h2>Your deck</h2>

      <div
        className={dragging ? 'dropzone over' : 'dropzone'}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <textarea
          value={value}
          spellCheck={false}
          placeholder={EXAMPLE}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) onSubmit();
          }}
        />
      </div>

      <div className="row">
        <button className="primary" onClick={onSubmit} disabled={!value.trim()}>
          Analyse deck
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".ydk,.txt"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file);
          }}
        />
        <button onClick={() => fileInput.current?.click()}>Load .ydk</button>
        {onCancel && (
          <button className="link" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {deck && deck.unresolved.length > 0 && (
        <div className="notice">
          <strong>{deck.unresolved.length} line(s) skipped:</strong>{' '}
          <span className="muted">{deck.unresolved.slice(0, 4).join(' · ')}</span>
          {deck.unresolved.length > 4 && <span className="muted"> …</span>}
        </div>
      )}
    </section>
  );
}
