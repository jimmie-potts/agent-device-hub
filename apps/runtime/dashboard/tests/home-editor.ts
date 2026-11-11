import type {Page} from 'playwright';

/**
 * Opens a card's options in Edit Home (#1672). On the unit grid each card's edit bar shows its name and an options
 * button; Earlier, Later, the shape choice, Hide and Remove open below it. One-column layouts show them in the bar.
 */
export async function cardOptions(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole('button', {name: `Options for ${name}`, exact: true});
  if (await toggle.count() > 0 && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
