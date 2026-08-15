import { useEffect, useRef, useState } from 'react';
import {
  createScanner,
  cropRegion,
  extractCard,
  extractSetCode,
  NO_MEMORY,
  OCR_MODES,
  PASSCODE_REGION,
  SET_CODE_MODE,
  stepScan,
  type Scanner as OcrScanner,
} from '../lib/scan';
import { displayName } from '../lib/dataset';
import type { Card, Database } from '../lib/types';

type Status = 'starting' | 'ready' | 'reading' | 'error';

/** One recognised card: which card, and which printing if it could be read. */
export interface ScanResult {
  card: Card;
  setCode: string | null;
}

interface Props {
  db: Database;
  /** Return value decides the feedback line: what the app did with the card. */
  onCard: (result: ScanResult) => string;
  /** Take one copy back off. Without it the session list is read-only. */
  onUndo?: (result: ScanResult) => void;
  onClose: () => void;
}

/** How often a frame is grabbed while continuous scanning is on. */
const SCAN_INTERVAL_MS = 700;

interface Entry {
  key: number;
  result: ScanResult;
  message: string;
  undone: boolean;
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

export function Scanner({ db, onCard, onUndo, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const ocr = useRef<OcrScanner | null>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [auto, setAuto] = useState(true);
  const [flash, setFlash] = useState(false);
  // What the OCR actually received. If a person cannot read this, neither can it.
  const [preview, setPreview] = useState<string | null>(null);

  // Refs, not state: the scan loop reads these between renders.
  const busy = useRef(false);
  const memory = useRef(NO_MEMORY);
  const statusRef = useRef(status);
  statusRef.current = status;
  /*
   * The loop is started once and then runs for minutes, so anything it calls has to
   * be reached through a ref. Calling the prop it captured at start-up meant every
   * scan was applied to the collection as it looked when the scanner opened, and
   * each card came out as the first copy again.
   */
  const onCardRef = useRef(onCard);
  onCardRef.current = onCard;

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

  /** Confirms a hit without a line of text: a flash, and a buzz where supported. */
  function celebrate() {
    setFlash(true);
    globalThis.setTimeout(() => setFlash(false), 220);
    try {
      navigator.vibrate?.(40);
    } catch {
      // Vibration is a nicety; a browser refusing it changes nothing.
    }
  }

  function record(result: ScanResult) {
    const message = onCardRef.current(result);
    setFeedback(message);
    setEntries((list) => [{ key: Date.now() + Math.random(), result, message, undone: false }, ...list].slice(0, 40));
    celebrate();
  }

  function undo(entry: Entry) {
    onUndo?.(entry.result);
    setEntries((list) => list.map((item) => (item.key === entry.key ? { ...item, undone: true } : item)));
    // Let the card be counted again straight away, since it was just taken back.
    memory.current = NO_MEMORY;
  }

  /**
   * One recognition attempt.
   *
   * `manual` does two things: it also tries the inverted crop, which doubles the
   * work and is only worth it when the user asked for a scan; and it counts the card
   * even if it is the one already in view, which is how you record a second copy
   * without moving anything.
   */
  async function runPass(manual: boolean): Promise<{ found: boolean; readings: string[] }> {
    const source = video.current;
    const readings: string[] = [];
    if (!source) return { found: false, readings };

    const crops = (manual ? [false, true] : [false]).map((invert) =>
      cropRegion(source, PASSCODE_REGION, { invert }),
    );
    if (manual) setPreview(crops[0]!.toDataURL('image/png'));

    const scanner = (ocr.current ??= await createScanner());

    for (const canvas of crops) {
      for (const mode of OCR_MODES) {
        const text = await scanner.read(canvas, mode);
        readings.push(text.replace(/\s+/g, ''));
        const card = extractCard(text, db);
        if (!card) continue;

        const step = stepScan(memory.current, card.id, Date.now());
        memory.current = step.memory;
        if (!step.count && !manual) return { found: true, readings };

        // Only now is a second pass worth its cost: we know which card, so the set
        // code can be checked against that card's printings.
        let setCode: string | null = null;
        try {
          setCode = extractSetCode(await scanner.read(canvas, SET_CODE_MODE), card);
        } catch {
          // A failed set read is a missing detail, not a failed scan.
        }
        record({ card, setCode });
        return { found: true, readings };
      }
    }

    // Nothing in view: that is what tells the scanner the next card is a new one.
    memory.current = stepScan(memory.current, null, Date.now()).memory;
    return { found: false, readings };
  }

  // Continuous scanning: the whole point at 2000 cards is not tapping per card.
  useEffect(() => {
    if (!auto || status === 'error') return;
    let stopped = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

    async function tick() {
      if (stopped) return;
      if (!busy.current && statusRef.current === 'ready' && (video.current?.videoWidth ?? 0) > 0) {
        busy.current = true;
        try {
          await runPass(false);
        } catch (passError) {
          if (!stopped) {
            setAuto(false);
            setFeedback(
              `Dauerscan gestoppt: ${passError instanceof Error ? passError.message : String(passError)}`,
            );
          }
        } finally {
          busy.current = false;
        }
      }
      if (!stopped) timer = globalThis.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
    }

    timer = globalThis.setTimeout(() => void tick(), SCAN_INTERVAL_MS);
    return () => {
      stopped = true;
      globalThis.clearTimeout(timer);
    };
    // Deliberately not depending on runPass: restarting the loop on every render
    // would reset its timing. It reaches current props through refs instead.
  }, [auto, status, attempt]);

  /** The manual button: everything the auto pass does, plus the inverted crop. */
  async function capture() {
    if (busy.current || statusRef.current !== 'ready') return;
    busy.current = true;
    setStatus('reading');
    setFeedback(null);
    try {
      const { found, readings } = await runPass(true);
      if (!found) {
        const seen = readings.filter(Boolean).join(' / ').slice(0, 30);
        setFeedback(
          seen
            ? `Gelesen: "${seen}" — kein bekannter Passcode. Näher ran, mehr Licht.`
            : 'Nichts erkannt. Der Ausschnitt unten zeigt, was die Erkennung bekommen hat.',
        );
      }
      setStatus('ready');
    } catch (readError) {
      setStatus('error');
      setError(`Texterkennung fehlgeschlagen: ${readError instanceof Error ? readError.message : String(readError)}`);
    } finally {
      busy.current = false;
    }
  }

  const counted = entries.filter((entry) => !entry.undone).length;

  return (
    <section className="panel">
      <h2>Karten scannen</h2>

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
          <div className={flash ? 'scanview hit' : 'scanview'}>
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
            {auto
              ? 'Karte für Karte in den Kasten halten — jede wird automatisch erfasst. Der untere Kartenrand mit der 8-stelligen Nummer muss drin liegen.'
              : 'Karte aufrecht halten und den unteren Kartenrand in den Kasten legen, dann auf Scannen tippen.'}
          </p>

          <div className="row">
            <button className="primary" onClick={() => void capture()} disabled={status !== 'ready'}>
              {status === 'reading' ? 'Lese…' : status === 'starting' ? 'Kamera startet…' : 'Jetzt scannen'}
            </button>
            <button onClick={() => setAuto((value) => !value)}>
              {auto ? 'Dauerscan aus' : 'Dauerscan an'}
            </button>
            <button onClick={onClose}>Fertig</button>
          </div>

          {feedback && <div className="notice">{feedback}</div>}

          {entries.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ fontSize: 12.5, margin: '0 0 4px' }}>
                {counted} Karten in dieser Sitzung
              </p>
              {entries.map((entry) => (
                <div className="line" key={entry.key} style={{ fontSize: 13 }}>
                  <span className={entry.undone ? 'muted struck' : undefined}>
                    {displayName(entry.result.card)}
                    {entry.result.setCode && <span className="muted"> · {entry.result.setCode}</span>}
                  </span>
                  {onUndo && !entry.undone && (
                    <button className="link" onClick={() => undo(entry)}>
                      rückgängig
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {preview && (
            <div style={{ marginTop: 8 }}>
              <p className="muted" style={{ fontSize: 12, margin: '0 0 4px' }}>
                Das sieht die Erkennung:
              </p>
              <img className="scanpreview" src={preview} alt="Ausschnitt der letzten Aufnahme" />
            </div>
          )}
        </>
      )}
    </section>
  );
}
