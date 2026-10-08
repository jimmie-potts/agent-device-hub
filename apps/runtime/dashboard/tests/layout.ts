// Layout checks the browser suites share (Hub #277), on the runtime's dashboard (Hub #922).
import type {Page} from 'playwright';

/** Visible text blocks in the open view whose boxes overlap, as short labels; an empty list means none do. Ancestors and descendants are not compared. */
export function textOverlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Content of a closed disclosure is not rendered; only its summary is.
    const folded = (element: Element): boolean => {
      const details = element.closest('details:not([open])');
      return details !== null && details.querySelector(':scope>summary')?.contains(element) !== true;
    };
    const blocks = [...document.querySelectorAll<HTMLElement>('main section p, main section h2, main section h3, main section dt, main section dd, main section label, main section button, main section a, main section summary')]
      .filter(element => element.offsetParent !== null && !folded(element) && element.getBoundingClientRect().height > 1 && (element.textContent ?? '').trim() !== '');
    const found: string[] = [];
    blocks.forEach((a, i) => {
      for (const b of blocks.slice(i + 1)) {
        if (a.contains(b) || b.contains(a)) continue;
        const r = a.getBoundingClientRect();
        const q = b.getBoundingClientRect();
        if (Math.min(r.right, q.right) - Math.max(r.left, q.left) > 1 && Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top) > 1) {
          found.push(`${(a.textContent ?? '').trim().slice(0, 32)} × ${(b.textContent ?? '').trim().slice(0, 32)}`);
        }
      }
    });
    return found;
  });
}

/** How far across the main column the open view's visible controls reach, as a fraction of its width. */
export function controlReach(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.getElementById('main')?.getBoundingClientRect();
    if (main === undefined) return 0;
    const controls = [...document.querySelectorAll<HTMLElement>('main section:not([hidden]) select, main section:not([hidden]) input, main section:not([hidden]) button')]
      .filter(element => element.offsetParent !== null);
    const right = Math.max(main.left, ...controls.map(element => element.getBoundingClientRect().right));
    return Math.round(100 * (right - main.left) / main.width) / 100;
  });
}
