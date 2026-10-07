// The module's section and the cutover's conversion (Hub #928). The conversion reads today's mode files as the old
// controller wrote them, and its fail-closed cases are converted from controllers/lifx/tests/status.test.mjs at main
// 483d3a93: a symlinked file or a group-readable folder reads as Free.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chmod, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkConfiguration} from '@jimmie-potts/sdk';
import {configureLifx, convertLegacyConfiguration, createLifxModule, lifxModuleFactory, readLegacyModes, SimulatedLifx, type LegacyMode} from '../src/index.js';
import {BEAM, it, PENDANT, SECTION} from './support.js';

const refusal = (section: unknown): string | undefined => {
  const answer = configureLifx(section);
  return 'error' in answer ? answer.error.code : undefined;
};

it('the section names the bulbs as the module\'s devices, with the default bounds', () => {
  const answer = configureLifx({...SECTION, secrets: {token: '/nowhere/unused'}});
  assert.ok(!('error' in answer));
  assert.deepEqual(answer.devices, ['pendant-1', 'beam']);
  assert.deepEqual([answer.config.timeoutMs, answer.config.retries, answer.config.maxPending], [500, 1, 8]);
  assert.deepEqual(answer.config.bulbs[0]?.status, {brightnessCapPercent: 50, quietCapPercent: 20});
  const checked = checkConfiguration(createLifxModule({transport: new SimulatedLifx()}).manifest, SECTION);
  assert.equal(checked.status, 'accepted', 'the runtime\'s own check accepts it');
  const simulated = checkConfiguration(lifxModuleFactory.simulate().manifest, {...lifxModuleFactory.simulatedSection.config});
  assert.deepEqual(simulated.status === 'accepted' && simulated.devices, ['pendant-1', 'beam'], 'the factory\'s simulated section');
});

it('a malformed section is refused with fixed text that repeats no value from it', () => {
  const cases: unknown[] = [
    undefined, [], {}, {bulbs: []}, {bulbs: [PENDANT], extra: 1}, {bulbs: [{...PENDANT, id: 'Pendant 1'}]}, {bulbs: [{...PENDANT, address: 'bulb.local'}]},
    {bulbs: [{...PENDANT, address: '192.0.2.255'}]}, {bulbs: [PENDANT, {...BEAM, address: PENDANT.address}]}, {bulbs: [PENDANT, {...BEAM, id: PENDANT.id}]},
    {bulbs: [{...PENDANT, status: {brightnessCapPercent: 0}}]}, {bulbs: [{...PENDANT, initialMode: 'party'}]}, {bulbs: [{...PENDANT, vendor: -1}]},
    {bulbs: [{...PENDANT, label: 'desk'}]}, {...SECTION, timeoutMs: 5001}, {...SECTION, retries: 4}, {...SECTION, maxPending: 33},
    {bulbs: Array.from({length: 33}, (_, index) => ({id: `bulb-${index}`, address: `192.0.2.${index + 1}`}))},
  ];
  for (const section of cases) {
    assert.equal(refusal(section), 'invalid-request', JSON.stringify(section));
    const answer = configureLifx(section);
    if ('error' in answer) assert.ok(!(answer.error.detail ?? '').includes('192.0.2'), 'no address in the detail');
  }
});

/** Writes a bulb's mode file as the old controller did: the SHA-256 of its device ID, owner-only. */
async function writeMode(folder: string, deviceId: string, mode: string): Promise<string> {
  const file = join(folder, `${createHash('sha256').update(deviceId).digest('hex')}.json`);
  await writeFile(file, JSON.stringify({mode}), {mode: 0o600});
  return file;
}

it('the conversion keeps every bulb\'s address, model evidence, status caps and mode', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lifx-conversion-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const modes = join(root, 'modes');
  await mkdir(modes, {mode: 0o700});
  await writeMode(modes, 'pendant-1', 'Work');
  await writeMode(modes, 'Desk_Lamp', 'Quiet');
  const legacy = {
    controllerId: 'lifx', sourceId: 'lifx-lan', timeoutMs: 400, retries: 2,
    status: {hubUrl: 'http://127.0.0.1:8788', ownerId: 'owner', tokenFile: '/absolute/private/hub-read-token'},
    bulbs: [
      {deviceId: 'pendant-1', address: '192.168.1.40', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90, status: {brightnessCapPercent: 60, quietCapPercent: 10}},
      {deviceId: 'Desk_Lamp', address: '192.168.1.41', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90},
      {deviceId: 'hall', address: '192.168.1.42', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90},
      {deviceId: 'beam', address: '192.168.1.43', vendor: 1, product: 38, firmwareMajor: 3, firmwareMinor: 70},
    ],
  };
  const read = readLegacyModes(modes, legacy.bulbs.map(bulb => bulb.deviceId));
  assert.deepEqual([...read], [['pendant-1', 'Work'], ['Desk_Lamp', 'Quiet'], ['hall', 'Free'], ['beam', 'Free']]);
  const converted = convertLegacyConfiguration(legacy, read);
  assert.ok(!('error' in converted));
  assert.deepEqual(converted.section, {
    timeoutMs: 400, retries: 2,
    bulbs: [
      {id: 'pendant-1', address: '192.168.1.40', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90, status: {brightnessCapPercent: 60, quietCapPercent: 10}, initialMode: 'work'},
      {id: 'desk-lamp', address: '192.168.1.41', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90, initialMode: 'quiet'},
      {id: 'hall', address: '192.168.1.42', vendor: 1, product: 27, firmwareMajor: 2, firmwareMinor: 90, initialMode: 'free'},
      {id: 'beam', address: '192.168.1.43', vendor: 1, product: 38, firmwareMajor: 3, firmwareMinor: 70},
    ],
  });
  assert.deepEqual(converted.renamed, [{from: 'Desk_Lamp', to: 'desk-lamp'}]);
  assert.equal(refusal(converted.section), undefined, 'the module accepts what the conversion wrote');
  // Without the old host's status feed, no bulb painted, so none keeps its caps.
  const withoutFeed = convertLegacyConfiguration({...legacy, status: undefined}, read);
  assert.ok(!('error' in withoutFeed));
  assert.equal(withoutFeed.section.bulbs[0]?.status, undefined);
  // Two device IDs that become one routing ID are refused, as the runtime would refuse them.
  const clash = convertLegacyConfiguration({bulbs: [{deviceId: 'Desk', address: '192.168.1.41'}, {deviceId: 'desk', address: '192.168.1.42'}]}, new Map());
  assert.equal('error' in clash && clash.error.code, 'invalid-request');
});

it('a mode file that is a link, or a folder others can read, reads as Free, as the old controller read it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'lifx-conversion-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const modes = join(root, 'modes');
  await mkdir(modes, {mode: 0o700});
  const target = join(root, 'elsewhere.json');
  await writeFile(target, JSON.stringify({mode: 'Work'}), {mode: 0o600});
  await symlink(target, join(modes, `${createHash('sha256').update('linked').digest('hex')}.json`));
  await writeMode(modes, 'invalid', 'Party');
  await writeFile(join(modes, `${createHash('sha256').update('garbage').digest('hex')}.json`), 'not json', {mode: 0o600});
  const expected: [string, LegacyMode][] = [['linked', 'Free'], ['invalid', 'Free'], ['garbage', 'Free'], ['missing', 'Free']];
  assert.deepEqual([...readLegacyModes(modes, ['linked', 'invalid', 'garbage', 'missing'])], expected);
  await writeMode(modes, 'shared', 'Quiet');
  await chmod(modes, 0o750);
  assert.deepEqual([...readLegacyModes(modes, ['shared'])], [['shared', 'Free']], 'a group-readable folder fails closed');
});
