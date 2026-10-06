// Values recorded from the Python bridge (recorded/values.json): keys, hashes, colors, titles, paths and number text
// that the installed state and its migration depend on.
import assert from 'node:assert/strict';
import {dumps, floatText, isObject, parseFloatText, pyDist, pyHypot, pyJson, pyMod, pyRound, pySum} from '../src/compat.js';
import {privateAddress} from '../src/transport.js';
import {defaultColor, fallbackTitle, normalize} from '../src/project-map.js';
import {evictionToken, identityKey, type Identity, type SharedSession, type SharedState} from '../src/shared-input.js';
import {completion, fixtureJson, loadDump, query, recordedSetup, setMode, suite, taskRow, temporary, test, write} from './support.js';

const recorded = fixtureJson('recorded/values.json');
if (!isObject(recorded)) throw new Error('values.json is not an object.');
const cases = (name: string): unknown[][] => recorded[name] as unknown[][];

suite('values recorded from Python', () => {
  test('identity keys match the installed shared task keys', () => {
    for (const [identity, key] of cases('identityKeys')) assert.equal(identityKey(identity as Identity), key);
  });

  test('eviction tokens match', () => {
    const value = recorded.evictionToken as unknown as {current: {config: {ownerId: string}; generation: number}; session: SharedSession; token: string};
    const current = {...value.current, config: value.current.config} as unknown as SharedState;
    assert.equal(evictionToken(current, value.session), value.token);
  });

  test('default project colors round as Python does', () => {
    for (const [project, color] of cases('defaultColors')) assert.equal(defaultColor(project as string), color, String(project));
  });

  test('fallback titles keep the last eight hexadecimal characters', () => {
    for (const [provider, session, title] of cases('fallbackTitles')) assert.equal(fallbackTitle(provider as string, session as string), title);
  });

  test('paths normalize like posixpath on Windows, /mnt and WSL spellings', () => {
    for (const [path, normalized] of cases('normalized')) assert.equal(normalize(path), normalized, JSON.stringify(path));
  });

  test('saved float text matches Python str(float) and reads back', () => {
    for (const [value, text] of cases('floatText')) {
      assert.equal(floatText(value as number), text);
      assert.equal(parseFloatText(text as string), value);
    }
    assert.equal(parseFloatText('-inf'), -Infinity);
    assert.throws(() => parseFloatText('abc'), {name: 'ValueError'});
  });

  test('round sends halves to the even neighbour', () => {
    for (const [value, rounded] of cases('rounded')) assert.equal(pyRound(value as number), rounded, String(value));
  });

  test('lengths and float sums match math.hypot and sum() to the last bit', () => {
    const numbers = fixtureJson('recorded/numbers.json') as {hypot: [number, number, number][]; sums: [number[], number][]};
    for (const [a, b, length] of numbers.hypot) assert.equal(pyHypot(a, b), length, `hypot(${a}, ${b})`);
    for (const [values, total] of numbers.sums) assert.equal(pySum(values), total, JSON.stringify(values));
    assert.equal(pyHypot(Infinity, NaN), Infinity);
    assert.ok(Number.isNaN(pyHypot(1, NaN)));
    assert.equal(pyDist([1, 2], [4, 6]), 5);
  });

  test('float remainders take the divisor sign as Python does', () => {
    for (const [value, divisor, result] of cases('pyMod')) assert.equal(pyMod(value as number, divisor as number), result, `${String(value)} % ${String(divisor)}`);
  });

  test('JSON text matches json.dumps and shared_input.dumps', () => {
    for (const [value, text] of cases('pyJson')) assert.equal(pyJson(value), text);
    for (const [value, text] of cases('dumps')) assert.equal(dumps(value), text);
  });

  test('only private IPv4 addresses are accepted, with Python messages', () => {
    for (const [ip, outcome] of cases('privateAddress')) {
      const result = ((): string => {
        try {
          return privateAddress(ip as string);
        } catch (error) {
          assert.ok(error instanceof Error && error.name === 'ValueError');
          return 'error: ' + error.message;
        }
      })();
      assert.equal(result, outcome, String(ip));
    }
  });
});

suite('test fixtures recorded from Python', () => {
  test('taskRow saves what a prompt hook event saved in Python', context => {
    const directory = temporary(context);
    write(directory, db => taskRow(db, 'a', '1', 1000));
    const recordedRows = recordedSetup('taskRow');
    for (const table of ['sessions', 'activity', 'task_info', 'meta', 'slots', 'comets', 'waits', 'receipts']) {
      assert.deepEqual(query(directory, `SELECT * FROM ${table} ORDER BY rowid`), recordedRows[table]?.rows, table);
    }
  });

  test('completion saves what a Stop hook event saved in Python', context => {
    const directory = temporary(context);
    write(directory, db => taskRow(db, 'a', '1', 1000));
    write(directory, db => completion(db, 'a', '1', 1000.5));
    const recordedRows = recordedSetup('completion');
    for (const table of ['sessions', 'activity', 'task_info', 'meta', 'slots', 'comets', 'waits', 'receipts']) {
      assert.deepEqual(query(directory, `SELECT * FROM ${table} ORDER BY rowid`), recordedRows[table]?.rows, table);
    }
  });

  test('setMode saves what modes.set_mode saved for a device without a controller ledger', context => {
    const directory = temporary(context);
    loadDump(directory, recordedSetup('enrollment'));
    setMode(directory, 'quiet', 1000, 'panels');
    setMode(directory, 'work', 1001, 'panels');
    setMode(directory, 'free', 1002, 'panels');
    const sorted = (values: readonly (readonly unknown[])[]): string[] => values.map(row => JSON.stringify(row)).sort();
    assert.deepEqual(sorted(query(directory, 'SELECT * FROM meta')), sorted(recordedSetup('enrollmentModes').meta?.rows ?? []));
  });
});
