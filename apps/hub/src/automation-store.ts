import type {DatabaseSync, StatementSync} from 'node:sqlite';

/** One stored rule row. Trigger and action hold validated JSON; `automation.ts` owns their meaning. */
export type RuleRow = {id:string; name:string; enabled:boolean; kind:string; trigger:string; action:string; createdAtMs:number; updatedAtMs:number};
/** One automation log row, written by arbitration. `detail` holds JSON built only from allowlisted fields. */
export type LogRow = {seq:number; atMs:number; ruleId:string; eventSource:string; eventId:string; eventKind:string; eventAlias:string|null;
  agent:string|null; task:string|null; momentId:string; priorityClass:string; coversStatus:boolean; target:string;
  outcome:'blocked'|'receipt'|'not-sent'|'uncertain'; reason:string|null; detail:string|null};
export type NewLogRow = Omit<LogRow,'seq'>;

export const LOG_LIMIT = 5000;
export const EVENT_LIMIT = 10000;

/**
 * Hub #358 tables in the owner's private `state.sqlite`, under the same exclusive lease as agent state.
 * Every call is synchronous and no transaction spans an await, so it never interleaves with agent-state commits on the
 * shared connection. `check` throws once the lease is released.
 */
export class AutomationStore {
  private readonly statements: Record<string,StatementSync>;
  constructor(private readonly db: DatabaseSync, private readonly check: () => void, seed: {interruptSet:string[]; settings:unknown}) {
    db.exec(`CREATE TABLE IF NOT EXISTS automation_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        kind TEXT NOT NULL CHECK(kind IN ('event','routine')), trigger TEXT NOT NULL, action TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS interrupt_set (kind TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS automation_settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_events (key TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, rule_id TEXT NOT NULL,
        event_source TEXT NOT NULL, event_id TEXT NOT NULL, event_kind TEXT NOT NULL, event_alias TEXT, agent TEXT, task TEXT,
        moment_id TEXT NOT NULL, priority_class TEXT NOT NULL, covers_status INTEGER NOT NULL CHECK(covers_status IN (0,1)), target TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('blocked','receipt','not-sent','uncertain')), reason TEXT, detail TEXT);
      CREATE INDEX IF NOT EXISTS automation_log_handed ON automation_log(priority_class, outcome, at_ms);`);
    const prepare = (sql:string) => db.prepare(sql);
    this.statements = {
      rules:prepare('SELECT * FROM rules ORDER BY created_at_ms, id'),
      rule:prepare('SELECT * FROM rules WHERE id=?'),
      insertRule:prepare('INSERT INTO rules VALUES(?,?,?,?,?,?,?,?)'),
      updateRule:prepare('UPDATE rules SET name=?, enabled=?, kind=?, trigger=?, action=?, updated_at_ms=? WHERE id=?'),
      deleteRule:prepare('DELETE FROM rules WHERE id=?'),
      countRules:prepare('SELECT COUNT(*) AS count FROM rules'),
      interruptSet:prepare('SELECT kind FROM interrupt_set ORDER BY kind'),
      clearInterruptSet:prepare('DELETE FROM interrupt_set'),
      insertKind:prepare('INSERT INTO interrupt_set VALUES(?)'),
      settings:prepare('SELECT payload FROM automation_settings WHERE id=1'),
      writeSettings:prepare('INSERT INTO automation_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload'),
      meta:prepare('SELECT value FROM automation_meta WHERE key=?'),
      writeMeta:prepare('INSERT INTO automation_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
      seenEvent:prepare('SELECT 1 AS seen FROM automation_events WHERE key=?'),
      recordEvent:prepare('INSERT INTO automation_events VALUES(?, COALESCE((SELECT MAX(seq) FROM automation_events),0)+1)'),
      pruneEvents:prepare(`DELETE FROM automation_events WHERE seq <= (SELECT MAX(seq) FROM automation_events) - ${EVENT_LIMIT}`),
      appendLog:prepare('INSERT INTO automation_log (at_ms,rule_id,event_source,event_id,event_kind,event_alias,agent,task,moment_id,priority_class,covers_status,target,outcome,reason,detail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'),
      pruneLog:prepare(`DELETE FROM automation_log WHERE seq <= (SELECT MAX(seq) FROM automation_log) - ${LOG_LIMIT}`),
      readLog:prepare('SELECT * FROM automation_log WHERE seq < ? ORDER BY seq DESC LIMIT ?'),
      handed:prepare(`SELECT COUNT(DISTINCT moment_id) AS count FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked' AND at_ms > ?`),
      handedByAgent:prepare(`SELECT COUNT(DISTINCT moment_id) AS count FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked' AND at_ms > ? AND agent=?`),
      handedByTask:prepare(`SELECT COUNT(DISTINCT moment_id) AS count FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked' AND agent=? AND task=?`),
      lastToTarget:prepare(`SELECT MAX(at_ms) AS at FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked' AND target=?`)
    };
    // Seed the owner-approved defaults exactly once. A later owner edit, including an empty set, is never re-seeded.
    this.transaction(() => {
      if (this.statements.meta.get('seeded')) return;
      for (const kind of seed.interruptSet) this.statements.insertKind.run(kind);
      this.statements.writeSettings.run(JSON.stringify(seed.settings));
      this.statements.writeMeta.run('seeded','1');
    });
  }
  private transaction<T>(work: () => T): T {
    this.check();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private static rule(row: Record<string,unknown>): RuleRow {
    return {id:String(row.id),name:String(row.name),enabled:row.enabled === 1,kind:String(row.kind),trigger:String(row.trigger),action:String(row.action),
      createdAtMs:Number(row.created_at_ms),updatedAtMs:Number(row.updated_at_ms)};
  }
  rules(): RuleRow[] { this.check(); return this.statements.rules.all().map(row => AutomationStore.rule(row)); }
  rule(id: string): RuleRow|undefined { this.check(); const row = this.statements.rule.get(id); return row ? AutomationStore.rule(row) : undefined; }
  /** Inserts a rule unless the table already holds `limit` rules; returns false when full. */
  insertRule(rule: RuleRow, limit: number): boolean {
    return this.transaction(() => {
      if (Number(this.statements.countRules.get()!.count) >= limit) return false;
      this.statements.insertRule.run(rule.id,rule.name,rule.enabled ? 1 : 0,rule.kind,rule.trigger,rule.action,rule.createdAtMs,rule.updatedAtMs);
      return true;
    });
  }
  replaceRule(rule: RuleRow): boolean {
    this.check();
    return Number(this.statements.updateRule.run(rule.name,rule.enabled ? 1 : 0,rule.kind,rule.trigger,rule.action,rule.updatedAtMs,rule.id).changes) === 1;
  }
  deleteRule(id: string): boolean { this.check(); return Number(this.statements.deleteRule.run(id).changes) === 1; }
  interruptSet(): string[] { this.check(); return this.statements.interruptSet.all().map(row => String(row.kind)); }
  replaceInterruptSet(kinds: readonly string[]): void {
    this.transaction(() => { this.statements.clearInterruptSet.run(); for (const kind of kinds) this.statements.insertKind.run(kind); });
  }
  settings(): unknown { this.check(); const row = this.statements.settings.get(); return row ? JSON.parse(String(row.payload)) : undefined; }
  replaceSettings(value: unknown): void { this.check(); this.statements.writeSettings.run(JSON.stringify(value)); }
  seenEvent(key: string): boolean { this.check(); return this.statements.seenEvent.get(key) !== undefined; }
  /** Persists an event key before evaluation; returns false when the key was already recorded. */
  recordEvent(key: string): boolean {
    return this.transaction(() => {
      if (this.statements.seenEvent.get(key)) return false;
      this.statements.recordEvent.run(key);this.statements.pruneEvents.run();
      return true;
    });
  }
  appendLog(rows: readonly NewLogRow[]): void {
    if (rows.length === 0) return;
    this.transaction(() => {
      for (const row of rows) this.statements.appendLog.run(row.atMs,row.ruleId,row.eventSource,row.eventId,row.eventKind,row.eventAlias,row.agent,row.task,
        row.momentId,row.priorityClass,row.coversStatus ? 1 : 0,row.target,row.outcome,row.reason,row.detail);
      this.statements.pruneLog.run();
    });
  }
  /** Newest first, strictly below `before`. */
  readLog(limit: number, before = Number.MAX_SAFE_INTEGER): LogRow[] {
    this.check();
    return this.statements.readLog.all(before,limit).map(row => ({seq:Number(row.seq),atMs:Number(row.at_ms),ruleId:String(row.rule_id),
      eventSource:String(row.event_source),eventId:String(row.event_id),eventKind:String(row.event_kind),eventAlias:row.event_alias === null ? null : String(row.event_alias),
      agent:row.agent === null ? null : String(row.agent),task:row.task === null ? null : String(row.task),momentId:String(row.moment_id),
      priorityClass:String(row.priority_class),coversStatus:row.covers_status === 1,target:String(row.target),outcome:String(row.outcome) as LogRow['outcome'],
      reason:row.reason === null ? null : String(row.reason),detail:row.detail === null ? null : String(row.detail)}));
  }
  /** Distinct flourish moments handed to the sender after `sinceMs`, optionally for one agent. */
  handedFlourishes(sinceMs: number, agent?: string): number {
    this.check();
    return Number((agent === undefined ? this.statements.handed.get(sinceMs) : this.statements.handedByAgent.get(sinceMs,agent))!.count);
  }
  handedForTask(agent: string, task: string): number { this.check(); return Number(this.statements.handedByTask.get(agent,task)!.count); }
  lastFlourishTo(target: string): number|undefined {
    this.check(); const at = this.statements.lastToTarget.get(target)?.at;
    return at === null || at === undefined ? undefined : Number(at);
  }
}
