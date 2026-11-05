// The provider adapters over a fake transport. No real call runs, and the keys are placeholders.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AnthropicIdeas, ANTHROPIC_URL} from '../src/anthropic.js';
import {OpenAiImages, OPENAI_IMAGES_URL} from '../src/openai.js';
import {ProviderFault, post, type Transport} from '../src/provider.js';

const signal = new AbortController().signal;
const image = {model: 'gpt-image-2', quality: 'low', size: '1024x1024', prompt: 'a moon bakery'};
const text = {model: 'claude-opus-5-5', system: 'write an idea', prompt: 'a moon bakery', maxTokens: 2000};
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
type Sent = {url: string; init: Parameters<Transport>[1]};
const record = (answer: () => Response | Promise<Response>): {sent: Sent[]; transport: Transport} => {
  const sent: Sent[] = [];
  return {sent, transport: async (url, init) => {sent.push({url, init}); return answer();}};
};
const fault = async (work: Promise<unknown>): Promise<ProviderFault> => {
  try {await work;} catch (error) {assert.ok(error instanceof ProviderFault); return error;}
  throw new Error('expected a fault');
};
const usage = {input_tokens: 12, output_tokens: 34};

void test('response bounds cancel a chunked or incorrectly sized body before consuming it', async () => {
  for (const headers of [{}, {'content-length': '1'}, {'content-length': '1000'}]) {
    let chunks = 0, cancelled = false;
    const body = new ReadableStream<Uint8Array>({pull(controller) {
      chunks++; controller.enqueue(new Uint8Array(16));
      if (chunks === 100) controller.close();
    }, cancel() {cancelled = true;}});
    const error = await fault(post(() => Promise.resolve(new Response(body, {headers})), 'https://synthetic.invalid', {}, '{}', signal, 10));
    assert.equal(error.code, 'too-large');
    assert.equal(error.keep, true);
    assert.ok(chunks <= 2 && cancelled, `consumed ${chunks} chunks; cancelled=${String(cancelled)}`);
  }
});

void test('OpenAI: one request with the header key and the qualified shape, and bytes and usage back', async () => {
  const {sent, transport} = record(() => json({data: [{b64_json: Buffer.from('png-bytes').toString('base64')}], usage}));
  const answer = await new OpenAiImages({key: 'test-key', transport}).image(image, signal);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.url, OPENAI_IMAGES_URL);
  assert.equal(sent[0]?.init.redirect, 'error');
  assert.equal(sent[0]?.init.headers.authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(sent[0]?.init.body ?? ''), {model: 'gpt-image-2', prompt: 'a moon bakery', size: '1024x1024', quality: 'low', n: 1, output_format: 'png'});
  assert.equal(Buffer.from(answer.bytes).toString(), 'png-bytes');
  assert.deepEqual(answer.usage, {inputTokens: 12, outputTokens: 34});
});

void test('OpenAI: a GIF request names its frames and duration, and sends no unsupported field', async () => {
  const {sent, transport} = record(() => json({data: [{b64_json: Buffer.from('gif-bytes').toString('base64')}], usage}));
  await new OpenAiImages({key: 'test-key', transport}).image({model: 'gpt-image-2.6-flare', quality: 'low', size: '512x256', prompt: 'a campfire', gif: {frameCount: 8, frameDurationMs: 200}}, signal);
  assert.equal(sent[0]?.url, OPENAI_IMAGES_URL);
  assert.deepEqual(JSON.parse(sent[0]?.init.body ?? ''), {model: 'gpt-image-2.6-flare', prompt: 'a campfire', size: '512x256', quality: 'low', n: 1, output_format: 'gif', frame_count: 8, frame_duration_ms: 200});
});

void test('OpenAI: generic GIF refusals do not invent a preview-access diagnosis', async () => {
  const gif = {model: 'gpt-image-2.6-flare', quality: 'low', size: '512x512', prompt: 'a campfire', gif: {frameCount: 8, frameDurationMs: 200}};
  const provider = (body: unknown, status: number) => new OpenAiImages({key: 'test-key', transport: record(() => json(body, status)).transport});
  for (const [body, status] of [[{error: {code: 'model_not_found'}}, 404], [{error: {}}, 403], [{error: {param: 'output_format'}}, 400]] as const) {
    assert.equal((await fault(provider(body, status).image(gif, signal))).reason, 'provider-refused');
    assert.equal((await fault(provider(body, status).image(image, signal))).reason, 'provider-refused');
  }
  assert.equal((await fault(provider({error: {code: 'moderation_blocked'}}, 400).image(gif, signal))).reason, 'moderation');
  assert.equal((await fault(provider({error: {param: 'prompt'}}, 400).image(gif, signal))).reason, 'provider-refused');
});

void test('Claude: one request with the versioned header and a fixed max_tokens, and text and usage back', async () => {
  const {sent, transport} = record(() => json({content: [{type: 'thinking', thinking: ''}, {type: 'text', text: ' a baker on the moon '}], stop_reason: 'end_turn', usage}));
  const answer = await new AnthropicIdeas({key: 'test-key', transport}).text(text, signal);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.url, ANTHROPIC_URL);
  assert.equal(sent[0]?.init.headers['x-api-key'], 'test-key');
  assert.equal(sent[0]?.init.headers['anthropic-version'], '2026-10-21');
  const body = JSON.parse(sent[0]?.init.body ?? '') as Record<string, unknown>;
  assert.equal(body.max_tokens, 2000);
  assert.equal(answer.text, 'a baker on the moon');
  assert.deepEqual(answer.usage, {inputTokens: 12, outputTokens: 34});
});

void test('a refused or cut-off idea is no idea, but its usage still counts', async () => {
  for (const stop_reason of ['refusal', 'max_tokens']) {
    const {transport} = record(() => json({content: [{type: 'text', text: 'partial'}], stop_reason, usage}));
    const answer = await new AnthropicIdeas({key: 'test-key', transport}).text(text, signal);
    assert.equal(answer.text, null);
    assert.deepEqual(answer.usage, {inputTokens: 12, outputTokens: 34});
  }
});

void test('a 4xx is a definite failure: moderation and unverified organizations are named, with usage or zero', async () => {
  const provider = (body: unknown, status: number) => new OpenAiImages({key: 'test-key', transport: record(() => json(body, status)).transport});
  const blocked = await fault(provider({error: {code: 'moderation_blocked', message: 'provider text'}}, 400).image(image, signal));
  assert.deepEqual([blocked.reason, blocked.uncertain, blocked.keep, blocked.usage], ['moderation', false, false, null]);
  assert.equal(blocked.message.includes('provider text'), false, 'provider text stays out');
  const unverified = await fault(provider({error: {code: 'org_unverified'}}, 403).image(image, signal));
  assert.deepEqual([unverified.code, unverified.reason, unverified.keep], ['forbidden', 'provider-refused', false]);
  const limited = await fault(provider({error: {code: 'rate_limited'}, usage}, 429).image(image, signal));
  assert.deepEqual([limited.code, limited.usage], ['capacity', {inputTokens: 12, outputTokens: 34}]);
});

void test('a 5xx without usage, a lost response and an aborted call are uncertain, and the reservation is kept', async () => {
  const provider = (transport: Transport) => new OpenAiImages({key: 'test-key', transport});
  const server = await fault(provider(record(() => json({error: {}}, 503)).transport).image(image, signal));
  assert.deepEqual([server.uncertain, server.keep, server.code], [true, true, 'uncertain-result']);
  const withUsage = await fault(provider(record(() => json({error: {}, usage}, 500)).transport).image(image, signal));
  assert.deepEqual([withUsage.uncertain, withUsage.keep, withUsage.usage], [false, false, {inputTokens: 12, outputTokens: 34}]);
  const lost = await fault(provider(() => Promise.reject(new Error('socket hang up with the prompt inside'))).image(image, signal));
  assert.deepEqual([lost.uncertain, lost.keep, lost.reason], [true, true, 'lost-response']);
  assert.equal(lost.message.includes('prompt'), false);
  const controller = new AbortController(); controller.abort();
  const aborted = await fault(provider(() => Promise.reject(new Error('aborted'))).image(image, controller.signal));
  assert.deepEqual([aborted.uncertain, aborted.keep, aborted.code], [true, true, 'cancelled']);
  const cut = new Response(new ReadableStream({start(stream) {stream.error(new Error('cut'));}}), {status: 200});
  const midBody = await fault(provider(() => Promise.resolve(cut)).image(image, signal));
  assert.deepEqual([midBody.uncertain, midBody.keep], [true, true]);
});

void test('invalid, missing or oversized output fails: usage settles it, and otherwise the reservation is kept', async () => {
  const provider = (body: unknown, headers?: Record<string, string>) => new OpenAiImages({key: 'test-key', transport: () => Promise.resolve(new Response(JSON.stringify(body), {status: 200, ...(headers === undefined ? {} : {headers})}))});
  const missing = await fault(provider({data: [], usage}).image(image, signal));
  assert.deepEqual([missing.uncertain, missing.keep, missing.usage], [false, false, {inputTokens: 12, outputTokens: 34}]);
  const bare = await fault(provider({data: [{b64_json: '***'}]}).image(image, signal));
  assert.deepEqual([bare.uncertain, bare.keep, bare.reason], [false, true, 'invalid-output']);
  const large = await fault(provider({}, {'content-length': String(64 * 1024 * 1024)}).image(image, signal));
  assert.deepEqual([large.code, large.keep], ['too-large', true]);
  const notJson = await fault(new OpenAiImages({key: 'k', transport: () => Promise.resolve(new Response('<html>', {status: 200}))}).image(image, signal));
  assert.deepEqual([notJson.code, notJson.keep], ['invalid-message', true]);
});
