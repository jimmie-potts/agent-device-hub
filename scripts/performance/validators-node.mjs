import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {platform, release, loadavg} from 'node:os';

const MANIFEST = 'ac8a72433adc8d516715476e842f2deccafeec748b2292c6df9d96b5afa93f96';
const CORPUS = '872e5104bb9a109853948e61cee4d900b7c7acecde65de5313c3064194089fec';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const elapsed = start => Number(process.hrtime.bigint() - start);

function detachedEqual(actual, expected) {
  if (expected !== null && typeof expected === 'object') {
    return actual !== expected && actual !== null && typeof actual === 'object'
      && Array.isArray(actual) === Array.isArray(expected)
      && JSON.stringify(Object.keys(actual)) === JSON.stringify(Object.keys(expected))
      && Object.keys(expected).every(key => detachedEqual(actual[key], expected[key]));
  }
  return Object.is(actual, expected);
}

async function main() {
  const [directory, cycleText, warmupText] = process.argv.slice(2);
  const cycles = Number(cycleText), warmups = Number(warmupText);
  if (!directory || !Number.isInteger(cycles) || cycles < 1 || cycles > 1000
      || !Number.isInteger(warmups) || warmups < 0 || warmups > 100
      || Number(process.versions.node.split('.')[0]) !== 24) throw new Error('invalid-worker-configuration');
  if (sha256(readFileSync(join(directory, 'manifest.json'))) !== MANIFEST) throw new Error('manifest-mismatch');
  const fixture = readFileSync(join(directory, 'fixtures', 'lifecycle-v1.json'));
  if (sha256(fixture) !== CORPUS) throw new Error('corpus-mismatch');
  const corpus = JSON.parse(fixture), cases = corpus.cases.filter(item => item.valid === true);
  if (corpus.cases.length !== 81 || cases.length !== 33) throw new Error('unexpected-corpus-inventory');
  const require = createRequire(pathToFileURL(join(directory, 'package.json')));
  const dependency = JSON.parse(readFileSync(require.resolve('ajv/package.json')));
  if (dependency.version !== '8.20.0') throw new Error('unexpected-ajv-version');
  const began = process.hrtime.bigint();
  const api = await import(pathToFileURL(join(directory, 'dist', 'index.js')));
  const importNs = elapsed(began);
  if (api.ARTIFACT_VERSION !== '1.0.0' || api.API_VERSION !== '1.0') throw new Error('unexpected-validator-version');
  emit({type: 'ready', importNs, runtime: {language: 'node', version: process.versions.node,
    dependencyVersion: dependency.version, system: platform(), release: release()}});
  const originals = cases.map(item => JSON.stringify(item.input));
  function invoke(index) {
    const input = cases[index].input, start = process.hrtime.bigint();
    const result = api.validateEvent(input), duration = elapsed(start);
    if (result.ok !== true || !detachedEqual(result.value, input) || JSON.stringify(input) !== originals[index]) {
      throw new Error('validator-result-mismatch');
    }
    return duration;
  }
  const firstCallNs = invoke(0), rssBeforeBytes = process.memoryUsage().rss, cpuStarted = process.cpuUsage();
  for (let cycle = 0; cycle < warmups; cycle++) for (let i = 0; i < cases.length; i++) invoke(i);
  const durationNs = [];
  for (let cycle = 0; cycle < cycles; cycle++) for (let i = 0; i < cases.length; i++) durationNs.push(invoke(i));
  const cpu = process.cpuUsage(cpuStarted);
  emit({type: 'result', firstCallNs, durationNs, cpuWarmupAndChecksNs: (cpu.user + cpu.system) * 1000,
    rssBeforeBytes, rssAfterBytes: process.memoryUsage().rss, rssMethod: 'instantaneous-process-rss',
    loadAverage: process.platform === 'win32' ? null : loadavg()});
}

main().catch(() => { process.exitCode = 2; });
