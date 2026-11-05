#!/usr/bin/env node
// Disposable numeric fixture. It imports no audio API and opens no media.
const monotonicMs = () => Number(process.hrtime.bigint()) / 1e6;
if (process.argv[2] === '--clock') {
  process.stdout.write(JSON.stringify({schema: 'music-native-clock/1.0', monotonicMs: monotonicMs()}) + '\n');
} else if (process.argv[2] === '--capture') {
  let sequence = 0;
  const timer = setInterval(() => {
    const endMonotonicMs = monotonicMs();
    process.stdout.write(JSON.stringify({schema: 'music-native-frame/1.0', sequence: ++sequence,
      sampleRateHz: 48000, channels: 2, frameCount: 4800, startMonotonicMs: endMonotonicMs - 100,
      endMonotonicMs, emittedMonotonicMs: monotonicMs(), rms: 0.25, peak: 0.5, clippedFraction: 0,
      bands: {bass: 0.1, mid: 0.2, treble: 0.05}, onset: {strength: 0.2, confidence: 0.1}, discontinuity: sequence === 1}) + '\n');
  }, 100);
  const stop = () => {clearInterval(timer); process.exit(0);};
  process.stdin.on('data', stop); process.stdin.on('end', stop); process.once('SIGTERM', stop);
  process.stdin.resume();
} else process.exitCode = 2;
