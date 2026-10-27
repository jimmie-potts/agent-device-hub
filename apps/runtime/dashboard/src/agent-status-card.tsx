// Presentation only: the caller supplies the core-derived row and any guarded actions.
import React from 'react';
import {age, agentSummary, needsAttention, type NoticeRow, type SessionRow} from './sessions.ts';
import {Facts} from './ui.tsx';
import './agent-status.css';

function Notice({notice}: {notice: NoticeRow}): React.JSX.Element {
  const by = notice.acknowledgedBy.length === 0 ? 'none' : notice.acknowledgedBy.join(', ');
  return <div className="notice"><p>Turn {notice.turn} ended</p>
    <p className="hint">Acknowledged by: {by}. This does not establish success or readership.</p></div>;
}

/** A whole-face native disclosure; inspecting a card has no effect on core evidence. */
export function AgentStatusCard({row, live, now, actions}: {
  row: SessionRow; live: boolean; now: number; actions?: React.ReactNode;
}): React.JSX.Element {
  const stale = row.uncertain || !live;
  const elapsed = Math.max(0, now - row.lastEvidenceAtMs);
  return <article className="session agent-status-card" data-session={row.id} data-chip={row.chip}
    data-attention={needsAttention(row)} data-stale={stale}>
    <details className="agent-disclosure">
      <summary className="agent-face">
        <span className="agent-client">{row.where}</span>
        <div className="session-id"><h3>{row.name}</h3></div>
        <span className="agent-state"><span className="session-dot" data-chip={row.chip} aria-hidden="true"/>
          <span className="chip" data-chip={row.chip}>{stale ? 'Stale' : row.chipText}</span>
          {stale && needsAttention(row) && <span className="agent-last-attention">{row.chipText}</span>}
          <span className="agent-caret" aria-hidden="true">›</span>
        </span>
      </summary>
      <div className="agent-evidence">
        <p className={stale ? 'warning' : 'hint'}>{stale ? `Last known: ${row.chipText}. ` : ''}Last evidence: {age(elapsed)} ago.
          {stale ? ' Freshness is uncertain.' : ' Current observation; not a completion estimate.'}</p>
        {row.attention.length > 0 && <p className="attention">{row.attention.join(' · ')}</p>}
        {actions}
        {row.notices.length > 0 && <><h4>Retained notices</h4>{row.notices.map(notice => <Notice key={notice.id} notice={notice}/>)}</>}
        <Facts className="strip" items={[
          ['Source', row.facts.source], ['Session ID', row.facts.sessionId], ['Activity', row.facts.activity],
          ['Read evidence', row.facts.read], ['Parent', row.facts.parent], ['Attributable children', row.facts.children],
        ]}/>
      </div>
    </details>
  </article>;
}

/** Full-copy summary, reusable independently of the collection or its filters. */
export function AgentStatusSummary({rows, live}: {rows: readonly SessionRow[]; live: boolean}): React.JSX.Element {
  const counts = agentSummary(rows, live);
  return <div className="agent-summary" role="group" aria-label="Agent summary">
    <div><strong>{counts.working}</strong><span>Working</span></div>
    <div><strong>{counts.attention}</strong><span>Needs you</span></div>
    <div><strong>{counts.unread}</strong><span>Unread</span></div>
  </div>;
}
