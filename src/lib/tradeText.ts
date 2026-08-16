import { displayName } from './dataset';
import type { CardNeed } from './setFinder';
import type { CardCount } from './stats';

/**
 * Lists as plain text, in the `3x Card Name` shape that Cardmarket's want-list
 * import and every trading group chat understand.
 *
 * English names on purpose: a want list is read by strangers, and the English name
 * is the one that is unambiguous across countries. The German name is what the app
 * shows *you*; this is what you hand to someone else.
 */
export function needsAsText(needs: readonly CardNeed[]): string {
  return needs
    .filter((need) => need.needed > 0)
    .map((need) => `${need.needed}x ${need.card.name}`)
    .join('\n');
}

export function sparesAsText(spares: readonly CardCount[]): string {
  return spares.map((spare) => `${spare.count}x ${spare.card.name}`).join('\n');
}

/** The same, with the name you see in the app — for your own notes. */
export function sparesAsLocalText(spares: readonly CardCount[]): string {
  return spares.map((spare) => `${spare.count}x ${displayName(spare.card)}`).join('\n');
}

/**
 * Puts text on the clipboard, reporting whether it worked.
 *
 * A refusal is normal rather than exceptional: browsers block the clipboard outside
 * a user gesture, and iOS refuses it outright in some contexts. The caller shows the
 * text for copying by hand instead of pretending it succeeded.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
