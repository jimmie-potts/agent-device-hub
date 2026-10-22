// Collection adapter over the shell's existing session copy; no additional connection or state subscription.
import React, {useMemo, useState} from 'react';
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import {AgentStatusCard, AgentStatusSummary} from './agent-status-card.tsx';
import {LabelEditor} from './label-editor.tsx';
import {matches, sessionRows} from './sessions.ts';
import {Select} from './ui.tsx';

export function AgentSessions({records, synced, live, control, now}: {
  records: readonly SessionRecord[]; synced: boolean; live: boolean; control: boolean; now: number;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  const rows = useMemo(() => sessionRows(records), [records]);
  const shown = new Set(records.filter(record => matches(record, query, provider)).map(record => record.id));
  const filtering = query !== '' || provider !== '';
  const providers = [...new Set(['codex', 'claude', ...records.map(record => record.identity.provider)])];
  return <div className="agent-sessions">
    <AgentStatusSummary rows={rows} live={live}/>
    <div className="filters">
      <label>Find a session<input type="search" maxLength={120} value={query} onChange={event => {setQuery(event.target.value);}} placeholder="Find a session"/></label>
      <Select label="Provider" value={provider} onChange={setProvider} options={[{value: '', label: 'All providers'}, ...providers.map(value => ({value, label: value}))]}/>
    </div>
    {shown.size === 0 && <div className="empty"><h3>{filtering ? 'No matching sessions' : synced ? 'No sessions observed' : 'Sessions not synced yet'}</h3>
      <p>{filtering ? 'Change the filters to see other sessions.' : 'Sessions appear when the core reports them.'}</p></div>}
    <div className="sessions agent-grid">{rows.map(row => <div key={`${row.id}:${row.generation}`} hidden={!shown.has(row.id)}>
      <AgentStatusCard row={row} live={live} now={now} actions={control ? <LabelEditor row={row} live={live}/> : undefined}/>
    </div>)}</div>
  </div>;
}
