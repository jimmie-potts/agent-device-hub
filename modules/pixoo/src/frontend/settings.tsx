// Adapted from divoom-app-upgrade apps/web/src/settings.tsx at 0777479c; one runtime config and tracked display controls.
import React, {useEffect, useId, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';

type Settings = {device: {id: string; address: string; profile: string; model?: string; firmware?: string};
  limits: {maxFrames: number; minDelayMs: number; maxDelayMs: number; uniformTiming: boolean}; simulated: boolean; hostedConfigured: boolean};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function settingsOf(value: unknown): Settings {
  if (!object(value) || value.schema !== 'module-settings/2.0' || value.module !== 'pixoo' || !object(value.settings)) throw new Error('invalid settings');
  const settings = value.settings;
  const {device, limits} = settings;
  if (!object(device) || !['id', 'address', 'profile'].every(key => typeof device[key] === 'string')
    || !object(limits) || !['maxFrames', 'minDelayMs', 'maxDelayMs'].every(key => Number.isSafeInteger(limits[key]))
    || typeof limits.uniformTiming !== 'boolean' || typeof settings.simulated !== 'boolean' || typeof settings.hostedConfigured !== 'boolean'
    || !(device.model === undefined || typeof device.model === 'string')
    || !(device.firmware === undefined || typeof device.firmware === 'string')) throw new Error('invalid settings');
  return settings as Settings;
}

function Controls({context, device, live, command}: {context: FrontendContext; device: DeviceRecord; live: boolean; command: FrontendCommand}): React.JSX.Element {
  const id = useId();
  const [brightness, setBrightness] = useState('50');
  const [failure, setFailure] = useState<string>();
  const submitting = useRef(false);
  const percent = Number(brightness);
  const valid = brightness.trim() !== '' && Number.isInteger(percent) && percent >= 0 && percent <= 100;
  const blocked = !context.control || !context.connected || !live || !context.operationsLive || command.locked;
  const run = (family: 'brightness-set' | 'power-set', data: object): void => {
    if (blocked || submitting.current || (family === 'brightness-set' && !valid)) return;
    submitting.current = true; setFailure(undefined);
    void command.run({family, target: device.id, requestId: crypto.randomUUID(), data: {...data,
      expectedConfigurationRevision: device.configurationRevision, expectedGeneration: device.generation}})
      .catch(() => {setFailure('The request has no confirmed reply. It was not sent again.');})
      .finally(() => {submitting.current = false;});
  };
  const {Facts} = context.ui;
  return <>
    <Facts items={[
      ['Availability', device.availability],
      ['Requested brightness', device.desired.brightness.status === 'known' ? `${device.desired.brightness.value}%` : 'Unknown'],
      ['Requested screen', device.desired.power.status === 'known' ? device.desired.power.value ? 'on' : 'off' : 'Unknown'],
    ]}/>
    {context.control ? <>
      {device.capabilities.brightness.supported && <form onSubmit={event => {event.preventDefault(); run('brightness-set', {percent});}}>
        <label htmlFor={id}>Requested brightness</label>
        <input id={id} type="number" min={0} max={100} step={1} value={brightness} disabled={blocked}
          onChange={event => {setBrightness(event.target.value);}}/>
        <button type="submit" disabled={blocked || !valid}>Apply brightness</button>
      </form>}
      {device.capabilities.power.supported && <div className="actions">
        <button type="button" className="secondary" disabled={blocked} onClick={() => {run('power-set', {on: false});}}>Screen off</button>
        <button type="button" className="secondary" disabled={blocked} onClick={() => {run('power-set', {on: true});}}>Screen on</button>
      </div>}
    </> : <p className="hint">Read-only access.</p>}
    <p role="status">{failure ?? command.text}</p>
    <p className="hint">Screen off pauses advancement. Screen on does not resume. Brightness is a requested value, not observed telemetry.</p>
  </>;
}

export function SettingsPage({context, device, live}: {context: FrontendContext; device: DeviceRecord | undefined; live: boolean}): React.JSX.Element {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false; setLoading(true); setError(undefined);
    void context.api.read('/api/v2/modules/pixoo/settings').then(value => {
      const shown = settingsOf(value); if (!disposed) {setSettings(shown); setLoading(false);}
    }).catch((error: unknown) => {if (!disposed) {
      setError(object(error) && object(error.body) && object(error.body.error) && typeof error.body.error.code === 'string' ? error.body.error.code : 'unavailable');
      setLoading(false);
    }});
    return () => {disposed = true;};
  }, [context.api, refresh]);
  const {Badge, Facts, Command} = context.ui;
  return <section className="widget" aria-label="Pixoo settings">
    <header className="widget-head"><h2>Settings</h2><Badge warning={!context.connected || !live}>{context.connected && live ? 'Current' : 'Stale'}</Badge></header>
    <button type="button" className="secondary" disabled={loading} onClick={() => {setRefresh(value => value + 1);}}>Refresh settings</button>
    {loading && <p role="status">Loading settings…</p>}
    {error !== undefined && <p role="alert">Settings unavailable ({error}). Refresh to try again.</p>}
    {settings !== undefined && <>
      <p>{settings.simulated ? 'Simulator is active. The configured address does not connect it to hardware.' : 'Device transport is active. Visible output is unverified.'}</p>
      <Facts items={[
        ['Configured address', settings.device.address], ['Active profile', settings.device.profile],
        ['Model', settings.device.model ?? 'Unknown'], ['Firmware', settings.device.firmware ?? 'Unknown'],
        ['Maximum frames', settings.limits.maxFrames], ['Frame delay', `${settings.limits.minDelayMs}–${settings.limits.maxDelayMs} ms`],
        ['Uniform timing', settings.limits.uniformTiming ? 'Required' : 'Not required'],
      ]}/>
      <p className="hint">Edit the Pixoo section of the runtime configuration to change its address, profile or device notes. Changes take effect when the runtime restarts.</p>
      {settings.device.profile === 'pixoo64-hosted-2026-10-01' && <p className="hint">Hosted playback needs a device-reachable file listener. Readiness and play counts are estimated; a downloaded animation may keep looping after Stop. {settings.hostedConfigured ? 'The listener is configured.' : 'The listener is not configured.'}</p>}
    </>}
    <h3>Display controls</h3>
    <p className="hint">Availability follows the module's automatic probes. Refreshing this page sends no device command.</p>
    {device === undefined ? <p role="status">The Pixoo owner has no device record.</p> : <Command context={context} target={device.id} key={device.id}>{command =>
      <Controls context={context} device={device} live={live} command={command}/>
    }</Command>}
    <a href="#/connections">Running build and connections</a>
  </section>;
}
