// Retained JavaScript is a browser source entry; test its pure adapter without a DOM or listener.
import assert from 'node:assert/strict';
import {test} from 'node:test';
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
