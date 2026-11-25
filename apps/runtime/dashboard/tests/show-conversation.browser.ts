import assert from 'node:assert/strict';
import {chromium, type Browser} from 'playwright';
import {feed, startWorld} from './harness.ts';

export async function showConversationJourney(browser: Browser): Promise<void> {
  const world = await startWorld({companions: true, nanoleaf: true, assistantCatalog: ['create_light_show_draft', 'edit_light_show_cue',
    'preview_light_show_draft', 'save_light_show', 'read_light_shows', 'control_music_lighting_control']});
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.goto(`${world.url}/#/module/companions/assistant`);
    await feed(page, 'connected');
    const conversation = page.getByRole('region', {name: 'B.U.N.N.Y. conversation', exact: true});
    await conversation.getByRole('button', {name: 'Enable conversation', exact: true}).click();
    const send = async (name: string, input: object) => {
      await conversation.getByRole('textbox', {name: 'Message', exact: true}).fill(`SYNTHETIC_CATALOG ${JSON.stringify({name, input})}`);
      await conversation.getByRole('button', {name: 'Send', exact: true}).click();
    };
    await send('create_light_show_draft', {name: 'Warm test', starter: 'warm'});
    const created = conversation.getByText(/Synthetic result: Draft Warm test/);
    await created.waitFor();
    const id = /show-[0-9a-f-]{36}/.exec(await created.innerText())?.[0];
    assert.ok(id !== undefined);
    await send('edit_light_show_cue', {draftId: id, revision: 1, cue: 'opening', changes: '{"intensity":0.25}'});
    await conversation.getByText(/Synthetic result: Draft Warm test.*revision 2/s).waitFor();
    await conversation.getByRole('textbox', {name: 'Message', exact: true})
      .fill(`Save draft Warm test (${id}) revision 2 as Version one`);
    await conversation.getByRole('button', {name: 'Send', exact: true}).click();
    assert.equal(await conversation.getByRole('article', {name: 'Proposed command', exact: true}).count(), 0);
    const tool = conversation.getByRole('article', {name: 'tool message', exact: true}).filter({
      has: page.locator('p', {hasText: 'accepted: nanoleaf-show-save on shows'}),
    });
    await tool.locator('summary').click();
    await tool.getByText('Tracked operation succeeded · evidence observed', {exact: true}).waitFor();
    await send('read_light_shows', {view: 'saved', id, offset: 0});
    await conversation.getByText(/Synthetic result: .*"versionName":"Version one"/s).waitFor();
  } finally {
    await context.close();
    await world.close();
  }
  process.stdout.write('Light-show Conversation browser: draft, cue edit, direct guarded save and immutable catalog receipt passed.\n');
}

if (import.meta.main) {
  const browser = await chromium.launch({headless: true});
  try {await showConversationJourney(browser);}
  finally {await browser.close();}
}
