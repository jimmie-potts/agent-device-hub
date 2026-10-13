import type {DatabaseSync} from 'node:sqlite';
import {BaseCheckpointSaver, WRITES_IDX_MAP, compareWritesSortKeys, writesSortKey,
  type ChannelVersions, type Checkpoint, type CheckpointListOptions, type CheckpointMetadata,
  type CheckpointTuple, type PendingWrite} from '@langchain/langgraph-checkpoint';

type Config = Parameters<BaseCheckpointSaver['getTuple']>[0];
type Row = {thread: string; namespace: string; id: string; parent: string | null;
  checkpoint_type: string; checkpoint: Uint8Array; metadata_type: string; metadata: Uint8Array};
type WriteRow = {task: string; path: string; ordinal: number; channel: string; type: string; value: Uint8Array};
const configFor = (thread: string, namespace: string, id: string): Config => ({configurable: {thread_id: thread, checkpoint_ns: namespace, checkpoint_id: id}});
function identity(config: Config): {thread: string; namespace: string; id?: string} {
  const values = config.configurable;
  const thread: unknown = values?.thread_id, namespace: unknown = values?.checkpoint_ns ?? '', id: unknown = values?.checkpoint_id;
  if (typeof thread !== 'string' || thread === '' || typeof namespace !== 'string' || (id !== undefined && typeof id !== 'string')) throw new Error('invalid-checkpoint-identity');
  return {thread, namespace, ...(typeof id === 'string' ? {id} : {})};
}

export class CheckpointCapacityError extends Error {constructor() {super('checkpoint-capacity');}}

/** Module-local adapter. The SDK owns this connection and its lifetime; no second connection or async SQL transaction. */
export class SqliteCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly database: DatabaseSync) {
    super();
    database.exec(`CREATE TABLE IF NOT EXISTS assistant_checkpoints (
      thread TEXT NOT NULL, namespace TEXT NOT NULL, id TEXT NOT NULL, parent TEXT,
      checkpoint_type TEXT NOT NULL, checkpoint BLOB NOT NULL, metadata_type TEXT NOT NULL, metadata BLOB NOT NULL,
      PRIMARY KEY(thread, namespace, id));
      CREATE TABLE IF NOT EXISTS assistant_writes (
      thread TEXT NOT NULL, namespace TEXT NOT NULL, checkpoint_id TEXT NOT NULL,
      task TEXT NOT NULL, path TEXT NOT NULL, ordinal INTEGER NOT NULL, channel TEXT NOT NULL, type TEXT NOT NULL, value BLOB NOT NULL,
      PRIMARY KEY(thread, namespace, checkpoint_id, task, ordinal));`);
  }
  override async getTuple(config: Config): Promise<CheckpointTuple | undefined> {
    const {thread, namespace, id} = identity(config);
    const row = (id === undefined
      ? this.database.prepare('SELECT * FROM assistant_checkpoints WHERE thread=? AND namespace=? ORDER BY id DESC LIMIT 1').get(thread, namespace)
      : this.database.prepare('SELECT * FROM assistant_checkpoints WHERE thread=? AND namespace=? AND id=?').get(thread, namespace, id)) as Row | undefined;
    return row === undefined ? undefined : this.tuple(row);
  }
  private async tuple(row: Row): Promise<CheckpointTuple> {
    // Copy all rows before deserialization yields, so a tuple represents one synchronous read snapshot.
    const writes = this.database.prepare('SELECT * FROM assistant_writes WHERE thread=? AND namespace=? AND checkpoint_id=?')
      .all(row.thread, row.namespace, row.id) as WriteRow[];
    writes.sort((a, b) => compareWritesSortKeys(writesSortKey(a.path, a.task, a.ordinal), writesSortKey(b.path, b.task, b.ordinal)));
    const checkpoint = await this.serde.loadsTyped(row.checkpoint_type, row.checkpoint) as Checkpoint;
    // This new application has no legacy checkpoints to migrate. Never silently reinterpret older formats.
    if (checkpoint.v !== 4) throw new Error('unsupported-checkpoint-version');
    return {config: configFor(row.thread, row.namespace, row.id), checkpoint,
      metadata: await this.serde.loadsTyped(row.metadata_type, row.metadata) as CheckpointMetadata,
      pendingWrites: await Promise.all(writes.map(async row => [row.task, row.channel, await this.serde.loadsTyped(row.type, row.value)] as [string, string, unknown])),
      ...(row.parent === null ? {} : {parentConfig: configFor(row.thread, row.namespace, row.parent)})};
  }
  override async *list(config: Config, options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
    const values: Record<string, unknown> = config.configurable ?? {};
    const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
    const thread = string(values.thread_id), namespace = string(values.checkpoint_ns), id = string(values.checkpoint_id);
    const before = string(options.before?.configurable?.checkpoint_id);
    const rows = this.database.prepare(`SELECT * FROM assistant_checkpoints
      WHERE (? IS NULL OR thread=?) AND (? IS NULL OR namespace=?) AND (? IS NULL OR id=?) AND (? IS NULL OR id<?)
      ORDER BY id DESC`).all(thread, thread, namespace, namespace, id, id, before, before) as Row[];
    let remaining = options.limit ?? Infinity;
    for (const row of rows) {
      if (remaining <= 0) break;
      const tuple = await this.tuple(row);
      const metadata = tuple.metadata as Record<string, unknown> | undefined;
      if (options.filter !== undefined && !Object.entries(options.filter).every(([key, value]) => JSON.stringify(metadata?.[key]) === JSON.stringify(value))) continue;
      remaining -= 1; yield tuple;
    }
  }
  override async put(config: Config, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<Config> {
    const {thread, namespace, id} = identity(config);
    const [checkpointType, bytes] = await this.serde.dumpsTyped(checkpoint);
    const [metadataType, metadataBytes] = await this.serde.dumpsTyped(metadata);
    if (bytes.byteLength > 32 * 1024) throw new CheckpointCapacityError();
    this.database.prepare('INSERT OR REPLACE INTO assistant_checkpoints VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(thread, namespace, checkpoint.id, id ?? null, checkpointType, bytes, metadataType, metadataBytes);
    return configFor(thread, namespace, checkpoint.id);
  }
  override async putWrites(config: Config, writes: PendingWrite[], taskId: string, taskPath = ''): Promise<void> {
    const {thread, namespace, id} = identity(config);
    if (id === undefined) throw new Error('missing-checkpoint-id');
    const rows = await Promise.all(writes.map(async ([channel, value], index) => {
      const [type, bytes] = await this.serde.dumpsTyped(value);
      return {channel, index: WRITES_IDX_MAP[channel] ?? index, type, bytes};
    }));
    if (rows.reduce((size, row) => size + row.bytes.byteLength, 0) > 32 * 1024) throw new CheckpointCapacityError();
    this.transaction(() => {
      for (const row of rows) this.database.prepare(`INSERT OR ${row.index < 0 ? 'REPLACE' : 'IGNORE'} INTO assistant_writes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(thread, namespace, id, taskId, taskPath, row.index, row.channel, row.type, row.bytes);
    });
  }
  override deleteThread(threadId: string): Promise<void> {
    // Required saver interface, intentionally not exposed as a product control.
    this.transaction(() => {
      this.database.prepare('DELETE FROM assistant_writes WHERE thread=?').run(threadId);
      this.database.prepare('DELETE FROM assistant_checkpoints WHERE thread=?').run(threadId);
    });
    return Promise.resolve();
  }
  private transaction(action: () => void): void {
    this.database.exec('SAVEPOINT assistant_checkpoint');
    try {action(); this.database.exec('RELEASE assistant_checkpoint');}
    catch (error) {
      // SQLITE_FULL may already have rolled back the transaction and discarded its savepoints.
      // Preserve the original numeric error for the SDK's capacity classifier even if cleanup fails.
      try {if (this.database.isTransaction) this.database.exec('ROLLBACK TO assistant_checkpoint; RELEASE assistant_checkpoint');} catch { /* original failure wins */ }
      throw error;
    }
  }
}
