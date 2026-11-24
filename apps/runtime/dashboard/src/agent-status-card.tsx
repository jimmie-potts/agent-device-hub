// Presentation only: the caller supplies the core-derived row and any guarded actions.
import React from 'react';
import {agentSummary, faceText, heardAge, needsAttention, type NoticeRow, type SessionRow} from './sessions.ts';
import {Facts} from './ui.tsx';
import './agent-status.css';

function Notice({notice}: {notice: NoticeRow}): React.JSX.Element {
  const by = notice.acknowledgedBy.length === 0 ? 'none' : notice.acknowledgedBy.join(', ');
  return <div className="notice"><p>Turn {notice.turn} ended</p>
    <p className="hint">Acknowledged by: {by}. This does not establish success or readership.</p></div>;
}

/**
 * A companion tag on the face (Hub #2054): the companion's name, styled as a chip, named `Companion: <name>` for assistive
 * technology and on hover.
 */
function CompanionTag({name}: {name: string}): React.JSX.Element {
  return <span className="chip agent-companion" title={`Companion: ${name}`}><span className="agent-companion-word">Companion: </span>{name}</span>;
}

/** A whole-face native disclosure; inspecting a card has no effect on core evidence. */
export function AgentStatusCard({row, live, now, actions}: {
  row: SessionRow; live: boolean; now: number; actions?: React.ReactNode;
}): React.JSX.Element {
  const stale = row.uncertain || !live;
  // The evidence age, against the page's clock, from the record's evidence time: no read of its own (Hub #1947).
  const heard = heardAge(now - row.lastEvidenceAtMs);
  return <article className="session agent-status-card" data-session={row.id} data-chip={row.chip}
    data-attention={needsAttention(row)} data-stale={stale}>
    <details className="agent-disclosure">
      <summary className="agent-face">
        <span className="agent-meta">{row.companionTags.map(name => <CompanionTag key={name} name={name}/>)}<span className="agent-client" title={row.where}>{row.where}</span>
          <span className="agent-heard" title={`Heard ${heard} ago: when the hub last heard from this session, to the minute`}><span className="agent-heard-word">Heard </span>{heard} ago</span></span>
        <div className="session-id"><h3 title={row.name}>{row.name}</h3></div>
        <span className="agent-state"><span className="session-dot" data-chip={row.chip} aria-hidden="true"/>
          <span className="chip" data-chip={row.chip}>{faceText(row, live)}</span>
          {!live && needsAttention(row) && <span className="agent-last-attention">{row.chipText}</span>}
          <span className="agent-caret" aria-hidden="true">›</span>
        </span>
      </summary>
      <div className="agent-evidence">
        <p className={stale ? 'warning' : 'hint'}>{stale ? `Last known: ${row.chipText}. ` : ''}Last heard: {heard} ago, to the minute.
          {!live ? ' The session copy is not synced.' : row.uncertainty !== undefined ? ` ${row.uncertainty}` : ' Not a completion estimate.'}</p>
        {row.attention.length > 0 && <p className="attention">{row.attention.join(' · ')}</p>}
        {actions}
        {row.notices.length > 0 && <><h4>Retained notices</h4>{row.notices.map(notice => <Notice key={notice.id} notice={notice}/>)}</>}
        <Facts className="strip" items={[
          ['Source', row.facts.source], ['Session ID', row.facts.sessionId], ['Work', row.facts.work],
          ['Read evidence', row.facts.read], ['Parent', row.facts.parent], ['Attributable children', row.facts.children],
          ...(row.facts.companion === undefined ? [] : [[row.companions.length > 1 ? 'Companions' : 'Companion', row.facts.companion] as const]),
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
