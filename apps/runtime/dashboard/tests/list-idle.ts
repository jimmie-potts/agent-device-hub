// Shared by home-shapes.browser.ts and home-idle.browser.ts (#1672 F18): what changes inside Home's list cards while
// nobody acts.
import type {Page} from 'playwright/test';

/**
 * Every DOM change inside each Inbox, Agent sessions and Timeline card on the Home grid during `ms` idle milliseconds:
 * attributes, children and text. The shell's one-second clock is not paging and is left out: it counts up a session's
 * "Last evidence" age, and React's re-render of the controlled find field rewrites that input's name and type to the
 * values they already had. `cards` names other cards to watch instead, each by its id or an id prefix (#1672 PR B).
 */
export async function idleChanges(page: Page, ms = 2000, cards: readonly string[] = ['inbox', 'sessions', 'timeline']): Promise<string[]> {
  return page.evaluate(async ({ms, watched}) => {
    const cards = [...document.querySelectorAll<HTMLElement>('.home-layout-grid > [data-home-card]')].filter(card => watched.some(id => (card.dataset.homeCard ?? '').startsWith(id)) && (card.dataset.homeCard ?? '') !== '');
    const changes: string[] = [];
    const observers = cards.map(card => {
      const observer = new MutationObserver(records => {
        for (const record of records) {
          const target = record.target instanceof Element ? record.target : record.target.parentElement;
          if (record.type === 'characterData' && target?.closest('.agent-evidence') !== null) continue;
          if (record.type === 'attributes' && target instanceof HTMLInputElement && (record.attributeName === 'name' || record.attributeName === 'type')) continue;
          changes.push(`${card.dataset.homeCard ?? ''}: ${record.type}${record.attributeName === null ? '' : ` ${record.attributeName}`} on ${target?.tagName.toLowerCase() ?? '?'}.${String(target?.className ?? '').slice(0, 40)}`);
        }
      });
      observer.observe(card, {subtree: true, childList: true, attributes: true, characterData: true});return observer;
    });
    await new Promise(resolve => setTimeout(resolve, ms));
    for (const observer of observers) observer.disconnect();
    return changes;
  }, {ms, watched: cards});
}
