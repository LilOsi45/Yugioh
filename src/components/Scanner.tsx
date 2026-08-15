import { useEffect, useRef, useState } from 'react';
import { createScanner, cropRegion, extractCard, PASSCODE_REGION, type Scanner as OcrScanner } from '../lib/scan';
import type { Card, Database } from '../lib/types';

type Status = 'idle' | 'starting' | 'ready' | 'reading' | 'denied' | 'unsupported' | 'failed';

interface Props {
  db: Database;
  /** Return value decides the feedback line: what the app did with the card. */
  onCard: (card: Card) => string;
  onClose: () => void;
}

/**
 * Camera capture for adding cards. The user lines the card up with the frame and
 * taps; we read the passcode strip at the bottom left rather than the card name.
 *
 * Every scan is a deliberate tap rather than a continuous video loop — OCR on every
 * frame drains the battery and produces a stream of half-read numbers.
 */
export function Scanner({ db, onCard, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const ocr = useRef<OcrScanner | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported');
        return;
      }
      setStatus('starting');
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        });
        if (cancelled) {
          for (const track of media.getTracks()) track.stop();
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        setStatus('ready');
      } catch {
        if (!cancelled) setStatus('denied');
      }
    }

    void start();

    return () => {
      cancelled = true;
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      void ocr.current?.stop();
    };
  }, []);

  async function capture() {
    if (!video.current || status === 'reading') return;
    setStatus('reading');
    setFeedback(null);
    try {
      ocr.current ??= await createScanner();
      const text = await ocr.current.read(cropRegion(video.current));
      const card = extractCard(text, db);
      if (card) {
        const message = onCard(card);
        setFeedback(message);
        setLog((entries) => [message, ...entries].slice(0, 6));
      } else {
        setFeedback('No passcode read — line up the number at the bottom left and try again.');
      }
      setStatus('ready');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <section className="panel">
      <h2>Scan a card</h2>

      {status === 'unsupported' && (
        <p className="empty">This browser gives no camera access. Add cards by name instead.</p>
      )}
      {status === 'denied' && (
        <p className="empty">
          No camera access. Allow it in the browser settings, or add cards by name instead.
        </p>
      )}
      {status === 'failed' && <p className="empty">The text recognition engine could not be loaded.</p>}

      <div className="scanview">
        <video ref={video} playsInline muted />
        {/* Marks where the passcode has to sit. */}
        <div
          className="scanguide"
          style={{
            left: `${PASSCODE_REGION.x * 100}%`,
            top: `${PASSCODE_REGION.y * 100}%`,
            width: `${PASSCODE_REGION.width * 100}%`,
            height: `${PASSCODE_REGION.height * 100}%`,
          }}
        />
      </div>

      <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
        Fill the frame with the card, keep the 8-digit code at the bottom left inside the box.
      </p>

      <div className="row">
        <button className="primary" onClick={() => void capture()} disabled={status !== 'ready'}>
          {status === 'reading' ? 'Reading…' : 'Scan'}
        </button>
        <button onClick={onClose}>Done</button>
      </div>

      {feedback && <div className="notice">{feedback}</div>}

      {log.length > 1 && (
        <div style={{ marginTop: 10 }}>
          {log.slice(1).map((entry, index) => (
            <div className="line muted" key={`${entry}-${index}`} style={{ fontSize: 13 }}>
              {entry}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
