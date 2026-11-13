import {isRegisteredStandbyCore} from './core/core.js';
import {readStandbyCredentials, standbyCredentialList, type EdgeCredential} from './credentials.js';
import {RuntimeError} from './state.js';

declare const standbyAdmissionBrand: unique symbol;
export type StandbyCredentialAdmission = {readonly [standbyAdmissionBrand]: true};
const standbyStartupGrants = new WeakMap<StandbyCredentialAdmission, {
  core: object; file: string; credentials: readonly EdgeCredential[];
}>();

/** Reads a private file before bootstrap and binds its snapshot to the core instance about to start. */
export async function admitStandbyStartupCredentials(core: object, file: string): Promise<StandbyCredentialAdmission> {
  if (!isRegisteredStandbyCore(core)) throw new RuntimeError('edge-credentials-invalid', 'standby credentials need a registered standby core');
  const credentials = standbyCredentialList(await readStandbyCredentials(file));
  const admission = Object.freeze({}) as StandbyCredentialAdmission;
  standbyStartupGrants.set(admission, {core, file, credentials});
  return admission;
}

/** A snapshot is accepted once, for the original file and the runtime's exact registered standby core. */
export function takeStandbyStartupCredentials(admission: StandbyCredentialAdmission, core: object,
  file: string): readonly EdgeCredential[] {
  const snapshot = standbyStartupGrants.get(admission);
  if (snapshot === undefined || snapshot.core !== core || snapshot.file !== file) throw new RuntimeError('edge-credentials-invalid', 'the credentials have no matching standby admission');
  standbyStartupGrants.delete(admission);
  return snapshot.credentials;
}
