import React, {useEffect, useState} from 'react';
import type {FrontendCommand, FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import {type Gesture, type Led, type PublicFamily, type RobotState} from '../contracts.js';
const STALE_MS = 60_000;
function Controls({context, robot, live, command, now}: {context: FrontendContext; robot: RobotState; live: boolean; command: FrontendCommand; now: number}): React.JSX.Element {
  const [color, setColor] = useState('#2196ff'), [tail, setTail] = useState(64), [docked, setDocked] = useState(false);
  const link = robot.link.status === 'known' ? robot.link.value : undefined;
  useEffect(() => {setDocked(false);}, [link?.helperEpoch, link?.connectionGeneration]);
  const ready = context.control && context.connected && context.operationsLive && live && robot.linkLive && link !== undefined;
  const allowed = ready && !command.locked;
  // Either tracked command may own the uncertain hold. A pending connection
  // action stays locked; recovery is a fresh explicit request, never a replay.
  const recovering = context.operations.some(operation => operation.target === robot.id && ['bb8-connect', 'bb8-disconnect'].includes(operation.family) && ['sent', 'accepted'].includes(operation.status));
  const release = ready && !recovering && (allowed || robot.held !== undefined);
  const connected = link?.connection === 'connected' && robot.held === undefined;
  const send = (family: PublicFamily, led?: Led, extra: object = {}): void => {
    if (!(family === 'bb8-connect' || family === 'bb8-disconnect' ? release : allowed) || link === undefined) return;
    void command.run({family, target: robot.id, requestId: crypto.randomUUID(), data: {expectedConfigurationRevision: robot.configurationRevision, expectedHelperEpoch: link.helperEpoch, expectedConnectionGeneration: link.connectionGeneration, ...(led === undefined ? {} : {led}), ...extra}});
  };
  const power = robot.power.status === 'known' ? robot.power.value : undefined;
  const categories = ['Unknown', 'Charging', 'OK', 'Low', 'Critical'];
  return <section aria-label="BB-8 controls">
    <h2>BB-8</h2>
    {!context.control && <p>Read-only access. Control access is required for device commands.</p>}
    {(!live || !robot.linkLive) && <p role="status">Connection information is stale. Controls are unavailable.</p>}
    {robot.held !== undefined && <p role="status">A previous operation has an uncertain result. Reconnect or disconnect explicitly before further control.</p>}
    <p>Connection: {link?.connection ?? 'unknown'}</p>
    <p>Connect and wake unlocks and wakes the robot before checking ping and version replies. Its lights or posture may change.</p>
    <button disabled={!release} onClick={() => {send('bb8-connect');}}>Connect and wake</button>{' '}
    <button disabled={!release} onClick={() => {send('bb8-disconnect');}}>Disconnect</button>{' '}
    <button disabled={!allowed || !connected} onClick={() => {send('bb8-wake');}}>Wake</button>
    <fieldset disabled={!allowed || !connected}><legend>LEDs</legend>
      <label>Main color <input type="color" value={color} onChange={event => {setColor(event.target.value);}} /></label>{' '}
      <button onClick={() => {send('bb8-led-set', {target: 'main', rgb: [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]});}}>Set main LED</button>
      <label>Tail brightness <input type="number" min="0" max="255" step="1" value={tail} onChange={event => {setTail(Number(event.target.value));}} /></label>{' '}
      <button disabled={!Number.isInteger(tail) || tail < 0 || tail > 255} onClick={() => {send('bb8-led-set', {target: 'tail', brightness: tail});}}>Set tail LED</button>
    </fieldset>
    <p>LED completion reports transmission. Physical LED state is unknown.</p>
    <p>Power: {power === undefined ? 'unknown' : `${categories[power.category] ?? 'Unknown'} · ${(power.voltageHundredths / 100).toFixed(2)} V · ${now - power.observedAtMs > STALE_MS ? 'stale' : 'reported'} at ${new Date(power.observedAtMs).toISOString()}`}</p>
    <button disabled={!allowed || !connected} onClick={() => {send('bb8-power-refresh');}}>Refresh power</button>
    <fieldset disabled={!allowed || !connected}><legend>Docked gestures</legend>
      <p>Floor driving is hibernated. Use gestures only on the powered charging dock; they can move the head and internal mechanism.</p>
      <label><input type="checkbox" checked={docked} onChange={event => {setDocked(event.target.checked);}} /> BB-8 is on its powered dock</label>
      {([['look-left', 'Look left'], ['look-right', 'Look right'], ['shake-head', 'Head shake']] as const satisfies readonly (readonly [Gesture, string])[]).map(([gesture, label]) => <button key={gesture} disabled={!docked} onClick={() => {if (docked) send('bb8-gesture', undefined, {gesture, docked: true});}}>{label}</button>)}
      <p>Each gesture uses fixed zero-speed heading requests with local Stop and checks charging before each segment.</p>
    </fieldset>
    <context.ui.Command context={context} target={robot.id}>{stop => <>
      <button disabled={!ready || link?.connection !== 'connected'} onClick={() => {
        if (link === undefined) return;
        void stop.run({family: 'bb8-stop', target: robot.id, requestId: crypto.randomUUID(), data: {expectedConfigurationRevision: robot.configurationRevision, expectedHelperEpoch: link.helperEpoch, expectedConnectionGeneration: link.connectionGeneration}});
      }}>Stop gesture</button>
      <p role="status" aria-live="polite">Stop: {stop.text}</p>
    </>}</context.ui.Command>
    <p>Gesture completion confirms transmission, not observed head position. A lost Bluetooth link can prevent Stop; stay nearby.</p>
    <p role="status" aria-live="polite">{command.text}</p>
    {robot.lastResult.status === 'known' && <p>Last result: {robot.lastResult.value.result} · evidence {robot.lastResult.value.evidence}</p>}
  </section>;
}
function Page({context}: {context: FrontendContext}): React.JSX.Element {
  const [robot, setRobot] = useState<RobotState | undefined>(), [live, setLive] = useState(false), [attempt, setAttempt] = useState(0), [now, setNow] = useState(Date.now);
  useEffect(() => {const timer = window.setInterval(() => {setNow(Date.now());}, 1000); return () => {window.clearInterval(timer);};}, []);
  useEffect(() => {
    let stopped = false; let copy: SyncedCopy<RobotState> | undefined;
    setLive(false);
    const show = (): void => {if (!stopped && copy !== undefined) setRobot(copy.states().map(state => state.data)[0]);};
    void context.api.sync<RobotState>(['bb8-robot'], change => {
      if (stopped) return;
      switch (change.type) {
        case 'failed': setLive(false); break;
        case 'synced': setLive(true); show(); break;
        case 'updated': setRobot(change.message.data); break;
        case 'removed': setRobot(undefined); break;
      }
    }).then(result => {
      if (result.status === 'rejected') {if (!stopped) setLive(false); return;}
      if (stopped) {void result.copy.close(); return;}
      copy = result.copy; show(); setLive(true);
    }).catch(() => {if (!stopped) setLive(false);});
    return () => {stopped = true; void copy?.close();};
  }, [context.api, attempt]);
  const Command = context.ui.Command;
  return <>{robot === undefined ? <p role="status">BB-8 status is unknown.</p> : <Command context={context} target={robot.id}>{command => <Controls context={context} robot={robot} live={live} command={command} now={now}/>}</Command>}
    {!live && <button onClick={() => {setAttempt(value => value + 1);}}>Reload status</button>}
  </>;
}
export const frontend: FrontendContribution = {module: 'bb8', pages: [{id: 'robot', Component: Page}]};
