import React, {useEffect, useRef, useState} from 'react';
import type {CompanionState} from '@jimmie-potts/event-contracts/v2/companions';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {checkNames, inspectEvidence, observationTime, propose, type CheckName, type CheckResult, type CheckStatus, type TaskEvidence, type SuggestionContext} from './suggestion-model.js';

const emptyChecks = (): Record<CheckName, CheckResult> => ({tests: {status: 'unknown', reference: ''}, build: {status: 'unknown', reference: ''},
  browser: {status: 'unknown', reference: ''}, accessibility: {status: 'unknown', reference: ''}});
const blank = (): Pick<TaskEvidence, 'task' | 'repository' | 'base' | 'head' | 'evidenceHead' | 'checks'> & {observed: string} =>
  ({task: '', repository: '', base: '', head: '', evidenceHead: '', observed: '', checks: emptyChecks()});
const reasons: Record<string, string> = {
  disabled: 'Enable Reachy text cards to inspect a suggestion.', 'category-muted': 'Turn endings are muted; coding suggestions use that category.',
  'presentation-unavailable': 'Reachy presentation is unavailable.', 'core-unavailable': 'Current core state is unavailable.',
  'task-identity-required': 'Name one task. Keep task and repository text within the form bounds.',
  'matching-head-required': 'Supply matching current and evidence head commits (40 lowercase hex characters). A supplied base must also be a full commit.',
  'expired-evidence': 'Evidence must have an actual observation time within the last five minutes, never in the future.',
  'stale-session': 'The selected session is unavailable or stale.', 'session-changed': 'The selected session changed. Inspect fresh evidence for its current turn.',
  'attention-priority': 'A coding attention request takes priority. Review it on Home.',
  'unsupported-check-claim': 'Use supported statuses and a reference for each passed, failed or skipped check.',
  'no-supported-next-check': 'No supported next check follows from this evidence. A turn ending alone proves no result.',
  'older-evidence': 'Older evidence cannot replace the last inspected evidence for this task.',
  'ambiguous-replacement': 'Changed claims at the same observation time are ambiguous. Supply their actual newer observation time.',
};

/** Module-owned transient preview. The only outward effect is an explicit clipboard write. */
export function CodingSuggestions({context, state, live}: {context: FrontendContext; state: CompanionState; live: boolean}): React.JSX.Element {
  const synced = context.core?.sessionsLive === true && context.core.modeLive;
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState(blank);
  const [accepted, setAccepted] = useState<TaskEvidence>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const prior = useRef<TaskEvidence | undefined>(undefined);
  const {connected} = context;
  useEffect(() => {
    if (connected && synced) return;
    setAccepted(undefined); setDraft(blank()); setSelected(''); prior.current = undefined; setMessage('');
  }, [connected, synced]);
  const sessions = context.core?.sessions ?? [];
  const session = sessions.find(record => record.id === selected);
  useEffect(() => {
    setDraft(previous => ({...previous, checks: emptyChecks(), observed: ''}));
    setAccepted(undefined);
    if (selected !== '') setMessage('Session context changed. Supply results for the current session revision.');
  }, [selected, session?.revision, session?.generation]);
  const mode = context.core?.mode;
  const policy = (): SuggestionContext => ({nowMs: Date.now(), connected: connected && synced, available: live && state.availability === 'available', settings: state.settings, mode, sessions});
  const result = accepted === undefined ? undefined : propose(accepted, policy());
  const expiresAt = result?.kind === 'proposal' ? result.validUntilMs : undefined;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const timeout = setTimeout(() => {tick(value => value + 1);}, Math.max(0, expiresAt - Date.now()));
    return () => {clearTimeout(timeout);};
  }, [expiresAt]);
  const locked = !connected || !synced || !live || !context.control || busy;
  const edit = (field: 'task' | 'repository' | 'base' | 'head' | 'evidenceHead' | 'observed', value: string): void => {
    setDraft(previous => ({...previous, [field]: value, ...(field === 'observed' ? {} : {checks: emptyChecks()})}));
    setAccepted(undefined); setMessage('');
  };
  const inspect = (): void => {
    if (locked || session === undefined) {setAccepted(undefined); setMessage('Choose a current coding session.'); return;}
    const input: TaskEvidence = {task: draft.task, repository: draft.repository, base: draft.base, head: draft.head, evidenceHead: draft.evidenceHead,
      checks: structuredClone(draft.checks), observedAtMs: observationTime(draft.observed), session: structuredClone(session)};
    const inspection = inspectEvidence(input, policy(), prior.current);
    prior.current = inspection.latest;
    const next = inspection.decision;
    if (next.kind === 'gap') {setAccepted(undefined); setMessage(reasons[next.reason] ?? 'Evidence gap.'); return;}
    setAccepted(input); setMessage('');
  };
  const copy = async (): Promise<void> => {
    if (locked || accepted === undefined) return;
    // Recheck at the click. No await separates validity from starting the clipboard write.
    const current = propose(accepted, policy());
    if (current.kind !== 'proposal') {setAccepted(undefined); setMessage(reasons[current.reason] ?? 'Evidence gap.'); return;}
    setBusy(true);
    try {await navigator.clipboard.writeText(current.text); setMessage('Copied coding suggestion. Nothing was submitted.');}
    catch {setMessage('Copy could not be confirmed. Check clipboard permission before trying again.');}
    finally {setBusy(false);}
  };
  const {Facts, Badge} = context.ui;
  return <section aria-label="Coding suggestions" style={{overflowWrap: 'anywhere'}}>
    <h3>Coding suggestions</h3>
    <p>Supply results for one task, inspect a fixed next-check prompt, then copy it yourself. Claims and revisions are owner-supplied, never independently verified.</p>
    <p>Draft and preview stay in this page's memory and are discarded on reload, navigation or disconnect. Keep credentials out of every field. Changing task, repository or commits resets the checks.</p>
    <fieldset disabled={locked}><legend>Task evidence</legend>
      <form onSubmit={event => {event.preventDefault(); inspect();}}>
        <label htmlFor="coding-session">Coding session</label>
        <select id="coding-session" value={selected} onChange={event => {setSelected(event.target.value); setDraft(blank()); setAccepted(undefined); prior.current = undefined; setMessage('');}} style={{maxWidth: '100%'}}>
          <option value="">Choose a session</option>{sessions.map(value => <option key={value.id} value={value.id}>{value.identity.provider}: {value.identity.sessionId} ({value.identity.hostId}/{value.identity.sourceId})</option>)}
        </select>
        {(['task', 'repository', 'base', 'head', 'evidenceHead', 'observed'] as const).map(field => <div key={field}>
          <label htmlFor={`coding-${field}`}>{{task: 'Task ID', repository: 'Repository reference (optional)', base: 'Base commit (optional)', head: 'Current head commit', evidenceHead: 'Evidence head commit', observed: 'Observation time (UTC ISO)'}[field]}</label>
          <input id={`coding-${field}`} value={draft[field]} maxLength={field === 'task' ? 200 : field === 'repository' ? 500 : field === 'observed' ? 30 : 40}
            onChange={event => {edit(field, event.target.value);}} style={{width: '100%', boxSizing: 'border-box'}}/>
        </div>)}
        <p>Use full commit IDs and the actual evidence observation time, for example 2026-10-24T12:00:00.000Z. Unknown base or repository may be left blank.</p>
        {checkNames.map(name => <fieldset key={name}><legend>{name}</legend>
          <label htmlFor={`coding-${name}-status`}>{name} status</label>
          <select id={`coding-${name}-status`} value={draft.checks[name].status} onChange={event => {
            const status = event.target.value as CheckStatus;
            setDraft(previous => ({...previous, checks: {...previous.checks, [name]: {...previous.checks[name], status}}})); setAccepted(undefined); setMessage('');
          }}>{(['unknown', 'unrun', 'skipped', 'failed', 'passed'] as const).map(status => <option key={status}>{status}</option>)}</select>
          <label htmlFor={`coding-${name}-reference`}>{name} evidence reference</label>
          <input id={`coding-${name}-reference`} maxLength={500} value={draft.checks[name].reference} onChange={event => {
            const reference = event.target.value;
            setDraft(previous => ({...previous, checks: {...previous.checks, [name]: {...previous.checks[name], reference}}})); setAccepted(undefined); setMessage('');
          }} style={{width: '100%', boxSizing: 'border-box'}}/>
        </fieldset>)}
        <button type="submit">Inspect coding suggestion</button>
      </form>
    </fieldset>
    {!connected || !synced || !live ? <p role="status">Coding suggestions unavailable. Reconnect and supply fresh evidence.</p> : null}
    {!context.control && <p>Read-only access. Evidence input requires operator authority.</p>}
    {accepted !== undefined && result?.kind === 'proposal' && <article aria-label="Coding suggestion">
      <Badge>Owner-supplied structured evidence</Badge><Badge>Inspect/copy only</Badge>
      <Facts items={[
        ['Task', accepted.task], ['Session', `${accepted.session.identity.provider}/${accepted.session.identity.sessionId}`],
        ['Turn', accepted.session.turn.status === 'known' ? accepted.session.turn.id : 'Unknown'], ['Source revision', accepted.session.revision],
        ['Source generation', accepted.session.generation], ['Source', `${accepted.session.identity.hostId}/${accepted.session.identity.sourceId}`], ['Session entity', accepted.session.id], ['Next check', result.target], ['Expires', new Date(result.validUntilMs).toISOString()],
      ]}/>
      <pre style={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{result.text}</pre>
      <button type="button" disabled={locked} onClick={() => {void copy();}}>Copy coding suggestion</button>
    </article>}
    {result?.kind === 'gap' && <p role="status">Evidence gap: {reasons[result.reason] ?? result.reason}</p>}
    <p role="status">{message}</p>
  </section>;
}
