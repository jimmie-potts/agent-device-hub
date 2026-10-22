// Internal #1167 early data ownership. This is not the pending/prepared packaged startup gate.
import type {Stats} from 'node:fs';
import {lstat, realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {checkLeaseSidecars, takeExistingLock, type Lock} from './core/lock.js';
import {checkStateDirectory} from './state.js';

declare const ownershipBrand: unique symbol;
/** Only acquisition can mint this capability. Release is allowed only before core binding. */
export type RuntimeOwnership = {readonly [ownershipBrand]: true; releaseBeforeStartup(): void};
export type CoreOwnership = {readonly token: RuntimeOwnership; readonly core: object};
type Identity = readonly [Stats, Stats, Stats];
type Owner = {
  root: string; identity: Identity; lock: Lock;
  phase: 'acquired' | 'bound' | 'reserved' | 'admitted' | 'consumed' | 'released'; core?: object;
};
const owners = new WeakMap<RuntimeOwnership, Owner>();
// A dropped capability or stopped core cannot let SQLite GC end process ownership.
const retained = new Set<Owner>();
export const ownershipUnavailable = (): SdkError => new SdkError(errorBody('unavailable', {detail: 'runtime data ownership is unavailable'}));

async function identity(root: string): Promise<Identity> {
  if (await checkStateDirectory(root) !== root) throw ownershipUnavailable();
  const paths = [root, join(root, 'modules'), join(root, 'modules', 'core.sqlite-owner')] as const;
  const values: Stats[] = [];
  for (const [index, path] of paths.entries()) {
    const info = await lstat(path);
    if (await realpath(path) !== path || info.uid !== process.getuid?.() ||
      (info.mode & 0o7777) !== (index === 2 ? 0o600 : 0o700) ||
      (index === 2 ? !info.isFile() || info.nlink !== 1 || info.size !== 0 : !info.isDirectory())) throw ownershipUnavailable();
    values.push(info);
  }
  await checkLeaseSidecars(paths[2]);
  return values as unknown as Identity;
}
async function revalidate(owner: Owner): Promise<void> {
  const current = await identity(owner.root);
  if (current.some((info, index) => info.dev !== owner.identity[index]?.dev || info.ino !== owner.identity[index]?.ino)) throw ownershipUnavailable();
}

/** Requires pre-existing bootstrap, acquires the existing lease without waiting, and creates no files. */
export async function acquireRuntimeOwnership(stateDir: string): Promise<RuntimeOwnership> {
  let lock: Lock | undefined;
  try {
    const before = await identity(stateDir);
    lock = await takeExistingLock(join(stateDir, 'modules', 'core.sqlite'));
    const owner: Owner = {root: stateDir, identity: before, lock, phase: 'acquired'};
    await revalidate(owner);
    const token = Object.freeze({releaseBeforeStartup: () => {
      if (owner.phase === 'released') return;
      if (owner.phase !== 'acquired') throw ownershipUnavailable();
      owner.lock.release(); owner.phase = 'released'; retained.delete(owner);
    }}) as RuntimeOwnership;
    owners.set(token, owner); retained.add(owner);
    return token;
  } catch {
    lock?.release();
    throw ownershipUnavailable();
  }
}

/** Called only by the actual core factory's binding closure; binding seals release synchronously. */
export function bindRuntimeOwnership(token: RuntimeOwnership, core: object): void {
  const owner = owners.get(token);
  if (owner?.phase !== 'acquired') throw ownershipUnavailable();
  owner.phase = 'bound'; owner.core = core;
}

/** Reserve before any await, so concurrent starts cannot both reach effects. Failed admission is not reusable. */
export async function admitRuntimeOwnership(binding: CoreOwnership, root: string): Promise<void> {
  const owner = owners.get(binding.token);
  if (owner?.phase !== 'bound' || owner.core !== binding.core) throw ownershipUnavailable();
  owner.phase = 'reserved';
  try {
    if (root !== owner.root) throw ownershipUnavailable();
    await revalidate(owner);
    owner.phase = 'admitted';
  } catch {throw ownershipUnavailable();}
}

/** Core start must have passed runtime admission, even when somebody calls the module directly. */
export function assertRuntimeOwnership(binding: CoreOwnership): void {
  const owner = owners.get(binding.token);
  if (owner?.phase !== 'admitted' || owner.core !== binding.core) throw ownershipUnavailable();
}

/** The intended CoreStore consumes once. Closing it cannot release the process's real SQLite owner. */
export function borrowRuntimeOwnership(binding: CoreOwnership, location: string | null): Lock {
  assertRuntimeOwnership(binding);
  const owner = owners.get(binding.token);
  if (owner === undefined || location !== join(owner.root, 'modules', 'core.sqlite')) throw ownershipUnavailable();
  owner.phase = 'consumed';
  return {release: () => {}};
}

/** Maintenance revalidates its actual unbound owner without opening/closing the lease inode. */
export async function assertUnboundRuntimeOwnership(token: RuntimeOwnership, root: string): Promise<void> {
  const owner = owners.get(token);
  if (owner?.phase !== 'acquired' || owner.root !== root) throw ownershipUnavailable();
  await revalidate(owner);
  if (owner.phase !== 'acquired') throw ownershipUnavailable();
}
