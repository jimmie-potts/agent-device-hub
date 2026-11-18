// The Monitor's markers follow the hub's shared status (Hub #1865, design decision 10). Every check of the contracts
// package's shared synthetic case set goes through the Monitor's own source (`monitorView`, from the views the shared
// read function gives) and its pager, and each root row's uncertain marker, and its children marker where the case pins
// it, must be what the case expects.
import {expect, it} from 'vitest';
import {loadSessionCases} from '@jimmie-potts/event-contracts/v2/session-cases';
import {DashboardPager} from '../../src/presentation/agent-dashboard.js';
import {monitorView} from '../../src/presentation/sources.js';

it('marks each root row of every shared case as the case expects', () => {
  let checked = 0;
  for (const item of loadSessionCases().cases) {
    for (const [index, check] of item.checks.entries()) {
      const where = `${item.id} check ${index}`;
      const views = Object.entries(check.views);
      const state = monitorView({state: check.synced ? 'current' : 'stale', revision: 1, sessions: views.map(([, view]) => view)});
      const rows = Object.fromEntries(views.filter(([, view]) => view.parent.status !== 'known').map(([name, view]) => {
        const [row] = new DashboardPager().layout(state, 0, {session: view.identity}).rows;
        expect(row, `${where}: ${name}`).toBeDefined();
        return [name, row];
      }));
      expect(Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, row?.uncertain])), where).toEqual(check.readers.pixoo);
      const children = check.readers.pixooChildren;
      if (children !== undefined) {
        expect(Object.fromEntries(Object.entries(rows).map(([name, row]) => [name, row?.childrenUncertain])), `${where}: children`).toEqual(children);
      }
      checked++;
    }
  }
  expect(checked).toBeGreaterThanOrEqual(25);
});
