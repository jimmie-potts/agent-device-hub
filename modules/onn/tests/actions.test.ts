import assert from 'node:assert/strict';
import {test} from 'node:test';
import {spawnSync} from 'node:child_process';
import {CURRENT_APP_COMMAND, currentApp, keyCommand, textCommand, launcherCommand, launchCommand} from '../src/actions.js';

void test('only the eight qualified keys map to one Android key press', () => {
  for (const [key, code] of Object.entries({up: 19, down: 20, left: 21, right: 22, select: 23, back: 4, home: 3, 'play-pause': 85}))
    assert.equal(keyCommand(key), `input keyevent ${code}`);
  for (const key of ['power', 'volume-up', 'forward', 'rewind', '22; input keyevent 26', 'toString']) assert.equal(keyCommand(key), undefined);
});

void test('the actual foreground filter accepts both qualified Android forms without publishing raw activity data', () => {
  for (const field of ['mResumedActivity:', 'topResumedActivity=']) {
    const observed = spawnSync('sh', ['-c', CURRENT_APP_COMMAND.replace('dumpsys activity activities', 'cat')], {
      encoding: 'utf8', input: `${field}ActivityRecord{a12 u0 com.google.android.youtube.tv/.MainActivity t22}\nSYNTHETIC_UNSELECTED_DETAILS\n`,
    });
    assert.equal(observed.status, 0); assert.equal(observed.stderr, '');
    assert.equal(currentApp(observed.stdout), 'youtube', field);
    assert.equal(observed.stdout.includes('SYNTHETIC_UNSELECTED_DETAILS'), false);
  }
  assert.equal(currentApp('com.google.android.youtube.tv\ncom.stremio.one\n'), undefined, 'ambiguous foreground is unknown');
});

void test('focused text quotes safe ASCII once and refuses unqualified input before transport', () => {
  assert.equal(textCommand('bunny test'), "input text 'bunny%stest'");
  assert.equal(textCommand('SYNTHETIC aA19._-'), "input text 'SYNTHETIC%saA19._-'");
  for (const text of ['', 'a'.repeat(257), 'abc%stest', "a'b", 'a;b', 'a\nb', '😊']) assert.equal(textCommand(text), undefined);
});

void test('the two shortcuts resolve the selected LEANBACK package and validate its exact activity', () => {
  assert.equal(launcherCommand('stremio'), 'cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER com.stremio.one');
  assert.equal(launchCommand('stremio', 'com.stremio.one/com.stremio.tv.MainActivity\n'), 'am start -W -n com.stremio.one/com.stremio.tv.MainActivity');
  assert.equal(launchCommand('youtube', 'com.google.android.youtube.tv/.MainActivity'), 'am start -W -n com.google.android.youtube.tv/.MainActivity');
  for (const output of ['No activity found', 'com.other/.Main', 'com.stremio.one/.Main; input keyevent 3', 'com.stremio.one/.Main\ncom.stremio.one/.Other']) assert.equal(launchCommand('stremio', output), undefined);
});
