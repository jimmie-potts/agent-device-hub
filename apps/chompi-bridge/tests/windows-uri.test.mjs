import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDeepLink } from '../dist/windows/index.js';

const thread = '019a3b1c-7d2e-7f00-8a11-0123456789ab';
const local = 'local_4f1e2d3c-1b2a-4c5d-8e9f-a0b1c2d3e4f5';

test('only the two qualified deep-link shapes are accepted', () => {
  assert.deepEqual(parseDeepLink(`codex://threads/${thread}`), { client: 'codex', threadId: thread });
  assert.deepEqual(parseDeepLink(`claude://code/continue?session=${local}`), { client: 'claude', localId: local });
});

test('every other link is rejected', () => {
  const rejected = [
    `codex://threads/${thread.toUpperCase()}`,
    `Codex://threads/${thread}`,
    `codex://threads/${thread}/`,
    `codex://threads/${thread}?x=1`,
    `codex://threads/${thread}#x`,
    `codex://threads/${thread.slice(0, -1)}`,
    `codex://threads/../${thread}`,
    `codex://thread/${thread}`,
    `codex:threads/${thread}`,
    ` codex://threads/${thread}`,
    `codex://threads/${thread}\n`,
    `codex://new?prompt=hello`,
    `claude://code/continue?session=${local}&q=hi`,
    `claude://code/continue?session=${local.replace('local_', '')}`,
    `claude://code/continue?session=${local.toUpperCase().replace('LOCAL_', 'local_')}`,
    `claude://code/continue?session=local_x`,
    `claude://code/continue?session=${local}#frag`,
    `claude://code/needs-input?session=${local}`,
    `claude://resume?session=${local}`,
    `claude://code/new?q=hello`,
    `claude://code/continue/?session=${local}`,
    `https://example.com/codex://threads/${thread}`,
    `file:///C:/Windows/System32/calc.exe`,
    `ms-settings:`,
    `C:\\Windows\\System32\\calc.exe`,
    '',
  ];
  for (const uri of rejected) assert.equal(parseDeepLink(uri), null, JSON.stringify(uri));
  for (const value of [undefined, null, 42, {}, ['codex://threads/' + thread]]) assert.equal(parseDeepLink(value), null);
});
