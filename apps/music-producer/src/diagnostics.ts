import {randomUUID} from 'node:crypto';
import type {Writable} from 'node:stream';
import {createRecord} from '@jimmie-potts/bunny-observability';
import {levelOf, type LogFields} from '@jimmie-potts/sdk';

const CHECKPOINT = 'music.capture.producer.checkpoint';

/** Consumes an error only on the stream owned by these diagnostic writes. */
export function producerDiagnosticWriter(sink: Writable): (fields: LogFields) => void {
  const resource = {'service.namespace': 'bunny', 'service.name': 'music-producer', 'service.version': 'unknown',
    'service.instance.id': randomUUID(), 'deployment.environment.name': 'production'};
  let failed = false;
  let dropped = 0;
  sink.on('error', () => {failed = true;});
  return fields => {
    if (failed || sink.destroyed || sink.writableEnded) return;
    if (sink.writableNeedDrain) {dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1); return;}
    const record = createRecord({schema_version: '1.12', timestamp: new Date().toISOString(),
      severity_text: levelOf(CHECKPOINT).toUpperCase(), event_name: CHECKPOINT, resource,
      scope: {name: 'bunny.music-producer', version: '1.0.0'}, attributes: {'bunny.provenance': 'source', ...fields,
        ...(dropped === 0 ? {} : {'bunny.music.sink_dropped_count': dropped})}});
    if (!record.ok) return;
    dropped = 0;
    sink.write(JSON.stringify(record.value) + '\n', error => {
      if (error !== null && error !== undefined) failed = true;
    });
  };
}
