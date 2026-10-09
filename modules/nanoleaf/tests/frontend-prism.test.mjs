// Retained JavaScript is a browser source entry; test its pure adapter without a DOM or listener.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';
import {PrismAdapters} from '../src/frontend/prism-adapters.js';

test('retained Prism adapter preserves zone order under transforms and rejects mismatched wall geometry', () => {
  const graph = {version: 1, nodes: [{id: 'a', x: 0, y: 0}, {id: 'b', x: 300, y: 0}],
    lines: [{id: '1:2', number: 1, a: 'a', b: 'b', zoneIds: [1, 2]}]};
  const view = {connector_layout: graph, settings: {rotation: 90, flip_x: 1, flip_y: 0}, lines: [{id: '1:2', number: 1}]};
  const adapted = PrismAdapters.fromState(view, () => ['#112233', '#445566']);
  assert.deepEqual(adapted.lines[0].zoneIds, [1, 2]);
  assert.deepEqual(adapted.lines[0].colors, ['#112233', '#445566']);
  assert.equal(adapted.nodes[1].y, 300);
  assert.ok(Math.abs(adapted.nodes[1].x) < 0.000001);
  assert.throws(() => PrismAdapters.fromState({...view, lines: []}, () => ['#112233', '#445566']), /Connector layout unavailable/);
  const wrong = {...graph, lines: [{...graph.lines[0], number: 2}]};
  assert.throws(() => PrismAdapters.fromState({...view, connector_layout: wrong}, () => ['#112233', '#445566']), /Line identities differ/);
});

// Run the retained closure's actual animation functions. Only DOM surfaces and the
// animation clock are synthetic; this does not duplicate the assembly or teardown logic.
const controller = readFileSync(new URL('../src/frontend/wall.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/frontend/wall.css', import.meta.url), 'utf8');
function between(start, end) {
  const from = controller.indexOf(start), to = controller.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `retained source boundary: ${start}`);
  return controller.slice(from, to);
}
function fallback() {
  const animations = [], completions = [], pulses = [...css.matchAll(/@keyframes (nanoleaf-pulse\w*) /g)]
    .map(match => ({animationName: match[1], startTime: 1234}));
  pulses.push({animationName: 'unrelated-animation', startTime: 5678});
  let removed = false, touchesAfterRemoval = 0, redraws = 0, activeAtRemoval = 0;
  const animate = () => {
    let finish, reject;
    const finished = new Promise((resolve, refuse) => { finish = resolve; reject = refuse; });
    const animation = {finished, cancellations: 0, finish, cancel() { this.cancellations++; reject(new Error('synthetic animation cancelled')); }};
    animations.push(animation); return animation;
  };
  const group = {style: {}, animate};
  const classes = new Set();
  const root = {
    classList: {add: value => classes.add(value), remove: value => classes.delete(value)},
    querySelector: selector => selector === '.orb' ? {getAttribute: () => '0'} : group,
    querySelectorAll: selector => selector === '.wall-line' ? [group] : [],
    getAnimations: () => pulses,
  };
  const box = {
    disposed: false, prism: null, wallFingerprint: '',
    state: {lines: [{id: '1:2', points: [[0, 0], [150, 0], [300, 0]]}], settings: {rotation: 0, flip_x: 0, flip_y: 0}},
    window: {matchMedia: () => ({matches: false})}, localStorage: {getItem: () => null},
    kindOf: () => 'lines', transform: point => point, drawWall: () => { redraws++; },
    $: () => { if (removed) { touchesAfterRemoval++; return null; } return root; },
    host: {replaceChildren: () => { activeAtRemoval = animations.filter(animation => animation.cancellations === 0).length; removed = true; }},
    observer: {disconnect() {}},
    listeners: [], timers: new Set(), frames: new Set(), clearTimeout, cancelAnimationFrame() {},
    Promise: {all: values => ({then: callback => { const completion = Promise.all(values).then(callback); completions.push(completion); return completion; }})},
  };
  const source = between('const assembly={', 'function sizeLineNumbers(')
    + '\nfunction dispose(){' + between('      if(disposed)return;disposed=true;', '    }\n  };')
    + '\n}\nglobalThis.controls={playAssembly,anchorPulses,dispose};';
  vm.createContext(box); vm.runInContext(source, box);
  return {controls: box.controls, animations, completions, pulses, classes,
    state: () => ({removed, touchesAfterRemoval, redraws, activeAtRemoval})};
}

for (const queued of [false, true]) test(`normal-motion fallback disposal cancels animation work and ignores ${queued ? 'already queued' : 'later'} completion`, async () => {
  const run = fallback();
  assert.equal(run.controls.playAssembly('opening'), true);
  assert.equal(run.animations.length, 3, 'orb, Line and number assembly run without Prism or reduced motion');
  assert.equal(run.classes.has('assembling'), true);
  if (queued) for (const animation of run.animations) animation.finish();
  run.controls.dispose();
  const cancelledAtDispose = run.animations.map(animation => animation.cancellations);
  for (const animation of run.animations) animation.finish();
  const completed = await Promise.allSettled(run.completions);
  assert.deepEqual(cancelledAtDispose, [1, 1, 1], 'every animation stops before the host is removed');
  assert.deepEqual(completed.map(result => result.status), ['fulfilled'], 'late completion must not reject');
  assert.deepEqual(run.state(), {removed: true, touchesAfterRemoval: 0, redraws: 1, activeAtRemoval: 0});
  run.controls.dispose();
  assert.equal(run.controls.playAssembly('replay'), false, 'a disposed mount cannot start another assembly');
  run.controls.anchorPulses();
  assert.equal(run.state().touchesAfterRemoval, 0);
  assert.deepEqual(run.animations.map(animation => animation.cancellations), [1, 1, 1], 'disposal is idempotent');
});

test('fallback pulses use the scoped CSS names and retain their document-timeline phase across redraws', () => {
  const run = fallback();
  assert.equal(run.pulses.length, 3, 'both scoped pulse keyframes plus an unrelated animation');
  for (let redraw = 0; redraw < 2; redraw++) {
    for (const animation of run.pulses.slice(0, 2)) animation.startTime = 1234 + redraw;
    run.controls.anchorPulses();
    assert.deepEqual(run.pulses.map(animation => animation.startTime), [0, 0, 5678]);
  }
});
