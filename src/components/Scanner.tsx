import { useEffect, useRef, useState } from 'react';
import {
  captureFrame,
  createScanner,
  cropGuide,
  cropPixels,
  cropVideoRegion,
  extractSetCode,
  matchPasscode,
  NO_MEMORY,
  PASS_VARIANTS,
  passcodeBand,
  PASSCODE_LINE,
  SET_CODE_LINE,
  guideSourceRect,
  guideBox,
  SET_CODE_SPAN,
  WIDE_BAND,
  passVariant,
  THRESHOLD_PASSES,
  pointInFrame,
  samplePatch,
  samplePixels,
  OCR_MODES,
  SET_CODE_MODE,
  SET_CODE_SPARSE_MODE,
  stepScan,
  TURNS,
  wordCentre,
  type Crop,
  type Frame,
  type Rect,
  type LineBox,
  type PassVariant,
  type Reading,
  type Scanner as OcrScanner,
  type Turn,
  type WordBox,
} from '../lib/scan';
import {
  ART_REGION,
  boundingBoxOnCard,
  cardFrameFromLine,
  NAME_REGION,
  RARITY_REGIONS,
  refineScale,
  regionsVisible,
  SET_CODE_BANDS,
  TEXTBOX_REGION,
  type CardFrame,
} from '../lib/cardGeometry';
import { combineLooks, decideRarity, measureLook, type Look, type RarityDecision } from '../lib/rarity';
import { displayName } from '../lib/dataset';
import { cardmarketUrl } from '../lib/market';
import { formatEuro } from '../lib/pricing';
import type { Card, Database } from '../lib/types';

type Status = 'starting' | 'ready' | 'error';
/** The text engine is several megabytes and loads separately from the camera. */
type Engine = 'loading' | 'ready' | 'failed';

/** One recognised card: which card, and which printing if it could be read. */
export interface ScanResult {
  card: Card;
  setCode: string | null;
  rarity?: string | null;
}

/**
 * The sets a card was printed in, newest first — what to offer when the set code on
 * the card could not be read. Most cards have a handful, so one tap fills the gap
 * that would otherwise land in the collection as "no set" and have to be dug out
 * again later.
 */
const SET_CHOICES = 6;

function setsFor(card: Card): string[] {
  const byCode = new Map<string, string>();
  for (const printing of card.printings) {
    if (!byCode.has(printing.set.code)) byCode.set(printing.set.code, printing.set.tcgDate ?? '');
  }
  return [...byCode.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]))
    .slice(0, SET_CHOICES)
    .map(([code]) => code);
}

/** The rarities a card was printed at in one set, deduplicated. */
function raritiesIn(card: Card, setCode: string | null): string[] {
  if (!setCode) return [];
  const found = new Set<string>();
  for (const printing of card.printings) {
    if (printing.set.code === setCode && printing.rarity) found.add(printing.rarity);
  }
  return [...found].sort();
}

interface Props {
  db: Database;
  /** Return value decides the feedback line: what the app did with the card. */
  onCard: (result: ScanResult) => string;
  /** Take one copy back off. Without it the session list is read-only. */
  onUndo?: (result: ScanResult) => void;
  /** What the session added, reported once on closing. */
  onSummary?: (line: string) => void;
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

/**
 * How often the card's colours are sampled before deciding the rarity, and how far
 * apart. Foil is directional — it flashes as the card turns — so a few frames a
 * moment apart say more than one, and hand tremor supplies the movement for free.
 */
const RARITY_SAMPLES = 3;

const RARITY_GAP_MS = 70;

/**
 * How wide a photograph is scaled to before reading. A phone hands over twelve
 * megapixels; past this the extra pixels cost seconds and add nothing, because the
 * digits are already several times taller than the engine needs.
 */
const PHOTO_WIDTH = 2400;

/**
 * Where to look in a photograph, in order. The bottom third first — that is where the
 * number is on a card that fills the frame, and it is the fastest read — then the
 * whole picture, which finds it wherever it ended up.
 */
const PHOTO_REGIONS: Rect[] = [
  { x: 0, y: 0.6, width: 1, height: 0.4 },
  { x: 0, y: 0, width: 1, height: 1 },
];

interface Entry {
  key: number;
  result: ScanResult;
  message: string;
  undone: boolean;
  /** False when the passcode needed a repaired digit to match. */
  exact: boolean;
  /** Offered only when the card exists at several rarities in the scanned set. */
  choices: string[];
  /** Offered when the set code could not be read: the sets this card was printed in. */
  sets: string[];
  /** True when the rarity in `result` came from the camera rather than a tap. */
  detected: boolean;
}

const wait = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

/** The longest run of digits a reading contains, which is what a passcode looks like. */
function passcodeWord(words: WordBox[]): WordBox | null {
  let best: WordBox | null = null;
  let bestLength = 5;
  for (const word of words) {
    const digits = word.text.replace(/\D/g, '').length;
    if (digits > bestLength) {
      best = word;
      bestLength = digits;
    }
  }
  return best;
}

/** The line a word belongs to, which is what carries the baseline and row height. */
function lineOf(reading: Reading, word: WordBox): LineBox | null {
  return reading.lines.find((line) => line.words.includes(word)) ?? null;
}

/** The word the set code was read from, so its position on the card is known. */
function setCodeWord(words: WordBox[], code: string): WordBox | null {
  const wanted = code.toUpperCase();
  for (const word of words) {
    if (word.text.toUpperCase().replace(/[^A-Z0-9]/g, '').startsWith(wanted)) return word;
  }
  return null;
}

/**
 * Camera constraints, tried in order. Phones differ wildly in what they accept:
 * an exact rear-camera request fails outright on devices with one camera, and a
 * resolution hint can be rejected on its own. Falling back costs one extra call
 * and turns a dead scanner into a working one.
 */
const CONSTRAINTS: MediaStreamConstraints[] = [
  { video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 } } },
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

export function Scanner({ db, onCard, onUndo, onSummary, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const ocr = useRef<OcrScanner | null>(null);
  /** The phone's own camera app, which focuses and gives back the full sensor. */
  const photo = useRef<HTMLInputElement>(null);

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
  const [sound, setSound] = useState(true);
  const [detectRarity, setDetectRarity] = useState(true);
  /** The quarter turn the cards are lying at, learned from the first card that read. */
  const [turnSeen, setTurnSeen] = useState<Turn>(0);
  /** Held for the whole session once chosen: a rarity collection is all one rarity. */
  const [sessionRarity, setSessionRarity] = useState<string | null>(null);
  /* Proof of life: without these the scanner looks identical whether it is
     searching or dead, which is exactly how the last version failed. */
  const [checked, setChecked] = useState(0);
  const [reading, setReading] = useState<string | null>(null);
  const [setReadingText, setSetReading] = useState<string | null>(null);

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
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const detectRarityRef = useRef(detectRarity);
  detectRarityRef.current = detectRarity;
  /**
   * Which way the cards lie. Set by hand rather than searched for: hunting through all
   * four quarter turns spent three of every four attempts on a turn that could not
   * work, and flipped the preview on every tick — which looks like a fault and is one.
   */
  const turnRef = useRef<Turn>(0);
  turnRef.current = turnSeen;
  const sessionRarityRef = useRef(sessionRarity);
  sessionRarityRef.current = sessionRarity;
  /** One audio context for the whole session; creating one per beep is wasteful. */
  const audio = useRef<AudioContext | null>(null);

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

  /**
   * A short beep, synthesised rather than loaded — no asset, no request, works
   * offline. Working through a stack, you look at the cards and not at the screen,
   * so hearing the hit is worth more than seeing it.
   */
  function beep() {
    try {
      const Ctor = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      audio.current ??= new Ctor();
      const context = audio.current;
      void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.15, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.13);
    } catch {
      // Audio is a nicety; a browser refusing it changes nothing.
    }
  }

  /** Confirms a hit without a line of text: a flash, a buzz, and a beep. */
  function celebrate() {
    setFlash(true);
    globalThis.setTimeout(() => setFlash(false), 220);
    try {
      navigator.vibrate?.(40);
    } catch {
      // Vibration is a nicety; a browser refusing it changes nothing.
    }
    if (soundRef.current) beep();
  }

  /**
   * `exact` is false when a digit had to be repaired to reach a known card.
   *
   * Three things can answer the rarity, in this order: the set only offers one, so
   * there is nothing to ask; the session was told to stick to one rarity; the camera
   * measured it. Anything left over is asked, as chips.
   */
  function record(result: ScanResult, exact = true, decision?: RarityDecision | null) {
    const choices = raritiesIn(result.card, result.setCode);
    const held = sessionRarityRef.current;
    let rarity = result.rarity ?? null;
    let detected = false;
    if (!rarity && choices.length === 1) rarity = choices[0]!;
    if (!rarity && held && choices.includes(held)) rarity = held;
    if (!rarity && decision?.rarity) {
      rarity = decision.rarity;
      detected = true;
    }

    const settled: ScanResult = rarity ? { ...result, rarity } : result;
    // Offered best guess first, so the likely correction is the nearest chip.
    const ordered = decision && decision.ranked.length > 0 ? decision.ranked.map((guess) => guess.rarity) : choices;

    const message = onCardRef.current(settled);
    setFeedback(exact ? message : `${message} — unsicher gelesen, bitte prüfen`);
    setEntries((list) =>
      [
        {
          key: Date.now() + Math.random(),
          result: settled,
          message,
          undone: false,
          exact,
          choices: choices.length > 1 ? ordered : [],
          sets: settled.setCode ? [] : setsFor(settled.card),
          detected,
        },
        ...list,
      ].slice(0, 40),
    );
    celebrate();
  }

  /**
   * Corrects the rarity of an entry after the fact: takes the copy back off under
   * the old key and puts it on under the new one, so counts stay right.
   */
  function chooseRarity(entry: Entry, rarity: string) {
    onUndo?.(entry.result);
    const updated: ScanResult = { ...entry.result, rarity };
    onCardRef.current(updated);
    setEntries((list) =>
      list.map((item) => (item.key === entry.key ? { ...item, result: updated, detected: false } : item)),
    );
  }

  /**
   * Fills in the set for an entry whose code the camera could not read. Rebooks the
   * copy under the new key, and settles the rarity straight away when that set only
   * ever printed the card one way.
   */
  function chooseSet(entry: Entry, setCode: string) {
    onUndo?.(entry.result);
    const choices = raritiesIn(entry.result.card, setCode);
    const updated: ScanResult = {
      ...entry.result,
      setCode,
      rarity: choices.length === 1 ? choices[0]! : entry.result.rarity ?? null,
    };
    onCardRef.current(updated);
    setEntries((list) =>
      list.map((item) =>
        item.key === entry.key
          ? { ...item, result: updated, sets: [], choices: choices.length > 1 ? choices : [], detected: false }
          : item,
      ),
    );
  }

  /** Another copy of a card already in hand, without scanning it again. */
  function again(entry: Entry) {
    record(entry.result, entry.exact);
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
   * Hunts for the set code once the card is known.
   *
   * Looks at the whole lower half of the camera frame first, not the viewfinder
   * crop: the set code sits on the opposite corner from the passcode and is
   * routinely outside the visible box. The viewfinder crop stays as a fallback,
   * since it is sharper when the code does happen to be in it.
   */
  async function readSetCode(
    frame: Frame,
    guideCrop: Crop,
    card: Card,
    scanner: OcrScanner,
    rough: CardFrame | null,
    turn: Turn,
  ): Promise<{ code: string; at: { x: number; y: number } | null } | null> {
    /*
     * A band of the frame, not of the card: it holds the set code wherever on the card
     * that is printed, and it does not depend on having guessed the card's size right.
     * The card-space bands below are sharper when the geometry is good; this one is
     * what catches the code when it is not.
     */
    const wide = cropVideoRegion(frame, passcodeBand(turn, SET_CODE_SPAN), { turn, scale: 3 });
    // Where the code is on the card, addressed through the outline — the same trick
    // that finds the number, and it needs no geometry to have been guessed right.
    const framed = cropGuide(frame, SET_CODE_LINE, { scale: 4 });
    /*
     * The card's own lower band comes first when the geometry is known. It covers both
     * places a card can print its set code — under the artwork, or on the bottom line
     * beside the passcode — while leaving the artwork out, and on a foil card that is
     * the difference between reading the code and not: rainbow foil thresholds into a
     * field of speckle that swallows it.
     */
    const bands = rough
      ? SET_CODE_BANDS.map((region: Rect) => {
          const box = boundingBoxOnCard(rough, region);
          return cropPixels(frame, { sx: box.x, sy: box.y, sw: box.width, sh: box.height }, {
            scale: 3,
            turn,
          });
        })
      : [];
    const readings: string[] = [];
    for (const [crop, mode] of [
      [framed, SET_CODE_MODE] as const,
      [framed, SET_CODE_SPARSE_MODE] as const,
      ...bands.flatMap((band: Crop) => [[band, SET_CODE_MODE] as const, [band, SET_CODE_SPARSE_MODE] as const]),
      [wide, SET_CODE_MODE],
      [wide, SET_CODE_SPARSE_MODE],
      [guideCrop, SET_CODE_MODE],
    ] as const) {
      const reading = await scanner.read(crop.canvas, mode, detectRarityRef.current);
      const cleaned = reading.text.replace(/\s+/g, ' ').trim();
      if (cleaned) readings.push(cleaned);
      const code = extractSetCode(reading.text, card);
      if (code) {
        setSetReading(`Set gelesen: ${code}`);
        // Where the code sits is the second anchor the rarity measurement needs.
        const word = setCodeWord(reading.words, code);
        return { code, at: word ? wordCentre(word, crop) : null };
      }
    }
    // Nothing usable: show the raw text, so a failure can be diagnosed from the
    // screen instead of guessed at.
    setSetReading(readings.length > 0 ? `Set nicht erkannt in: ${readings.join(' / ').slice(0, 60)}` : null);
    return null;
  }

  /**
   * Works out the rarity from how the card looks.
   *
   * Everything needed to place the card in the picture is already in hand: the
   * passcode was read at its bottom left, the set code at its bottom right. Two known
   * points on a rectangle of known proportions fix the whole card, and with that the
   * name strip and the artwork can be sampled in colour.
   *
   * Returns null whenever that chain breaks — a missing anchor, a card whose top is
   * outside the picture — and the choice then stays where it was before: with the
   * user. The camera never overrules a tap and never guesses when two rarities look
   * the same.
   */
  async function measureRarity(
    source: HTMLVideoElement,
    frame: Frame,
    card: CardFrame | null,
    candidates: string[],
  ): Promise<RarityDecision | null> {
    if (!detectRarityRef.current || candidates.length < 2) return null;
    if (!card) {
      setSetReading((line) => (line ? `${line} · Rarity: Karte nicht vermessbar` : null));
      return null;
    }
    if (!regionsVisible(card, frame.width, frame.height, RARITY_REGIONS)) {
      setSetReading((line) => (line ? `${line} · Rarity: Karte nicht ganz im Bild` : null));
      return null;
    }

    const looks: Look[] = [];
    for (let sample = 0; sample < RARITY_SAMPLES; sample += 1) {
      const shot = sample === 0 ? frame : captureFrame(source);
      const name = samplePixels(shot, boundingBoxOnCard(card, NAME_REGION));
      const art = samplePatch(shot, boundingBoxOnCard(card, ART_REGION));
      const textbox = samplePixels(shot, boundingBoxOnCard(card, TEXTBOX_REGION));
      if (name && art && textbox) looks.push(measureLook(name, art, textbox));
      if (sample < RARITY_SAMPLES - 1) await wait(RARITY_GAP_MS);
    }
    if (looks.length === 0) return null;
    const decision = decideRarity(candidates, combineLooks(looks));
    // Says which way it went, so a wrong reading can be seen rather than discovered
    // later in the collection.
    setSetReading((line) =>
      [
        line,
        decision.rarity
          ? `Rarity erkannt: ${decision.rarity}`
          : `Rarity nicht eindeutig: ${decision.ranked.slice(0, 2).map((guess) => guess.rarity).join(' / ')}`,
      ]
        .filter(Boolean)
        .join(' · '),
    );
    return decision;
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

    /*
     * A tap works through every crop and mode at the turn that last worked, then takes
     * one look at each other turn. The continuous loop takes one combination per tick
     * and lets `turnForMisses` decide when to start looking at other turns.
     */
    const held = turnRef.current;
    const attempts: { variant: PassVariant; turn: Turn }[] = manual
      ? [
          // The plain variants at the turn that works, then one look at each other
          // turn. The inverted ones are for an unusual kind of printing and used to
          // push a tap to nineteen recognitions, which on a phone is not a button
          // press any more — they come last, and only if nothing else lands.
          ...PASS_VARIANTS.filter((variant) => !variant.invert).map((variant) => ({ variant, turn: held })),
          ...PASS_VARIANTS.filter((variant) => variant.invert).map((variant) => ({ variant, turn: held })),
        ]
      : [{ variant: passVariant(tick.current), turn: held }];
    tick.current += 1;

    /*
     * One still picture for the whole attempt. Cutting each crop out of the running
     * video meant the readings of a single attempt came from different moments —
     * harmless while they were only compared with the card index, but the passcode
     * and set code now also say *where* the card is, and two positions from two
     * moments describe a card that was never there.
     */
    const frame = captureFrame(source);

    // Each distinct crop is built once and reused by every variant that wants it.
    const crops = new Map<string, Crop>();
    function cropFor(variant: PassVariant, turn: Turn): Crop {
      const key = `${variant.wide}:${variant.invert}:${variant.threshold.window}:${variant.threshold.bias}:${turn}`;
      const existing = crops.get(key);
      if (existing) return existing;
      const options = { invert: variant.invert, threshold: variant.threshold, turn };
      /*
       * The band turns with the card: a quarter turn moves the passcode to the side
       * of the picture, outside a band fixed to the bottom. Two widths, because the
       * narrow one assumes the card's bottom edge is near the edge of the frame and
       * that is only true if the card is held right down — so the wide one goes first
       * and the narrow one follows as the sharper second look.
       */
      /*
       * Two bands rather than a band and the viewfinder box. The box was a sensible
       * crop while it marked where to put the passcode; now that the outline asks for
       * the whole card, what it frames is mostly artwork. A narrow strip along the
       * card's bottom edge and a wider fallback do the same job without that.
       */
      /*
       * The outline first, the picture second. Cutting the card's own bottom edge out
       * of the outline gives the number line and nothing else — where a band of the
       * picture either lands below the card or brings the whole effect text with it.
       * A real reading came back as `328154153381140`: fifteen digits of effect text,
       * with the number nowhere in them.
       */
      const crop = variant.wide
        ? cropVideoRegion(frame, passcodeBand(turn, WIDE_BAND), { ...options, scale: 2 })
        : cropGuide(frame, PASSCODE_LINE, { ...options, scale: 4 });
      crops.set(key, crop);
      return crop;
    }

    showPreview(cropFor(attempts[0]!.variant, attempts[0]!.turn).canvas);

    const readings: string[] = [];
    for (const [index, { variant, turn }] of attempts.entries()) {
      const crop = cropFor(variant, turn);
      if (manual) {
        showPreview(crop.canvas);
        setReading(`Versuch ${index + 1} von ${attempts.length}…`);
      }
      const reading = await scanner.read(crop.canvas, variant.mode, detectRarityRef.current);
      const cleaned = reading.text.replace(/\s+/g, '');
      if (cleaned) readings.push(cleaned);

      // Repairs only on a tap: see matchPasscode for why the continuous scan must
      // stay strict.
      const match = matchPasscode(reading.text, db, { repair: manual });
      if (!match) continue;
      const card = match.card;

      const step = stepScan(memory.current, card.id, Date.now());
      memory.current = step.memory;
      if (!step.count && !manual) {
        setReading(`${displayName(card)} — schon erfasst, liegt noch im Bild`);
        return;
      }

      /*
       * Where the passcode was read, and at what angle, puts the whole card on the
       * map: its line's baseline is the card's own horizontal, and the row height is
       * roughly its size. That is what the set code is then looked for through.
       */
      const word = passcodeWord(reading.words);
      const passcodeAt = word ? wordCentre(word, crop) : null;
      const line = word ? lineOf(reading, word) : null;
      /*
       * The outline is the card, so it is the card frame — no row height to estimate
       * and no second anchor to find. The estimate below stays for a card that was
       * read from the picture instead.
       */
      const box = guideSourceRect(frame);
      let geometry: CardFrame | null =
        box.sw > 0 && box.sh > 0
          ? { origin: { x: box.sx, y: box.sy }, right: { x: box.sw, y: 0 }, down: { x: 0, y: box.sh } }
          : null;
      if (!variant.wide && geometry) {
        // Read through the outline: trust it and skip the estimate entirely.
      } else if (word && passcodeAt && line) {
        const from = pointInFrame({ x: line.baseline.x0, y: line.baseline.y0 }, crop);
        const to = pointInFrame({ x: line.baseline.x1, y: line.baseline.y1 }, crop);
        geometry = cardFrameFromLine(
          passcodeAt,
          { x0: from.x, y0: from.y, x1: to.x, y1: to.y },
          line.rowHeight / crop.scale,
        );
      }

      // Only now is a second pass worth its cost: we know which card, so the set
      // code can be checked against that card's printings.
      let found: { code: string; at: { x: number; y: number } | null } | null = null;
      try {
        found = await readSetCode(frame, crop, card, scanner, geometry, turn);
      } catch {
        // A failed set read is a missing detail, not a failed scan.
      }
      const setCode = found?.code ?? null;

      // The set code across the card is a far longer lever than a row height, so it
      // is what the measurement's aim finally rests on.
      const sharp = !variant.wide
        ? geometry
        : geometry && passcodeAt && found?.at
          ? refineScale(geometry, passcodeAt, found.at)
          : null;

      let decision: RarityDecision | null = null;
      try {
        decision = await measureRarity(source, frame, sharp, raritiesIn(card, setCode));
      } catch {
        // Same rule as the set code: a detail that failed, not a failed scan.
      }

      setReading(null);
      record({ card, setCode }, match.exact, decision);
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
  /**
   * Reads a photograph taken with the phone's own camera app.
   *
   * The live preview is the weakest picture the phone can give: a couple of megapixels,
   * compressed for streaming, exposed for the whole scene and often not focused at
   * arm's length. Everything that went wrong with this scanner came back to that — an
   * eight digit number sixteen pixels tall, blurred by a hand that never holds still.
   *
   * A photo is a different thing entirely. The camera app focuses, meters, steadies
   * and hands back the sensor's full resolution, where the same number is a hundred
   * pixels tall and sharp. At that size the reading needs no guide box, no band and no
   * geometry: the whole picture is searched, and whatever eight digit run matches a
   * real card wins.
   */
  async function scanPhoto(file: File): Promise<void> {
    const scanner = ocr.current;
    if (!scanner) return;
    setWorking(true);
    setFeedback(null);
    setReading('Foto wird gelesen…');
    try {
      /*
       * Loaded through an <img> rather than createImageBitmap, for two reasons that
       * both end in "nothing is read at all":
       *
       *  - A phone stores a photo the way the sensor saw it and puts the rotation in
       *    an EXIF tag. `createImageBitmap` ignores that tag, so a picture taken
       *    upright decodes on its side and every line of text runs vertically.
       *  - iPhones write HEIC. An <img> hands that to the system decoder; not every
       *    browser's createImageBitmap will.
       */
      const url = URL.createObjectURL(file);
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Bildformat wird nicht unterstützt'));
        image.src = url;
      });
      const source = { width: image.naturalWidth, height: image.naturalHeight };
      // A phone photo is far larger than the engine needs; past about this width the
      // extra pixels only cost time.
      const scale = Math.min(1, PHOTO_WIDTH / Math.max(source.width, source.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(source.width * scale);
      canvas.height = Math.round(source.height * scale);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);

      const frame: Frame = {
        image: canvas,
        width: canvas.width,
        height: canvas.height,
        elementWidth: canvas.width,
        elementHeight: canvas.height,
      };

      const readings: string[] = [];
      let step = 0;
      const total = PHOTO_REGIONS.length * THRESHOLD_PASSES.length * OCR_MODES.length * TURNS.length;
      // Every quarter turn as well: a photo of a card lying on a table can come out
      // any way up, and the engine reads horizontal text and nothing else.
      for (const region of PHOTO_REGIONS) {
        for (const turn of TURNS) {
          for (const threshold of THRESHOLD_PASSES) {
          for (const mode of OCR_MODES) {
            step += 1;
            setReading(`Foto: Versuch ${step} von ${total}…`);
            const crop = cropVideoRegion(frame, region, { threshold, scale: 1, turn });
            showPreview(crop.canvas);
            const reading = await scanner.read(crop.canvas, mode, true);
            const cleaned = reading.text.replace(/\s+/g, '');
            if (cleaned) readings.push(cleaned.slice(0, 30));

            // A photo is sharp enough that a repaired digit is a real near miss and
            // not the noise the continuous scan produces, so repairs are allowed.
            const match = matchPasscode(reading.text, db, { repair: true });
            if (!match) continue;

            let setCode: string | null = null;
            try {
              const found = await readSetCode(frame, crop, match.card, scanner, null, turn);
              setCode = found?.code ?? null;
            } catch {
              // A missing set code is a detail, not a failed scan.
            }
            memory.current = NO_MEMORY;
            setReading(null);
            record({ card: match.card, setCode }, match.exact);
            return;
          }
          }
        }
      }
      setReading(readings.length > 0 ? `gelesen: ${readings.join(' / ').slice(0, 120)}` : 'nichts lesbar im Foto');
      setFeedback(
        'Auf dem Foto war keine bekannte Nummer zu finden. Näher ran, so dass die Karte das Bild füllt, und die Nummer scharf ist.',
      );
    } catch (photoError) {
      setFeedback(`Foto konnte nicht gelesen werden: ${photoError instanceof Error ? photoError.message : String(photoError)}`);
    } finally {
      setWorking(false);
    }
  }

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

  const kept = entries.filter((entry) => !entry.undone);
  const counted = kept.length;

  /**
   * Closing reports what the session was worth. A stack session is half an hour of
   * work; ending it on a blank screen makes it feel like nothing happened.
   */
  function finish() {
    const cents = kept.reduce((sum, entry) => sum + entry.result.card.priceCents, 0);
    if (counted > 0) onSummary?.(`${counted} Karten erfasst · ${formatEuro(cents)}`);
    onClose();
  }
  /*
   * The outline is drawn from the same rectangle the crops are cut from, so the two
   * cannot drift apart. They did twice, and both times the scanner was reading a part
   * of the picture the user was not aiming at.
   */
  const box = guideBox(video.current?.clientWidth ?? 0, video.current?.clientHeight ?? 0);
  const outline = {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.width * 100}%`,
    height: `${box.height * 100}%`,
  };

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
            {/* The whole card, not just its bottom: the set code sits in the opposite
                corner from the passcode, and the rarity is read off the name and the
                artwork. Everything the scanner needs is inside this outline — and it
                lies the way the cards do, so it is an instruction and not a puzzle. */}
            <div className="scanguide" style={outline} />
          </div>

          <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
            {auto
              ? 'Am sichersten: „Foto aufnehmen" — die Kamera-App stellt scharf und liefert ein vielfach schärferes Bild als die Vorschau. Karte formatfüllend fotografieren. Der Live-Scan im Kasten läuft nebenher weiter.'
              : 'Am sichersten: „Foto aufnehmen", Karte formatfüllend. Sonst untere Kartenkante nah in den Kasten halten.'}
          </p>

          <div className="row">
            <button
              className="primary"
              onClick={() => photo.current?.click()}
              disabled={engine !== 'ready' || working}
            >
              {working ? 'Lese…' : 'Foto aufnehmen'}
            </button>
            <button onClick={capture} disabled={status !== 'ready' || engine === 'failed'}>
              Bild jetzt prüfen
            </button>
            <button onClick={() => setAuto((value) => !value)}>{auto ? 'Auto-Scan aus' : 'Auto-Scan an'}</button>
            {torchAvailable && <button onClick={toggleTorch}>{torch ? 'Licht aus' : 'Licht an'}</button>}
            <button onClick={() => setSound((value) => !value)}>{sound ? 'Ton aus' : 'Ton an'}</button>
            <button onClick={() => setTurnSeen((value) => TURNS[(TURNS.indexOf(value) + 1) % TURNS.length]!)}>
              {turnSeen === 0 ? 'Karte liegt quer?' : `Quer: ${turnSeen}°`}
            </button>
            <button onClick={() => setDetectRarity((value) => !value)}>
              {detectRarity ? 'Rarity-Erkennung aus' : 'Rarity-Erkennung an'}
            </button>
            <button onClick={finish}>Fertig</button>
          </div>

          {/* Quarter-turned cards are unreadable to the engine until the crop is
              turned with them, so which way they lie is worth stating. */}
          {/* A rarity collection is one rarity from front to back; saying so once
              saves the rest of the taps. */}
          {sessionRarity && (
            <div className="notice" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>Alle Karten dieser Sitzung: {sessionRarity}</span>
              <button className="link" onClick={() => setSessionRarity(null)}>
                aufheben
              </button>
            </div>
          )}

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
          {setReadingText && (
            <p className="muted scanreading" title={setReadingText}>
              {setReadingText}
            </p>
          )}
          <canvas ref={preview} className="scanpreview" />

          {/* The camera app rather than the live preview: it focuses, meters and hands
              back the full sensor, where the number is sharp and many times larger. */}
          <input
            ref={photo}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void scanPhoto(file);
            }}
          />

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
                  <span className={entry.undone ? 'muted struck' : undefined} style={{ minWidth: 0, flex: 1 }}>
                    {displayName(entry.result.card)}
                    {entry.result.setCode && <span className="muted"> · {entry.result.setCode}</span>}
                    {entry.result.rarity && <span className="muted"> · {entry.result.rarity}</span>}
                    {entry.detected && <span className="muted"> · erkannt</span>}
                    {!entry.exact && <span className="muted"> · unsicher</span>}
                    {/* No set code read: the card's own sets are a short list, and one
                        tap beats hunting for the card in the collection later. */}
                    {!entry.undone && entry.sets.length > 0 && (
                      <span className="filters" style={{ marginTop: 4 }}>
                        <span className="muted" style={{ fontSize: 12 }}>Set?</span>
                        {entry.sets.map((code) => (
                          <button key={code} className="chip" onClick={() => chooseSet(entry, code)}>
                            {code}
                          </button>
                        ))}
                      </span>
                    )}
                    {/* Only asked when the card exists at several rarities in that
                        set, and then best guess first. */}
                    {!entry.undone && entry.choices.length > 0 && (
                      <span className="filters" style={{ marginTop: 4 }}>
                        {entry.choices.map((rarity) => (
                          <button
                            key={rarity}
                            className="chip"
                            aria-pressed={entry.result.rarity === rarity}
                            onClick={() => chooseRarity(entry, rarity)}
                          >
                            {rarity}
                          </button>
                        ))}
                        {entry.result.rarity && entry.result.rarity !== sessionRarity && (
                          <button className="chip" onClick={() => setSessionRarity(entry.result.rarity ?? null)}>
                            merken
                          </button>
                        )}
                        {/* The prices per rarity are not in our data — see
                            src/lib/market.ts — so this goes where they are. */}
                        <a
                          className="chip"
                          href={cardmarketUrl(entry.result.card)}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          Preise ↗
                        </a>
                      </span>
                    )}
                  </span>
                  {!entry.undone && (
                    <span className="num" style={{ display: 'flex', gap: 8 }}>
                      {/* Three of the same card is one scan and a tap, not three
                          passes in front of the lens. */}
                      <button className="link" onClick={() => again(entry)}>
                        +1
                      </button>
                      {onUndo && (
                        <button className="link" onClick={() => undo(entry)}>
                          Undo
                        </button>
                      )}
                    </span>
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
