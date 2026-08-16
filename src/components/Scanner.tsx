import { useEffect, useRef, useState } from 'react';
import {
  createScanner,
  cropRegion,
  extractSetCode,
  matchPasscode,
  NO_MEMORY,
  PASS_VARIANTS,
  PASSCODE_REGION,
  passVariant,
  SET_CODE_MODE,
  stepScan,
  type PassVariant,
  type Scanner as OcrScanner,
} from '../lib/scan';
import { displayName } from '../lib/dataset';
import type { Card, Database } from '../lib/types';

type Status = 'starting' | 'ready' | 'error';
/** The text engine is several megabytes and loads separately from the camera. */
type Engine = 'loading' | 'ready' | 'failed';

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

/** How long to wait between attempts while scanning continuously. */
const SCAN_INTERVAL_MS = 700;
/** How often the loop looks for work when continuous scanning is off. */
const IDLE_INTERVAL_MS = 250;
/** A single attempt taking longer than this is worth saying out loud. */
const SLOW_PASS_MS = 15000;
/** Width of the on-screen copy of what the engine is being given. */
const PREVIEW_WIDTH = 320;

interface Entry {
  key: number;
  result: ScanResult;
  message: string;
  undone: boolean;
  /** False when the passcode needed a repaired digit to match. */
  exact: boolean;
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
  const preview = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const ocr = useRef<OcrScanner | null>(null);

  const [status, setStatus] = useState<Status>('starting');
  const [engine, setEngine] = useState<Engine>('loading');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [auto, setAuto] = useState(true);
  const [flash, setFlash] = useState(false);
  const [working, setWorking] = useState(false);
  const [torch, setTorch] = useState(false);
  const [typed, setTyped] = useState('');
  /* Proof of life: without these the scanner looks identical whether it is
     searching or dead, which is exactly how the last version failed. */
  const [checked, setChecked] = useState(0);
  const [reading, setReading] = useState<string | null>(null);

  // Refs, not state: the scan loop reads these between renders.
  const busy = useRef(false);
  const memory = useRef(NO_MEMORY);
  const tick = useRef(0);
  /** A tap waiting to be served, set even while a pass is already running. */
  const pendingManual = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;
  const autoRef = useRef(auto);
  autoRef.current = auto;
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

  /*
   * Load the engine as soon as the scanner opens, with a visible state. Hiding this
   * inside the first recognition attempt meant the first several seconds — a
   * multi-megabyte download on mobile data — looked like a scanner that does
   * nothing.
   */
  useEffect(() => {
    let cancelled = false;
    setEngine('loading');
    createScanner()
      .then((scanner) => {
        if (cancelled) {
          void scanner.stop();
          return;
        }
        ocr.current = scanner;
        setEngine('ready');
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setEngine('failed');
        // A tap waiting for an engine that will never arrive must not leave the
        // button stuck on "Lese…".
        pendingManual.current = false;
        setWorking(false);
        setFeedback(
          `Texterkennung konnte nicht geladen werden: ${loadError instanceof Error ? loadError.message : String(loadError)}`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The worker holds a wasm instance; drop it when the scanner closes.
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

  /** `exact` is false when a digit had to be repaired to reach a known card. */
  function record(result: ScanResult, exact = true) {
    const message = onCardRef.current(result);
    setFeedback(exact ? message : `${message} — unsicher gelesen, bitte prüfen`);
    setEntries((list) =>
      [{ key: Date.now() + Math.random(), result, message, undone: false, exact }, ...list].slice(0, 40),
    );
    celebrate();
  }

  function undo(entry: Entry) {
    onUndo?.(entry.result);
    setEntries((list) => list.map((item) => (item.key === entry.key ? { ...item, undone: true } : item)));
    // Let the card be counted again straight away, since it was just taken back.
    memory.current = NO_MEMORY;
  }

  /** Puts the strip the engine is working on on screen, as cheaply as possible. */
  function showPreview(crop: HTMLCanvasElement) {
    const target = preview.current;
    if (!target || crop.width === 0) return;
    const height = Math.max(1, Math.round((crop.height / crop.width) * PREVIEW_WIDTH));
    if (target.width !== PREVIEW_WIDTH || target.height !== height) {
      target.width = PREVIEW_WIDTH;
      target.height = height;
    }
    // drawImage rather than toDataURL: encoding a PNG every 700 ms is a cost a
    // phone pays for nothing.
    target.getContext('2d')?.drawImage(crop, 0, 0, PREVIEW_WIDTH, height);
  }

  /**
   * One recognition attempt.
   *
   * A tap tries every crop and mode at once, the way it always did. The continuous
   * loop tries one combination per tick, so no single attempt is slow but all of
   * them are covered within a couple of seconds.
   */
  async function runPass(manual: boolean): Promise<void> {
    const source = video.current;
    const scanner = ocr.current;
    if (!source || !scanner) return;

    const variants: PassVariant[] = manual ? PASS_VARIANTS : [passVariant(tick.current)];
    tick.current += 1;

    // Each distinct crop is built once and reused by every variant that wants it.
    const crops = new Map<string, HTMLCanvasElement>();
    function cropFor(variant: PassVariant): HTMLCanvasElement {
      const key = `${variant.invert}:${variant.bias}`;
      const existing = crops.get(key);
      if (existing) return existing;
      const canvas = cropRegion(source!, PASSCODE_REGION, { invert: variant.invert, bias: variant.bias });
      crops.set(key, canvas);
      return canvas;
    }

    showPreview(cropFor(variants[0]!));

    const readings: string[] = [];
    for (const [index, variant] of variants.entries()) {
      if (manual) {
        showPreview(cropFor(variant));
        setReading(`Versuch ${index + 1} von ${variants.length}…`);
      }
      const canvas = cropFor(variant);
      const text = await scanner.read(canvas, variant.mode);
      const cleaned = text.replace(/\s+/g, '');
      if (cleaned) readings.push(cleaned);

      // Repairs only on a tap: see matchPasscode for why the continuous scan must
      // stay strict.
      const match = matchPasscode(text, db, { repair: manual });
      if (!match) continue;
      const card = match.card;

      const step = stepScan(memory.current, card.id, Date.now());
      memory.current = step.memory;
      if (!step.count && !manual) {
        setReading(`${displayName(card)} — schon erfasst, liegt noch im Bild`);
        return;
      }

      // Only now is a second pass worth its cost: we know which card, so the set
      // code can be checked against that card's printings.
      let setCode: string | null = null;
      try {
        setCode = extractSetCode(await scanner.read(canvas, SET_CODE_MODE), card);
      } catch {
        // A failed set read is a missing detail, not a failed scan.
      }
      setReading(null);
      record({ card, setCode }, match.exact);
      return;
    }

    // Nothing in view: that is what tells the scanner the next card is a new one.
    memory.current = stepScan(memory.current, null, Date.now()).memory;
    setReading(readings.length > 0 ? `gelesen: ${readings.join(' / ').slice(0, 40)}` : 'nichts lesbar im Kasten');
    if (manual) {
      setFeedback(
        readings.length > 0
          ? 'Kein bekannter Passcode dabei. Näher ran, mehr Licht — der Ausschnitt unten zeigt, was ankommt.'
          : 'Nichts erkannt. Der Ausschnitt unten zeigt, was die Erkennung bekommen hat.',
      );
    }
  }

  /*
   * One loop serves both the continuous scan and the button. The button used to run
   * its own attempt and gave up silently whenever the loop happened to be busy —
   * which, since an attempt outlasts the interval on a phone, was most of the time.
   * Now a tap is a request the loop picks up next, so it can never be swallowed.
   */
  useEffect(() => {
    if (status !== 'ready' || engine !== 'ready') return;
    let stopped = false;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

    async function pass(manual: boolean) {
      busy.current = true;
      setWorking(true);
      const slow = globalThis.setTimeout(
        () => setFeedback('Die Erkennung braucht ungewöhnlich lange. Bei schwachem Handy kann das dauern.'),
        SLOW_PASS_MS,
      );
      try {
        await runPass(manual);
      } catch (passError) {
        if (!stopped) {
          setAuto(false);
          setFeedback(
            `Erkennung fehlgeschlagen: ${passError instanceof Error ? passError.message : String(passError)}`,
          );
        }
      } finally {
        globalThis.clearTimeout(slow);
        busy.current = false;
        if (!stopped) {
          setWorking(false);
          setChecked((count) => count + 1);
        }
      }
    }

    async function loop() {
      if (stopped) return;
      const live = (video.current?.videoWidth ?? 0) > 0;
      if (live && pendingManual.current) {
        pendingManual.current = false;
        await pass(true);
      } else if (live && autoRef.current) {
        await pass(false);
      }
      if (stopped) return;
      const delay = pendingManual.current ? 0 : autoRef.current ? SCAN_INTERVAL_MS : IDLE_INTERVAL_MS;
      timer = globalThis.setTimeout(() => void loop(), delay);
    }

    timer = globalThis.setTimeout(() => void loop(), 0);
    return () => {
      stopped = true;
      globalThis.clearTimeout(timer);
    };
    // Deliberately not depending on runPass: restarting the loop on every render
    // would reset its timing. It reaches current props and state through refs.
  }, [status, engine, attempt]);

  /** The button: a request the loop serves next, never a silent no-op. */
  function capture() {
    if (statusRef.current !== 'ready') return;
    pendingManual.current = true;
    setWorking(true);
    setFeedback(null);
    setReading('Ausschnitt wird geprüft…');
  }

  /**
   * The camera light, where the browser offers it. A dim card bottom is the single
   * most common reason a reading comes back as noise, and this fixes it at the
   * source instead of asking the software to guess harder.
   */
  function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    track
      .applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorch(next))
      .catch(() => setFeedback('Dieses Handy lässt das Licht über den Browser nicht schalten.'));
  }

  /** Torch support cannot be asked for up front; it shows up on the live track. */
  const torchAvailable =
    status === 'ready' && 'torch' in (stream.current?.getVideoTracks()[0]?.getCapabilities?.() ?? {});

  /** The way out when the camera simply will not read a card: type the number. */
  function addTyped() {
    const digits = typed.replace(/\D/g, '');
    if (!digits) return;
    const card = db.byPasscode.get(Number.parseInt(digits, 10));
    if (!card) {
      setFeedback(`${digits} gehört zu keiner bekannten Karte.`);
      return;
    }
    setTyped('');
    record({ card, setCode: null });
  }

  const counted = entries.filter((entry) => !entry.undone).length;
  const engineLine =
    engine === 'loading'
      ? 'Texterkennung wird geladen…'
      : engine === 'failed'
        ? 'Texterkennung nicht verfügbar'
        : status === 'starting'
          ? 'Kamera startet…'
          : `${checked} Bilder geprüft · ${counted} Karten erfasst`;

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
              : 'Karte aufrecht halten, unteren Kartenrand in den Kasten legen, dann auf Scannen tippen.'}
          </p>

          <div className="row">
            <button className="primary" onClick={capture} disabled={status !== 'ready' || engine === 'failed'}>
              {working ? 'Lese…' : 'Jetzt scannen'}
            </button>
            <button onClick={() => setAuto((value) => !value)}>{auto ? 'Dauerscan aus' : 'Dauerscan an'}</button>
            {torchAvailable && <button onClick={toggleTorch}>{torch ? 'Licht aus' : 'Licht an'}</button>}
            <button onClick={onClose}>Fertig</button>
          </div>

          {feedback && <div className="notice">{feedback}</div>}

          {/* Always on screen: a scanner that is working and a scanner that is stuck
              must not look the same. */}
          <div className="scanstate">
            <span className={working ? 'dot live' : 'dot'} />
            <span>{engineLine}</span>
          </div>
          {reading && (
            <p className="muted scanreading" title={reading}>
              {reading}
            </p>
          )}
          <canvas ref={preview} className="scanpreview" />

          {/* If the camera will not read a card, the number under it still can be
              typed — eight digits is faster than fighting the light. */}
          <div className="row" style={{ marginTop: 8 }}>
            <input
              className="search"
              type="text"
              inputMode="numeric"
              value={typed}
              placeholder="Nummer eintippen, z. B. 68464358"
              style={{ flex: 1, marginBottom: 0 }}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addTyped();
              }}
            />
            <button onClick={addTyped} disabled={typed.replace(/\D/g, '').length === 0}>
              Hinzufügen
            </button>
          </div>

          {entries.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {entries.map((entry) => (
                <div className="line" key={entry.key} style={{ fontSize: 13 }}>
                  <span className={entry.undone ? 'muted struck' : undefined}>
                    {displayName(entry.result.card)}
                    {entry.result.setCode && <span className="muted"> · {entry.result.setCode}</span>}
                    {!entry.exact && <span className="muted"> · unsicher</span>}
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
        </>
      )}
    </section>
  );
}
