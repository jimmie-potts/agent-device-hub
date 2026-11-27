// The journeys' record of contained card faults (Hub #2139). A card the page contained leaves the page mounted, so a
// journey's later assertions no longer fail on a blank page. The first `feed()` on a page starts this watch: an observer in
// the page reports each failure as it happens, through a binding, to this process, which keeps it with its page. The
// world's `close()`, which every journey calls at its end, fails the run on any failure no health check reported and the
// journey did not expect. A page that never calls `feed()` or `copiesSynced()` is not watched: the harness does not see
// the browser contexts a journey opens, so it has no one place to start the watch for them. The record is taken when the fault happens, so it holds after the page or its browser closes.
//
// A failure is a rise of a boundary's `data-fault-count` (card-boundary.tsx), which counts the failures it recorded, so
// each failure is reported once: a failed face that mounts again after Retry shows its earlier count first, and a face
// already failed when the watch starts is reported once. The observer only reads that attribute and its element's
// `data-card-failed` and `data-error-type`; the one thing it adds to the page is the binding and a flag on `globalThis`.
import type {Page} from 'playwright';

type Fault = {readonly page: Page; readonly card: string; readonly type: string; reported: boolean};

const faults: Fault[] = [];
const watched = new WeakSet<Page>();
const expected = new WeakMap<Page, Set<string>>();
const BINDING = 'bunnyCardFailed';

/** Runs in the page: reports each failure from now on, and once each face that has already failed. */
function observe(binding: string): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope.bunnyCardWatch === true) return;
  scope.bunnyCardWatch = true;
  const report = (node: Element): void => {
    const call = scope[binding];
    if (typeof call === 'function') void (call as (card: string, type: string) => Promise<void>)(node.getAttribute('data-card-failed') ?? '', node.getAttribute('data-error-type') ?? 'unknown');
  };
  for (const node of document.querySelectorAll('[data-card-failed]')) if (Number(node.getAttribute('data-fault-count')) > 0) report(node);
  new MutationObserver(records => {
    // Several changes of one face in one batch: each record holds the value before it, the next one's, or the face's own.
    records.forEach((record, index) => {
      const node = record.target as Element, next = records.slice(index + 1).find(later => later.target === node);
      const after = next === undefined ? node.getAttribute('data-fault-count') : next.oldValue;
      if (Number(after) > Number(record.oldValue ?? 0)) report(node);
    });
  }).observe(document, {subtree: true, attributes: true, attributeFilter: ['data-fault-count'], attributeOldValue: true});
}

/** Starts recording `page`'s card faults, once per page; later documents of the page are watched from their start. */
export async function watchCards(page: Page): Promise<void> {
  if (watched.has(page)) return;
  watched.add(page);
  await page.exposeBinding(BINDING, (_source, card: string, type: string) => { faults.push({page, card, type, reported: false}); });
  await page.addInitScript(observe, BINDING);
  await page.evaluate(observe, BINDING);
}

/** The one opt-out, for a journey that fails `cards` on `page` on purpose: their failures do not fail the run. */
export function expectCardFaults(page: Page, cards: readonly string[]): void {
  const own = expected.get(page) ?? new Set<string>();
  for (const card of cards) own.add(card);
  expected.set(page, own);
}

/** Marks `page`'s recorded failures of `cards` as reported, by a health check that failed on them or expected them. */
export function cardFaultsReported(page: Page, cards: readonly string[]): void {
  for (const fault of faults) if (fault.page === page && cards.includes(fault.card)) fault.reported = true;
}

/** The recorded failures that nothing reported and no journey expected, each `card (type)` once; it marks them reported. */
export function unreportedCardFaults(): string[] {
  const late = faults.filter(fault => !fault.reported && expected.get(fault.page)?.has(fault.card) !== true);
  for (const fault of late) fault.reported = true;
  return [...new Set(late.map(fault => `${fault.card} (${fault.type})`))];
}

/**
 * Called by the world's `close()`. Any unreported failure fails the run: the line goes to standard error and the exit code
 * is 1. It does not throw, since `close()` runs in each journey's `finally` and a throw there would replace a failure
 * already on its way out; that failure stays the run's error and this line is added to it.
 */
export function failOnCardFaults(): void {
  const late = unreportedCardFaults();
  if (late.length === 0) return;
  process.exitCode = 1;
  process.stderr.write(`a card failed: ${late.join(', ')}. The page contained the error after the journey's last health check, so the journey would otherwise pass over a broken card.\n`);
}
