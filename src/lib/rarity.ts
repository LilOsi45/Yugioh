/**
 * Reading the rarity off the card the way a person does: by how it looks.
 *
 * The printed code cannot answer it — measured against the live data, a card printed
 * at seven rarities carries `RA04-EN087` all seven times. The print itself does
 * differ, and in ways a camera can measure:
 *
 * | what               | tells apart                                  |
 * |--------------------|----------------------------------------------|
 * | black name         | Common, Super Rare                           |
 * | silver foil name   | Rare, Secret Rare and its variants           |
 * | gold foil name     | Ultra Rare, Ultimate Rare, Collector's Rare  |
 * | foil in the artwork| Super/Ultra/Secret against Common/Rare       |
 *
 * The point that makes this workable at all: the card and the set are already known
 * when this runs, so the answer is one of a handful of listed rarities, not one of
 * fifty. Common against Super Rare — the everyday booster question — comes down to a
 * single yes/no.
 *
 * What it deliberately does **not** do is separate what the light cannot: Ultra from
 * Ultimate (embossing, not colour) or Secret from Platinum Secret from Quarter
 * Century (foil texture). Those tie, and a tie means the app asks instead of guessing.
 */

/** Just enough of `ImageData` to be built by hand in a test. */
export interface Pixels {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface Look {
  /** Share of the name's glyphs that are much darker than the strip around them. */
  nameDark: number;
  /** Share that is warm and more saturated than their surroundings — gold foil. */
  nameGold: number;
  /** Share that is bright and colourless — silver foil. */
  nameSilver: number;
  /** How much the artwork behaves like foil rather than ink, 0..1. */
  artHolo: number;
  /** Mean colourfulness of the artwork, kept so several frames can be compared. */
  artChroma: number;
}

export const NEUTRAL_LOOK: Look = {
  nameDark: 0,
  nameGold: 0,
  nameSilver: 0,
  artHolo: 0,
  artChroma: 0,
};

/**
 * The card text box is the same pale cream on every card ever printed, which makes it
 * a known colour in an unknown light. Correcting it back to this removes the camera's
 * white balance and the colour of the room — without which warm lamplight on silver
 * foil reads as gold.
 */
const TEXTBOX_REFERENCE = { r: 232, g: 226, b: 208 };

/** Correction is a nudge, not a repaint: a wild gain means the sample was not the box. */
const MAX_GAIN = 1.8;
const MIN_GAIN = 0.55;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Gain {
  r: number;
  g: number;
  b: number;
}

export const NO_GAIN: Gain = { r: 1, g: 1, b: 1 };

function clampGain(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(MAX_GAIN, Math.max(MIN_GAIN, value));
}

/** The per-channel correction that puts the sampled text box back on its known colour. */
export function whiteBalance(textbox: Pixels): Gain {
  const mean = meanColour(textbox);
  if (mean.r <= 0 || mean.g <= 0 || mean.b <= 0) return NO_GAIN;
  return {
    r: clampGain(TEXTBOX_REFERENCE.r / mean.r),
    g: clampGain(TEXTBOX_REFERENCE.g / mean.g),
    b: clampGain(TEXTBOX_REFERENCE.b / mean.b),
  };
}

function meanColour(pixels: Pixels): Rgb {
  const { data } = pixels;
  const count = Math.floor(data.length / 4);
  if (count === 0) return { r: 0, g: 0, b: 0 };
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < count; i += 1) {
    r += data[i * 4] ?? 0;
    g += data[i * 4 + 1] ?? 0;
    b += data[i * 4 + 2] ?? 0;
  }
  return { r: r / count, g: g / count, b: b / count };
}

function luminance(colour: Rgb): number {
  return colour.r * 0.299 + colour.g * 0.587 + colour.b * 0.114;
}

/** Saturation as a share of brightness, so a dark red is as colourful as a light one. */
function saturation(colour: Rgb): number {
  const max = Math.max(colour.r, colour.g, colour.b);
  const min = Math.min(colour.r, colour.g, colour.b);
  return max <= 0 ? 0 : (max - min) / max;
}

/** Hue in degrees, 0 = red, 60 = yellow. Undefined for grey, reported as -1. */
function hue(colour: Rgb): number {
  const max = Math.max(colour.r, colour.g, colour.b);
  const min = Math.min(colour.r, colour.g, colour.b);
  const span = max - min;
  if (span <= 0) return -1;
  let value: number;
  if (max === colour.r) value = ((colour.g - colour.b) / span) % 6;
  else if (max === colour.g) value = (colour.b - colour.r) / span + 2;
  else value = (colour.r - colour.g) / span + 4;
  return ((value * 60) % 360 + 360) % 360;
}

function corrected(data: ArrayLike<number>, index: number, gain: Gain): Rgb {
  return {
    r: Math.min(255, (data[index] ?? 0) * gain.r),
    g: Math.min(255, (data[index + 1] ?? 0) * gain.g),
    b: Math.min(255, (data[index + 2] ?? 0) * gain.b),
  };
}

/**
 * Which pixels of the name strip are the letters.
 *
 * Not by colour — the strip behind the name is orange on a monster, green on a spell,
 * and any of a dozen shades on the newer frames, so no fixed rule fits. What holds
 * everywhere is that the letters are the *minority that differs most* from whatever
 * the strip happens to be. So the background is taken as the strip's median colour
 * and the letters as the pixels furthest from it.
 */
const GLYPH_SHARE = 0.22;

/** Gold has to be clearly warmer and more colourful than the strip it sits on. */
const GOLD_HUE = { from: 18, to: 80 };
const GOLD_MIN_SATURATION = 0.17;
const GOLD_OVER_BACKGROUND = 1.15;

/** Silver is the opposite: brighter than the strip and nearly colourless. */
const SILVER_MAX_SATURATION = 0.17;
const SILVER_MIN_BRIGHTNESS = 1.02;

/** Black print, against the strip's own brightness rather than an absolute value. */
const DARK_BELOW_BACKGROUND = 0.68;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

interface NameLook {
  dark: number;
  gold: number;
  silver: number;
}

function measureName(name: Pixels, gain: Gain): NameLook {
  const count = Math.floor(name.data.length / 4);
  if (count < 16) return { dark: 0, gold: 0, silver: 0 };

  const colours: Rgb[] = [];
  for (let i = 0; i < count; i += 1) colours.push(corrected(name.data, i * 4, gain));

  const background: Rgb = {
    r: median(colours.map((colour) => colour.r)),
    g: median(colours.map((colour) => colour.g)),
    b: median(colours.map((colour) => colour.b)),
  };
  const backgroundLuma = luminance(background);
  const backgroundSaturation = saturation(background);

  const distances = colours.map(
    (colour) =>
      Math.abs(colour.r - background.r) +
      Math.abs(colour.g - background.g) +
      Math.abs(colour.b - background.b),
  );
  const ranked = [...distances].sort((a, b) => b - a);
  const cut = ranked[Math.max(0, Math.floor(ranked.length * GLYPH_SHARE) - 1)] ?? 0;

  let glyphs = 0;
  let dark = 0;
  let gold = 0;
  let silver = 0;
  for (let i = 0; i < colours.length; i += 1) {
    if ((distances[i] ?? 0) < cut) continue;
    const colour = colours[i]!;
    glyphs += 1;
    const luma = luminance(colour);
    const sat = saturation(colour);
    const tone = hue(colour);
    if (luma < backgroundLuma * DARK_BELOW_BACKGROUND) {
      dark += 1;
    } else if (
      sat >= Math.max(GOLD_MIN_SATURATION, backgroundSaturation * GOLD_OVER_BACKGROUND) &&
      tone >= GOLD_HUE.from &&
      tone <= GOLD_HUE.to
    ) {
      gold += 1;
    } else if (sat <= SILVER_MAX_SATURATION && luma >= backgroundLuma * SILVER_MIN_BRIGHTNESS) {
      silver += 1;
    }
  }

  if (glyphs === 0) return { dark: 0, gold: 0, silver: 0 };
  return { dark: dark / glyphs, gold: gold / glyphs, silver: silver / glyphs };
}

/**
 * How much the artwork looks like foil.
 *
 * Printed artwork at arm's length is smooth: the camera blurs fine detail, so colour
 * changes gradually from pixel to pixel. Holographic foil does the opposite — it
 * scatters light into a fine rainbow grain, so neighbouring pixels differ in *hue*,
 * not just brightness. Measuring that high-frequency colour change separates the two
 * without needing to know what the picture shows.
 *
 * This is the weaker of the two signals, which is why it counts for less in the
 * scoring below and why "Common or Super Rare?" is allowed to end in a question.
 */
const HOLO_GRAIN_FULL = 26;

function measureArt(art: Pixels, gain: Gain): { holo: number; chroma: number } {
  const { width, height, data } = art;
  if (width < 4 || height < 4) return { holo: 0, chroma: 0 };

  let chromaSum = 0;
  let samples = 0;
  const grains: number[] = [];

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const here = corrected(data, (y * width + x) * 4, gain);
      const right = corrected(data, (y * width + x + 1) * 4, gain);
      const below = corrected(data, ((y + 1) * width + x) * 4, gain);
      chromaSum += saturation(here);
      samples += 1;

      // Colour difference that is not just a brightness step: an edge in the picture
      // changes both, foil grain shifts the colour while staying about as bright.
      for (const other of [right, below]) {
        const brightness = Math.abs(luminance(here) - luminance(other));
        const colourStep =
          (Math.abs(here.r - other.r) + Math.abs(here.g - other.g) + Math.abs(here.b - other.b)) / 3;
        grains.push(Math.max(0, colourStep - brightness));
      }
    }
  }

  if (samples === 0) return { holo: 0, chroma: 0 };
  grains.sort((a, b) => b - a);
  const strongest = grains.slice(0, Math.max(1, Math.floor(grains.length * 0.1)));
  const grain = strongest.reduce((sum, value) => sum + value, 0) / strongest.length;

  return {
    holo: Math.min(1, grain / HOLO_GRAIN_FULL),
    chroma: chromaSum / samples,
  };
}

/** Measures one frame. */
export function measureLook(name: Pixels, art: Pixels, textbox: Pixels): Look {
  const gain = whiteBalance(textbox);
  const glyphs = measureName(name, gain);
  const artwork = measureArt(art, gain);
  return {
    nameDark: glyphs.dark,
    nameGold: glyphs.gold,
    nameSilver: glyphs.silver,
    artHolo: artwork.holo,
    artChroma: artwork.chroma,
  };
}

/** How much the artwork's colourfulness must swing between frames to count as foil. */
const FLICKER_FULL = 0.06;

/**
 * Averages several frames of the same card, and uses the fact that they were taken at
 * slightly different angles.
 *
 * Foil is directional: tilt the card a little and the highlights move and change
 * colour, while ink stays exactly as it was. Handheld, "a little" happens by itself
 * between two frames 70 ms apart, so the swing between the samples is evidence in its
 * own right — and it also averages out a single unlucky frame.
 */
export function combineLooks(looks: Look[]): Look {
  if (looks.length === 0) return NEUTRAL_LOOK;
  const mean = (pick: (look: Look) => number): number =>
    looks.reduce((sum, look) => sum + pick(look), 0) / looks.length;

  const chromas = looks.map((look) => look.artChroma);
  const flicker = Math.min(1, (Math.max(...chromas) - Math.min(...chromas)) / FLICKER_FULL);

  return {
    nameDark: mean((look) => look.nameDark),
    nameGold: mean((look) => look.nameGold),
    nameSilver: mean((look) => look.nameSilver),
    artHolo: Math.min(1, Math.max(mean((look) => look.artHolo), flicker)),
    artChroma: mean((look) => look.artChroma),
  };
}

interface Expectation {
  nameDark: number;
  nameGold: number;
  nameSilver: number;
  artHolo: number;
}

/**
 * What each rarity should look like. Rarities that share a row are genuinely
 * indistinguishable by colour — they are meant to tie.
 */
const LOOKS: Record<string, Expectation> = {
  common: { nameDark: 0.8, nameGold: 0.05, nameSilver: 0.05, artHolo: 0.1 },
  'short print': { nameDark: 0.8, nameGold: 0.05, nameSilver: 0.05, artHolo: 0.1 },
  'super short print': { nameDark: 0.8, nameGold: 0.05, nameSilver: 0.05, artHolo: 0.1 },
  rare: { nameDark: 0.1, nameGold: 0.05, nameSilver: 0.7, artHolo: 0.1 },
  'super rare': { nameDark: 0.8, nameGold: 0.05, nameSilver: 0.05, artHolo: 0.85 },
  'ultra rare': { nameDark: 0.1, nameGold: 0.7, nameSilver: 0.05, artHolo: 0.85 },
  'ultimate rare': { nameDark: 0.1, nameGold: 0.7, nameSilver: 0.05, artHolo: 0.85 },
  "collector's rare": { nameDark: 0.1, nameGold: 0.6, nameSilver: 0.15, artHolo: 0.9 },
  'ghost rare': { nameDark: 0.1, nameGold: 0.05, nameSilver: 0.7, artHolo: 0.9 },
  'secret rare': { nameDark: 0.1, nameGold: 0.05, nameSilver: 0.7, artHolo: 0.9 },
  'prismatic secret rare': { nameDark: 0.1, nameGold: 0.05, nameSilver: 0.7, artHolo: 0.9 },
  'platinum secret rare': { nameDark: 0.1, nameGold: 0.05, nameSilver: 0.7, artHolo: 0.9 },
  'quarter century secret rare': { nameDark: 0.1, nameGold: 0.05, nameSilver: 0.7, artHolo: 0.9 },
  'starlight rare': { nameDark: 0.1, nameGold: 0.05, nameSilver: 0.7, artHolo: 0.9 },
  'gold rare': { nameDark: 0.1, nameGold: 0.75, nameSilver: 0.05, artHolo: 0.5 },
  'premium gold rare': { nameDark: 0.1, nameGold: 0.75, nameSilver: 0.05, artHolo: 0.6 },
};

/**
 * How much each measurement is trusted. The name is print, and print is the same in
 * every light once the white balance is undone; the artwork signal has to survive
 * whatever the picture itself happens to show, so it counts for half.
 */
const WEIGHTS: Expectation = { nameDark: 1, nameGold: 1, nameSilver: 1, artHolo: 0.5 };

/** Distance below which the leader is not a leader, and the app asks instead. */
export const MIN_MARGIN = 0.16;

/**
 * What a rarity this table has never heard of scores.
 *
 * Deliberately in between: high enough that it cannot be beaten by the small margin
 * that decides things automatically — an unlisted rarity in the running means the app
 * asks — and low enough that a well matched, listed rarity still comes first.
 */
const UNKNOWN_SCORE = 0.75;

/** Rarity names carry set-specific suffixes; the look is decided by the base name. */
export function normalizeRarity(rarity: string): string {
  return rarity
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface RarityGuess {
  rarity: string;
  /** 0..1, higher is a better fit. */
  score: number;
}

/**
 * Scores the card's possible rarities against what was measured.
 *
 * The distance is rooted rather than left squared, so the numbers stay on the same
 * scale as the measurements themselves. That matters for the one decision that hangs
 * on it: whether the leader is far enough ahead to be taken without asking.
 */
export function rankRarities(candidates: string[], look: Look): RarityGuess[] {
  const total = WEIGHTS.nameDark + WEIGHTS.nameGold + WEIGHTS.nameSilver + WEIGHTS.artHolo;
  return candidates
    .map((rarity) => {
      const expectation = LOOKS[normalizeRarity(rarity)];
      if (!expectation) return { rarity, score: UNKNOWN_SCORE };
      const error =
        WEIGHTS.nameDark * (look.nameDark - expectation.nameDark) ** 2 +
        WEIGHTS.nameGold * (look.nameGold - expectation.nameGold) ** 2 +
        WEIGHTS.nameSilver * (look.nameSilver - expectation.nameSilver) ** 2 +
        WEIGHTS.artHolo * (look.artHolo - expectation.artHolo) ** 2;
      return { rarity, score: Math.max(0, 1 - Math.sqrt(error / total)) };
    })
    .sort((a, b) => b.score - a.score || a.rarity.localeCompare(b.rarity));
}

export interface RarityDecision {
  /** Taken automatically only when one candidate is clearly ahead. */
  rarity: string | null;
  /** All candidates, best first — the order the chips are offered in. */
  ranked: RarityGuess[];
}

/**
 * Decides, or declines to.
 *
 * A single candidate needs no measurement. Otherwise the leader must be ahead by
 * `MIN_MARGIN`; below that the app keeps quiet and leaves the choice, because a
 * wrongly recorded rarity is worse than an unanswered question — it looks like data.
 */
export function decideRarity(candidates: string[], look: Look): RarityDecision {
  if (candidates.length === 0) return { rarity: null, ranked: [] };
  const ranked = rankRarities(candidates, look);
  const [best, second] = ranked;
  if (!best) return { rarity: null, ranked };
  if (!second) return { rarity: best.rarity, ranked };
  return { rarity: best.score - second.score >= MIN_MARGIN ? best.rarity : null, ranked };
}
