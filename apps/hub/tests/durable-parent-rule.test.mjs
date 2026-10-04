import test from 'node:test';
import assert from 'node:assert/strict';
import {validateEvent} from '@jimmie-potts/agent-lifecycle-contracts';

// The installed upgrade gate freezes lifecycle validators because stored
// sessions reopen through validateEvent. This rule has no schema expression,
// so the Hub pins it here rather than in the published lifecycle corpus.
const identity=(sourceId,sessionId)=>({provider:'codex',client:'cli',hostId:'host-a',sourceId,sessionId});
const child=parentSource=>({
 apiVersion:'1.0',identity:identity('source-a','session-a'),turn:{status:'known',id:'turn-a'},
 parent:{status:'known',identity:identity(parentSource,'other')},
 event:{kind:'turn.started'},observedAtMs:1000,ordering:{status:'unknown'},
});

test('stored-session reopen rejects a parent from another source', () => {
 assert.equal(validateEvent(child('source-b')).ok,false);
 assert.equal(validateEvent(child('source-a')).ok,true);
});
