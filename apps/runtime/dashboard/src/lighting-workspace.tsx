import React, {useEffect, useMemo, useRef, useState} from 'react';
import type {LightingLayout, LightingLayoutRecord, LightingSelection, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {FrontendCommand} from '@jimmie-potts/sdk/frontend';
import {NanoleafLightVisual} from '@jimmie-potts/nanoleaf/frontend';
import type {DashboardConnection} from './connection.ts';
import type {RuntimeData} from './runtime-feeds.ts';
import type {Route} from './routes.ts';
import {useAttempt} from './command-control.tsx';
import {LightCard} from './light-card.tsx';
import {DeviceModeChoice} from './device-mode.tsx';
import {brandName, cardsFor, emptyLightingLayout, groupCards, lightCapabilities, lightingDevices, plugDevices, prepareLighting, resolveCard, selectionKey, ungroupCard, unitKey, type LightingCard, type LightingDevice, type LightingIntent} from './lighting.ts';
import {GroupWith, useFuse} from './fuse.tsx';
import {GroupPanel} from './group-panel.tsx';
import {useHomeShape} from './home-shape-context.ts';
import './lighting.css';
import {PinToggle} from './pins.tsx';
import {RoomModels} from './room-models.tsx';
import {roomBinding} from './room-bindings.ts';
type Bindings = Map<string, FrontendCommand>;
const STALE_LAYOUT = 'Layout records are unavailable or stale. Arrangement is read-only.';
function AttemptBinding({target, operations, operationsLive, bindings, changed}: {target: string; operations: readonly OperationRecord[]; operationsLive: boolean; bindings: Bindings; changed: () => void}): null {
  const command = useAttempt(target, operations, operationsLive);
  bindings.set(target, command);
  useEffect(changed, [command.text, command.locked, command.requestId, changed]);
  useEffect(() => () => { bindings.delete(target); }, [bindings, target]);
  return null;
}
function Placeholder({device}: {device: LightingDevice | undefined}): React.JSX.Element {
  const bulb = device?.record.kind === 'lifx' && device.record.capabilities.power.supported;
  return <svg viewBox="0 0 220 150" role="img" aria-label={bulb ? 'Light bulb placeholder' : 'Light placeholder; model artwork unavailable'}>
    {bulb ? <><path className="light-bulb-glow" d="M86 91C86 78 70 72 70 51a40 40 0 0 1 80 0c0 21-16 27-16 40Z"/><path className="light-bulb-base" d="M87 94h46v24l-12 13H99l-12-13Z"/><path d="M89 102h42m-42 8h42m-35 9h28" fill="none" stroke="currentColor" strokeWidth="3"/></>
      : <><path className="light-bulb-glow" d="M40 45h100v14H54v44h126v14H40Z"/><text x="110" y="140" textAnchor="middle">Placeholder</text></>}
  </svg>;
}
/** One shell composition owns bindings and persistence; each view supplies only its selection scope. */
export function LightingWorkspace({runtime, connected, operations, operationsLive, connection, route, homeSelection, homeSelections}: {
  runtime: RuntimeData; connected: boolean; operations: readonly OperationRecord[]; operationsLive: boolean; connection: DashboardConnection; route: Route; homeSelection?: LightingSelection; homeSelections?: LightingSelection[];
}): React.JSX.Element {
  const devices = lightingDevices(runtime.copies, connected);
  // On Home (#1933) cards group by their drag handle and the "Group with" selector, with plugs as well as lights.
  const fuse = useFuse(), shape = useHomeShape();
  const layoutCopy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'lighting-layout');
  const record = (layoutCopy?.records as readonly LightingLayoutRecord[] | undefined)?.find(item => item.id === 'lighting');
  const layout = record?.layout ?? emptyLightingLayout();
  const layoutCommand = useAttempt('lighting', operations, operationsLive);
  const bindings = useRef<Bindings>(new Map());
  const [, render] = useState(0);
  const changed = useMemo(() => () => { render(value => value + 1); }, []);
  const [message, setLocalMessage] = useState('');
  // A Home card says what it refused on Home's one status line (#1933, fuse.tsx), never on the bare backdrop above it.
  const onHomeLine = route.kind === 'home' && homeSelection !== undefined && fuse !== undefined;
  const setMessage = (text: string): void => {if (onHomeLine) fuse.say(text);else setLocalMessage(text);};
  const scope = useMemo(() => connection.openModule('nanoleaf'), [connection]);
  useEffect(() => () => { void scope.close(); }, [scope]);
  const readWall = useMemo(() => (path: string): Promise<unknown> => scope.api.read(path), [scope]);
  const layoutLive = connected && layoutCopy?.synced === true && record !== undefined;
  const editable = runtime.control && layoutLive && operationsLive && !layoutCommand.locked;
  const save = (next: LightingLayout | string): void => {
    if (typeof next === 'string') { setMessage(next); return; }
    if (!editable || record === undefined) { setMessage('Layout changes are unavailable until the current save is resolved and records are synced.'); return; }
    setMessage('');
    void layoutCommand.run({family: 'lighting-layout-set', target: 'lighting', requestId: crypto.randomUUID(), data: {expectedRevision: record.revision, layout: next}});
  };
  const locks = (): Set<string> => new Set(devices.filter(device => bindings.current.get(device.record.id)?.locked !== false).map(device => device.record.id));
  const act = (card: LightingCard, intent: LightingIntent): void => {
    const actions = prepareLighting(card.members, devices, intent, runtime.control, operationsLive, locks(), () => crypto.randomUUID(), card.brand);
    if (typeof actions === 'string') { setMessage(actions); return; }
    setMessage('');
    for (const action of actions) void bindings.current.get(action.target)?.run(action);
  };
  const home = route.kind === 'home';
  const roomView = route.kind === 'rooms';
  const brand = route.kind === 'lighting-brand' ? route.brand : undefined;
  const active = home || roomView || brand !== undefined;
  const viewScope = home ? 'home' : brand === undefined ? 'rooms' : `brand-${brand}`;
  const cards = homeSelections !== undefined ? homeSelections.map(selection => resolveCard(selection, layout, devices)) : roomView ? layout.rooms.map(room => resolveCard({kind: 'room', id: room.id}, layout, devices)) : cardsFor(viewScope, layout, devices);
  const displayedCards = homeSelection === undefined ? cards : [resolveCard(homeSelection, layout, devices)];
  const selected = cardsFor('home', layout, devices).map(card => card.selection);
  const toggleHome = (selection: LightingSelection, checked: boolean): void => {
    const next = structuredClone(layout);
    next.home = selected.filter(value => selectionKey(value) !== selectionKey(selection));
    if (checked) next.home.push(selection);
    save(next);
  };
  const group = (first: LightingSelection, second: LightingSelection): void => { save(groupCards(layout, viewScope, first, second, devices, crypto.randomUUID(), homeSelections)); };
  // The group panel has Ungroup on its face (#1933), so its options leave it out.
  const options = (card: LightingCard, currentObservationsOnly = false, ungroupInMenu = true): React.ReactNode => <details className="light-options"><summary aria-label={`Options for ${card.name}`}>⋯</summary><div className="light-options-body">
    {card.selection.kind !== 'room' && (home && fuse !== undefined ? <GroupWith name={card.name} self={unitKey(card.selection)} fuse={fuse} group={target => {fuse.group(card.selection, target);}}/>
      : <label>Group with<select aria-label={`Group ${card.name} with`} value="" disabled={!editable} onChange={event => {
      const target = cards.find(item => selectionKey(item.selection) === event.target.value); if (target !== undefined) group(card.selection, target.selection);
      event.currentTarget.closest('details')?.removeAttribute('open');
    }}><option value="">Choose a card</option>{cards.filter(other => other.selection.kind !== 'room' && selectionKey(other.selection) !== selectionKey(card.selection)).map(other => <option key={selectionKey(other.selection)} value={selectionKey(other.selection)}>{other.name}</option>)}</select></label>)}
    {card.selection.kind === 'group' && ungroupInMenu && <button type="button" disabled={!editable} onClick={() => { save(ungroupCard(layout, card.selection.id)); }}>Ungroup</button>}
    {card.selection.kind !== 'device' && <form onSubmit={event => {
      event.preventDefault(); const field = new FormData(event.currentTarget).get('name'); const name = typeof field === 'string' ? field.trim() : ''; if (name === '') return;
      const next = structuredClone(layout); const item = card.selection.kind === 'room' ? next.rooms.find(item => item.id === card.selection.id) : next.groups.find(item => item.id === card.selection.id);
      if (item !== undefined) item.name = name; save(next);
    }}><label>Name<input name="name" aria-label={`Name for ${card.name}`} defaultValue={card.name} maxLength={80} required disabled={!editable}/></label><button type="submit" disabled={!editable}>Save name</button></form>}
    {card.selection.kind === 'room' && <button type="button" disabled={!editable} onClick={() => { toggleHome(card.selection, !selected.some(item => selectionKey(item) === selectionKey(card.selection))); }}>{selected.some(item => selectionKey(item) === selectionKey(card.selection)) ? 'Remove from Home' : 'Add to Home'}</button>}
    {home && homeSelection === undefined && card.selection.kind === 'device' && <button type="button" disabled={!editable} onClick={() => { toggleHome(card.selection, false); }}>Remove from Home</button>}
    <h4>Details</h4>{card.members.map(id => {
      // A plug member's details and controls are on its own page.
      if (card.plugs?.some(plug => plug.device === id) === true) {
        const plug = plugDevices(runtime.copies, connected).find(item => item.record.id === id);
        return <div key={id}><a href={`#/component/${encodeURIComponent(id)}`}>{plug?.record.label ?? id} · plug page</a></div>;
      }
      const device = devices.find(item => item.record.id === id), command = bindings.current.get(id);
      const current = !currentObservationsOnly || device?.live === true && device.record.availability === 'available';

      return <div key={id}><a href={`#/component/${encodeURIComponent(id)}`}>{device?.record.label ?? id} · advanced controls</a>
        <label>Room<select aria-label={`Room for ${device?.record.label ?? id}`} value={layout.assignments.find(item => item.device === id)?.room ?? ''} disabled={!editable} onChange={event => {
          const next = structuredClone(layout); next.assignments = next.assignments.filter(item => item.device !== id);
          if (event.target.value !== '') next.assignments.push({device: id, room: event.target.value}); save(next);
        }}><option value="">Unassigned</option>{layout.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <p>{device === undefined ? 'Light unavailable' : `${device.owner} · ${device.record.availability}${device.live ? '' : ' · stale'}`}</p>
        <p>{device?.wall === undefined ? 'Artwork is a placeholder.' : 'Artwork uses the module’s saved geometry.'}</p>
        {device !== undefined && <p>Requested power: {device.record.desired.power.status === 'known' ? String(device.record.desired.power.value) : 'unknown'}. Observed power: {current && device.record.observed.status === 'known' && device.record.observed.power.status === 'known' ? String(device.record.observed.power.value) : 'unknown'}.</p>}
        <p>{command?.text ?? 'No command sent from this page.'}</p>
      </div>;
    })}
  </div></details>;
  return <>
    {[...new Set(devices.map(device => device.record.id))].map(target => <AttemptBinding key={target} target={target} operations={operations} operationsLive={operationsLive} bindings={bindings.current} changed={changed}/>)}
    {active && <section className="lighting-workspace" aria-label={home ? 'Lights' : roomView ? 'Rooms' : `${brandName(brand ?? '')} lights`}>
      {homeSelection === undefined && <header className="lighting-heading"><h2>{home ? 'Lights' : roomView ? 'Rooms' : brandName(brand ?? '')}</h2><div className="lighting-heading-actions">{route.kind === 'lighting-brand' && <PinToggle route={route}/>}<details className="lighting-organize"><summary>{roomView ? 'Manage rooms' : 'Arrange'}</summary><div>
        <form onSubmit={event => {
          event.preventDefault(); const form = event.currentTarget; const field = new FormData(form).get('room'); const name = typeof field === 'string' ? field.trim() : '';
          if (name === '') return; const next = structuredClone(layout); next.rooms.push({id: crypto.randomUUID(), name}); save(next); form.reset();
        }}><label>New room<input name="room" aria-label="New room name" maxLength={80} required disabled={!editable}/></label><button type="submit" disabled={!editable}>Create room</button></form>
        <h3>Home cards</h3>{layout.rooms.map(room => <label className="lighting-check" key={room.id}><input type="checkbox" checked={selected.some(item => item.kind === 'room' && item.id === room.id)} disabled={!editable} onChange={event => { toggleHome({kind: 'room', id: room.id}, event.target.checked); }}/>{room.name} · room</label>)}
        {devices.map(device => <label className="lighting-check" key={`${device.owner}/${device.record.id}`}><input type="checkbox" checked={selected.some(item => item.kind === 'device' && item.id === device.record.id)} disabled={!editable || selected.some(item => item.kind === 'group' && layout.groups.find(group => group.id === item.id)?.devices.includes(device.record.id) === true)} onChange={event => { toggleHome({kind: 'device', id: device.record.id}, event.target.checked); }}/>{device.record.label ?? device.record.id}</label>)}
        {layout.groups.filter(group => group.scope === 'home').map(group => <label className="lighting-check" key={group.id}><input type="checkbox" checked={selected.some(item => item.kind === 'group' && item.id === group.id)} disabled={!editable} onChange={event => {
          const next = structuredClone(layout); next.home = selected.filter(item => !(item.kind === 'device' && group.devices.includes(item.id)) && !(item.kind === 'group' && item.id === group.id)); if (event.target.checked) next.home.push({kind: 'group', id: group.id}); save(next);
        }}/>{group.name} · group</label>)}
        <h3>Room assignments</h3>{devices.map(device => <label key={`${device.owner}/${device.record.id}`}>{device.record.label ?? device.record.id}<select aria-label={`Assign ${device.record.label ?? device.record.id} to room`} value={layout.assignments.find(item => item.device === device.record.id)?.room ?? ''} disabled={!editable} onChange={event => {
          const next = structuredClone(layout); next.assignments = next.assignments.filter(item => item.device !== device.record.id); if (event.target.value !== '') next.assignments.push({device: device.record.id, room: event.target.value}); save(next);
        }}><option value="">Unassigned</option>{layout.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>)}
      </div></details></div></header>}
      {/* A Home card shows this inside its own face (#1932), where it neither sits on the backdrop nor pushes the face down. */}
      {!layoutLive && homeSelection === undefined && <p role="status" data-glass-veil>{STALE_LAYOUT}</p>}
      {/* A Home card leaves layout results to Home's own line (#1933, fuse.tsx). */}
      {(homeSelection === undefined || fuse === undefined) && (layoutCommand.locked || /Refused|Not sent/i.test(layoutCommand.text)) && <p role="status" data-glass-veil>Layout: {layoutCommand.text.replace('The module observed the result.', 'The layout was saved.')} <button type="button" onClick={() => { void connection.refreshDevices(); }}>Refresh records</button></p>}
      {message !== '' && !onHomeLine && <p role="status" data-glass-veil>{message}</p>}
      {roomView && <RoomModels connection={connection} connected={connected && runtime.modules?.some(module => module.name === 'core' && module.state === 'running') === true} layout={layout} layoutLive={layoutLive} devices={devices} copies={runtime.copies}
        renderLight={(anchor, roomId, currentObservationsOnly = false) => {
          const bound = roomBinding(anchor, roomId, layout, devices, layoutLive);
          if ('reason' in bound) return <p>{bound.reason}</p>;
          const {card, device} = bound;
          return <LightCard key={card.selection.id} card={card} devices={devices} currentObservationsOnly={currentObservationsOnly}
            capabilities={lightCapabilities(card.members, devices, runtime.control, operationsLive, locks())}
            act={intent => {
              const current = roomBinding(anchor, roomId, layout, devices, layoutLive);
              if ('reason' in current) { setMessage(current.reason); return; }
              act(current.card, intent);
            }} options={options(card,currentObservationsOnly)} modeChoice={card.selection.kind === 'device' ? <DeviceModeChoice target={card.selection.id}/> : undefined}
            status={card.members.map(id => ({name: card.name, text: bindings.current.get(id)?.text ?? '', locked: bindings.current.get(id)?.locked ?? false}))}
            artwork={<div className="lighting-image-group"><div>{device.wall === undefined ? <Placeholder device={device}/> : <NanoleafLightVisual wall={device.wall} read={readWall}/>}</div></div>}/>;
        }}/>}
      {cards.length === 0 && <p>{roomView ? 'Create a room, then assign its lights in Manage rooms.' : 'No light cards here. Use Arrange to select Home cards.'}</p>}
      <div className="lighting-grid">{displayedCards.map(card => {
        // On Home a group in the Wide shape, and a group that holds a plug in every shape, is the group panel (#1933).
        const saved = card.selection.kind === 'group' ? layout.groups.find(item => item.id === card.selection.id) : undefined;
        if (home && saved !== undefined && (shape === 'wide' || (saved.plugs?.length ?? 0) > 0)) return <GroupPanel key={selectionKey(card.selection)} id={saved.id} name={card.name} group={saved}
          devices={devices} plugs={plugDevices(runtime.copies, connected)} control={runtime.control} operations={operations} operationsLive={operationsLive}
          ungroup={editable ? () => {save(ungroupCard(layout, saved.id));} : undefined} handle={fuse?.handle(card.selection, card.name)} options={options(card, false, false)}
          {...(!layoutLive ? {notice: STALE_LAYOUT} : {})}/>;
        return <LightCard key={selectionKey(card.selection)} card={card} devices={devices} operations={operations} capabilities={lightCapabilities(card.members, devices, runtime.control, operationsLive, locks(), card.brand)}
        {...(!layoutLive && homeSelection !== undefined ? {notice: STALE_LAYOUT} : {})}
        act={intent => { act(card, intent); }} options={options(card)} modeChoice={card.selection.kind === 'device' ? <DeviceModeChoice target={card.selection.id}/> : undefined} status={card.members.map(id => ({name: devices.find(device => device.record.id === id)?.record.label ?? id, text: bindings.current.get(id)?.text ?? '', locked: bindings.current.get(id)?.locked ?? false}))}
        artwork={<div className="lighting-image-group">{card.members.map(id => {
          const device = devices.find(device => device.record.id === id);
          return <div key={id}>{device?.wall === undefined ? <Placeholder device={device}/> : <NanoleafLightVisual wall={device.wall} read={readWall}/>}</div>;
        })}</div>}
        {...(home && fuse !== undefined ? card.selection.kind === 'room' ? {} : {handle: fuse.handle(card.selection, card.name)} : editable && !roomView && card.selection.kind !== 'room' ? {drag: (event: React.DragEvent<HTMLElement>) => { event.dataTransfer.setData('application/x-bunny-light-card', selectionKey(card.selection)); event.dataTransfer.effectAllowed = 'move'; }, drop: (event: React.DragEvent<HTMLElement>) => {
          event.preventDefault(); const key = event.dataTransfer.getData('application/x-bunny-light-card'); const first = cards.find(item => selectionKey(item.selection) === key); if (first !== undefined) group(first.selection, card.selection);
        }} : {})}/>;
      })}</div>
    </section>}
  </>;
}
