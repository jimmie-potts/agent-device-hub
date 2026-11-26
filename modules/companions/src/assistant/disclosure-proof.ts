import type {DisclosedField} from './sharing.js';
import type {AssistantStore, SavedDisclosureProof, Task} from './store.js';

const FINAL = -1;
const INCOMPLETE: SavedDisclosureProof = {fields: [], sources: [], legacy: false, complete: false, model: false};
function proofTask({id, conversationId, profile, status, supervisor, contextThrough, clarificationDevices}: Task) {
  return {id, conversationId, profile, status, supervisor, contextThrough, clarificationDevices};
}
type Boundary = {task: ReturnType<typeof proofTask>; through: number};
type PartialProof = SavedDisclosureProof | {missing: Boundary};

function keyOf({source, field, record}: DisclosedField): string {
  return record === undefined ? `${source}:${field}` : `${source}:${field}:${record}`;
}

function assemble(store: AssistantStore, {task, through}: Boundary, prior: (boundary: Boundary) => SavedDisclosureProof | undefined): PartialProof {
  const fields = new Map<string, DisclosedField>();
  const add = (field: DisclosedField) => {fields.set(keyOf(field), field);};
  const sources = new Set<string>();
  let legacy = false;
  for (const id of task.clarificationDevices ?? []) {
    add({source: 'devices', field: 'index', record: id});
    add({source: 'devices', field: 'label', record: id});
  }
  const calls = store.calls(task.id).filter(call => through === FINAL || call.ordinal <= through);
  let model = false;
  for (const call of calls) {
    if (call.incompleteDisclosures === true) return INCOMPLETE;
    model ||= call.kind === 'model' && call.status === 'succeeded';
    legacy ||= call.disclosures === undefined && call.status === 'succeeded';
    for (const field of call.disclosures ?? []) add(field);
  }
  // Newer origins normally cover the older sources in the same rolling window.
  for (const call of calls.sort((a, b) => b.ordinal - a.ordinal)) {
    for (const {id} of [...call.historySources ?? []].reverse()) {
      if (sources.has(id)) continue;
      const source = store.messageSource(id);
      if (source === undefined && store.messages.removal(id)?.conversationId !== task.conversationId) return INCOMPLETE;
      sources.add(id);
      add({source: 'conversation', field: 'text', record: id});
      if (source?.role === 'owner' || source === undefined && !id.endsWith('-result')) continue;
      const origin = store.task(source?.taskId ?? id.slice(0, -'-result'.length));
      if (origin?.conversationId !== task.conversationId || origin.profile !== task.profile || origin.status !== 'succeeded' ||
          origin.supervisor === undefined || origin.supervisor.provider === 'synthetic' ||
          origin.contextThrough !== undefined && task.contextThrough !== undefined && origin.contextThrough >= task.contextThrough) return INCOMPLETE;
      let cutoff = FINAL;
      if (source?.role === 'tool') {
        const tool = store.call(id);
        if (tool?.taskId !== origin.id || tool.kind !== 'tool' || tool.status !== 'succeeded') return INCOMPLETE;
        add({source: 'conversation', field: 'details', record: id});
        cutoff = tool.ordinal;
      } else if (id !== `${origin.id}-result`) return INCOMPLETE;
      const boundary = {task: proofTask(origin), through: cutoff};
      const inherited = prior(boundary);
      if (inherited === undefined) return {missing: boundary};
      if (!inherited.complete || !inherited.model) return INCOMPLETE;
      legacy ||= inherited.legacy;
      for (const field of inherited.fields) add(field);
      for (const sourceId of inherited.sources) sources.add(sourceId);
    }
  }
  return {fields: [...fields.values()], sources: [...sources], legacy, complete: true, model};
}

function materialize(store: AssistantStore, root: Boundary): SavedDisclosureProof {
  const stack = [root];
  const key = ({task, through}: Boundary) => `${task.id}/${String(through)}`;
  const pending = new Set([key(root)]);
  const prior = ({task, through}: Boundary) => store.disclosureProof(task.id, through);
  while (stack.length > 0) {
    const boundary = stack.at(-1);
    if (boundary === undefined) break;
    const proof = assemble(store, boundary, prior);
    if ('missing' in proof) {
      if (pending.has(key(proof.missing))) return INCOMPLETE;
      pending.add(key(proof.missing));
      stack.push(proof.missing);
      continue;
    }
    if (!proof.complete) return INCOMPLETE;
    if (boundary.task.status === 'succeeded' && boundary.task.supervisor !== undefined && boundary.task.supervisor.provider !== 'synthetic') {
      store.saveDisclosureProof(boundary.task.id, boundary.through, proof);
    }
    if (boundary === root) return proof;
    pending.delete(key(boundary));
    stack.pop();
  }
  return INCOMPLETE;
}

/** Materializes older ledgers on demand. The work stack holds boundaries, not all the transcript ledgers. */
export function savedDisclosureProof(store: AssistantStore, task: Task): SavedDisclosureProof {
  const saved = store.disclosureProof(task.id, FINAL);
  if (saved !== undefined) return saved;
  const {database} = store;
  database.exec('SAVEPOINT assistant_disclosure_proof');
  try {
    const proof = materialize(store, {task: proofTask(task), through: FINAL});
    database.exec('RELEASE assistant_disclosure_proof');
    return proof;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK TO assistant_disclosure_proof; RELEASE assistant_disclosure_proof');
    throw error;
  }
}
