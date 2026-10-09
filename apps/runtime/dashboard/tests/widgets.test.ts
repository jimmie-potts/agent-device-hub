// The widget catalog and the home layout (Hub #277), on the runtime (Hub #922): widgets name the families they
// sync or the private content they read, and the home follows the owner-approved mockup, with the Hub mode (#924) and the inbox (#923) as slots.
import assert from 'node:assert/strict';
import test from 'node:test';
import {homeLayout, invalidPlacements, widgetCatalog, widgetDefinition} from '../src/widgets.ts';

void test('every catalog widget declares its source, read surface, sizes and command behavior', () => {
  const ids = widgetCatalog.map(widget => widget.id);
  assert.deepEqual([...new Set(ids)], ids, 'IDs are unique');
  for (const widget of widgetCatalog) {
    assert.match(widget.id, /^[a-z0-9-]+$/);
    assert.ok(widget.name.length > 0 && widget.description.length > 0, widget.id);
    assert.ok(['core', 'module', 'external'].includes(widget.source.kind), widget.id);
    assert.ok(widget.source.families.length > 0 || (widget.source.content?.length ?? 0) > 0, `${widget.id} names its read surface`);
    assert.ok(widget.sizes.length > 0, `${widget.id} declares a size`);
    assert.equal(typeof widget.commands, 'boolean');
  }
  assert.deepEqual(widgetDefinition('sessions')?.source, {kind: 'core', families: ['session']});
  assert.equal(widgetDefinition('attention')?.commands, false, 'a read-only widget declares no command action');
  assert.deepEqual(widgetDefinition('wispr')?.source, {kind: 'module', families: [], content: ['wispr/status', 'wispr/summary']});
  assert.equal(widgetDefinition('wispr')?.commands, false);
  assert.equal(widgetDefinition('missing'), undefined);
});

void test('the home keeps mode and sessions wide, with inbox, attention and optional Wispr narrow', () => {
  const {wide, narrow} = homeLayout();
  assert.deepEqual(wide.map(placement => placement.widget), ['hub-mode', 'sessions']);
  assert.deepEqual(narrow.map(placement => placement.widget), ['inbox', 'attention', 'wispr']);
  assert.deepEqual(invalidPlacements([...wide, ...narrow]), []);
  assert.equal(widgetDefinition('hub-mode')?.commands, true);
  assert.deepEqual(widgetDefinition('hub-mode')?.source.families, ['mode', 'operation']);
  assert.deepEqual(widgetCatalog.filter(widget => widget.slot !== undefined).map(widget => [widget.id, widget.slot?.story]), [['inbox', '#923']]);
});

void test('a placement outside the catalog or at an undeclared size is reported', () => {
  assert.deepEqual(invalidPlacements([{widget: 'graph', size: 'small'}, {widget: 'attention', size: 'large'}]),
    [{widget: 'graph', size: 'small'}, {widget: 'attention', size: 'large'}]);
});
