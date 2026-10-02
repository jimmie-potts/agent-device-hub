import { isDeepStrictEqual } from 'node:util';

const id = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const empty = value => value == null || (object(value) && Object.keys(value).length === 0);
const networkOptions = value => value == null || (object(value) && Object.entries(value).every(([key, val]) =>
  (key === 'com.docker.network.enable_ipv4' && val === 'true') || (key === 'com.docker.network.enable_ipv6' && val === 'false')));
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const labelsMatch = (value, plan) => object(value) &&
  Object.entries(plan.labels).every(([key, expected]) => value[key] === expected);

function readNetwork(value, plan, containerId) {
  const deny = () => { throw new Error('Backend network ownership or isolation verification failed'); };
  if (!value || !id(value.Id) || value.Name !== plan.networkName || !timestamp(value.Created) ||
    value.Driver !== 'bridge' || value.Scope !== 'local' || value.Internal !== true ||
    value.Attachable !== false || value.Ingress !== false || !networkOptions(value.Options) ||
    (value.EnableIPv4 !== undefined && value.EnableIPv4 !== true) || (value.EnableIPv6 !== undefined && value.EnableIPv6 !== false) ||
    !labelsMatch(value.Labels, plan) || !object(value.Containers) ||
    (containerId !== undefined && !id(containerId))) deny();
  for (const [key, endpoint] of Object.entries(value.Containers)) {
    if (key !== containerId || endpoint?.Name !== plan.containerName) deny();
  }
  return { networkId: value.Id, name: value.Name, createdAt: value.Created,
    labels: { ...plan.labels } };
}

/** Capture only a new, empty isolated network; do not adopt an existing named network. */
export function networkReceipt(inspect, plan) { return readNetwork(inspect, plan); }

/** Pass the recorded container ID only before its removal; afterwards require no endpoints. */
export function assertOwnedNetwork(inspect, plan, receipt, containerId) {
  if (!isDeepStrictEqual(readNetwork(inspect, plan, containerId), receipt)) {
    throw new Error('Backend network creation receipt mismatch');
  }
  return true;
}

function readVolume(value, plan) {
  if (!value || value.Name !== plan.volumeName || !timestamp(value.CreatedAt) ||
    value.Driver !== 'local' || value.Scope !== 'local' || !empty(value.Options) ||
    !labelsMatch(value.Labels, plan) || typeof value.Mountpoint !== 'string' ||
    !value.Mountpoint.startsWith('/') || /[\r\n\0]/.test(value.Mountpoint)) {
    throw new Error('Backend volume ownership or isolation verification failed');
  }
  // Docker volumes have no immutable ID. Match the recorded creation properties
  // and unique run labels; never treat the mountpoint as a host deletion target.
  return { name: value.Name, createdAt: value.CreatedAt, mountpoint: value.Mountpoint,
    driver: value.Driver, scope: value.Scope, labels: { ...plan.labels } };
}

export function volumeReceipt(inspect, plan) { return readVolume(inspect, plan); }
export function assertOwnedVolume(inspect, plan, receipt) {
  if (!isDeepStrictEqual(readVolume(inspect, plan), receipt)) {
    throw new Error('Backend volume creation receipt mismatch');
  }
  return true;
}
