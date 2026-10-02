import { isDeepStrictEqual } from 'node:util';
import { backendPlan } from './backend-plan.mjs';

function validate(plan) {
  const expected = backendPlan({ runId: plan?.runId, ownerToken: plan?.ownerToken,
    configDirectory: plan?.configDirectory, ports: plan?.ports });
  if (!isDeepStrictEqual(plan, expected)) throw new Error('Backend plan differs from fixed profile');
}

/** Generate only this pilot's fixed API requests; no arbitrary bodies or image override. */
export function backendCreateRequests(plan) {
  validate(plan);
  const bindings = Object.fromEntries(Object.entries({ grafana: 3000, otlp: 4318, loki: 3100, tempo: 3200, health: 13133 })
    .map(([name, port]) => [port + '/tcp', [{ HostIp: '127.0.0.1', HostPort: String(plan.ports[name]) }]]));
  return {
    network: { path: '/networks/create', body: { Name: plan.networkName, Driver: 'bridge', Internal: true,
      Attachable: false, Ingress: false, Labels: { ...plan.labels } } },
    volume: { path: '/volumes/create', body: { Name: plan.volumeName, Driver: 'local', Labels: { ...plan.labels } } },
    container: { path: `/containers/create?name=${plan.containerName}&platform=linux%2Famd64`, body: {
      Image: plan.image, Labels: { ...plan.labels }, StopTimeout: 20,
      Env: plan.containerArgs.filter((_, index, all) => all[index - 1] === '--env'),
      ExposedPorts: Object.fromEntries(Object.keys(bindings).map(port => [port, {}])),
      HostConfig: { NetworkMode: plan.networkName, Memory: 4294967296, MemorySwap: 4294967296, NanoCpus: 2000000000,
        Privileged: false, PidMode: '', IpcMode: 'private', CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'],
        Devices: [], PublishAllPorts: false, AutoRemove: false, RestartPolicy: { Name: 'no' },
        LogConfig: { Type: 'local', Config: { 'max-size': '5m', 'max-file': '2' } }, PortBindings: bindings,
        Mounts: [{ Type: 'volume', Source: plan.volumeName, Target: '/data', ReadOnly: false },
          ...['otelcol-config.yaml', 'loki-config.yaml'].map(name => ({ Type: 'bind', Source: `${plan.configDirectory}/${name}`,
            Target: `/otel-lgtm/${name}`, ReadOnly: true }))],
      },
    } },
  };
}

/** Inspect the local pinned image before any resource allocation; this does not pull it. */
export function assertPinnedImage(inspect, plan) {
  validate(plan);
  const digest = 'grafana/otel-lgtm@' + plan.image.split('@')[1];
  if (!inspect || !/^sha256:[a-f0-9]{64}$/.test(inspect.Id ?? '') || inspect.Os !== 'linux' ||
    inspect.Architecture !== 'amd64' || !Number.isSafeInteger(inspect.Size) || inspect.Size < 0 ||
    inspect.Size > plan.limits.imageBytes || !Array.isArray(inspect.RepoDigests) || !inspect.RepoDigests.includes(digest)) {
    throw new Error('Backend image identity, platform or size invalid');
  }
  return { imageId: inspect.Id, imageBytes: inspect.Size };
}
