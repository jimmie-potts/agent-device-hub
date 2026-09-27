import {existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {appendFile, mkdtemp, readdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {RECEIPT_VERSION, type Receipt} from './types.js';
import {ANY_RUN_ID, KEBAB, holder, holderAlive, iso, pause} from './util.js';

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
    // Always written by 1.0.0; optional so a reader accepts records from before it existed.
    if ('scenario' in capture) string(capture.scenario, `${path}.scenario`);
    if ('fresh' in capture && capture.fresh !== true) fail(`${path}.fresh`, 'expected true when present');
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
    if (typeof preview.leaseMinutes !== 'number' || !(preview.leaseMinutes > 0) || preview.leaseMinutes > 1440) fail(`${p}.leaseMinutes`, 'expected minutes greater than 0 and at most 1440');
  });

  const owned = object(receipt.owned, 'owned');
  // Names derive from a valid run id only; an invalid one is reported above, never turned into a pattern.
  const runId = typeof receipt.runId === 'string' && ANY_RUN_ID.test(receipt.runId) ? receipt.runId : undefined;
  if (runId === undefined || owned.unit !== `app-verify-${runId}.service`) fail('owned.unit', 'expected app-verify-<run-id>.service');
  if (typeof owned.leaseTimer !== 'string' || runId === undefined || !(owned.leaseTimer === `app-verify-${runId}-lease.timer` || /^-lease-\d+\.timer$/.test(owned.leaseTimer.slice(`app-verify-${runId}`.length)) && owned.leaseTimer.startsWith(`app-verify-${runId}-lease-`))) fail('owned.leaseTimer', 'expected app-verify-<run-id>-lease[-<k>].timer');
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

const LOCK_WAIT_MS = 10000;
/** A lock or breaker directory without a readable holder this old was left by a killed writer. */
const HOLDERLESS_MS = 5000;

/** The receipt is held by another live operation. */
export class LockedError extends Error {}

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

  /**
   * Read-modify-write under a lock shared by every operation on this run.
   * The lock is a directory holding its holder's PID, start time and a nonce,
   * created atomically by renaming a prepared directory into place. A dead
   * holder's lock is broken by renaming it aside and deleting it only if it
   * still names that holder. The receipt is written only while the lock
   * still names this operation, and only this operation's lock is released.
   * A live holder is waited for up to 10 s, then reported as locked.
   */
  async update(change: (receipt: Receipt) => void | Promise<void>): Promise<Receipt> {
    const lock = join(this.dir, '.receipt.lock');
    const mine = `${(await holder()).trim()} ${randomBytes(8).toString('hex')}\n`;
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      if (await this.acquire(lock, mine)) break;
      const record = await readFile(join(lock, 'holder'), 'utf8').catch(() => undefined);
      let blocker: string | undefined;
      if (record === undefined) {
        // Released meanwhile, or a lock from an older writer that never recorded a holder.
        const info = await stat(lock).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > HOLDERLESS_MS) blocker = await this.breakDead(lock, undefined);
      } else if (!(await holderAlive(record))) {
        blocker = await this.breakDead(lock, record);
      } else blocker = `another operation (pid ${record.trim().split(' ')[0]})`;
      // Every path is bounded: a stuck holder or lock breaker ends in receipt-locked, never an endless wait.
      if (Date.now() > deadline) throw new LockedError(`${blocker ?? 'another operation'} held the receipt lock for ${LOCK_WAIT_MS / 1000} s; retry when it finishes`);
      await pause(blocker ? 50 : 10);
    }
    await this.sweep();
    try {
      const receipt = await this.read();
      await change(receipt);
      // Fencing: never write after losing the lock, so a displaced operation cannot overwrite another's update.
      if ((await readFile(join(lock, 'holder'), 'utf8').catch(() => undefined)) !== mine) throw new LockedError('the receipt lock changed hands during this operation; nothing was written, retry it');
      await this.write(receipt);
      return receipt;
    } finally {
      // Released by renaming it aside first: an emptied lock directory could otherwise be replaced mid-delete.
      if ((await readFile(join(lock, 'holder'), 'utf8').catch(() => undefined)) === mine) await this.tombstone(lock, mine);
    }
  }

  /** Put a prepared lock in place; `false` when another lock already holds the name. */
  private async acquire(lock: string, mine: string): Promise<boolean> {
    const prepared = await mkdtemp(join(this.dir, '.receipt.lock.new-'));
    await writeFile(join(prepared, 'holder'), mine);
    try {
      await rename(prepared, lock);
      return true;
    } catch (error) {
      await rm(prepared, {recursive: true, force: true});
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'ENOTDIR') return false;
      throw error;
    }
  }

  /**
   * Remove a dead holder's lock, and only that lock. Breaking is serialized
   * under a short-lived breaker lock: while it is held nothing else can
   * replace the main lock, so a lock that still names the dead holder is
   * exactly the one removed, and a live lock is never displaced.
   */
  private async breakDead(lock: string, record: string | undefined): Promise<string | undefined> {
    const breaker = `${lock}.break`;
    const me = `${(await holder()).trim()} ${randomBytes(8).toString('hex')}\n`;
    if (!(await this.acquire(breaker, me))) {
      // A breaker killed mid-break, or one that never recorded a holder, is dead: clear it and try again.
      const other = await readFile(join(breaker, 'holder'), 'utf8').catch(() => undefined);
      if (other !== undefined && !(await holderAlive(other))) await this.tombstone(breaker, other);
      else if (other === undefined) {
        const info = await stat(breaker).catch(() => undefined);
        if (info && Date.now() - info.mtimeMs > HOLDERLESS_MS) await this.tombstone(breaker, undefined);
        else if (info) return 'a lock breaker without a holder';
      } else return `a lock breaker (pid ${other.trim().split(' ')[0]})`;
      return undefined;
    }
    try {
      if ((await readFile(join(lock, 'holder'), 'utf8').catch(() => undefined)) === record) await this.tombstone(lock, record);
    } finally {
      if ((await readFile(join(breaker, 'holder'), 'utf8').catch(() => undefined)) === me) await this.tombstone(breaker, me);
    }
    return undefined;
  }

  /** Remove lock litter a killed process left: prepared or set-aside lock directories older than a minute. */
  private async sweep(): Promise<void> {
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (!/^\.receipt\.lock\.(?:new|dead)-/.test(name)) continue;
      const info = await stat(join(this.dir, name)).catch(() => undefined);
      if (info && Date.now() - info.mtimeMs > 60000) await rm(join(this.dir, name), {recursive: true, force: true});
    }
  }

  /** Rename a lock aside and delete it if it still names `record`; otherwise put it back. */
  private async tombstone(path: string, record: string | undefined): Promise<void> {
    const aside = join(this.dir, `.receipt.lock.dead-${randomBytes(8).toString('hex')}`);
    try {
      await rename(path, aside);
    } catch {
      return;
    }
    if ((await readFile(join(aside, 'holder'), 'utf8').catch(() => undefined)) !== record) {
      try {
        await rename(aside, path);
        return;
      } catch {
        // Taken again meanwhile; its holder's fencing check refuses to write.
      }
    }
    await rm(aside, {recursive: true, force: true});
  }
}
