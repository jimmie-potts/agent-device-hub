import type {DisclosedField} from './sharing.js';
import type {AssistantStore, Call, SavedDisclosureProof, Task} from './store.js';

const FINAL = -1;
const INCOMPLETE: SavedDisclosureProof = {fields: [], sources: [], legacy: false, complete: false, model: false};
function proofTask({id, conversationId, profile, status, supervisor, contextThrough, clarificationDevices}: Task) {
  return {id, conversationId, profile, status, supervisor, contextThrough, clarificationDevices};
}
type Boundary = {task: ReturnType<typeof proofTask>; through: number};

function keyOf({source, field, record}: DisclosedField): string {
  return record === undefined ? `${source}:${field}` : `${source}:${field}:${record}`;
}

function assemble(store: AssistantStore, {task, through}: Boundary, ledger: readonly Call[],
  prior: (boundary: Boundary) => SavedDisclosureProof): SavedDisclosureProof {
  const fields = new Map<string, DisclosedField>();
  const add = (field: DisclosedField) => {fields.set(keyOf(field), field);};
  const sources = new Set<string>();
  let legacy = false;
  for (const id of task.clarificationDevices ?? []) {
    add({source: 'devices', field: 'index', record: id});
    add({source: 'devices', field: 'label', record: id});
  }
  const calls = ledger.filter(call => through === FINAL || call.ordinal <= through);
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
      if (!inherited.complete || !inherited.model) return INCOMPLETE;
      legacy ||= inherited.legacy;
      for (const field of inherited.fields) add(field);
      for (const sourceId of inherited.sources) sources.add(sourceId);
    }
  }
  return {fields: [...fields.values()], sources: [...sources], legacy, complete: true, model};
}

function priorProof(store: AssistantStore, boundary: Boundary): SavedDisclosureProof {
  const {task, through} = boundary;
  const saved = store.disclosureProof(task.id, through);
  if (saved !== undefined) return saved;
  const ledger = store.calls(task.id);
  // Records from before hosted rolling history carry direct disclosures only.
  // A dependent reply from the current format must already have a saved proof.
  if (ledger.some(call => (through === FINAL || call.ordinal <= through) && (call.historySources?.length ?? 0) > 0)) return INCOMPLETE;
  const proof = assemble(store, boundary, ledger, () => INCOMPLETE);
  if (proof.complete) store.saveDisclosureProof(task.id, through, proof);
  return proof;
}

export function saveFinalDisclosureProofs(store: AssistantStore, task: Task): void {
  const subject = proofTask(task);
  const ledger = store.calls(task.id);
  const boundaries = [FINAL, ...ledger.filter(call => call.kind === 'tool' && call.status === 'succeeded' && call.action === undefined &&
    call.disclosures?.some(field => field.source === 'devices') === true &&
    call.disclosures.every(field => field.source === 'devices' && field.field !== 'details')).map(call => call.ordinal)];
  for (const through of boundaries) {
    const proof = assemble(store, {task: subject, through}, ledger, boundary => priorProof(store, boundary));
    if (proof.complete) store.saveDisclosureProof(task.id, through, proof);
  }
}

export function hasSavedDisclosureProof(store: AssistantStore, taskId: string, ledger: readonly Call[], through = FINAL): boolean {
  if (!ledger.some(call => (through === FINAL || call.ordinal <= through) && (call.historySources?.length ?? 0) > 0)) return true;
  return store.hasDisclosureProof(taskId, through);
}

/** Reuse finalized proof or check a current/legacy task's own ledger and its saved origins. */
export function savedDisclosureProof(store: AssistantStore, task: Task): SavedDisclosureProof {
  const saved = store.disclosureProof(task.id, FINAL);
  if (saved !== undefined) return saved;
  const ledger = store.calls(task.id);
  if (task.status === 'succeeded' && !hasSavedDisclosureProof(store, task.id, ledger)) return INCOMPLETE;
  const proof = assemble(store, {task: proofTask(task), through: FINAL}, ledger, boundary => priorProof(store, boundary));
  if (proof.complete && task.status === 'succeeded' && task.supervisor !== undefined && task.supervisor.provider !== 'synthetic') {
    store.saveDisclosureProof(task.id, FINAL, proof);
  }
  return proof;
}
