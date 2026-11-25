import React, {useCallback, useEffect, useState} from 'react';
import type {CodingState} from '@jimmie-potts/event-contracts/v2/coding';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk';
import type {MessageCodingInput, OpenNativeClientInput, StopCodingInput} from '../assistant/history-contract.js';
import {conversationRail} from './conversation-rail.js';
import type {CodingJobEntry, CodingJobPage, JobMessage} from '../coding/job-page.js';
import {companionName} from './coding-status.js';

function isMessage(value: unknown): value is JobMessage {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.requestId === 'string' && typeof row.operationId === 'string' && typeof row.recordedAtMs === 'number' &&
    typeof row.observed === 'boolean' && (row.status === 'queued' || row.status === 'accepted' || row.status === 'refused' || row.status === 'uncertain');
}

function isNativeClient(value: unknown): boolean {
  const native = record(value);
  return native !== undefined && typeof native.observedAtMs === 'number' && Array.isArray(native.clients) &&
    native.clients.every(client => client === 'terminal' || client === 'claude-desktop') &&
    ['available', 'opening', 'terminal', 'desktop', 'offline', 'uncertain'].includes(String(native.state)) &&
    (native.refusal === undefined || typeof native.refusal === 'string');
}

function isJob(value: unknown): value is CodingJobEntry {
  if (typeof value !== 'object' || value === null) return false;
  const job = value as Record<string, unknown>;
  return typeof job.jobId === 'string' && typeof job.operationId === 'string' && typeof job.taskId === 'string' &&
    typeof job.conversationId === 'string' && typeof job.repository === 'string' &&
    (job.status === 'queued' || job.status === 'dispatching' || job.status === 'started' || job.status === 'cancelling' ||
      job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'uncertain' || job.status === 'ended') &&
    (job.latestUpdate === undefined || typeof job.latestUpdate === 'string') && (job.label === undefined || typeof job.label === 'string') &&
    (job.steering === undefined || job.steering === 'live' || job.steering === 'unsupported' || job.steering === 'unavailable') &&
    (job.messages === undefined || Array.isArray(job.messages) && job.messages.every(isMessage)) &&
    (job.companion === undefined || job.companion === 'bunny' || job.companion === 'reachy' || job.companion === 'microduck') &&
    (job.setup === undefined || job.setup === 'waiting' || job.setup === 'running' || job.setup === 'ready') &&
    (job.worktreeRef === undefined || typeof job.worktreeRef === 'string' && /^bunny-[A-Za-z0-9_-]{1,100}$/u.test(job.worktreeRef)) &&
    (job.branch === undefined || job.branch === null || typeof job.branch === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(job.branch)) &&
    (job.model === undefined || typeof job.model === 'string') &&
    (job.harness === undefined || typeof job.harness === 'string') && (job.sessionId === undefined || typeof job.sessionId === 'string') &&
    (job.nativeClient === undefined || isNativeClient(job.nativeClient));
}

function parsePage(value: unknown): CodingJobPage | null {
  if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 ||
      !('jobs' in value) || !Array.isArray(value.jobs) || !('next' in value) || (value.next !== null && typeof value.next !== 'string')) return null;
  const jobs: unknown[] = value.jobs;
  return jobs.every(isJob) ? {version: 1, jobs, next: value.next} : null;
}

function phase(job: CodingJobEntry): string {
  if (job.status !== 'started') return job.status;
  if (job.setup === 'waiting') return 'waiting for Git setup';
  if (job.setup === 'running') return 'preparing worktree';
  if (job.setup === 'ready' && job.sessionId === undefined) return 'worktree ready';
  return 'running';
}

export function useCodingState({api, connected}: FrontendContext): CodingState | undefined {
  const [coding, setCoding] = useState<CodingState>();
  useEffect(() => {
    setCoding(undefined);
    if (!connected) return;
    let active = true;
    let copy: SyncedCopy<CodingState> | undefined;
    const apply = (): void => {
      if (active) setCoding(copy?.states().find(message => message.data.id === 'coding')?.data);
    };
    void api.sync<CodingState>(['coding-state'], change => {
      if (!active) return;
      if (change.type === 'updated' && change.message.data.id === 'coding') setCoding(change.message.data);
      else if (change.type === 'failed' || change.type === 'removed') setCoding(undefined);
      else if (change.type === 'synced' && copy !== undefined) apply();
    }, {onRestarted: () => {if (active) setCoding(undefined);}}).then(result => {
      if (result.status !== 'synced') return;
      if (!active) {void result.copy.close(); return;}
      copy = result.copy;
      apply();
    }, () => {if (active) setCoding(undefined);});
    return () => {active = false; void copy?.close();};
  }, [api, connected]);
  return connected ? coding : undefined;
}

function submitJobInput(command: FrontendCommand, input: StopCodingInput | MessageCodingInput | OpenNativeClientInput, requestId: string): void {
  void command.run({family: 'assistant-input', target: 'assistant', requestId,
    upload: {name: 'input.json', file: new Blob([JSON.stringify(input)], {type: 'application/json'})}});
}

export function stopCodingJob(command: FrontendCommand, jobId: string, operationId: string): void {
  submitJobInput(command, {action: 'stop-coding-job', jobId, operationId}, crypto.randomUUID());
}

export function messageCodingJob(command: FrontendCommand, job: Pick<CodingJobEntry, 'jobId' | 'operationId'>, text: string, requestId: string): void {
  submitJobInput(command, {action: 'message-coding-job', jobId: job.jobId, operationId: job.operationId, text}, requestId);
}

export function openNativeClient(command: FrontendCommand, input: OpenNativeClientInput): void {
  submitJobInput(command, input, crypto.randomUUID());
}

export function explicitJobInstruction(value: string): {target: string; text: string} | undefined {
  const match = /^\s*message job (.{1,154}?):\s*([\s\S]+)$/iu.exec(value) ??
    /^\s*tell (?:the )?(.{1,154}?) job to\s+([\s\S]+)$/iu.exec(value);
  const target = match?.[1]?.trim(), text = match?.[2]?.trim();
  return target === undefined || target === '' || text === undefined || text === '' ? undefined : {target, text};
}

export async function readJobTargets(read: (path: string) => Promise<unknown>, target: string): Promise<CodingJobPage> {
  const value = parsePage(await read(`/modules/companions/content/coding-jobs?${new URLSearchParams({target}).toString()}`));
  if (value === null) throw new Error('coding jobs unavailable');
  return value;
}

function messageStatus(message: JobMessage): string {
  if (message.status === 'accepted') return 'Accepted by the harness';
  if (message.status === 'queued') return 'Queued in the Hub';
  if (message.status === 'uncertain') return 'Delivery uncertain';
  return 'Message refused';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function stringRows(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function AttemptResults({value}: {value: unknown}): React.JSX.Element | null {
  const attempt = record(value);
  if (attempt === undefined || typeof attempt.operationId !== 'string' || typeof attempt.status !== 'string') return null;
  const result = record(attempt.result), usage = record(result?.usage);
  const context = record(attempt.context);
  const files = stringRows(result?.changedFiles), limitations = stringRows(result?.limitations);
  const checks: unknown[] = Array.isArray(result?.checks) ? result.checks : [];
  const facts = [
    ['Harness', attempt.harness], ['Native session', attempt.sessionId], ['Reported model', context?.model],
    ['Branch', context?.branch === null ? 'Detached HEAD' : context?.branch], ['Worktree', context?.worktreeRef],
    ['Turn count', usage?.turns], ['Cost', typeof usage?.costUsd === 'number' ? `$${usage.costUsd.toFixed(2)}` : undefined],
  ] as const;
  return <li className="coding-job-attempt">
    <strong>{attempt.status}</strong> · <code>{attempt.operationId}</code>
    {typeof attempt.selectionReason === 'string' && <p>{attempt.selectionReason}</p>}
    <dl>{facts.map(([label, fact]) => <React.Fragment key={label}><dt>{label}</dt><dd>{typeof fact === 'number' || typeof fact === 'string' ? fact : 'Unknown'}</dd></React.Fragment>)}</dl>
    {result !== undefined && <>
      <p>{typeof result.outcome === 'string' ? result.outcome : 'Outcome unknown'}</p>
      {typeof result.pendingDecision === 'string' && <p>Pending decision{result.pendingDecision === '' ? '' : ` · ${result.pendingDecision}`}</p>}
      <details><summary>Checks ({checks.length})</summary><ul>{checks.map((value, index) => {
        const check = record(value);
        return typeof check?.name === 'string' && typeof check.status === 'string' ? <li key={index}>{check.name} · {check.status}</li> : null;
      })}</ul></details>
      <details><summary>Changed files ({files.length})</summary><ul>{files.map(file => <li key={file}>{file}</li>)}</ul></details>
      <details><summary>Limitations ({limitations.length})</summary><ul>{limitations.map(line => <li key={line}>{line}</li>)}</ul></details>
    </>}
  </li>;
}

function JobAttempts({jobId, revision, read}: {jobId: string; revision: number | undefined; read: (path: string) => Promise<unknown>}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<{attempts: readonly unknown[]; continuationReason?: string} | null>();
  useEffect(() => {
    if (!expanded || revision === undefined) return;
    let current = true;
    void read(`/modules/companions/content/coding-job?${new URLSearchParams({jobId}).toString()}`).then(value => {
      const detail = record(value);
      if (current) setDetail(detail?.version === 1 && detail.jobId === jobId && Array.isArray(detail.attempts)
        ? {attempts: detail.attempts as unknown[], ...(typeof detail.continuationReason === 'string' ? {continuationReason: detail.continuationReason} : {})} : null);
    }, () => {if (current) setDetail(null);});
    return () => {current = false;};
  }, [expanded, jobId, read, revision]);
  return <details onToggle={event => {setExpanded(event.currentTarget.open);}}>
    <summary>Attempts and results</summary>
    {expanded && (detail === undefined ? <p>Loading attempts…</p> : detail === null ? <p>Attempts unavailable.</p>
      : <>{detail.continuationReason !== undefined && <p>{detail.continuationReason}</p>}
        <ol>{detail.attempts.map((attempt, index) => <AttemptResults key={index} value={attempt}/>)}</ol></>)}
  </details>;
}

type OpenNative = (input: OpenNativeClientInput) => void;
function NativeClients({job, openNative, locked}: {job: CodingJobEntry; openNative: OpenNative; locked: boolean}): React.JSX.Element | null {
  if (job.harness !== 'claude-code' && job.harness !== 'codex') return null;
  const client = job.nativeClient;
  const active = job.status === 'queued' || job.status === 'dispatching' || job.status === 'started' || job.status === 'cancelling';
  const writer = active ? 'Coding worker' : client?.state === 'terminal' ? 'Native terminal' :
    client?.state === 'desktop' ? 'Claude Desktop, activity unobserved' :
      client?.state === 'opening' || client?.state === 'uncertain' ? 'Unconfirmed' : client === undefined ? 'Native writer unknown' : 'No active writer reported';
  const available = client?.state === 'available' && !active;
  const desktop = client?.clients.includes('claude-desktop') === true;
  const terminal = client?.clients.includes('terminal') === true;
  return <details>
    <summary>Native clients</summary>
    <dl>
      <dt>Write control</dt><dd>{writer}</dd>
      <dt>Last native update</dt><dd>{client === undefined ? 'No native update' : new Date(client.observedAtMs).toLocaleString()}</dd>
      <dt>Live terminal</dt><dd>{job.harness === 'claude-code'
        ? 'Unavailable for the worker’s headless Claude sessions.' : 'Unavailable for the worker’s private app-server connection.'}</dd>
      <dt>Desktop</dt><dd>{job.harness === 'claude-code'
        ? desktop ? 'Saved session takeover. The Hub cannot observe a return from Desktop.' : 'Saved session takeover is not qualified on this worker.'
        : 'Access to this worker profile’s exact thread in Codex Desktop is unverified.'}</dd>
    </dl>
    {client?.state === 'terminal' && <p>The Hub can observe writer release. Native messages and progress stay in the terminal.</p>}
    {client?.state === 'desktop' && <p>The launcher acknowledged the exact attempt. The Hub cannot observe Desktop activity or release its writer.</p>}
    {client?.state === 'opening' && <p>Waiting for the native launch receipt.</p>}
    {client?.state === 'uncertain' && <p>The native client may still hold write control.</p>}
    <p>{available && terminal
      ? 'Start the native helper on the worker host with this attempt ID, then continue the saved session.'
      : 'Saved terminal continuation is unavailable for this attempt.'}</p>
    {client?.refusal !== undefined && <p role="status">Native client request refused · {client.refusal}</p>}
    {available && terminal && <>
      <button type="button" className="secondary" onClick={() => {void navigator.clipboard.writeText(job.operationId).catch(() => {});}}>Copy attempt ID</button>
      <button type="button" className="secondary" disabled={locked}
        onClick={() => {openNative({action: 'open-native-terminal', jobId: job.jobId, operationId: job.operationId});}}>Continue saved session in terminal</button>
    </>}
    {available && desktop && <button type="button" className="secondary" disabled={locked}
      onClick={() => {openNative({action: 'open-claude-desktop', jobId: job.jobId, operationId: job.operationId});}}>Hand off saved session to Claude Desktop</button>}
  </details>;
}

type MessageJob = (job: CodingJobEntry, text: string, requestId: string) => void;
export function CodingJobCard({job, stop, message, openNative, locked, read, revision, operations, inConversation = false}: {
  job: CodingJobEntry; stop: (jobId: string, operationId: string) => void; message: MessageJob; openNative: OpenNative; locked: boolean; read: (path: string) => Promise<unknown>; revision: number | undefined; operations: FrontendContext['operations']; inConversation?: boolean;
}): React.JSX.Element {
  const {companion, conversationId} = job;
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const [submitted, setSubmitted] = useState<string>();
  useEffect(() => {
    if (submitted !== undefined && job.messages?.some(item => item.requestId === submitted) === true) {
      setDraft(''); setComposing(false); setSubmitted(undefined);
    } else if (submitted !== undefined && operations.some(operation => operation.requestId === submitted &&
      operation.status === 'completed' && operation.result === 'failed')) setSubmitted(undefined);
  }, [job.messages, operations, submitted]);
  const active = job.status === 'queued' || job.status === 'dispatching' || job.status === 'started';
  const canMessage = active && job.steering === 'live' && !locked;
  return <article className="coding-job-card" aria-label={`Coding job ${job.jobId}`}>
    <h3>{job.repository}</h3>
    {job.label !== undefined && <p>{job.label}</p>}
    <p>{companion === undefined ? 'Companion unknown' : companionName(companion)} · {phase(job)}</p>
    <dl>
      <dt>Job</dt><dd>{job.jobId}</dd>
      <dt>Attempt</dt><dd>{job.operationId}</dd>
      <dt>Harness</dt><dd>{job.harness ?? 'Unknown'}</dd>
      <dt>Reported model</dt><dd>{job.model ?? 'Unknown'}</dd>
      <dt>Branch</dt><dd>{job.branch === null ? 'Detached HEAD' : job.branch ?? 'Unknown'}</dd>
      <dt>Worktree</dt><dd>{job.worktreeRef ?? 'Unknown'}</dd>
      <dt>Native session</dt><dd>{job.sessionId ?? 'Unknown'}</dd>
    </dl>
    <JobAttempts jobId={job.jobId} read={read} revision={revision}/>
    <NativeClients job={job} openNative={openNative} locked={locked}/>
    {!inConversation && job.latestUpdate !== undefined && <p className="conversation-message-text">{job.latestUpdate}</p>}
    {!inConversation && companion !== undefined && <a href="#/module/companions/assistant"
      onClick={() => {conversationRail.openConversation(companion, conversationId);}}>Open original conversation</a>}
    {active && <button type="button" className="secondary" disabled={locked}
      aria-label={`Stop coding job ${job.jobId}`} onClick={() => {stop(job.jobId, job.operationId);}}>Stop job</button>}
    {active && <button type="button" className="secondary" disabled={!canMessage} onClick={() => {setComposing(value => !value);}}>Message job</button>}
    {active && !canMessage && <p>{job.steering === 'unsupported' ? 'This harness does not support live messages.' : 'Live messages are unavailable for this attempt.'}</p>}
    {composing && <form onSubmit={event => {
      event.preventDefault();
      if (!canMessage || submitted !== undefined || draft.trim() === '' || new TextEncoder().encode(draft).byteLength > 4096) return;
      const requestId = crypto.randomUUID();
      setSubmitted(requestId);
      message(job, draft, requestId);
    }}>
      <label>Job instruction <textarea value={draft} onChange={event => {setDraft(event.target.value);}} disabled={!canMessage || submitted !== undefined}/></label>
      <button type="submit" disabled={!canMessage || submitted !== undefined || draft.trim() === '' || new TextEncoder().encode(draft).byteLength > 4096}>Send job message</button>
    </form>}
    {job.messages !== undefined && job.messages.length > 0 && <ul aria-label="Job message receipts">
      {job.messages.map(entry => <li key={entry.requestId}>
        {messageStatus(entry)}{entry.observed && ' · Input observed in the native turn'}{entry.code !== undefined && ` · ${entry.code}`}
      </li>)}
    </ul>}
  </article>;
}

export function CodingJobs({read, revision, stop, message, openNative, operations, locked, standalone = false}: {
  read: (path: string) => Promise<unknown>;
  revision: number;
  stop: (jobId: string, operationId: string) => void;
  message: MessageJob;
  openNative: OpenNative;
  operations: FrontendContext['operations'];
  locked: boolean;
  standalone?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState(['']);
  const after = cursors.at(-1) ?? '';
  const [response, setResponse] = useState<{after: string; page: CodingJobPage | null}>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open && !standalone) return;
    let current = true;
    const params = new URLSearchParams();
    if (after !== '') params.set('after', after);
    if (standalone) params.set('scope', 'all');
    const query = params.size === 0 ? '' : `?${params.toString()}`;
    void read(`/modules/companions/content/coding-jobs${query}`).then(value => {
      if (!current) return;
      setResponse({after, page: parsePage(value)});
    }, () => {if (current) setResponse({after, page: null});});
    return () => {current = false;};
  }, [after, open, read, revision, retry, standalone]);
  const page = response?.after === after ? response.page : undefined;
  const list = <>{page === undefined ? <p>Loading coding jobs…</p>
    : page === null ? <p>Coding jobs unavailable. <button type="button" onClick={() => {setRetry(value => value + 1);}}>Retry</button></p>
    : page.jobs.length === 0 ? <p>{standalone ? 'No jobs on this page.' : 'No active jobs on this page.'}</p>
    : <ul className="coding-job-list">{page.jobs.map(job => <li key={job.jobId}><CodingJobCard job={job} stop={stop} message={message} openNative={openNative} locked={locked} read={read} revision={revision} operations={operations}/></li>)}</ul>}
    {cursors.length > 1 && <button type="button" onClick={() => {setCursors(values => values.slice(0, -1));}}>Previous jobs</button>}
    {page?.next != null && <button type="button" onClick={() => {
      const next = page.next;
      if (next !== null) setCursors(values => [...values, next]);
    }}>Next jobs</button>}
  </>;
  return standalone ? <>{list}</> : <details onToggle={event => {setOpen(event.currentTarget.open);}}>
    <summary>Coding jobs</summary>
    {open && list}
  </details>;
}

export function ConversationCodingJob({jobId, revision, read, locked, stop, message, openNative, operations}: {
  jobId: string; revision: number | undefined; read: (path: string) => Promise<unknown>;
  locked: boolean; stop: (jobId: string, operationId: string) => void; message: MessageJob; openNative: OpenNative; operations: FrontendContext['operations'];
}): React.JSX.Element | null {
  const [job, setJob] = useState<CodingJobEntry>();
  useEffect(() => {
    if (revision === undefined) return;
    let current = true;
    void read(`/modules/companions/content/coding-jobs?${new URLSearchParams({jobId}).toString()}`).then(value => {
      if (current) setJob(parsePage(value)?.jobs.find(entry => entry.jobId === jobId));
    }, () => {if (current) setJob(undefined);});
    return () => {current = false;};
  }, [jobId, read, revision]);
  return job === undefined ? null : <CodingJobCard job={job} stop={stop} message={message} openNative={openNative} locked={locked || revision === undefined} read={read} revision={revision} operations={operations} inConversation/>;
}

export function JobsPage({context}: {context: FrontendContext}): React.JSX.Element {
  const {api, connected, control, operationsLive, ui: {Command}} = context;
  const coding = useCodingState(context);
  const read = useCallback((path: string) => api.read(path), [api]);
  return <section className="conversation-page coding-jobs-page" aria-label="Jobs">
    <h1>Jobs</h1>
    {coding === undefined ? <p role="status">{connected ? 'Loading jobs…' : 'Jobs unavailable while disconnected.'}</p>
      : <Command context={context} target="assistant">{command => <>
        <CodingJobs standalone read={read} revision={coding.revision} operations={context.operations}
          stop={(jobId, operationId) => {stopCodingJob(command, jobId, operationId);}}
          openNative={input => {openNativeClient(command, input);}}
          message={(job, text, requestId) => {messageCodingJob(command, job, text, requestId);}}
          locked={command.locked || !control || !operationsLive}/>
        {command.requestId !== undefined && <p role="status">{command.text}</p>}
      </>}</Command>}
  </section>;
}
