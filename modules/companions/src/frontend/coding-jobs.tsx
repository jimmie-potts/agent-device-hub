import React, {useEffect, useState} from 'react';
import type {CodingJobEntry, CodingJobPage} from '../coding/job-page.js';
import {companionName} from './coding-status.js';

function isJob(value: unknown): value is CodingJobEntry {
  if (typeof value !== 'object' || value === null) return false;
  const job = value as Record<string, unknown>;
  return typeof job.jobId === 'string' && typeof job.operationId === 'string' && typeof job.taskId === 'string' &&
    typeof job.conversationId === 'string' && typeof job.repository === 'string' &&
    (job.status === 'queued' || job.status === 'dispatching' || job.status === 'started' || job.status === 'cancelling') &&
    (job.companion === undefined || job.companion === 'bunny' || job.companion === 'reachy' || job.companion === 'microduck') &&
    (job.setup === undefined || job.setup === 'waiting' || job.setup === 'running' || job.setup === 'ready') &&
    (job.harness === undefined || typeof job.harness === 'string') && (job.sessionId === undefined || typeof job.sessionId === 'string');
}

function phase(job: CodingJobEntry): string {
  if (job.status !== 'started') return job.status;
  if (job.setup === 'waiting') return 'waiting for Git setup';
  if (job.setup === 'running') return 'preparing worktree';
  if (job.setup === 'ready' && job.sessionId === undefined) return 'worktree ready';
  return 'running';
}

export function CodingJobs({read, revision, stop, locked}: {
  read: (path: string) => Promise<unknown>;
  revision: number;
  stop: (jobId: string, operationId: string) => void;
  locked: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState(['']);
  const after = cursors.at(-1) ?? '';
  const [response, setResponse] = useState<{after: string; page: CodingJobPage | null}>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    const query = after === '' ? '' : `?${new URLSearchParams({after}).toString()}`;
    void read(`/modules/companions/content/coding-jobs${query}`).then(value => {
      if (!current) return;
      if (typeof value !== 'object' || value === null || !('version' in value) || value.version !== 1 ||
        !('jobs' in value) || !Array.isArray(value.jobs) || !('next' in value) || (value.next !== null && typeof value.next !== 'string')) {
        setResponse({after, page: null});
        return;
      }
      const jobs: unknown[] = value.jobs;
      setResponse({after, page: jobs.every(isJob) ? {version: 1, jobs, next: value.next} : null});
    }, () => {if (current) setResponse({after, page: null});});
    return () => {current = false;};
  }, [after, open, read, revision, retry]);
  const page = response?.after === after ? response.page : undefined;
  return <details onToggle={event => {setOpen(event.currentTarget.open);}}>
    <summary>Coding jobs</summary>
    {page === undefined ? <p>Loading coding jobs…</p>
      : page === null ? <p>Coding jobs unavailable. <button type="button" onClick={() => {setRetry(value => value + 1);}}>Retry</button></p>
      : page.jobs.length === 0 ? <p>No active jobs on this page.</p>
      : <ul>{page.jobs.map(job => <li key={job.jobId}>
        <span>{job.companion === undefined ? job.repository : `${companionName(job.companion)} · ${job.repository}`} · {phase(job)}</span>
        <div style={{overflowWrap: 'anywhere'}}>{job.jobId}</div>
        {job.status !== 'cancelling' && <button type="button" disabled={locked}
          aria-label={`Stop coding job ${job.jobId}`} onClick={() => {stop(job.jobId, job.operationId);}}>Stop job</button>}
      </li>)}</ul>}
    {cursors.length > 1 && <button type="button" onClick={() => {setCursors(values => values.slice(0, -1));}}>Previous jobs</button>}
    {page?.next != null && <button type="button" onClick={() => {
      const next = page.next;
      if (next !== null) setCursors(values => [...values, next]);
    }}>Next jobs</button>}
  </details>;
}
