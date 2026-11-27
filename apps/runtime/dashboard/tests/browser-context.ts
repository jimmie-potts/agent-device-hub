import type {Browser, BrowserContext, BrowserContextOptions} from 'playwright';

/**
 * Install once at context creation, before any page can start a request. Page routes take precedence over this
 * fallback. Removing their last handler keeps interception on for all pages in the context (#1691).
 */
export async function keepRequestInterception(context: BrowserContext): Promise<void> {
  await context.route('**/*', route => route.fallback());
}

/** Opens a context with its fallback in place before any journey handler or navigation. */
export async function openJourneyContext(browser: Browser, options?: BrowserContextOptions): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  try {
    await keepRequestInterception(context);
    return context;
  } catch (error) {
    await context.close();
    throw error;
  }
}
