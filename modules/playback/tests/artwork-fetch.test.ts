import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ARTWORK_INPUT_BYTES, artworkUrl, createArtworkFetch} from '../src/artwork-fetch.js';
const endpoint = 'http://127.0.0.1:10000/sony';
const signal = new AbortController().signal;
const fake = (reply: Response, observe?: (input: string | URL | Request, init?: RequestInit) => void): typeof fetch => (input, init) => {
  observe?.(input, init); return Promise.resolve(reply);
};

void test('candidate admits exact configured origin only with no credentials or fragment', () => {
  assert.equal(artworkUrl(`${endpoint}/image?private=1`, endpoint), `${endpoint}/image?private=1`);
  for (const url of ['/image', 'https://127.0.0.1:10000/image', 'http://127.0.0.1:10001/image', 'http://localhost:10000/image',
    'http://name:secret@127.0.0.1:10000/image', `${endpoint}/image#fragment`, `${endpoint}/ima\nge`, `${endpoint}/${'x'.repeat(2048)}`]) assert.equal(artworkUrl(url, endpoint), undefined, url);
});

void test('wrong origin starts no fetch, redirect is manual and always refused', async () => {
  let calls = 0;
  const fetcher = createArtworkFetch(fake(new Response(null, {status: 302, headers: {location: `${endpoint}/other`}}), (_input, init) => {
    calls++; assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit');
  }));
  assert.equal((await fetcher('http://127.0.0.2:10000/image', endpoint, signal)).ok, false); assert.equal(calls, 0);
  assert.deepEqual(await fetcher(`${endpoint}/image`, endpoint, signal), {ok: false, code: 'unsupported', transient: false}); assert.equal(calls, 1);
});

void test('ignores media type and enforces streamed byte limit at and beyond boundary', async () => {
  const exact = createArtworkFetch(fake(new Response(new Uint8Array(ARTWORK_INPUT_BYTES), {headers: {'content-type': 'text/plain'}})));
  const result = await exact(`${endpoint}/image`, endpoint, signal); assert.ok(result.ok); assert.equal(result.value.byteLength, ARTWORK_INPUT_BYTES);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({start(controller) { controller.enqueue(new Uint8Array(ARTWORK_INPUT_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; }});
  const tooMuch = createArtworkFetch(fake(new Response(body, {headers: {'content-length': '1'}})));
  assert.deepEqual(await tooMuch(`${endpoint}/image`, endpoint, signal), {ok: false, code: 'capacity', transient: false}); assert.equal(cancelled, true);
});

void test('untrusted exception text cannot escape the failure result', async () => {
  const fail: typeof fetch = () => Promise.reject(new Error('secret URL and image bytes'));
  assert.deepEqual(await createArtworkFetch(fail)(`${endpoint}/image`, endpoint, signal), {ok: false, code: 'unavailable', transient: true});
});
