// Shared by home-shapes.browser.ts and home-idle.browser.ts (#1672 F18): what changes inside Home's list cards while
// nobody acts.
import type {Page} from 'playwright/test';

/**
 * Every DOM change inside each Inbox, Agent sessions and Timeline card on the Home grid during `ms` idle milliseconds:
 * children, text, and each attribute whose value at the end differs from its value at the start. An attribute written
 * again with the value it had (React's re-render of a controlled input writes `name` to "" and back, and its `type`
 * again) changes nothing on screen and is left out, wherever it happens. The shell's one-second clock is not paging and
 * is left out too: it counts up a session's "Last evidence" age. `cards` names other cards to watch instead, each by its
 * id or an id prefix (#1672 PR B).
 */
export async function idleChanges(page: Page, ms = 2000, cards: readonly string[] = ['inbox', 'sessions', 'timeline']): Promise<string[]> {
  return page.evaluate(async ({ms, watched}) => {
    const cards = [...document.querySelectorAll<HTMLElement>('.home-layout-grid > [data-home-card]')].filter(card => watched.some(id => (card.dataset.homeCard ?? '').startsWith(id)) && (card.dataset.homeCard ?? '') !== '');
    const changes: string[] = [];
    // The first value seen for each element's attribute, compared with its value when the window ends.
    const attributes = new Map<Element, Map<string, {before: string | null; label: string}>>();
    const label = (card: HTMLElement, target: Element | null, what: string): string => `${card.dataset.homeCard ?? ''}: ${what} on ${target?.tagName.toLowerCase() ?? '?'}.${String(target?.className ?? '').slice(0, 40)}`;
    const observers = cards.map(card => {
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (record.type === 'characterData' && target?.closest('.agent-evidence') !== null) continue;
          if (record.type === 'attributes' && record.attributeName !== null && target !== null) {
            const seen = attributes.get(target) ?? new Map<string, {before: string | null; label: string}>();attributes.set(target, seen);
            if (!seen.has(record.attributeName)) seen.set(record.attributeName, {before: record.oldValue, label: label(card, target, `attributes ${record.attributeName}`)});
            continue;
          }
          changes.push(label(card, target, record.type));
        }
      });
      observer.observe(card, {subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true});return observer;
    });
    await new Promise(resolve => setTimeout(resolve, ms));
    for (const observer of observers) observer.disconnect();
    for (const [target, seen] of attributes) for (const [attribute, value] of seen) if (target.getAttribute(attribute) !== value.before) changes.push(value.label);
    return changes;
  }, {ms, watched: cards});
}
