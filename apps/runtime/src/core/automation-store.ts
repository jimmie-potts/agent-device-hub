// Hub #925. Provenance: copied from apps/hub/src/automation-store.ts at bf11587c1a2c575c0da155725a386a209836eed9.
// Fresh core tables only; no legacy data transfer. Arbitration stays here; execution uses the tracked dispatcher.
import type {DatabaseSync, StatementSync} from 'node:sqlite';
import {isDeepStrictEqual} from 'node:util';

/** One stored rule row. Trigger and action hold validated JSON; `automation.ts` owns their meaning. */
export type RuleRow = {id:string; name:string; enabled:boolean; kind:string; trigger:string; action:string; createdAtMs:number; updatedAtMs:number};
/** One automation log row, written by arbitration. `detail` holds allowlisted event display fields and sender evidence. */
export type LogRow = {seq:number; atMs:number; ruleId:string; eventSource:string; eventId:string; eventKind:string; eventAlias:string|null;
  agent:string|null; task:string|null; momentId:string; priorityClass:string; coversStatus:boolean; target:string;
  outcome:'blocked'|'receipt'|'not-sent'|'uncertain'; reason:string|null; detail:string|null};
export type NewLogRow = Omit<LogRow,'seq'>;

export const LOG_LIMIT = 5000;
export const EVENT_LIMIT = 10000;

/** The engine applies a committed definition immediately when used without the core outbox. */
export type DefinitionCommit = (apply: () => void) => void;
export const applyDefinition: DefinitionCommit = apply => { apply(); };

/**
 * Fresh automation tables in the core's private database, under the same exclusive lease as agent state.
 * Every call is synchronous and no transaction spans an await, so it never interleaves with agent-state commits on the
 * shared connection. `check` throws once the lease is released.
 */
export class AutomationStore {
  readonly #artPlan: StatementSync;
  readonly #insertArtPlan: StatementSync;
  private readonly statements: Record<'rules'|'rule'|'insertRule'|'updateRule'|'deleteRule'|'countRules'|'interruptSet'|'clearInterruptSet'|'insertKind'|'settings'|'writeSettings'|'meta'|'writeMeta'|'seenEvent'|'recordEvent'|'pruneEvents'|'appendLog'|'pruneLog'|'readLog'|'handed'|'handedByAgent'|'handedByTask'|'lastToTarget'|'powerGuard'|'claimPower'|'deletePowerGuard',StatementSync>;
  constructor(private readonly db: DatabaseSync, private readonly check: () => void, seed: {interruptSet:string[]; settings:unknown}) {
    db.exec(`CREATE TABLE IF NOT EXISTS automation_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
        kind TEXT NOT NULL CHECK(kind IN ('event','routine')), trigger TEXT NOT NULL, action TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_power_guard (rule_id TEXT PRIMARY KEY, at_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_moment_reservations(moment_id TEXT NOT NULL,target TEXT NOT NULL,at_ms INTEGER NOT NULL,latest_ms INTEGER NOT NULL,agent TEXT,task TEXT,PRIMARY KEY(moment_id,target)) STRICT;
      CREATE TABLE IF NOT EXISTS automation_art_plans (id TEXT PRIMARY KEY, digest TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS interrupt_set (kind TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS automation_settings (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_events (key TEXT PRIMARY KEY, seq INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS automation_events_seq ON automation_events(seq);
      CREATE TABLE IF NOT EXISTS automation_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, rule_id TEXT NOT NULL,
        event_source TEXT NOT NULL, event_id TEXT NOT NULL, event_kind TEXT NOT NULL, event_alias TEXT, agent TEXT, task TEXT,
        moment_id TEXT NOT NULL, priority_class TEXT NOT NULL, covers_status INTEGER NOT NULL CHECK(covers_status IN (0,1)), target TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('blocked','receipt','not-sent','uncertain')), reason TEXT, detail TEXT);
      CREATE INDEX IF NOT EXISTS automation_log_handed ON automation_log(priority_class, outcome, at_ms);`);
    const prepare = (sql:string) => db.prepare(sql);
    this.#artPlan = prepare('SELECT digest FROM automation_art_plans WHERE id=?');
    this.#insertArtPlan = prepare('INSERT INTO automation_art_plans VALUES(?,?)');
    this.statements = {
      rules:prepare('SELECT * FROM rules ORDER BY created_at_ms, id'),
      rule:prepare('SELECT * FROM rules WHERE id=?'),
      powerGuard:prepare('SELECT at_ms FROM automation_power_guard WHERE rule_id=?'),
      claimPower:prepare('INSERT INTO automation_power_guard VALUES(?,?) ON CONFLICT(rule_id) DO UPDATE SET at_ms=excluded.at_ms'),
      deletePowerGuard:prepare('DELETE FROM automation_power_guard WHERE rule_id=?'),
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
      handed:prepare(`SELECT COUNT(DISTINCT moment_id) AS count FROM (SELECT moment_id,at_ms FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked' UNION ALL SELECT moment_id,at_ms FROM automation_moment_reservations) WHERE at_ms > ?`),
      handedByAgent:prepare(`SELECT COUNT(DISTINCT moment_id) AS count FROM (SELECT moment_id,at_ms,agent FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked' UNION ALL SELECT moment_id,at_ms,agent FROM automation_moment_reservations) WHERE at_ms > ? AND agent=?`),
      handedByTask:prepare(`SELECT COUNT(DISTINCT moment_id) AS count FROM (SELECT moment_id,agent,task FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked' UNION ALL SELECT moment_id,agent,task FROM automation_moment_reservations) WHERE agent=? AND task=?`),
      lastToTarget:prepare(`SELECT MAX(latest_ms) AS at FROM (SELECT at_ms AS latest_ms,target FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked' UNION ALL SELECT latest_ms,target FROM automation_moment_reservations) WHERE target=?`)
    };
    // Seed the owner-approved defaults exactly once. A later owner edit, including an empty set, is never re-seeded.
    this.transaction(() => {
      if (this.statements.meta.get('seeded')) return;
      this.replaceInterruptSet(seed.interruptSet);
      this.replaceSettings(seed.settings);
      if (Number(this.statements.writeMeta.run('seeded','1').changes) !== 1) throw new Error('automation defaults were not recorded');
    });
  }
  private transaction<T>(work: () => T): T {
    this.check();
    if(this.db.isTransaction)return work();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = work(); this.db.exec('COMMIT'); return result; }
    catch (error) {
      // SQLite can roll back the transaction itself on SQLITE_FULL.
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private static rule(row: Record<string,unknown>): RuleRow {
    return {id:String(row.id),name:String(row.name),enabled:row.enabled === 1,kind:String(row.kind),trigger:String(row.trigger),action:String(row.action),
      createdAtMs:Number(row.created_at_ms),updatedAtMs:Number(row.updated_at_ms)};
  }
  /** Like core_operations, immutable plan identities are never evicted or recovered as executable work. */
  claimArtPlan(id: string, digest: string): boolean {
    return this.transaction(() => {
      const existing = this.#artPlan.get(id);
      if (existing !== undefined) return existing.digest === digest;
      this.#insertArtPlan.run(id, digest);return true;
    });
  }
  rules(): RuleRow[] { this.check(); return this.statements.rules.all().map(row => AutomationStore.rule(row)); }
  rule(id: string): RuleRow|undefined { this.check(); const row = this.statements.rule.get(id); return row ? AutomationStore.rule(row) : undefined; }
  /** Inserts a rule unless the table already holds `limit` rules; returns false when full. */
  insertRule(rule: RuleRow, limit: number): boolean {
    return this.transaction(() => {
      if (Number((this.statements.countRules.get()?.count ?? 0)) >= limit) return false;
      this.insertDefinition(rule);
      return true;
    });
  }
  private insertDefinition(rule: RuleRow): void {
    const result = this.statements.insertRule.run(rule.id,rule.name,rule.enabled ? 1 : 0,rule.kind,rule.trigger,rule.action,rule.createdAtMs,rule.updatedAtMs);
    if (Number(result.changes) !== 1 || !isDeepStrictEqual(this.rule(rule.id), rule)) throw new Error('automation definition was not inserted');
  }
  replaceRule(rule: RuleRow): boolean {
    return this.transaction(() => {
      const result = this.statements.updateRule.run(rule.name,rule.enabled ? 1 : 0,rule.kind,rule.trigger,rule.action,rule.updatedAtMs,rule.id);
      if (Number(result.changes) !== 1) return false;
      if (!isDeepStrictEqual(this.rule(rule.id), rule)) throw new Error('automation definition was not updated');
      return true;
    });
  }
  deleteRule(id: string): boolean {
    return this.transaction(() => {
      if (Number(this.statements.deleteRule.run(id).changes) !== 1) return false;
      this.statements.deletePowerGuard.run(id);
      if (this.rule(id) !== undefined || this.powerBoundary(id) !== undefined) throw new Error('automation definition was not removed');
      return true;
    });
  }
  /**
   * The one forward migration of `power-window/1.0` rows (#1297), in one transaction: each `replacement` takes its row's
   * place and each `added` row joins beside it with a copy of the row's occurrence guard, outside the rule limit. A failure
   * on any pair leaves every row as it was.
   */
  splitRules(pairs: readonly {replacement: RuleRow; added: RuleRow}[]): void {
    this.transaction(() => {
      for (const {replacement, added} of pairs) {
        if (!this.replaceRule(replacement)) throw new Error('invalid-state');
        this.insertDefinition(added);
        const guard = this.powerBoundary(replacement.id);
        if (guard !== undefined) {
          const result = this.statements.claimPower.run(added.id, guard);
          if (Number(result.changes) !== 1 || this.powerBoundary(added.id) !== guard) throw new Error('invalid-state');
        }
      }
    });
  }
  powerBoundary(id:string): number|undefined {
    this.check();const row=this.statements.powerGuard.get(id);return row===undefined?undefined:Number(row.at_ms);
  }
  /** Durable claim precedes dispatch; recovery never replays it. Only one bounded watermark per saved rule. */
  claimPowerBoundary(id:string,definitionId:string,atMs:number): boolean {
    return this.transaction(()=>{
      const row=this.rule(id),last=this.powerBoundary(id);
      if(row===undefined || row.kind!=='routine' || !row.enabled ||
        (JSON.parse(row.action) as {definitionId?:unknown}).definitionId!==definitionId || (last!==undefined && last>=atMs)) return false;
      this.statements.claimPower.run(id,atMs);return true;
    });
  }
  interruptSet(): string[] { this.check(); return this.statements.interruptSet.all().map(row => String(row.kind)); }
  replaceInterruptSet(kinds: readonly string[]): void {
    this.transaction(() => {
      this.statements.clearInterruptSet.run();
      if (this.interruptSet().length !== 0) throw new Error('automation interrupt set was not cleared');
      for (const kind of kinds) {
        if (Number(this.statements.insertKind.run(kind).changes) !== 1) throw new Error('automation interrupt kind was not inserted');
      }
      if (!isDeepStrictEqual(this.interruptSet(), [...kinds].sort())) throw new Error('automation interrupt set was not replaced');
    });
  }
  settings(): unknown { this.check(); const row = this.statements.settings.get(); return row ? JSON.parse(String(row.payload)) : undefined; }
  replaceSettings(value: unknown): void {
    this.transaction(() => {
      const payload = JSON.stringify(value);
      const result = this.statements.writeSettings.run(payload);
      if (Number(result.changes) !== 1 || this.statements.settings.get()?.payload !== payload) throw new Error('automation settings were not saved');
    });
  }
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
  /** Reservations precede effects and survive uncertainty. One shared moment counts once across its targets. */
  reserveMoment(id:string,targets:readonly string[],atMs:number,latestMs:number,agent?:string,task?:string):void {
    this.transaction(()=>{for(const target of targets.length===0?['']:targets)
      this.db.prepare('INSERT OR IGNORE INTO automation_moment_reservations VALUES(?,?,?,?,?,?)').run(id,target,atMs,latestMs,agent??null,task??null);});
  }
  reservedUsage(sinceMs:number,except:string):number {
    this.check();return Number(this.db.prepare(`SELECT COUNT(DISTINCT moment_id) AS n FROM (
      SELECT moment_id,at_ms FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked'
      UNION ALL SELECT moment_id,at_ms FROM automation_moment_reservations) WHERE at_ms>? AND moment_id<>?`).get(sinceMs,except)?.n??0);
  }
  reservedLatest(target:string,except:string):number|undefined {
    this.check();const at=this.db.prepare(`SELECT MAX(latest_ms) AS at FROM (
      SELECT moment_id,target,at_ms AS latest_ms FROM automation_log WHERE priority_class='flourish' AND outcome<>'blocked'
      UNION ALL SELECT moment_id,target,latest_ms FROM automation_moment_reservations) WHERE target=? AND moment_id<>?`).get(target,except)?.at;
    return at===null||at===undefined?undefined:Number(at);
  }
  /** Distinct flourish moments handed to the sender after `sinceMs`, optionally for one agent. */
  handedFlourishes(sinceMs: number, agent?: string): number {
    this.check();
    return Number((agent === undefined ? this.statements.handed.get(sinceMs) : this.statements.handedByAgent.get(sinceMs,agent))?.count ?? 0);
  }
  handedForTask(agent: string, task: string): number { this.check(); return Number(this.statements.handedByTask.get(agent,task)?.count ?? 0); }
  lastFlourishTo(target: string): number|undefined {
    this.check(); const at = this.statements.lastToTarget.get(target)?.at;
    return at === null || at === undefined ? undefined : Number(at);
  }
}
