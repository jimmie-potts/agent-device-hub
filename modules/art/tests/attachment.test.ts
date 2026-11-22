import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {ART_ATTACHMENT_FAMILY, uploadArtworkId} from '@jimmie-potts/event-contracts/v2/art-show';
import sharp from 'sharp';
import {ATTACHMENT_LIFETIME_MS} from '../src/attachment.js';
import {hosted} from './support.js';

void test('staged attachments leave no saved item, and a save preserves the original across restart', async t => {
  const attachmentExpiry = new Set<() => void>();
  const art = await hosted(t, {providers: {}, scheduler: {after: (ms, fn) => {
    if (ms === ATTACHMENT_LIFETIME_MS) attachmentExpiry.add(fn);
    return () => {attachmentExpiry.delete(fn);};
  }}});
  const size = 64 * 32 * 3;
  const gif = await sharp(Buffer.concat([Buffer.alloc(size, 25), Buffer.alloc(size, 149)]),
    {raw: {width: 64, height: 64, pageHeight: 32, channels: 3}}).gif({delay: [80, 500]}).toBuffer();
  const command = (data: object, requestId: string) => art.operator.request(`bunny.cmd.${ART_ATTACHMENT_FAMILY}.art`, {
    type: 'org.bunny.art-attachment.edit.requested', subject: 'art',
    dataschema: 'https://bunny.invalid/events/art-attachment-edit/2.0', data,
  }, {requestId, timeoutMs: 2000});
  const upload = async (requestId: string) => {
    const input = art.attachmentUpload ?? assert.fail('missing attachment upload');
    const prepared = await input.stage({requestId, target: 'art', bytes: gif, name: 'synthetic.gif', signal: new AbortController().signal});
    assert.ok(!('error' in prepared), JSON.stringify(prepared));
    const result = await command(prepared.data, requestId);
    assert.equal(result.status, 'accepted');
    await prepared.finish({status: 'accepted', requestId});
  };

  const temporary = randomUUID();
  await upload(temporary);
  assert.equal(attachmentExpiry.size, 1);
  assert.equal(art.state.artworks.length, 0);
  await art.restart();
  assert.equal(attachmentExpiry.size, 0);
  assert.equal(await art.read(`conversation.${temporary}`), undefined);
  const requestId = randomUUID();
  await upload(requestId);
  const artworkId = uploadArtworkId(requestId);
  for (const _attempt of [0, 1]) {
    const result = await command({action: 'save', artworkId}, randomUUID());
    assert.equal(result.status, 'accepted');
  }
  assert.equal(attachmentExpiry.size, 0, 'saving releases the temporary expiry callback');
  await art.restart();
  const [item] = art.state.artworks;
  assert.equal(art.state.artworks.length, 1);
  assert.equal(item?.artworkId, artworkId);
  assert.equal(item?.favorite, true);
  assert.deepEqual(await art.readJson(`artwork.${artworkId}`), item, 'the saved browser selection can reopen outside the recent state record');
  assert.deepEqual(item?.compositions.filter(composition => composition.target !== 'ui').map(composition => composition.renditions[0]?.frames), [2, 2]);
  const result = await art.readJson<{rendition: {renditionId: string}}>(`conversation.${requestId}`);
  const original = await art.read(`rendition.${result.rendition.renditionId}`);
  assert.ok(original !== undefined && !('error' in original));
  assert.deepEqual(Buffer.from(original.bytes), gif);
});

void test('attachment validation rejects invalid files and oversized dimensions before admission', async t => {
  const art = await hosted(t, {providers: {}});
  const stage = art.attachmentUpload?.stage ?? assert.fail('missing attachment upload');
  const request = (bytes: Uint8Array) => ({requestId: randomUUID(), target: 'art', name: 'synthetic', bytes, signal: new AbortController().signal});
  const oversized = await sharp({create: {width: 2049, height: 16, channels: 3, background: '#000'}}).png().toBuffer();
  for (const [bytes, code] of [[Buffer.from('not artwork'), 'invalid-request'], [oversized, 'too-large']] as const) {
    const result = await stage(request(bytes));
    assert.ok('error' in result);
    assert.equal(result.error.code, code);
  }
  assert.equal(art.state.artworks.length, 0);
});
