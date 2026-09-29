// Read the owner state used to compare the real preview before and after reset.
import assert from 'node:assert/strict';

export async function qualificationSnapshot(readJson) {
  const snapshot = (await readJson('/api/monitor/v1/sessions?snapshotVersion=1.2')).snapshot;
  assert.equal(snapshot.apiVersion, '1.2', 'reset qualification requires shared title metadata');
  return snapshot;
}
