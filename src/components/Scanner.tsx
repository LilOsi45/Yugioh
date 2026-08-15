import { useEffect, useRef, useState } from 'react';
import {
  createScanner,
  cropRegion,
  extractCard,
  OCR_MODES,
  PASSCODE_REGION,
  type Scanner as OcrScanner,
} from '../lib/scan';
import type { Card, Database } from '../lib/types';

type Status = 'starting' | 'ready' | 'reading' | 'error';

interface Props {
  db: Database;
  /** Return value decides the feedback line: what the app did with the card. */
  onCard: (card: Card) => string;
  onClose: () => void;
}

/**
 * Camera constraints, tried in order. Phones differ wildly in what they accept:
 * an exact rear-camera request fails outright on devices with one camera, and a
 * resolution hint can be rejected on its own. Falling back costs one extra call
 * and turns a dead scanner into a working one.
 */
const CONSTRAINTS: MediaStreamConstraints[] = [
  { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } } },
  { video: { facingMode: 'environment' } },
  { video: true },
];

/** Turns a getUserMedia rejection into something a person can act on. */
function explain(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Kamera-Zugriff wurde abgelehnt. Erlaube ihn in den Browser-Einstellungen für diese Seite.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Keine passende Kamera gefunden.';
    case 'NotReadableError':
      return 'Die Kamera wird gerade von einer anderen App benutzt. Schließe sie und versuch es nochmal.';
    case 'SecurityError':
      return 'Der Browser blockiert die Kamera auf dieser Seite.';
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

/** Facts worth knowing when the camera refuses to start. */
function diagnostics(): string {
  const bits = [
    globalThis.isSecureContext ? 'HTTPS ok' : 'kein HTTPS',
    typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'Kamera-API da' : 'keine Kamera-API',
  ];
  return bits.join(' · ');
}

export function Scanner({ db, onCard, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const ocr = useRef<OcrScanner | null>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  // What the OCR actually received. If a person cannot read this, neither can it.
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      setStatus('starting');
      setError(null);

      if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
        setStatus('error');
        setError(
          globalThis.isSecureContext
            ? 'Dieser Browser bietet keinen Kamera-Zugriff.'
            : 'Kamera geht nur über HTTPS. Ruf die Seite über https:// auf.',
        );
        return;
      }

      let lastError: unknown = null;
      for (const constraints of CONSTRAINTS) {
        try {
          const media = await navigator.mediaDevices.getUserMedia(constraints);
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
          return;
        } catch (attemptError) {
          lastError = attemptError;
          // A refused permission will be refused for every constraint set.
          if (attemptError instanceof DOMException && attemptError.name === 'NotAllowedError') break;
        }
      }

      if (!cancelled) {
        setStatus('error');
        setError(explain(lastError));
      }
    }

    void start();

    return () => {
      cancelled = true;
      for (const track of stream.current?.getTracks() ?? []) track.stop();
      stream.current = null;
    };
  }, [attempt]);

  // The OCR worker is expensive to build, so it outlives camera restarts.
  useEffect(() => () => void ocr.current?.stop(), []);

  async function capture() {
    const source = video.current;
    if (!source || status !== 'ready') return;
    setStatus('reading');
    setFeedback(null);
    // Crop first and show it straight away: if the engine fails to load, the strip
    // is still the most useful thing on screen for working out what went wrong.
    const crops = [false, true].map((invert) => ({
      invert,
      canvas: cropRegion(source, PASSCODE_REGION, { invert }),
    }));
    setPreview(crops[0]!.canvas.toDataURL('image/png'));

    try {
      ocr.current ??= await createScanner();

      // Each segmentation mode against the normal crop first, then the inverted one
      // for cards printing light on a dark border. First real passcode wins.
      const readings: string[] = [];
      for (const { canvas } of crops) {
        for (const mode of OCR_MODES) {
          const text = await ocr.current.read(canvas, mode);
          readings.push(text.replace(/\s+/g, ''));
          const card = extractCard(text, db);
          if (card) {
            const message = onCard(card);
            setFeedback(message);
            setLog((entries) => [message, ...entries].slice(0, 6));
            setStatus('ready');
            return;
          }
        }
      }

      const seen = readings.filter(Boolean).join(' / ').slice(0, 30);
      setFeedback(
        seen
          ? `Gelesen: "${seen}" — kein bekannter Passcode. Näher ran, mehr Licht.`
          : 'Nichts erkannt. Der Ausschnitt unten zeigt, was die Erkennung bekommen hat.',
      );
      setStatus('ready');
    } catch (readError) {
      setStatus('error');
      setError(`Texterkennung fehlgeschlagen: ${readError instanceof Error ? readError.message : String(readError)}`);
    }
  }

  return (
    <section className="panel">
      <h2>Karte scannen</h2>

      {status === 'error' ? (
        <>
          <div className="notice error" style={{ marginTop: 0 }}>
            {error}
          </div>
          <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
            {diagnostics()}
          </p>
          {preview && <img className="scanpreview" src={preview} alt="Ausschnitt der letzten Aufnahme" />}
          <div className="row">
            <button className="primary" onClick={() => setAttempt((value) => value + 1)}>
              Nochmal versuchen
            </button>
            <button onClick={onClose}>Schließen</button>
          </div>
        </>
      ) : (
        <>
          <div className="scanview">
            <video ref={video} playsInline muted autoPlay />
            {/* Marks where the passcode has to sit for the crop to catch it. */}
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
            Karte aufrecht halten und den <strong>unteren Kartenrand</strong> in den Kasten legen — dort
            steht die 8-stellige Nummer. Näher ist besser.
          </p>

          <div className="row">
            <button className="primary" onClick={() => void capture()} disabled={status !== 'ready'}>
              {status === 'reading' ? 'Lese…' : status === 'starting' ? 'Kamera startet…' : 'Scannen'}
            </button>
            <button onClick={onClose}>Fertig</button>
          </div>

          {feedback && <div className="notice">{feedback}</div>}

          {preview && (
            <div style={{ marginTop: 8 }}>
              <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>
                Das sieht die Erkennung:
              </p>
              <img className="scanpreview" src={preview} alt="Ausschnitt der letzten Aufnahme" />
            </div>
          )}

          {log.length > 1 && (
            <div style={{ marginTop: 10 }}>
              {log.slice(1).map((entry, index) => (
                <div className="line muted" key={`${entry}-${index}`} style={{ fontSize: 13 }}>
                  {entry}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
