// Shared by home-shapes.browser.ts and home-idle.browser.ts (#1672 F18): what changes inside Home's list cards while
// nobody acts.
import type {Page} from 'playwright/test';

/**
 * Every DOM change inside each Inbox, Agent sessions and Timeline card on the Home grid during `ms` idle milliseconds:
 * children, text and each attribute write that changes the attribute's value, even when a later write restores it (a
 * render loop that ends where it began still counts). A write of the value the attribute already had is not a change
 * and is left out wherever it happens. The shell's one-second clock is not paging and is left out too: it counts up a
 * session's "Last evidence" age. `cards` names other cards to watch instead, each by its id or an id prefix (#1672 PR B).
 */
export async function idleChanges(page: Page, ms = 2000, cards: readonly string[] = ['inbox', 'sessions', 'timeline']): Promise<string[]> {
  return page.evaluate(async ({ms, watched}) => {
    const cards = [...document.querySelectorAll<HTMLElement>('.home-layout-grid > [data-home-card]')].filter(card => watched.some(id => (card.dataset.homeCard ?? '').startsWith(id)) && (card.dataset.homeCard ?? '') !== '');
    const changes: string[] = [];
    // Each element's attribute writes in order: a write's new value is the next write's old value, or the value at the end.
    const writes = new Map<Element, Map<string, {before: string | null; label: string}[]>>();
    const label = (card: HTMLElement, target: Element | null, what: string): string => `${card.dataset.homeCard ?? ''}: ${what} on ${target?.tagName.toLowerCase() ?? '?'}.${String(target?.className ?? '').slice(0, 40)}`;
    const observers = cards.map(card => {
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (record.type === 'characterData' && target?.closest('.agent-evidence') !== null) continue;
          if (record.type === 'attributes' && record.attributeName !== null && target !== null) {
            const byName = writes.get(target) ?? new Map<string, {before: string | null; label: string}[]>();writes.set(target, byName);
            const list = byName.get(record.attributeName) ?? [];byName.set(record.attributeName, list);
            list.push({before: record.oldValue, label: label(card, target, `attributes ${record.attributeName}`)});
            continue;
          }
          changes.push(label(card, target, record.type));
        }
      });
      observer.observe(card, {subtree: true, childList: true, attributes: true, attributeOldValue: true, characterData: true});return observer;
    });
    await new Promise(resolve => setTimeout(resolve, ms));
    for (const observer of observers) observer.disconnect();
    for (const [target, byName] of writes) for (const [attribute, list] of byName) for (const [index, write] of list.entries()) {
      const after = index + 1 < list.length ? list[index + 1]?.before ?? null : target.getAttribute(attribute);
      if (after !== write.before) changes.push(write.label);
    }
    return changes;
  }, {ms, watched: cards});
}
