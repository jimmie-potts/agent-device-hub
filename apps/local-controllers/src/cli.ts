import { loadHostConfig } from './config.js';
import { startLocalControllers } from './host.js';

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.argv.length !== 3) throw new Error('invalid-invocation');
  process.umask(0o077);
  const host = await startLocalControllers(loadHostConfig(process.argv[2]!));
  console.log('local-controllers-started');
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void host.close().then(() => {
      console.log('local-controllers-stopped');
      process.exitCode = 0;
    }, () => { console.error('local-controllers-stop-failed'); process.exitCode = 1; });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
void main().catch(() => { console.error('local-controllers-start-failed'); process.exitCode = 1; });
