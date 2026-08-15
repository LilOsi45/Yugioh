import { useRef, useState, type DragEvent } from 'react';
import type { Deck } from '../lib/types';

const EXAMPLE = `# Paste a decklist, a .ydk file's contents, or a ydke:// URL.
3 Ash Blossom & Joyous Spring
3 Effect Veiler
3 Called by the Grave
2 Infinite Impermanence
1 Pot of Prosperity`;

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  deck: Deck | null;
  onClear: () => void;
  shareLink: string | null;
}

export function ImportPanel({ value, onChange, onSubmit, deck, onClear, shareLink }: Props) {
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
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

  async function copyShareLink() {
    if (!shareLink) return;
    await navigator.clipboard.writeText(shareLink);
    setCopied(true);
    globalThis.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Your deck</h2>
        <p>
          On YGOPRODeck use <strong>Copy YDKE URL</strong> or <strong>Download YDK</strong>, then drop it here. A
          plain typed list works too.
        </p>
      </div>

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
        <button onClick={() => fileInput.current?.click()}>Load .ydk file</button>
        {deck && (
          <button className="link" onClick={onClear}>
            Clear
          </button>
        )}
        {shareLink && (
          <button className="link" onClick={() => void copyShareLink()}>
            {copied ? 'Link copied' : 'Copy share link'}
          </button>
        )}
      </div>

      {deck && deck.unresolved.length > 0 && (
        <div className="notice" style={{ marginTop: 14, marginBottom: 0 }}>
          <strong>{deck.unresolved.length} line(s) could not be matched</strong> and were skipped:{' '}
          <span className="muted">{deck.unresolved.slice(0, 6).join(' · ')}</span>
          {deck.unresolved.length > 6 && <span className="muted"> …</span>}
        </div>
      )}
    </section>
  );
}
