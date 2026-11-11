// The scenario catalog's shards (Hub #1674): every split covers each scenario and transport pair exactly once, and a
// malformed or out-of-range selection fails the catalog file loudly instead of letting it pass with no catalog tests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SCENARIOS, TRANSPORTS} from './scenarios/catalog.js';
import {SHARD_VARIABLE, parseShard, shardOf} from './scenarios/shard.js';
import {it} from './support.js';

const PAIRS = SCENARIOS.flatMap(scenario => TRANSPORTS.map(transport => `${scenario.id} over ${transport}`));
const CATALOG = fileURLToPath(new URL('./scenarios/catalog.test.js', import.meta.url));

it('a selection is i/n with 1 <= i <= n <= the number of pairs, and no selection means the whole catalog', () => {
  assert.equal(parseShard(undefined, 10), undefined);
  assert.deepEqual(parseShard('1/4', 10), {index: 1, count: 4});
  assert.deepEqual(parseShard('4/4', 10), {index: 4, count: 4});
  assert.deepEqual(parseShard('10/10', 10), {index: 10, count: 10});
  for (const text of ['', '1', '1/', '/4', '0/4', '1/0', '5/4', '11/11', '01/4', '1/04', ' 1/4', '1/4 ', '1-4', '-1/4', '1.5/4', 'a/b', '1/4/8']) {
    assert.throws(() => parseShard(text, 10), new RegExp(SHARD_VARIABLE), JSON.stringify(text));
  }
});

it('for every shard count the shards together hold each pair once, in order, and differ in size by one at most', () => {
  assert.ok(PAIRS.length > 100, 'the catalog has its pairs');
  for (let count = 1; count <= 16; count += 1) {
    const shards = Array.from({length: count}, (_, index) => shardOf(PAIRS, {index: index + 1, count}));
    const union = shards.flat();
    assert.equal(union.length, PAIRS.length, `${String(count)} shards hold every pair`);
    assert.deepEqual([...union].sort(), [...PAIRS].sort(), `${String(count)} shards hold each pair once`);
    for (const shard of shards) assert.deepEqual(shard, PAIRS.filter(pair => shard.includes(pair)), 'a shard keeps the catalog order');
    const sizes = shards.map(shard => shard.length);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${String(count)} shards: ${sizes.join(', ')}`);
    assert.deepEqual(shards, Array.from({length: count}, (_, index) => shardOf(PAIRS, {index: index + 1, count})), 'the split is deterministic');
  }
});

/** The catalog file's exit code and output when run with `selection`. */
async function runCatalog(selection: string): Promise<{code: number | null; output: string}> {
  const env: NodeJS.ProcessEnv = {...process.env, [SHARD_VARIABLE]: selection};
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [CATALOG], {env, stdio: ['ignore', 'pipe', 'pipe']});
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (text: string) => { output += text; });
  child.stderr.setEncoding('utf8').on('data', (text: string) => { output += text; });
  const code = await new Promise<number | null>(done => { child.once('close', done); });
  return {code, output};
}

it('a malformed or out-of-range selection fails the catalog file with its reason and runs no scenario', async () => {
  for (const [selection, reason] of [['two', 'must be <i>/<n>'], ['5/4', 'names shard 5 of only 4'], ['1/9999', 'asks for 9999 shards']] as const) {
    const {code, output} = await runCatalog(selection);
    assert.notEqual(code, 0, `${selection} fails`);
    assert.match(output, /the shard selection names one shard of the catalog/, selection);
    assert.ok(output.includes(reason), `${selection}: ${output}`);
    assert.doesNotMatch(output, / over (in-process|remote): /, `${selection} runs no scenario`);
  }
}, 60_000);
