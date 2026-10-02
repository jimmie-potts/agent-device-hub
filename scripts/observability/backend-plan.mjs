import { isAbsolute, resolve } from 'node:path';
export const LGTM_IMAGE = 'grafana/otel-lgtm:0.34.0@sha256:c6a56be719990e78b1d32e879988a219904300ecde1b9bfeec472831a56a922b';
const destinations = { grafana: 3000, otlp: 4318, loki: 3100, tempo: 3200, health: 13133 };

/** Pure launch plan. Runtime preflight, file ownership and image-size verification precede execution. */
export function backendPlan(input) {
  if (!input || Object.keys(input).sort().join(',') !== 'configDirectory,ownerToken,ports,runId') throw new TypeError('Invalid backend inputs');
  const { runId, ownerToken, configDirectory, ports } = input;
  if (typeof runId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId) ||
    typeof ownerToken !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ownerToken) ||
    typeof configDirectory !== 'string' || !isAbsolute(configDirectory) || resolve(configDirectory) !== configDirectory ||
    !configDirectory.split('/').includes('.local') || /[,\r\n\0]/.test(configDirectory)) throw new TypeError('Invalid backend identity or config path');
  if (!ports || Object.keys(ports).sort().join(',') !== Object.keys(destinations).sort().join(',') ||
    Object.values(ports).some(port => !Number.isInteger(port) || port < 1024 || port > 65535) ||
    new Set(Object.values(ports)).size !== 5) throw new TypeError('Invalid backend ports');
  const containerName = `bunny-o704-${runId}`, volumeName = `${containerName}-data`, networkName = `${containerName}-net`;
  const labels = { 'bunny.observability.task': '704', 'bunny.observability.run': runId, 'bunny.observability.owner': ownerToken };
  const labelArgs = Object.entries(labels).flatMap(([name, value]) => ['--label', `${name}=${value}`]);
  const networkArgs = ['network', 'create', '--driver', 'bridge', '--internal', ...labelArgs, networkName];
  const volumeArgs = ['volume', 'create', ...labelArgs, volumeName];
  const containerArgs = ['create', '--name', containerName, '--platform', 'linux/amd64', '--pull=never',
    '--network', networkName, '--cpus', '2', '--memory', '4294967296', '--memory-swap', '4294967296',
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--stop-timeout', '20',
    '--log-driver', 'local', '--log-opt', 'max-size=5m', '--log-opt', 'max-file=2', ...labelArgs,
    '--env', 'ENABLE_OBI=false', '--env', 'OTEL_COLLECTOR_DEBUG_EXPORTER=false',
    '--env', 'GF_ANALYTICS_REPORTING_ENABLED=false', '--env', 'GF_ANALYTICS_CHECK_FOR_UPDATES=false',
    '--env', 'GF_ANALYTICS_CHECK_FOR_PLUGIN_UPDATES=false', '--env', 'LGTM_SHUTDOWN_TIMEOUT_SECONDS=5',
    '--mount', `type=volume,source=${volumeName},target=/data`,
    ...['otelcol-config.yaml', 'loki-config.yaml'].flatMap(name =>
      ['--mount', `type=bind,source=${configDirectory}/${name},target=/otel-lgtm/${name},readonly`]),
    ...Object.entries(destinations).flatMap(([name, internal]) => ['--publish', `127.0.0.1:${ports[name]}:${internal}/tcp`]),
    LGTM_IMAGE];
  return { version: '1.0', runId, ownerToken, image: LGTM_IMAGE, containerName, volumeName, networkName,
    labels, configDirectory, ports: { ...ports }, networkArgs, volumeArgs, containerArgs,
    limits: { imageBytes: 10 * 1024 ** 3, runDataBytes: 2 * 1024 ** 3, teardownMs: 30000 } };
}

/** Never remove by a name/label alone. Couple fresh inspect to the exact creation receipt. */
export function assertOwnedBackend(inspect, plan, receipt) {
  if (!/^[a-f0-9]{64}$/.test(receipt?.containerId ?? '') || !/^sha256:[a-f0-9]{64}$/.test(receipt?.imageId ?? '') ||
    inspect?.Id !== receipt.containerId || inspect.Name !== '/' + plan.containerName || inspect.Image !== receipt.imageId ||
    inspect.Config?.Image !== LGTM_IMAGE || !Object.entries(plan.labels).every(([name, value]) => inspect.Config?.Labels?.[name] === value)) {
    throw new Error('Backend ownership verification failed');
  }
  return true;
}

/** Verify actual Docker configuration before starting workloads, not merely requested CLI flags. */
export function assertBackendIsolation(inspect, plan) {
  const host = inspect?.HostConfig;
  const deny = () => { throw new Error('Backend isolation verification failed'); };
  if (!host || host.NetworkMode !== plan.networkName || host.Privileged !== false || host.PidMode !== '' ||
    !['', 'private'].includes(host.IpcMode) || host.Memory !== 4294967296 || host.MemorySwap !== 4294967296 ||
    host.NanoCpus !== 2000000000 || (host.CapAdd != null && (!Array.isArray(host.CapAdd) || host.CapAdd.length)) ||
    !Array.isArray(host.CapDrop) || !host.CapDrop.includes('ALL') ||
    !Array.isArray(host.SecurityOpt) || !host.SecurityOpt.includes('no-new-privileges') ||
    !Array.isArray(host.Devices) || host.Devices.length || host.PublishAllPorts !== false) deny();
  const bindings = host.PortBindings;
  if (!bindings || Object.keys(bindings).length !== Object.keys(destinations).length) deny();
  for (const [name, port] of Object.entries(destinations)) {
    const values = bindings[`${port}/tcp`];
    if (!Array.isArray(values) || values.length !== 1 || values[0].HostIp !== '127.0.0.1' || values[0].HostPort !== String(plan.ports[name])) deny();
  }
  if (!Array.isArray(inspect.Mounts) || inspect.Mounts.length !== 3) deny();
  const data = inspect.Mounts.find(mount => mount.Destination === '/data');
  if (!data || data.Type !== 'volume' || data.Name !== plan.volumeName || data.RW !== true) deny();
  for (const name of ['otelcol-config.yaml', 'loki-config.yaml']) {
    const mount = inspect.Mounts.find(value => value.Destination === `/otel-lgtm/${name}`);
    if (!mount || mount.Type !== 'bind' || mount.Source !== `${plan.configDirectory}/${name}` || mount.RW !== false) deny();
  }
  return true;
}
