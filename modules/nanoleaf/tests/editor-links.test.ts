import assert from 'node:assert/strict';
import {ModuleWorld, QUALIFIED, SECTION, UNQUALIFIED} from './module-support.js';
import {test} from './support.js';

test('wall task links use only qualified Codex Desktop UUID identity', async context => {
  const cli = {...QUALIFIED, client: 'cli'} as const;
  const world = await ModuleWorld.open(context, {section: {...SECTION, qualifiedSources: [QUALIFIED, cli, UNQUALIFIED]}});
  const uuid = '00112233-4455-6677-8899-aabbccddeeff';
  await world.core.set(uuid, {title: 'Valid Desktop task'});
  await world.core.set('not-a-uuid', {title: 'codex://threads/' + uuid});
  await world.core.set(uuid, {identity: {...cli, sessionId: uuid}, title: 'CLI task'});
  await world.core.set(uuid, {identity: {...UNQUALIFIED, sessionId: uuid}, title: 'Other provider'});
  await world.start();
  await world.until(() => world.wall()?.tasks.length === 4, 5000, 'four qualified wall tasks');
  const tasks = world.state<{tasks: {title: string; codexUrl?: string}[]}>('nanoleaf-wall', 'wall')?.tasks ?? [];
  assert.equal(tasks.find(task => task.title === 'Valid Desktop task')?.codexUrl, 'codex://threads/' + uuid);
  assert.equal(tasks.filter(task => task.codexUrl !== undefined).length, 1);
  world.verify();
});
