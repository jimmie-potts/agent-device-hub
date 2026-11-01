// Runs only inside the explicit offline test image, beneath its independent hard deadline.
import {spawn, type ChildProcess} from 'node:child_process';
import {mkdir, chmod, readFile, writeFile, rename, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {artifactDigest, artifactHash, runCaptureStep, type CaptureStepResult, type ReadyLine, type PortableManifest} from '@jimmie-potts/app-verify';
import {Outcome} from '@jimmie-potts/sdk';
import plugin from './plugin.js';

async function main(): Promise<void> {
  const runId = process.env.APP_VERIFY_RUN_ID ?? '', revision = process.env.APP_VERIFY_REVISION ?? '';
  const build = JSON.parse(await readFile('/opt/bunny/portable-artifact.json', 'utf8')) as {schema?: string; revision?: string; artifactDigest?: string};
  const expected = build.artifactDigest ?? '', stepName = process.env.APP_VERIFY_STEP ?? '';
  if (!/^runtime-\d{8}T\d{6}Z-[a-f0-9]{6}$/.test(runId) || !/^[a-f0-9]{40}$/.test(revision)
    || build.schema !== 'portable-artifact/1' || build.revision !== revision
    || !/^sha256:[a-f0-9]{64}$/.test(expected) || !Object.hasOwn(plugin.captureSteps, stepName)) throw new Error('input refused');
  const runtimeDir = `/var/lib/app-verify/${runId}`, dataDir = join(runtimeDir, 'data'), proofDir = join(runtimeDir, 'proof');
  for (const at of [runtimeDir, dataDir, proofDir, join(runtimeDir, 'home'), join(runtimeDir, 'tmp')]) {
    await mkdir(at, {mode: 0o700}); await chmod(at, 0o700);
  }
  const manifest: PortableManifest = {schema: 'portable-capture/1', runId, revision, artifactDigest: expected,
    step: stepName, outcome: Outcome.failed, assertions: 0, files: []};
  const save = async () => {
    await writeFile(join(proofDir, 'manifest.next'), JSON.stringify(manifest), {mode: 0o600});
    await rename(join(proofDir, 'manifest.next'), join(proofDir, 'manifest.json'));
  };
  await save(); // Even a hard kill leaves attributable, explicitly incomplete evidence.
  let child: ChildProcess | undefined, result: CaptureStepResult | undefined;
  let exited: Promise<number | null> | undefined;
  let stage = 'candidate-check';
  try {
    const root = await stat(plugin.root);
    if (root.uid !== 0 || (root.mode & 0o222) !== 0) throw new Error('candidate writable');
    const digest = await artifactDigest(plugin, '', AbortSignal.timeout(10_000));
    if (digest !== expected) throw new Error('candidate drift');
    const step = plugin.captureSteps[stepName];
    if (step === undefined) throw new Error('unknown capture step');
    const scenario = step.scenario ?? plugin.defaultScenario, seed = plugin.scenarios[scenario];
    if (seed === undefined) throw new Error('unknown capture scenario');
    stage = 'seed';
    await seed.seed({runId, root: plugin.root, runtimeDir, dataDir, scenario, inputs: {}});
    stage = 'launch';
    const launch = await plugin.launch({runId, root: plugin.root, runtimeDir, dataDir, proofDir, scenario,
      node: process.execPath, port: 0, endpointPorts: {}, inputs: {}});
    const program = launch.argv[0];
    if (program === undefined) throw new Error('launch refused');
    const launched = spawn(program, [...launch.argv.slice(1)], {cwd: launch.cwd ?? plugin.root,
      env: {...process.env, ...launch.env}, stdio: ['ignore', 'pipe', 'pipe']});
    child = launched;
    const exit = new Promise<number | null>(resolve => {launched.once('exit', code => resolve(code)); launched.once('error', () => resolve(-1));});
    exited = exit;
    // Discard raw child diagnostics; they remain private in memory, never exported as proof.
    const errors = launched.stderr, output = launched.stdout;
    if (errors === null || output === null) throw new Error('launch streams unavailable');
    errors.resume();
    stage = 'readiness';
    const ready = await new Promise<ReadyLine>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('readiness unavailable')), 30_000);
      output.setEncoding('utf8').on('data', (chunk: string) => {
        text += chunk;
        if (text.length > 64 * 1024) {reject(new Error('readiness too large')); return;}
        let end: number;
        while ((end = text.indexOf('\n')) >= 0) {
          const line = plugin.readiness.line(text.slice(0, end)); text = text.slice(end + 1);
          if (line) {clearTimeout(timer); resolve(line);}
        }
      });
      void exit.then(() => {clearTimeout(timer); reject(new Error('candidate exited'));});
    });
    const context = {runId, root: plugin.root, runtimeDir, dataDir, scenario, url: ready.url, port: Number(new URL(ready.url).port),
      inputs: {}, endpoints: ready.endpoints ?? {}, signal: AbortSignal.timeout(30_000)};
    const health = await plugin.readiness.probe(context);
    if (!health.ok) throw new Error('readiness refused');
    stage = 'boundary-checks';
    for (const check of plugin.checks ?? []) {
      // The closed committed image and digest replace the source-mtime/git check, which cannot run inside an export.
      if (check.id !== 'build-current' && (await check.run(context)).outcome !== 'passed') throw new Error('boundary refused');
    }
    stage = 'capture';
    result = await runCaptureStep(plugin, stepName, {...context, outputDir: join(proofDir, 'capture'), artifactDigest: expected});
    manifest.outcome = result.outcome; manifest.assertions = result.assertions.length;
    if (await artifactDigest(plugin, '', AbortSignal.timeout(10_000)) !== expected) {stage = 'artifact-drift'; manifest.outcome = Outcome.failed;}
  } catch {manifest.outcome = Outcome.failed;}
  finally {
    if (child && exited) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child?.kill('SIGKILL'), 9000);
      if (await exited !== 0) {stage = 'stop'; manifest.outcome = Outcome.failed;}
      clearTimeout(timer);
    }
  }
  if (result) {
    const selected = [result.log, ...(manifest.outcome === 'passed' ? [result.screenshot, result.video, ...result.attachments] : [])];
    for (const at of selected) {
      if (at === null) continue;
      const name = at.slice(proofDir.length + 1).replaceAll('\\', '/');
      if (!['capture/assertions.json', 'capture/after.png', 'capture/interaction.webm', 'capture/checks.json', 'capture/scenario-result.json'].includes(name)) {
        manifest.outcome = Outcome.failed; break;
      }
      const bytes = await readFile(at);
      if (bytes.length > 32 * 1024 * 1024 || name.endsWith('.json') && /Bearer |tok_SYNTHETIC|PRIVATE_CANARY|DO_NOT_OPEN/.test(bytes.toString())) {
        manifest.outcome = Outcome.failed; manifest.files = []; break;
      }
      manifest.files.push({name, bytes: bytes.length, sha256: artifactHash(bytes)});
    }
  }
  if (manifest.outcome !== 'passed') {
    const path = join(proofDir, 'capture', 'checks.json');
    await mkdir(join(proofDir, 'capture'), {recursive: true, mode: 0o700});
    const bytes = Buffer.from(JSON.stringify({synthetic: true, physical: false, stage, status: 'incomplete'}));
    await writeFile(path, bytes, {mode: 0o600});
    manifest.files = manifest.files.filter(file => file.name !== 'capture/checks.json');
    manifest.files.push({name: 'capture/checks.json', bytes: bytes.length, sha256: artifactHash(bytes)});
  }
  await save();
  process.exitCode = manifest.outcome === 'passed' ? 0 : 1;
}
try {await main();} catch {process.exitCode = 1;}
