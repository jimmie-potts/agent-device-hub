import {existsSync} from 'node:fs';
import {appendFile, mkdir, readFile, rename, rmdir, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {RECEIPT_VERSION, type Receipt} from './types.js';
import {ANY_RUN_ID, KEBAB, iso, pause} from './util.js';

const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}\//;
const STATES = ['starting', 'running', 'failed', 'expired', 'stopped'];

type Value = Record<string, unknown>;
const isObject = (value: unknown): value is Value => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate a parsed receipt against docs/app-verification.md. Fields that a
 * later `app-verification/1` minor version adds are ignored, so an older
 * reader still reads a newer receipt; every documented field is checked.
 */
export function validateReceipt(value: unknown): {ok: true} | {ok: false; errors: string[]} {
  const errors: string[] = [];
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const string = (v: unknown, path: string, pattern?: RegExp) => {
    if (typeof v !== 'string' || v.length === 0 || v.length > 4096) fail(path, 'expected a non-empty string');
    else if (pattern && !pattern.test(v)) fail(path, `does not match ${pattern}`);
  };
  const nullable = (v: unknown, path: string, check: (v: unknown, path: string) => void) => {
    if (v !== null) check(v, path);
  };
  const time = (v: unknown, path: string) => string(v, path, TIME);
  const integer = (v: unknown, path: string, min = 0, max = Number.MAX_SAFE_INTEGER) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(path, `expected an integer from ${min} to ${max}`);
  };
  const object = (v: unknown, path: string): Value => {
    if (!isObject(v)) {
      fail(path, 'expected an object');
      return {};
    }
    return v;
  };
  const oneOf = (v: unknown, path: string, allowed: readonly unknown[]) => {
    if (!allowed.includes(v)) fail(path, `expected one of ${allowed.join(', ')}`);
  };

  const receipt = object(value, 'receipt');
  if (receipt.receiptVersion !== RECEIPT_VERSION) fail('receiptVersion', `expected ${RECEIPT_VERSION}`);
  string(receipt.runId, 'runId', ANY_RUN_ID);
  string(receipt.app, 'app', KEBAB);
  if (typeof receipt.runId === 'string' && typeof receipt.app === 'string' && !receipt.runId.startsWith(receipt.app + '-')) fail('runId', 'does not start with app');
  string(receipt.repository, 'repository', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  const roots = object(receipt.roots, 'roots');
  string(roots.proof, 'roots.proof');
  string(roots.runtime, 'roots.runtime');
  oneOf(receipt.state, 'state', STATES);
  time(receipt.startedAt, 'startedAt');
  if ('restarts' in receipt) string(receipt.restarts, 'restarts', ANY_RUN_ID);

  const build = object(receipt.build, 'build');
  string(build.sourceRevision, 'build.sourceRevision', /^(?:[0-9a-f]{40}|[0-9a-f]{64}|unknown)$/);
  if (typeof build.dirty !== 'boolean') fail('build.dirty', 'expected a boolean');
  nullable(build.artifactDigest, 'build.artifactDigest', (v, p) => string(v, p, /^sha256:[0-9a-f]{64}$/));
  string(build.version, 'build.version');

  const scenario = object(receipt.scenario, 'scenario');
  string(scenario.name, 'scenario.name');
  string(scenario.version, 'scenario.version');
  nullable(scenario.seededAt, 'scenario.seededAt', time);

  if (!Array.isArray(receipt.components)) fail('components', 'expected an array');
  else receipt.components.forEach((c, i) => {
    const component = object(c, `components[${i}]`);
    string(component.id, `components[${i}].id`);
    oneOf(component.kind, `components[${i}].kind`, ['actual', 'simulated']);
    if ('note' in component) string(component.note, `components[${i}].note`);
  });

  if (!Array.isArray(receipt.checks)) fail('checks', 'expected an array');
  else receipt.checks.forEach((c, i) => {
    const check = object(c, `checks[${i}]`);
    string(check.id, `checks[${i}].id`, KEBAB);
    oneOf(check.outcome, `checks[${i}].outcome`, ['passed', 'failed', 'skipped']);
    if (check.outcome !== 'passed') string(check.reason, `checks[${i}].reason`);
  });

  if (!Array.isArray(receipt.captures)) fail('captures', 'expected an array');
  else receipt.captures.forEach((c, i) => {
    const path = `captures[${i}]`;
    const capture = object(c, path);
    integer(capture.n, `${path}.n`, 1);
    string(capture.step, `${path}.step`);
    oneOf(capture.set, `${path}.set`, ['verified', 'after-handoff']);
    oneOf(capture.outcome, `${path}.outcome`, ['passed', 'failed', 'unavailable']);
    if (capture.outcome !== 'passed') string(capture.reason, `${path}.reason`);
    const relative = /^(?:verified\/|after-handoff\/)?capture-\d+\/[A-Za-z0-9._-]+$/;
    nullable(capture.screenshot, `${path}.screenshot`, (v, p) => string(v, p, relative));
    nullable(capture.video, `${path}.video`, (v, p) => string(v, p, relative));
    string(capture.log, `${path}.log`, relative);
    if ('attachments' in capture) {
      if (!Array.isArray(capture.attachments)) fail(`${path}.attachments`, 'expected an array');
      else capture.attachments.forEach((a, j) => string(a, `${path}.attachments[${j}]`, relative));
    }
    time(capture.startedAt, `${path}.startedAt`);
    nullable(capture.finishedAt, `${path}.finishedAt`, time);
    if (capture.outcome === 'passed' && (capture.screenshot === null || capture.video === null || capture.finishedAt === null)) fail(path, 'a passed capture has its screenshot, video and finish time');
  });

  nullable(receipt.preview, 'preview', (v, p) => {
    const preview = object(v, p);
    string(preview.url, `${p}.url`, LOOPBACK);
    time(preview.expiresAt, `${p}.expiresAt`);
    if (typeof preview.leaseMinutes !== 'number' || !(preview.leaseMinutes > 0) || preview.leaseMinutes > 1440) fail(`${p}.leaseMinutes`, 'expected minutes from 0 to 1440');
  });

  const owned = object(receipt.owned, 'owned');
  const runId = typeof receipt.runId === 'string' ? receipt.runId : '';
  if (owned.unit !== `app-verify-${runId}.service`) fail('owned.unit', 'expected app-verify-<run-id>.service');
  string(owned.leaseTimer, 'owned.leaseTimer', new RegExp(`^app-verify-${runId.replace(/-/g, '\\-')}-lease(?:-\\d+)?\\.timer$`));
  nullable(owned.port, 'owned.port', (v, p) => integer(v, p, 1, 65535));
  if (owned.runtimeDir !== runId) fail('owned.runtimeDir', 'expected the run id');
  if (owned.proofDir !== runId) fail('owned.proofDir', 'expected the run id');
  nullable(owned.mainPid, 'owned.mainPid', (v, p) => integer(v, p, 1));
  nullable(owned.mainStartMonotonic, 'owned.mainStartMonotonic', (v, p) => integer(v, p, 0));

  const proof = object(receipt.proof, 'proof');
  nullable(proof.frozenAt, 'proof.frozenAt', time);

  nullable(receipt.failure, 'failure', (v, p) => {
    const failure = object(v, p);
    string(failure.cause, `${p}.cause`, KEBAB);
    time(failure.at, `${p}.at`);
    if ('detail' in failure) string(failure.detail, `${p}.detail`);
  });
  if (receipt.state === 'failed' && receipt.failure === null) fail('failure', 'a failed run names its failure');

  const cleanup = object(receipt.cleanup, 'cleanup');
  oneOf(cleanup.result, 'cleanup.result', ['clean', 'partial', 'unknown', null]);
  if ('at' in cleanup) time(cleanup.at, 'cleanup.at');
  if ('items' in cleanup) {
    if (!Array.isArray(cleanup.items)) fail('cleanup.items', 'expected an array');
    else cleanup.items.forEach((c, i) => {
      const item = object(c, `cleanup.items[${i}]`);
      oneOf(item.kind, `cleanup.items[${i}].kind`, ['unit', 'lease-timer', 'runtime-dir']);
      string(item.name, `cleanup.items[${i}].name`);
      oneOf(item.outcome, `cleanup.items[${i}].outcome`, ['removed', 'absent', 'left', 'unknown']);
    });
  }

  if (receipt.state === 'running') {
    if (receipt.preview === null) fail('preview', 'a running run has a preview');
    if (owned.port === null || owned.mainPid === null) fail('owned', 'a running run records its port and process');
  }
  if (receipt.secrets !== 'none recorded') fail('secrets', 'expected "none recorded"');
  return errors.length ? {ok: false, errors} : {ok: true};
}

/** The proof directory of one run: its receipt, events and captures. */
export class ProofStore {
  constructor(readonly dir: string) {}

  get receiptPath() {
    return join(this.dir, 'receipt.json');
  }

  exists(): boolean {
    return existsSync(this.receiptPath);
  }

  async read(): Promise<Receipt> {
    return JSON.parse(await readFile(this.receiptPath, 'utf8')) as Receipt;
  }

  /** Write atomically after validation; an invalid receipt is a core bug, never written. */
  async write(receipt: Receipt): Promise<void> {
    const checked = validateReceipt(receipt);
    if (!checked.ok) throw new Error(`refusing to write an invalid receipt: ${checked.errors.join('; ')}`);
    const temporary = `${this.receiptPath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', {mode: 0o644});
    await rename(temporary, this.receiptPath);
  }

  async event(event: string, fields: Record<string, unknown> = {}): Promise<void> {
    await appendFile(join(this.dir, 'events.jsonl'), JSON.stringify({at: iso(), event, ...fields}) + '\n');
  }

  /** Read-modify-write under a directory lock shared by concurrent operations on this run. */
  async update(change: (receipt: Receipt) => void | Promise<void>): Promise<Receipt> {
    const lock = join(this.dir, '.receipt.lock');
    const deadline = Date.now() + 20000;
    for (;;) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // A lock older than a minute belongs to a killed operation.
        const info = await stat(lock).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > 60000) await rmdir(lock).catch(() => undefined);
        if (Date.now() > deadline) throw new Error('receipt is locked by another operation');
        await pause(50);
      }
    }
    try {
      const receipt = await this.read();
      await change(receipt);
      await this.write(receipt);
      return receipt;
    } finally {
      await rmdir(lock).catch(() => undefined);
    }
  }
}
