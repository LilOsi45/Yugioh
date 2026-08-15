import { useEffect, useMemo, useRef, useState } from 'react';

export interface VirtualWindow {
  /** First item to render. */
  start: number;
  /** One past the last item to render. */
  end: number;
  /** Pixels of spacer above the rendered slice. */
  paddingTop: number;
  /** Pixels of spacer below it. */
  paddingBottom: number;
}

/** Index of the first offset strictly greater than `value`, minus one. */
function findIndex(offsets: number[], value: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((offsets[mid] ?? 0) <= value) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Renders only the rows that are on screen.
 *
 * A collection of a couple of thousand cards puts the same number of rows in the
 * DOM, and every sort or keystroke rebuilds all of them — measured at 64 seconds to
 * switch sort order. Keeping a window of a few dozen rows makes that constant.
 *
 * Virtualises against the page scroll rather than an inner scroll container: a
 * nested scrolling box inside a phone page is unpleasant to use.
 */
export function useVirtualList(heights: number[], overscan = 8) {
  const ref = useRef<HTMLDivElement>(null);
  const [window_, setWindow] = useState<VirtualWindow>({ start: 0, end: 0, paddingTop: 0, paddingBottom: 0 });

  // Prefix sums: offsets[i] is where item i starts, offsets[n] is the full height.
  const offsets = useMemo(() => {
    const acc: number[] = new Array(heights.length + 1);
    acc[0] = 0;
    for (let i = 0; i < heights.length; i += 1) acc[i + 1] = (acc[i] ?? 0) + (heights[i] ?? 0);
    return acc;
  }, [heights]);

  useEffect(() => {
    const total = offsets[offsets.length - 1] ?? 0;
    const count = offsets.length - 1;

    function update() {
      const element = ref.current;
      if (!element || count === 0) {
        setWindow({ start: 0, end: 0, paddingTop: 0, paddingBottom: 0 });
        return;
      }
      const listTop = element.getBoundingClientRect().top + globalThis.scrollY;
      const viewTop = globalThis.scrollY - listTop;
      const viewBottom = viewTop + globalThis.innerHeight;

      const start = Math.max(0, findIndex(offsets, viewTop) - overscan);
      const end = Math.min(count, findIndex(offsets, viewBottom) + 1 + overscan);
      setWindow({
        start,
        end,
        paddingTop: offsets[start] ?? 0,
        paddingBottom: Math.max(0, total - (offsets[end] ?? total)),
      });
    }

    update();
    globalThis.addEventListener('scroll', update, { passive: true });
    globalThis.addEventListener('resize', update);
    return () => {
      globalThis.removeEventListener('scroll', update);
      globalThis.removeEventListener('resize', update);
    };
  }, [offsets, overscan]);

  return { ref, ...window_ };
}
