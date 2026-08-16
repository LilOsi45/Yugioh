import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

/**
 * Puts the text recognition engine next to the app instead of loading it from a CDN.
 *
 * Two reasons, in order of how much they matter here:
 *
 *  1. **Offline.** The service worker can only cache same-origin files. Served from
 *     jsdelivr, the engine is a network dependency every time the browser's own
 *     cache expires — and scanning cards happens in shops and at tournaments, which
 *     is exactly where the signal is worst.
 *  2. One less third party in the path of the app working at all.
 *
 * Run alongside `fetch-data`; the output is gitignored for the same reason the card
 * data is — it is generated, several megabytes, and would bloat every refresh.
 */

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'ocr');

/**
 * The worker, plus every core build tesseract might choose between. It picks by CPU
 * features at runtime — SIMD where available, plain elsewhere — so shipping only one
 * would break the phones that need a different one. Only the `lstm` builds are taken:
 * the app runs the LSTM engine, and the legacy builds would double the size for
 * nothing.
 */
const FROM_MODULES: [from: string, to: string][] = [
  ['tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ...['', 'simd-', 'relaxedsimd-'].flatMap((variant) =>
    ['js', 'wasm', 'wasm.js'].map(
      (extension): [string, string] => [
        `tesseract.js-core/tesseract-core-${variant}lstm.${extension}`,
        `tesseract-core-${variant}lstm.${extension}`,
      ],
    ),
  ),
];

/**
 * The trained data is not an npm dependency of this project, so it is downloaded —
 * from the same place tesseract.js would have fetched it at runtime.
 *
 * Two candidates because the library picks between them by whether it is running
 * LSTM-only, and getting it wrong here would break the deploy rather than fail
 * quietly. The smaller LSTM build is preferred; the full one is the fallback.
 */
const LANG_URLS = [
  'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz',
];

async function copyFromModules(): Promise<number> {
  let bytes = 0;
  for (const [from, to] of FROM_MODULES) {
    const source = join(here, '..', 'node_modules', from);
    await copyFile(source, join(OUT, to));
    bytes += (await stat(source)).size;
  }
  return bytes;
}

async function downloadLanguage(): Promise<{ bytes: number; url: string }> {
  const target = join(OUT, 'eng.traineddata.gz');
  const failures: string[] = [];

  for (const url of LANG_URLS) {
    const response = await fetch(url).catch((error: unknown) => {
      failures.push(`${url} → ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (!response) continue;
    if (!response.ok || !response.body) {
      failures.push(`${url} → ${response.status} ${response.statusText}`);
      continue;
    }
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(target),
    );
    return { bytes: (await stat(target)).size, url };
  }

  throw new Error(`No language data could be fetched:\n  ${failures.join('\n  ')}`);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  console.log('Fetching text recognition engine...');
  const copied = await copyFromModules();
  console.log(`  copied ${FROM_MODULES.length} files from node_modules`);
  const language = await downloadLanguage();
  console.log(`  GET ${language.url}`);
  console.log(`Wrote ${OUT}`);
  console.log(
    `  ${((copied + language.bytes) / 1e6).toFixed(1)} MB on disk; a phone downloads one core build, once`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
