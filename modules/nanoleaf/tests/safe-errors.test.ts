// Port-added safe errors (Hub #953, ADR 0012 "Safe errors"): text the module did not write, such as a parser's message
// or a thrown value, never becomes an error's message. It stays the error's cause, in memory.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseJson} from '../src/compat.js';
import {ValueError} from '../src/errors.js';
import {transactWith} from '../src/journal.js';
import {suite, test} from './support.js';

const SECRET = 'tok_SYNTHETIC123';

suite('safe errors', () => {
  // V8's message quotes the text around the error, here part of the credential.
  test('malformed JSON is a ValueError with fixed text that never quotes the input', () => {
    assert.throws(() => parseJson(`{"auth_token": ${SECRET}}`), (error: unknown) => {
      assert.ok(error instanceof ValueError);
      assert.equal(error.message, 'Malformed JSON.');
      assert.ok(error.cause instanceof SyntaxError, 'the parser\'s error stays the cause');
      return true;
    });
  });

  test('a transaction that throws a value that is not an Error rejects with fixed text and keeps the value as its cause', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      const thrown: unknown = SECRET;
      await assert.rejects(transactWith(db, () => {})(() => { throw thrown; }), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'The transaction threw a value that is not an Error.');
        assert.equal(error.cause, SECRET);
        return true;
      });
    } finally {
      db.close();
    }
  });
});
