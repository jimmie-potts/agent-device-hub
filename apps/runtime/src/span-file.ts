// The runtime's recorded spans in a bounded, private file pair in its state directory (ADR 0012, "Observability"; Hub
// #950): the destination that a disposable verification run reads from outside the runtime's process. A runtime that
// crashes has already written the spans it finished, and a reader sees the latest spans and how many were let go.
//
// The pair is `spans.ndjson`, the segment being written, and `spans.previous.ndjson`, the one before it. A segment ends
// at `SEGMENT_SPANS` spans or `SEGMENT_BYTES`, whichever comes first, and the next one replaces the segment before it,
// so the pair holds at most the contract's 1,024 records or 4 MiB. Each segment starts with one header line that says
// how many spans were let go before it. A runtime that restarts on the same state directory continues the same files.
import {closeSync, constants, fstatSync, openSync, readSync, renameSync, writeSync} from 'node:fs';
import {join} from 'node:path';
import {MAX_QUEUE_BYTES, MAX_QUEUE_RECORDS, MAX_RECORD_BYTES} from '@jimmie-potts/bunny-observability';
import {RuntimeError} from './state.js';
import type {SpanSink} from './tracing.js';

export const SPANS_FILE = 'spans.ndjson';
export const SPANS_PREVIOUS_FILE = 'spans.previous.ndjson';
const SCHEMA = 'runtime-spans/1.0';
/** Two segments hold the contract's queue bounds: 1,024 spans, 4 MiB. */
export const SEGMENT_SPANS = MAX_QUEUE_RECORDS / 2;
export const SEGMENT_BYTES = MAX_QUEUE_BYTES / 2;

export type SpanFileOptions = {segmentSpans?: number; segmentBytes?: number};

export interface SpanFile {
  /** Appends one finished span. It throws when it cannot, so that the host adapter counts the span as lost. */
  readonly sink: SpanSink;
  /** Closes the file. Later spans are refused. */
  close(): void;
}

const notPrivate = (file: string): RuntimeError => new RuntimeError('span-file-not-private', `${file} must be a private file with one link`);

/** Refuses a descriptor that is not a regular file of this user with one link and no access for others. */
function requirePrivate(descriptor: number, file: string): void {
  const info = fstatSync(descriptor);
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw notPrivate(file);
}

/** Opens `file` for appending without following a link; a link, or a file that others can reach, is refused. */
function openPrivate(file: string, flags: number): number {
  let descriptor: number;
  try {
    descriptor = openSync(file, flags | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    // O_NOFOLLOW on a link, and O_EXCL on a file that is there, are refusals of this kind, not faults of the disk.
    if (error instanceof Error && 'code' in error && (error.code === 'ELOOP' || error.code === 'EEXIST')) throw notPrivate(file);
    throw error;
  }
  try {
    requirePrivate(descriptor, file);
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  return descriptor;
}

function writeAll(descriptor: number, text: string): void {
  const bytes = Buffer.from(text);
  for (let written = 0; written < bytes.length;) written += writeSync(descriptor, bytes, written);
}

/** A segment's header line, which says how many spans were let go before it. */
const header = (evicted: number): string => `${JSON.stringify({schema: SCHEMA, evicted})}\n`;

type Segment = {spans: string[]; evicted: number | undefined; unreadable: number; truncated: boolean};

/**
 * The spans of one segment's text: each complete line that is a JSON object with `resourceSpans`; a header line gives
 * the count of spans let go. A line that is not one counts as unreadable and is never returned. A last line with no
 * newline is a write in flight, or one that a kill cut short: it is never returned and not counted, since the runtime
 * that ended without its stop record is a gap of its own and a runtime that continues the file ends the line first.
 */
function parse(text: string, truncated: boolean): Segment {
  const segment: Segment = {spans: [], evicted: undefined, unreadable: 0, truncated};
  const lines = text.split('\n');
  lines.pop();
  for (const line of lines) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      segment.unreadable += 1;
      continue;
    }
    const object = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    if (object?.schema === SCHEMA && typeof object.evicted === 'number' && Number.isSafeInteger(object.evicted) && object.evicted >= 0) segment.evicted = object.evicted;
    else if (Array.isArray(object?.resourceSpans)) segment.spans.push(line);
    else segment.unreadable += 1;
  }
  return segment;
}

/** The text of a segment and whether it was cut at `limit` bytes. A missing file has none. */
function readSegment(file: string, limit: number): {text: string; truncated: boolean} | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile()) throw notPrivate(file);
    const bytes = Buffer.alloc(Math.min(info.size, limit));
    let filled = 0;
    while (filled < bytes.length) {
      const got = readSync(descriptor, bytes, filled, bytes.length - filled, filled);
      if (got === 0) break;
      filled += got;
    }
    return {text: bytes.subarray(0, filled).toString('utf8'), truncated: info.size > limit};
  } finally {
    closeSync(descriptor);
  }
}

export type SpanFileRead = {
  /** Whether either file is there. A state directory with none has no spans recorded, which is not a file with none. */
  present: boolean;
  /** The spans, oldest first: the previous segment's, then the current one's. */
  lines: string[];
  /** How many spans were let go, from the current segment's header; undefined when it has none. */
  evicted: number | undefined;
  /** Complete lines that are not spans. */
  unreadable: number;
  /** A segment was longer than its bound, so the read stopped there. */
  truncated: boolean;
};

/**
 * Reads the span files of a state directory: the previous segment, then the current one. A rotation while it reads is
 * noticed by the current file changing, and the read starts again. Each segment is read to its byte bound and a little
 * more, whatever the file's size, so a file that grew cannot grow the read.
 */
export function readSpanFile(stateDir: string, options: SpanFileOptions = {}): SpanFileRead {
  const limit = (options.segmentBytes ?? SEGMENT_BYTES) + MAX_RECORD_BYTES;
  const current = join(stateDir, SPANS_FILE);
  const identity = (): string => {
    try {
      const descriptor = openSync(current, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        return String(fstatSync(descriptor).ino);
      } finally {
        closeSync(descriptor);
      }
    } catch {
      return 'none';
    }
  };
  for (let attempt = 0; ; attempt += 1) {
    const before = identity();
    const previous = readSegment(join(stateDir, SPANS_PREVIOUS_FILE), limit);
    const active = readSegment(current, limit);
    if (identity() !== before && attempt < 2) continue;
    const segments = [previous, active].flatMap(segment => segment === undefined ? [] : [parse(segment.text, segment.truncated)]);
    const activeSegment = active === undefined ? undefined : segments.at(-1);
    return {
      present: previous !== undefined || active !== undefined,
      lines: segments.flatMap(segment => segment.spans),
      evicted: activeSegment?.evicted,
      unreadable: segments.reduce((sum, segment) => sum + segment.unreadable, 0),
      truncated: segments.some(segment => segment.truncated),
    };
  }
}

/** How many spans a segment's text holds, read from a file. A missing or unreadable one holds none. */
function countSpans(file: string, limit: number): number {
  try {
    const segment = readSegment(file, limit);
    return segment === undefined ? 0 : parse(segment.text, segment.truncated).spans.length;
  } catch {
    return 0;
  }
}

/**
 * Opens the span files in a validated state directory and continues them if a runtime wrote them before: the current
 * segment's spans, bytes and count of spans let go. Refuses a link, a second hard link and a file that others can reach.
 */
export function openSpanFile(stateDir: string, options: SpanFileOptions = {}): SpanFile {
  const segmentSpans = options.segmentSpans ?? SEGMENT_SPANS;
  const segmentBytes = options.segmentBytes ?? SEGMENT_BYTES;
  const current = join(stateDir, SPANS_FILE);
  const previous = join(stateDir, SPANS_PREVIOUS_FILE);
  const limit = segmentBytes + MAX_RECORD_BYTES;
  let descriptor: number | undefined = openPrivate(current, constants.O_RDWR);
  let count = 0;
  let bytes = 0;
  let evicted = 0;
  try {
    const found = readSegment(current, limit);
    if (found === undefined || found.text === '') {
      writeAll(descriptor, header(0));
      bytes = Buffer.byteLength(header(0));
    } else {
      const segment = parse(found.text, found.truncated);
      count = segment.spans.length;
      bytes = fstatSync(descriptor).size;
      evicted = segment.evicted ?? 0;
      // A line that a kill cut short ends here, so the next span is a line of its own and not glued to it.
      if (!found.text.endsWith('\n') && !found.truncated) {
        writeAll(descriptor, '\n');
        bytes += 1;
      }
    }
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }

  /** Starts the next segment: the one before is let go, counted, and the current one takes its place. */
  const rotate = (): void => {
    if (descriptor !== undefined) closeSync(descriptor);
    descriptor = undefined;
    evicted = Math.min(Number.MAX_SAFE_INTEGER, evicted + countSpans(previous, limit));
    renameSync(current, previous);
    descriptor = openPrivate(current, constants.O_WRONLY | constants.O_EXCL);
    writeAll(descriptor, header(evicted));
    count = 0;
    bytes = Buffer.byteLength(header(evicted));
  };

  return {
    sink: line => {
      if (descriptor === undefined) throw new Error('span-file-closed');
      const size = Buffer.byteLength(line) + 1;
      if (line.includes('\n') || size > MAX_RECORD_BYTES) throw new Error('span-refused');
      if (count >= segmentSpans || bytes + size > segmentBytes) rotate();
      if (descriptor === undefined) throw new Error('span-file-closed');
      writeAll(descriptor, `${line}\n`);
      count += 1;
      bytes += size;
    },
    close: () => {
      if (descriptor !== undefined) closeSync(descriptor);
      descriptor = undefined;
    },
  };
}
