import assert from 'node:assert/strict';
import {test} from 'node:test';
import {READER_DEVICE_PATH,READER_INVOCATION,READER_SHA256,READER_SOURCE_SHA256} from '../src/reader-artifact.js';
void test('the shipped reader invocation binds one release path and no runtime arguments',()=>{
 assert.match(READER_SHA256,/^[a-f0-9]{64}$/);assert.match(READER_SOURCE_SHA256,/^[a-f0-9]{64}$/);
 assert.equal(READER_DEVICE_PATH,`/data/local/tmp/bunny-onn-metadata/${READER_SHA256}.dex`);
 assert.equal(READER_INVOCATION,`set -o pipefail; CLASSPATH=${READER_DEVICE_PATH} app_process /system/bin OnnMetadataReader 3>&1 1>/dev/null 2>/dev/null | cat`);
});
