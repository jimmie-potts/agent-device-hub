import type {Locator, Page} from 'playwright';

export async function openSettings(page: Page): Promise<void> {
  await page.getByRole('navigation', {name: 'Utilities'}).getByRole('link', {name: 'Settings', exact: true}).click();
}

export async function openConnections(page: Page): Promise<void> {
  if (new URL(page.url()).hash === '#/connections') return;
  await openSettings(page);
  await page.getByRole('link', {name: 'Connections', exact: true}).click();
}

export async function directoryLink(page: Page, category: string, name: string): Promise<Locator> {
  await page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: 'Devices', exact: true}).click();
  await page.getByRole('group', {name: 'Device categories'}).getByRole('button', {name: category, exact: true}).click();
  return page.getByRole('link', {name, exact: true});
}

export async function openAudio(page: Page): Promise<void> {
  await (await directoryLink(page, 'Audio', 'Audio')).click();
}
