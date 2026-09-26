import { loadRunnerConfig, startStatusRunner } from './runner.js';

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.argv.length !== 3) throw new Error('invalid-runner-invocation');
  process.umask(0o077);
  // Install handlers before startup and readiness; release the lease through runner.stop().
  let runner: ReturnType<typeof startStatusRunner> | undefined;
  let requested = false;
  let stopping = false;
  const stop = () => {
    requested = true;
    if (!runner || stopping) return;
    stopping = true;
    void runner.stop().then(() => {
      console.log('tidbyt-status-stopped');
      process.exitCode = 0;
    }, () => { console.error('tidbyt-status-stop-failed'); process.exitCode = 1; });
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  runner = startStatusRunner(loadRunnerConfig(process.argv[2]!));
  console.log('tidbyt-status-started');
  if (requested) stop();
}
void main().catch(() => { console.error('tidbyt-status-start-failed'); process.exitCode = 1; });
