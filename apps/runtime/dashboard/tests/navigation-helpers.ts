import type {Locator, Page} from 'playwright';

/** On a phone the rail is a drawer behind the menu button (Hub #1887); open it so its links can be used. */
export async function showRail(page: Page): Promise<void> {
  const menu = page.getByRole('button', {name: 'Open navigation', exact: true});
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
}

/** A main destination's link in the rail, with the phone drawer opened when the rail is one. */
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

export async function directoryLink(page: Page, category: string, name: string): Promise<Locator> {
  await (await destinationLink(page, 'Devices')).click();
  await page.getByRole('group', {name: 'Device categories'}).getByRole('button', {name: category, exact: true}).click();
  return page.getByRole('link', {name, exact: true});
}

export async function openAudio(page: Page): Promise<void> {
  await (await directoryLink(page, 'Audio', 'Audio')).click();
}
