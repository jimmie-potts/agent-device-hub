import {pathToFileURL} from 'node:url';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PRODUCER_SOURCE} from '@jimmie-potts/event-contracts/v2/music-capture';
import {connectRemote, Outcome, SdkError} from '@jimmie-potts/sdk';
import {loadConfiguration} from './configuration.js';
import {NativeCapture} from './native.js';
import {MusicProducer} from './producer.js';

/** Foreground endpoint only. Its startup declares availability without starting audio. */
export async function run(args: readonly string[]): Promise<void> {
  if (args.length !== 2 || args[0] !== '--config' || args[1] === undefined) throw new SdkError(errorBody('invalid-request'));
  if (process.platform !== 'darwin') throw new SdkError(errorBody('unsupported-capability'));
  const config = await loadConfiguration(args[1]);
  const participant = await connectRemote({url: config.edgeOrigin, token: config.token, source: MUSIC_PRODUCER_SOURCE,
    maxQueued: 8, onError: () => {}});
  const producer = new MusicProducer({participant, native: new NativeCapture({helper: config.helper})});
  const stop = (): void => {void producer.stop().catch(() => {process.exitCode = 1;});};
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await producer.start();
    const result = await producer.closed;
    if (result.status === Outcome.uncertain) {
      process.stderr.write('Music producer ended without confirmed native cleanup.\n');
      process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    await producer.stop();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void run(process.argv.slice(2)).catch(() => {
    process.stderr.write('Music producer could not start or continue. Use --config with a private configuration file.\n');
    process.exitCode = 1;
  });
}
