import type {StatementSync, DatabaseSync} from 'node:sqlite';
import {SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {coreValidator} from '@jimmie-potts/event-contracts/v2/families';
import {sameState} from '@jimmie-potts/event-contracts/v2/bookkeeping';
import {Outcome, recordLog, type Draft, type StateDraft, type TraceContext} from '@jimmie-potts/sdk';
import {AutomationError, type AutomationSettings, type Rule} from './automation.js';
import type {DefinitionCommit} from './automation-store.js';
import type {CoreHandle} from './core.js';
import type {Routine} from './power-schedules.js';
import type {Redactions} from '../log.js';

export const AUTOMATION_FAMILIES = ['automation-rule', 'automation-routine', 'automation-settings', 'automation-interrupt-set'] as const;
type Family = typeof AUTOMATION_FAMILIES[number];
export const isAutomationDefinitionSchema = (schema: string): boolean =>
  AUTOMATION_FAMILIES.some(family => schema === `${SCHEMA_BASE}${family}/2.0`);
export const isAutomationDefinitionFamily = (family: string): family is Family => AUTOMATION_FAMILIES.some(name => name === family);

export function holdsAutomationSecret(registry: Redactions, value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'number') return registry.holds(value);
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value).some(member => holdsAutomationSecret(registry, member));
}
type Definition = {id: string};
export type HoldsAutomationSecret = (data: object) => boolean;
export type AutomationWriteContext = {parent?: TraceContext; authorize?(): void};

export const ruleDefinition = ({id, name, enabled, trigger, action}: Rule) => ({id, name, enabled, trigger, action});
export const routineDefinition = ({id, name, enabled, days, time, actions}: Routine) => ({id, name, enabled, days, time, actions});
export const settingsDefinition = ({noFlourishes, quietHours, budgets}: AutomationSettings) =>
  ({id: 'settings', noFlourishes, quietHours, budgets});
export const interruptDefinition = (kinds: string[]) => ({id: 'interrupt-set', kinds});

function state(family: Family, definition: Definition, revision: number): StateDraft {
  return {type: `org.bunny.${family}.updated`, subject: definition.id, dataschema: `${SCHEMA_BASE}${family}/2.0`,
    data: {...definition, revision}};
}

/** Revision metadata for the current owner definitions. The owner tables still hold the definitions themselves. */
export class AutomationDefinitions {
  readonly #get: StatementSync;
  readonly #set: StatementSync;
  readonly #delete: StatementSync;

  constructor(database: DatabaseSync, readonly core: CoreHandle, readonly holdsSecret: HoldsAutomationSecret) {
    database.exec(`CREATE TABLE IF NOT EXISTS automation_definition_revisions (
      family TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY (family, id)
    ) STRICT`);
    this.#get = database.prepare('SELECT revision FROM automation_definition_revisions WHERE family = ? AND id = ?');
    this.#set = database.prepare(`INSERT INTO automation_definition_revisions VALUES (?, ?, ?)
      ON CONFLICT(family, id) DO UPDATE SET revision = excluded.revision`);
    this.#delete = database.prepare('DELETE FROM automation_definition_revisions WHERE family = ? AND id = ?');
  }

  current(family: Family, definition: Definition): StateDraft {
    return state(family, definition, Number(this.#get.get(family, definition.id)?.revision ?? 0));
  }

  async write<R>(family: Family, before: () => Definition | undefined, mutate: (commit: DefinitionCommit) => R,
    after: (result: R) => Definition | undefined, context?: AutomationWriteContext): Promise<R> {
    const parent = context?.parent;
    const options = parent === undefined ? {} : {parent};
    let authorizationFailed = false;
    try {
      return await this.core.transaction(tx => {
        try { context?.authorize?.(); }
        catch (error) { authorizationFailed = true; throw error; }
        const previous = before();
        if (tx.afterCommit === undefined) throw new Error('automation definitions require core commit confirmation');
        const result = mutate(apply => { tx.afterCommit?.(apply); }), next = after(result);
        // The owner's write is still uncommitted, and no revision, history row or outbox message has been added.
        if (next !== undefined && this.holdsSecret(next)) throw new AutomationError('internal', 500);
        if (sameState(previous, next, [])) return result;
        const id = next?.id ?? previous?.id;
        if (id === undefined) return result;
        const revision = tx.revision(), key = `bunny.state.${family}.${id}`;
        const message: Draft<object> = next === undefined ? this.#remove(family, id, revision) : {kind: 'state' as const, ...state(family, next, revision)};
        if (next !== undefined) {
          this.#set.run(family, id, revision);
          if (this.#get.get(family, id)?.revision !== revision) throw new Error('automation definition revision was not saved');
        }
        if (!coreValidator().validate(tx.add(key, message, options)).ok) throw new Error('invalid automation definition message');
        return result;
      });
    } catch (error) {
      if (authorizationFailed || error instanceof AutomationError) throw error;
      try {
        recordLog(this.core.log, 'operation.failed',
          {'bunny.operation': 'storage', 'bunny.outcome': Outcome.failed, 'bunny.code': 'internal'}, parent);
      } catch { /* Diagnostic sinks do not decide the write result. */ }
      throw new AutomationError('internal', 500);
    }
  }

  #remove(family: Family, id: string, revision: number) {
    this.#delete.run(family, id);
    if (this.#get.get(family, id) !== undefined) throw new Error('automation definition revision was not removed');
    return {kind: 'removal' as const, type: `org.bunny.${family}.removed`, subject: id,
      dataschema: `${SCHEMA_BASE}removal/2.0`, data: {entity: {family, id}, revision, reason: 'deleted'}};
  }
}
