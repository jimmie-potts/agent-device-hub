// Records of the module families that declare bookkeeping members (Hub #1771), as their modules publish them: the
// fixtures `bookkeeping.test.ts` checks the declaration against and `history-spans.test.ts` runs through history's intake.
export const AT = 1_791_287_998_500;
export const known = (value: number): {status: 'known'; value: number} => ({status: 'known', value});
const STATUS_KEYS = ['state', 'batteryPercent', 'cleanTimeSeconds', 'cleanAreaMm2', 'inCleaning', 'inReturning', 'errorCode', 'dockErrorStatus', 'chargeStatus',
  'dustCollectionStatus', 'waterBoxStatus', 'waterShortageStatus', 'washStatus', 'washPhase', 'dryStatus', 'avoidCount', 'dss'];
const CONSUMABLE_KEYS = ['mainBrushSeconds', 'sideBrushSeconds', 'filterSeconds', 'filterElementSeconds', 'sensorSeconds', 'strainerCycles', 'dustCollectionCycles',
  'cleaningBrushCycles'];
export const monitor = {filter: {q: 'build'}, cadenceMs: 10_000, connection: 'current', sessions: 4, matched: 3, attention: 1, page: 1, pages: 2};
const player = {state: 'playing', intent: 'active', playlistId: null, itemId: null, renditionId: null, lastError: null};
export const RECORDS: Readonly<Record<string, {type: string; data: Record<string, unknown>}>> = {
  'lifx-light/2.0': {type: 'org.bunny.lifx-light.updated', data: {
    id: 'bulb', revision: 4, capabilities: {color: {supported: true}, temperature: {supported: true, minimum: 1500, maximum: 9000}},
    observed: {status: 'known', observedAtMs: AT, hue: 120, saturation: 50, brightness: 80, kelvin: 3500},
  }},
  'roborock-vacuum/2.0': {type: 'org.bunny.roborock-vacuum.updated', data: {
    schema: 'roborock-vacuum/2.0', id: 'vacuum', revision: 7, observedAtMs: known(AT), availability: 'available', activity: 'cleaning',
    status: Object.fromEntries(STATUS_KEYS.map(key => [key, known(1)])),
    consumables: {observedAtMs: known(AT - 60_000), ...Object.fromEntries(CONSUMABLE_KEYS.map(key => [key, known(2)]))},
    totals: {observedAtMs: known(AT - 60_000), cleanTimeSeconds: known(3), cleanAreaMm2: known(4), cleanCount: known(5), dustCollectionCount: known(6)},
    collection: {retainedRuns: 1, observedSamples: 2, gaps: 0, history: 'partial', maps: 'unverified', clock: 'unqualified', lastFailure: {status: 'unknown'}},
  }},
  'pixoo-display/2.1': {type: 'org.bunny.pixoo-display.updated', data: {
    id: 'pixoo', revision: 9, mode: 'work', pendingMode: null, base: 'status', participating: true, showing: 'dashboard', monitor,
    nowPlaying: {media: 'popup', card: false, stale: false, takeover: null}, player, moments: {overStatus: true, playing: null},
  }},
  'pixoo-display/2.0': {type: 'org.bunny.pixoo-display.updated', data: {
    id: 'pixoo', revision: 9, mode: 'monitor', participating: true, pendingMode: null, showing: 'dashboard', monitor,
    nowPlaying: {media: 'popup', card: false, stale: false, takeover: null}, player, moments: {overMonitor: true, playing: null},
  }},
};

