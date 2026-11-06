import {pathToFileURL} from 'node:url';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {MUSIC_PLAYBACK_SOURCE} from '@jimmie-potts/event-contracts/v2/music-playback';
import {connectRemote, Outcome, SdkError} from '@jimmie-potts/sdk';
import {loadPlaybackConfiguration} from './playback-configuration.js';
import {MusicPlaybackNative} from './playback-native.js';
import {MusicPlaybackProducer} from './playback-producer.js';

/** Explicit foreground observations. Import and argument refusal perform no host reads. */
export async function runPlayback(args: readonly string[]): Promise<void> {
  if (args.length !== 3 || args[0] !== '--config' || args[1] === undefined || args[2] !== '--observe') throw new SdkError(errorBody('invalid-request'));
  if (process.platform !== 'darwin') throw new SdkError(errorBody('unsupported-capability'));
  const config = await loadPlaybackConfiguration(args[1]);
  const participant = await connectRemote({url: config.edgeOrigin, token: config.token, source: MUSIC_PLAYBACK_SOURCE, maxQueued: 8, onError: () => {}});
  const producer = new MusicPlaybackProducer({participant, native: new MusicPlaybackNative({helper: config.helper}), libraryScopeId: config.libraryScopeId});
  const stop = (): void => {void producer.stop().catch(() => {process.exitCode = 1;});};
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await producer.start();
    const result = await producer.closed;
    if (result.status === Outcome.uncertain) {
      process.stderr.write('Music playback producer ended without confirmed native cleanup.\n'); process.exitCode = 1;
    }
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); await producer.stop();
  }
}
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runPlayback(process.argv.slice(2)).catch(() => {
    process.stderr.write('Music playback producer could not start or continue. Use --config and --observe with a private configuration file.\n');
    process.exitCode = 1;
  });
}
