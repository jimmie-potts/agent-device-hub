import { loadHostConfig } from './config.js';
import { startLocalControllers, type LocalControllers } from './host.js';

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.argv.length !== 3) throw new Error('invalid-invocation');
  process.umask(0o077);
  // Handle a stop signal from the start, so one that arrives around the started line, or during startup,
  // still closes the host and releases its leases instead of killing the process.
  let host: LocalControllers | undefined;
  let requested = false;
  let stopping = false;
  const stop = () => {
    requested = true;
    if (!host || stopping) return;
    stopping = true;
    void host.close().then(() => {
      console.log('local-controllers-stopped');
      process.exitCode = 0;
    }, () => { console.error('local-controllers-stop-failed'); process.exitCode = 1; });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  host = await startLocalControllers(loadHostConfig(process.argv[2]!));
  console.log('local-controllers-started');
  if (requested) stop();
}
void main().catch(() => { console.error('local-controllers-start-failed'); process.exitCode = 1; });
