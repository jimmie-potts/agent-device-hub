import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyStatus } from '../src/contracts.js';
import { readContent } from '../src/content.js';
const signal = new AbortController().signal;
void test('public content admits only fixed references and closed bounded queries before storage', () => {
    let touched = false;
    const store = { listRuns() { touched = true; throw Error('Should not reach storage'); } };
    const state = emptyStatus('vacuum');
    for (const query of [{ path: '/private' }, { limit: '26' }, { cursor: 'x'.repeat(129) }, { limit: '01' }]) {
        const reply = readContent('runs', { query, signal }, state, store as never);
        assert.equal(reply && 'error' in reply ? reply.error.code : undefined, 'invalid-request');
    }
    assert.equal(touched, false);
    assert.equal(readContent('private', { query: {}, signal }, state, store as never), undefined);
    const reply = readContent('status', { query: {}, signal }, state, undefined);
    assert.ok(reply && 'bytes' in reply);
    assert.equal(reply.type, 'application/json');
    assert.deepEqual(JSON.parse(Buffer.from(reply.bytes).toString()), state);
    const wrong = readContent('status', { query: { id: 'another' }, signal }, state, undefined);
    assert.equal(wrong && 'error' in wrong ? wrong.error.code : undefined, 'invalid-request');
    const controller = new AbortController();
    controller.abort();
    const cancelled = readContent('status', { query: {}, signal: controller.signal }, state, undefined);
    assert.equal(cancelled && 'error' in cancelled ? cancelled.error.code : undefined, 'cancelled');
    for (const query of [{limit: '1'}, {cursor: '1'}, {path: '/private'}, {sort: 'newest'}]) {
        const refused = readContent('latest-run', {query, signal}, state, undefined);
        assert.equal(refused && 'error' in refused ? refused.error.code : undefined, 'invalid-request');
    }
    const stopped = readContent('latest-run', {query: {}, signal: controller.signal}, state, undefined);
    assert.equal(stopped && 'error' in stopped ? stopped.error.code : undefined, 'cancelled');
    const empty = readContent('latest-run', {query: {}, signal}, state, undefined);
    assert.ok(empty !== undefined && 'bytes' in empty);
    assert.deepEqual(JSON.parse(Buffer.from(empty.bytes).toString()), {schema: 'roborock-runs/2.0', id: 'vacuum', revision: 0, history: 'partial', runs: [], next: {status: 'unknown'}});
});
