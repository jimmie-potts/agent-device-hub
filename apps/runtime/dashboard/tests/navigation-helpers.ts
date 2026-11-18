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

/** The five destinations' names in order: four links and the Devices button (Hub #1889). */
export function destinationNames(page: Page): Promise<string[]> {
  return page.getByRole('navigation', {name: 'Main navigation'}).locator('a, button').allTextContents();
}

/** The Devices row opens the menu of every device page (Hub #1889). */
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

export async function directoryLink(page: Page, category: string, name: string): Promise<Locator> {
  await openDirectory(page);
  await page.getByRole('group', {name: 'Device categories'}).getByRole('button', {name: category, exact: true}).click();
  return page.getByRole('link', {name, exact: true});
}

export async function openAudio(page: Page): Promise<void> {
  await (await directoryLink(page, 'Audio', 'Audio')).click();
}
