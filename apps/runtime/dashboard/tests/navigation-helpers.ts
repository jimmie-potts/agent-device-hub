import type {Locator, Page} from 'playwright';

/** On a phone the rail is a drawer behind the menu button (Hub #1887); open it so its links can be used. */
export async function showRail(page: Page): Promise<void> {
  const menu = page.getByRole('button', {name: 'Open navigation', exact: true});
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
}

/** A main destination's link in the rail, with the phone drawer opened when the rail is one. Devices is not a link: use `openDirectory`. */
export async function destinationLink(page: Page, name: string | RegExp): Promise<Locator> {
  await showRail(page);
  return page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', typeof name === 'string' ? {name, exact: true} : {name});
}

export async function openSettings(page: Page): Promise<void> {
  await showRail(page);
  await page.getByRole('navigation', {name: 'Utilities'}).getByRole('link', {name: 'Settings', exact: true}).click();
}

export async function openConnections(page: Page): Promise<void> {
  if (new URL(page.url()).hash === '#/connections') return;
  await openSettings(page);
  await page.getByRole('link', {name: 'Connections', exact: true}).click();
}

/** The five destinations' names in order: four links and the Devices button (Hub #1889, #1950). */
export function destinationNames(page: Page): Promise<string[]> {
  return page.getByRole('navigation', {name: 'Main navigation'}).locator('a, button').allTextContents();
}

/** The Devices row opens the menu of the configured hardware (Hub #1889, #1950). */
export async function openDeviceMenu(page: Page): Promise<Locator> {
  await showRail(page);
  const row = page.getByRole('navigation', {name: 'Main navigation'}).getByRole('button', {name: 'Devices', exact: true});
  const menu = page.getByRole('menu', {name: 'Device pages', exact: true});
  if (await row.getAttribute('aria-expanded') !== 'true') await row.click();
  await menu.waitFor();
  return menu;
}

/** Opens the Devices directory, which is behind the menu's "All devices". */
export async function openDirectory(page: Page): Promise<void> {
  await (await openDeviceMenu(page)).getByRole('menuitem', {name: 'All devices', exact: true}).click();
  await page.getByRole('heading', {name: 'Devices', level: 1, exact: true}).waitFor();
}

/** The rail's link for a chat profile (Hub #1890), with the phone drawer opened when the rail is one. */
export async function conversationLink(page: Page, profile: 'bunny' | 'reachy' | 'microduck'): Promise<Locator> {
  await showRail(page);
  return page.getByRole('navigation', {name: 'Conversations', exact: true}).locator(`a[data-profile="${profile}"]`);
}

const CONVERSATION_NAMES = {bunny: 'B.U.N.N.Y.', reachy: 'Reachy', microduck: 'MicroDuck'} as const;
/** Chooses a chat profile in the rail and waits for the Conversation page to show it. A phone's drawer closes behind the choice. */
export async function chooseConversation(page: Page, profile: keyof typeof CONVERSATION_NAMES): Promise<void> {
  const drawer = await page.getByRole('button', {name: 'Open navigation', exact: true}).isVisible();
  await (await conversationLink(page, profile)).click();
  await page.locator('.conversation-header').getByRole('heading', {name: CONVERSATION_NAMES[profile], exact: true}).waitFor();
  if (drawer) await page.locator('.shell>aside').waitFor({state: 'hidden'});
}

/** One module of the catalog the page reads. */
export type CatalogModule = {name: string; state: string; pages: {id: string}[]};
/**
 * Lets a journey change what the page reads as its module catalog. It installs one route for the page's lifetime and
 * returns a setter: pass a function to change every module the page reads from then on, or nothing to read the real
 * catalog again. The route is never removed while the page is in use. The dashboard reads its catalog again whenever
 * the runtime reports a change, so removing a route can catch a request in flight, and that request's handler then
 * fails with "Route is already handled". A reload cancels a request in flight as well; the next page asks again.
 */
export async function routeCatalog(page: Page): Promise<(change?: (module: CatalogModule) => CatalogModule) => void> {
  let current: ((module: CatalogModule) => CatalogModule) | undefined;
  await page.route('**/api/v2/modules', async route => {
    const change = current;
    try {
      const response = await route.fetch();
      if (change === undefined) {await route.fulfill({response}); return;}
      const catalog = await response.json() as {modules: CatalogModule[]};
      await route.fulfill({response, json: {...catalog, modules: catalog.modules.map(change)}});
    } catch (error) {
      // Only a request that a reload or a closing page cancelled is let go; anything else is a real failure.
      if (!page.isClosed() && !/already handled|has been closed|disposed|aborted|cancell?ed/i.test(String(error))) throw error;
    }
  });
  return change => {current = change;};
}

/** A link in one category's section of the Devices directory (Hub #1950): Displays, Lighting or Appliances. */
export async function directoryLink(page: Page, category: string, name: string): Promise<Locator> {
  await openDirectory(page);
  return page.getByRole('region', {name: category, exact: true}).getByRole('link', {name, exact: true});
}

/** Audio is under Home (Hub #1950): Home's heading links it. */
export async function openAudio(page: Page): Promise<void> {
  await (await destinationLink(page, 'Home')).click();
  await page.locator('.home-layout-heading').getByRole('link', {name: 'Audio', exact: true}).click();
}

/** Habitat is under Companions (Hub #1950): the Companions overview links it. */
export async function openHabitat(page: Page): Promise<void> {
  await (await destinationLink(page, 'Companions')).click();
  await page.getByRole('region', {name: 'Companions', exact: true}).getByRole('link', {name: 'Open Habitat', exact: true}).click();
}

/**
 * Opens a page from the jump palette (Hub #1888), the way to reach a page that no menu lists, such as a module page
 * that is not hardware. `query` narrows the list; the row named `label` is chosen.
 */
export async function jumpTo(page: Page, query: string, label: string): Promise<void> {
  await page.getByRole('button', {name: 'Jump to a page', exact: true}).filter({visible: true}).first().click();
  const palette = page.getByRole('dialog', {name: 'Jump to a page', exact: true});
  await palette.getByRole('combobox').fill(query);
  await palette.getByRole('option').filter({has: page.getByText(label, {exact: true})}).first().click();
  await palette.waitFor({state: 'detached'});
}

/**
 * A task page's tab, reached as the owner reaches it (Hub #1950): the device's card in the directory, then the tab over
 * its page. `device` is the card's link name, such as "Pixoo" or "Nanoleaf overview".
 */
export async function deviceTab(page: Page, category: string, device: string, tab: string): Promise<Locator> {
  await (await directoryLink(page, category, device)).click();
  const link = page.locator('nav.feature-navigation').getByRole('link', {name: tab, exact: true});
  await link.waitFor();
  return link;
}
