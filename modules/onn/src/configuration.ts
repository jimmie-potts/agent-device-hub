import {isAbsolute} from 'node:path';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
export type OnnConfig = {
  id: string; configurationRevision: number; adbSocket: string; serial: string;
  hostExecutable: string; hostExecutableSha256: string; hostVersion: '37.0.1'; hostKeyDirectory: string;
};
const keys = ['id', 'configurationRevision', 'adbSocket', 'serial', 'hostExecutable', 'hostExecutableSha256', 'hostVersion', 'hostKeyDirectory'];
export const configureOnn = (value: unknown): {config: OnnConfig; devices: string[]} | ErrorBody => {
  const invalid = () => errorBody('invalid-request', {detail: 'ONN needs one qualified private ADB configuration'});
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const section = value as Record<string, unknown>;
  if (Object.keys(section).some(key => !keys.includes(key))) return invalid();
  const {id, configurationRevision, adbSocket, serial, hostExecutable, hostExecutableSha256, hostVersion, hostKeyDirectory} = section;
  if (typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 128
    || !Number.isSafeInteger(configurationRevision) || (configurationRevision as number) < 1
    || typeof adbSocket !== 'string' || !isAbsolute(adbSocket) || Buffer.byteLength(adbSocket) > 100
    || typeof hostExecutable !== 'string' || !isAbsolute(hostExecutable)
    || typeof hostKeyDirectory !== 'string' || !isAbsolute(hostKeyDirectory)
    || typeof hostExecutableSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(hostExecutableSha256) || hostVersion !== '37.0.1'
    || typeof serial !== 'string' || !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}:[0-9]{1,5}$/.test(serial)) return invalid();
  const [host, port] = serial.split(':');
  if (host === undefined || host.split('.').some(octet => Number(octet) > 255) || Number(port) < 1 || Number(port) > 65535) return invalid();
  return {config: section as OnnConfig, devices: [id]};
};
