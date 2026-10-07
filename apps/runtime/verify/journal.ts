// What a run's supervisor keeps of its runtime's stderr as the journal (Hub #950): each line that is a JSON object with an
// event name is a record, with the number of the runtime that wrote it. The supervisor does not judge a record; the follow
// query does, against the diagnostic contract. Any other line with something in it, such as a usage line or a stack trace,
// is counted, so that the query can say the journal held lines that were not records.
import type {LogRecord} from '../src/index.js';
import type {Generational} from '../tests/scenarios/catalog.js';

export class Journal {
  readonly entries: Generational<{record: LogRecord}>[] = [];
  /** Lines with content that were not taken, saturating at the largest safe integer. */
  skipped = 0;

  /** Keeps the line if it is a record and returns it; counts it, unless it is blank, and returns undefined if it is not. */
  take(generation: number, line: string): LogRecord | undefined {
    if (line.trim() === '') return undefined;
    try {
      const value: unknown = JSON.parse(line);
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && typeof (value as {event_name?: unknown}).event_name === 'string') {
        const record = value as LogRecord;
        this.entries.push({generation, record});
        return record;
      }
    } catch {
      // Not JSON.
    }
    this.skipped = Math.min(Number.MAX_SAFE_INTEGER, this.skipped + 1);
    return undefined;
  }
}
