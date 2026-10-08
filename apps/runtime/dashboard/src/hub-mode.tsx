import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {Mode, ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {sendAction, type ActionReply} from './actions.ts';
import {modeAction, modeApplication, modeDeviceResults, modeName, type ModeDeviceResult} from './hub-mode.ts';

export function HubMode({record, live, control, operations, operationsSynced, devices}: {
  record: ModeState | undefined; live: boolean; control: boolean; operations: readonly OperationRecord[];
  operationsSynced: boolean; devices: readonly DeviceRecord[];
}): React.JSX.Element {
  const [attempt, setAttempt] = useState<{mode: Mode; requestId: string}>();
  const [answer, setAnswer] = useState<ActionReply>();
  const [results, setResults] = useState<{requestId: string; rows: ModeDeviceResult[]}>();
  const inFlight = useRef(false), alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  const application = modeApplication(operations);
  useEffect(() => {
    if (application === undefined) return;
    let current = true;
    void modeDeviceResults(application, operations, devices, operationsSynced).then(rows => {
      if (current) setResults({requestId: application.requestId, rows});
    }).catch(() => {if (current) setResults({requestId: application.requestId, rows: []});});
    return () => {current = false;};
  }, [application, operations, devices, operationsSynced]);
  const available = control && live && record !== undefined;
  const pending = attempt !== undefined && answer === undefined;
  const select = async (mode: Mode): Promise<void> => {
    if (!available || record === undefined || inFlight.current) return;
    const requestId = crypto.randomUUID();
    inFlight.current = true; setAttempt({mode, requestId}); setAnswer(undefined);
    const reply = await sendAction(modeAction(record, mode, requestId));
    inFlight.current = false;
    if (alive.current) setAnswer(reply);
  };
  const matching = attempt === undefined ? undefined : operations.find(item => item.requestId === attempt.requestId && item.family === 'mode-set' && item.target === 'hub');
  const rows = application !== undefined && results?.requestId === application.requestId ? results.rows : [];
  return <div className="hub-mode">
    <p>Saved selection: <strong>{record === undefined ? 'Not observed' : modeName(record.mode)}</strong>{!live && record !== undefined ? ' · stale' : ''}.</p>
    <p className="hint">Saving a mode and applying it to each device are separate results.</p>
    <div className="actions" role="group" aria-label="Choose Hub mode">{(['work', 'free', 'quiet'] as const).map(mode =>
      <button key={mode} type="button" aria-pressed={record?.mode === mode} disabled={!available || pending} onClick={() => {void select(mode);}}>{modeName(mode)}</button>)}</div>
    {!control && <p className="warning">Read-only connection. Mode controls require control authority.</p>}
    {control && !live && <p className="warning">Wait for a current synced mode before changing it.</p>}
    <div role="status">
      {attempt !== undefined && answer === undefined && <p>{modeName(attempt.mode)} requested. Waiting for a reply.</p>}
      {answer !== undefined && !('error' in answer) && <p>Accepted. The saved selection and device results are shown separately.</p>}
      {answer !== undefined && 'error' in answer && <p>{answer.error.code === 'uncertain-result'
        ? 'The reply is uncertain. The request was not sent again.' : `Selection refused. Code: ${answer.error.code}.`}</p>}
      {attempt !== undefined && <p>Selection completion: {operationsSynced ? matching?.status ?? 'not observed' : 'not synced'}.</p>}
    </div>
    <h3>Recent device results</h3>
    <p className="hint">These results belong to a completed selection request. They do not prove what a device currently shows.</p>
    {application === undefined && <p>{operationsSynced ? 'No selection application observed.' : 'Application evidence is not synced.'}</p>}
    {application !== undefined && rows.length === 0 && <p>No device result observed for this selection request.</p>}
    {rows.length > 0 && <ul className="plain">{rows.map(row => <li key={row.target} data-mode-device={row.target}>
      {row.target}: {row.status}{row.result === undefined ? '' : ` · ${row.result}`}{row.evidence === undefined ? '' : ` · evidence: ${row.evidence}`}{row.code === undefined ? '' : ` · code: ${row.code}`}
    </li>)}</ul>}
  </div>;
}
