#!/usr/bin/env node
// Disposable numeric fixture. It imports no audio API and opens no media.
const monotonicMs = () => Number(process.hrtime.bigint()) / 1e6;
if (process.argv[2] === '--clock') {
  process.stdout.write(JSON.stringify({schema: 'music-native-clock/1.0', monotonicMs: monotonicMs()}) + '\n');
} else if (process.argv[2] === '--capture' || process.argv[2] === '--capture-microphone') {
  let sequence = 0, selected = process.argv[2] === '--capture', pending = '';
  const control = chunk => {
    if (selected) {stop(); return;}
    pending += chunk.toString();
    if (pending.length > 8192) {stop(); return;}
    const end = pending.indexOf('\n');
    if (end < 0) return;
    const request = JSON.parse(pending.slice(0, end));
    if (request.schema !== 'music-native-input/1.0' || request.uid !== 'synthetic-private-uid' || pending.slice(end + 1) !== '') {stop(); return;}
    selected = true;
  };
  const timer = setInterval(() => {
    if (!selected) return;
    const endMonotonicMs = monotonicMs();
    process.stdout.write(JSON.stringify({schema: 'music-native-frame/1.0', sequence: ++sequence,
      sampleRateHz: 48000, channels: 2, frameCount: 4800, startMonotonicMs: endMonotonicMs - 100,
      endMonotonicMs, emittedMonotonicMs: monotonicMs(), rms: 0.25, peak: 0.5, clippedFraction: 0,
      bands: {bass: 0.1, mid: 0.2, treble: 0.05}, onset: {strength: 0.2, confidence: 0.1}, discontinuity: sequence === 1}) + '\n');
  }, 100);
  const stop = () => {clearInterval(timer); process.exit(0);};
  process.stdin.on('data', control); process.stdin.on('end', stop); process.once('SIGTERM', stop);
  process.stdin.resume();
} else process.exitCode = 2;
