// The shared shell owns authentication, connection and tracked commands (Hub #934).
import React, {useEffect, useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendApi, FrontendCommand, FrontendContext, FrontendContribution} from '@jimmie-potts/sdk/frontend';
import type {SyncChange, SyncedCopy} from '@jimmie-potts/sdk/remote';
import {editorGeometry, legacyWall, wallAction, type ConnectorGraph, type LegacyWall, type WallDevice, type WallRecord} from './model.js';
import {mountWall, type MountedWall} from './wall.js';
import './wall.css';

type Record = DeviceRecord | WallRecord;
type Catalog = {live: boolean; pending: boolean; error: boolean; walls: WallRecord[]; devices: DeviceRecord[]};

/** Use the shell's participant and keep an explicitly stale copy after failure. No polling or second connection. */
function useCatalog(api: FrontendApi): Catalog & {retry: () => void} {
  const [catalog, setCatalog] = useState<Catalog>({live: false, pending: true, error: false, walls: [], devices: []});
  const [attempt, setAttempt] = useState(0);
  const kept = useRef(new Map<string, Record>());
  useEffect(() => {
    let disposed = false, live = false;
    let copy: SyncedCopy<Record> | undefined;
    const records = kept.current;
    setCatalog(previous => ({...previous, live: false, pending: true, error: false}));
    const show = (error = false): void => {
      if (disposed) return;
      const values = [...records.values()];
      setCatalog({live, error, pending: false,
        walls: values.filter((value): value is WallRecord => 'elements' in value).sort((a, b) => a.id.localeCompare(b.id)),
        devices: values.filter((value): value is DeviceRecord => 'capabilities' in value && value.kind === 'nanoleaf'),
      });
    };
    const changed = (change: SyncChange<Record>): void => {
      if (disposed) return;
      switch (change.type) {
        case 'updated': records.set(`${change.entity.family}/${change.entity.id}`, change.message.data); show(); break;
        case 'removed': records.delete(`${change.entity.family}/${change.entity.id}`); show(); break;
        case 'synced': live = true; show(); break;
        case 'failed': live = false; show(true); break;
      }
    };
    void api.sync<Record>(['device', 'nanoleaf-wall'], changed).then(result => {
      if (result.status === 'rejected') { show(true); return; }
      if (disposed) { void result.copy.close(); return; }
      copy = result.copy;
      records.clear();
      for (const state of copy.states()) records.set(`${'elements' in state.data ? 'nanoleaf-wall' : 'device'}/${state.data.id}`, state.data);
      live = true; show();
    }).catch(() => { live = false; show(true); });
    return () => { disposed = true; void copy?.close(); };
  }, [api, attempt]);
  return {...catalog, retry: () => { setAttempt(value => value + 1); }};
}

function Canvas({view, command, context, live, selectDevice}: {
  view: LegacyWall; command: FrontendCommand; context: FrontendContext; live: boolean; selectDevice: (id: string) => void;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedWall | undefined>(undefined);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const allowed = context.control && context.connected && context.operationsLive && live && !command.locked && !busy;
  const latest = useRef({view, command, allowed, selectDevice});
  latest.current = {view, command, allowed, selectDevice};
  useEffect(() => {
    if (host.current === null) return;
    let disposed = false;
    const wall = mountWall(host.current, {
      selectDevice: id => { latest.current.selectDevice(id); },
      action: (path, payload) => {
        const current = latest.current;
        if (!current.allowed || sending.current) return;
        sending.current = true;
        setBusy(true);
        wall.update(current.view, false);
        void current.command.run(wallAction(path, payload, current.view.id, crypto.randomUUID())).finally(() => {
          sending.current = false;
          if (!disposed) setBusy(false);
        });
      },
    });
    mounted.current = wall;
    wall.update(latest.current.view, latest.current.allowed);
    return () => { disposed = true; mounted.current = undefined; wall.dispose(); };
  }, []);
  useEffect(() => { mounted.current?.update(view, allowed); }, [view, allowed]);
  return <>
    {!context.control && <p>Read-only access. Wall changes require control access.</p>}
    {!live && <p role="status">Wall records are stale. Editing is unavailable until sync succeeds.</p>}
    <p role="status" aria-live="polite">{command.text}</p>
    <div ref={host} className="nanoleaf-wall"/>
  </>;
}

function Editor({context, wall, devices, live, selectDevice}: {
  context: FrontendContext; wall: WallRecord; devices: WallDevice[]; live: boolean; selectDevice: (id: string) => void;
}): React.JSX.Element {
  const [geometry, setGeometry] = useState<ConnectorGraph | undefined>(undefined);
  const [failure, setFailure] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (wall.kind !== 'lines') return;
    let disposed = false;
    setLoading(true); setFailure(false);
    void context.api.read(`/modules/nanoleaf/content/editor-layout?device=${encodeURIComponent(wall.id)}`).then(value => {
      if (disposed) return;
      setGeometry(editorGeometry(value, wall.id)); setLoading(false);
    }).catch(() => { if (!disposed) { setFailure(true); setLoading(false); } });
    return () => { disposed = true; };
  }, [context.api, wall.id, wall.kind, attempt]);
  const Command = context.ui.Command;
  return <>
    {wall.kind === 'lines' && <div>
      {failure && <p role="alert">Saved connector geometry is unavailable. {geometry === undefined ? 'The standard wall view remains available.' : 'Keeping the last valid geometry.'}</p>}
      <button type="button" disabled={loading} onClick={() => { setAttempt(value => value + 1); }}>{loading ? 'Reading saved geometry…' : 'Refresh saved geometry'}</button>
    </div>}
    <Command context={context} target={wall.id}>{command => <Canvas context={context} command={command} live={live}
      view={legacyWall(wall, devices, live, geometry)} selectDevice={selectDevice}/>}</Command>
  </>;
}

function Wall({context}: {context: FrontendContext}): React.JSX.Element {
  const catalog = useCatalog(context.api);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const configured = catalog.walls.filter(wall => catalog.devices.some(device => device.id === wall.id));
  const first = configured.find(wall => wall.kind === 'lines') ?? configured[0];
  const target = selected ?? first?.id;
  const wall = configured.find(value => value.id === target);
  const devices = configured.map(value => ({id: value.id, name: catalog.devices.find(device => device.id === value.id)?.label ?? value.id, default: value.id === first?.id}));
  return <>
    {catalog.error && <div><p role="alert">Nanoleaf records are unavailable. Saved records remain stale until sync succeeds.</p>
      <button type="button" disabled={catalog.pending} onClick={catalog.retry}>Retry Nanoleaf records</button></div>}
    {wall === undefined ? <p role="status">{catalog.pending ? 'Reading Nanoleaf records…' : 'The selected Nanoleaf wall is unavailable.'}</p>
      : <Editor key={wall.id} context={context} wall={wall} devices={devices} live={catalog.live && context.connected} selectDevice={setSelected}/>}
  </>;
}

export const frontend: FrontendContribution = {module: 'nanoleaf', pages: [{id: 'wall', Component: Wall}]};
