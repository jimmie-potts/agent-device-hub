import React, {useEffect, useId, useRef, useState} from 'react';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {FrontendCommandView} from '@jimmie-potts/sdk/frontend';
import type {LightingCard, LightingDevice, LightingIntent, lightCapabilities} from './lighting.ts';
import {useHomeShape} from './home-shape-context.ts';
import {useHomeUnfold} from './home-unfold.ts';
import {glowOf, lampAttributes, NO_GLOW} from './glass-light.ts';
import {LightDial} from './light-dial.tsx';
import {useDeviceModeNote} from './device-mode.tsx';
import {newerRequest} from './requested.ts';
import './light-dial.css';
type Tab = 'Power' | 'Color' | 'Scenes' | 'Timer';
const tabs: Tab[] = ['Power', 'Color', 'Scenes', 'Timer'];
export type LightCardProps = {
  card: LightingCard; devices: readonly LightingDevice[]; capabilities: ReturnType<typeof lightCapabilities>;
  artwork: React.ReactNode; modeChoice?: React.ReactNode; options: React.ReactNode; status: readonly (FrontendCommandView & {name: string})[];
  act: (intent: LightingIntent) => void; currentObservationsOnly?: boolean;
  /** The operation records, so the Small square dial can tell a request newer than the lights' last report. */
  operations?: readonly OperationRecord[]; drag?: React.DragEventHandler<HTMLElement>; drop?: React.DragEventHandler<HTMLElement>;
  /** A status about the card's arrangement, such as stale layout records, shown inside the card on Home. */
  notice?: string;
  /**
   * On Home, the drag handle that groups this card with another light or plug (#1933), at its top right. An unfolded
   * card shows none: it is grouped from its Small square or by "Group with".
   */
  handle?: React.ReactNode;
};
/** Where a card's own page is: a light's component page, the Rooms page for a room, a group's brand page. */
function pageOf(card: LightingCard): string | undefined {
  if (card.selection.kind === 'device') return `#/component/${encodeURIComponent(card.selection.id)}`;
  if (card.selection.kind === 'room') return '#/rooms';
  return card.brand === undefined ? undefined : `#/lights/${encodeURIComponent(card.brand)}`;
}
function Slider({label, value, min = 0, max = 100, unit = '%', disabled, commit}: {
  label: string; value: number | undefined; min?: number; max?: number; unit?: string; disabled: boolean; commit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? min);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setDraft(value ?? min); }, [value, min]);
  const send = (): void => { if (dirty.current && !disabled) { dirty.current = false; commit(draft); } };
  return <label className="light-slider"><span>{label}<output>{dirty.current ? draft : value === undefined ? 'Mixed / unknown' : value}{(dirty.current || value !== undefined) && unit}</output></span>
    <input aria-label={label} type="range" min={min} max={max} step="1" value={draft} disabled={disabled} onChange={event => { dirty.current = true; setDraft(Number(event.target.value)); }}
      onPointerUp={send} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) send(); }}/>
  </label>;
}
function common<T>(values: readonly (T | undefined)[]): T | undefined { return values.length > 0 && values.every(value => value !== undefined && value === values[0]) ? values[0] : undefined; }
/** Artwork and the menu remain mounted. Only the labelled control face changes on a tab switch. */
export function LightCard({card, devices, capabilities: cap, artwork, modeChoice, options, status, act, currentObservationsOnly = false, operations = [], drag, drop, notice, handle}: LightCardProps): React.JSX.Element {
  const id = useId(), shape = useHomeShape(), unfold = useHomeUnfold(), modeNote = useDeviceModeNote(card.selection.kind === 'device' ? card.selection.id : undefined);
  // Unfolding on Home (#1932): after the arrow or Escape, focus moves into the opened controls or back to the arrow.
  const arrow = useRef<HTMLButtonElement>(null), opened = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (unfold?.focus === undefined) return;
    (unfold.focus === 'arrow' ? arrow.current : opened.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]'))?.focus();
    unfold.focused();
  }, [unfold]);
  // In a one-row Home shape (#1672) the card keeps its artwork, state and power; color, scenes and the rest stay one
  // step away in the card's options menu and on its own page.
  const compact = shape === 'square' || shape === 'wide';
  const [tab, setTab] = useState<Tab>('Power');
  const [hue, setHue] = useState(210), [saturation, setSaturation] = useState(75);
  const [paletteDirty, setPaletteDirty] = useState(false);
  const members = card.members.map(member => devices.find(device => device.record.id === member));
  const requestedBrightness = common(members.map(member => member?.record.desired.brightness.status === 'known' ? member.record.desired.brightness.value : undefined));
  const observedMembers = currentObservationsOnly
    ? members.map(member => member?.live === true && member.record.availability === 'available' ? member : undefined)
    : members;
  const colors = currentObservationsOnly ? observedMembers.map(member => member?.colorLive === true ? member : undefined) : members;
  const observedBrightness = common(observedMembers.map(member => member?.record.observed.status === 'known' && member.record.observed.brightness.status === 'known' ? member.record.observed.brightness.value : undefined));
  const brightness = observedBrightness ?? requestedBrightness;
  const power = common(members.map(member => member?.record.desired.power.status === 'known' ? member.record.desired.power.value : undefined));
  const observedPower = common(observedMembers.map(member => member?.record.observed.status === 'known' && member.record.observed.power.status === 'known' ? member.record.observed.power.value : undefined));
  const kelvin = common(colors.map(member => member?.color?.observed.status === 'known' ? member.color.observed.kelvin : undefined));
  const colorHue = common(colors.map(member => member?.color?.observed.status === 'known' ? member.color.observed.hue : undefined));
  const colorSaturation = common(colors.map(member => member?.color?.observed.status === 'known' ? member.color.observed.saturation : undefined));
  useEffect(() => { if (!paletteDirty) { setHue(colorHue ?? 210); setSaturation(colorSaturation ?? 75); } }, [colorHue, colorSaturation, paletteDirty]);
  const attention = status.filter(({phase, locked}) => locked || phase.kind === 'refused' ||
    phase.kind === 'not-sent' || phase.kind === 'expired' || phase.kind === 'completed' && phase.result === 'failed');
  // While a request from this card is in progress or unresolved (sent, accepted, awaiting its reply, uncertain or
  // conflicting) the card says so, for checks that must not press before it has finished.
  const busy = status.some(item => item.locked) ? '' : undefined;
  const statusText = cap.blocked ?? (observedPower === undefined ? power === undefined ? 'Mixed / unknown' : `Requested ${power ? 'on' : 'off'}` : observedPower ? 'On · observed' : 'Off · observed');
  // The light this card gives Home's glass layer (#1931): observed state only, from the same members.
  const glow = currentObservationsOnly ? NO_GLOW : glowOf(card.members, devices);
  const attentionLine = attention.length > 0 && <p className="light-attention light-attention-line" role="status" title={attention.map(item => `${card.members.length > 1 ? `${item.name}: ` : ''}${item.text}`).join(' ')}>
    {card.members.length > 1 ? `${attention[0]?.name ?? ''}: ` : ''}{attention[0]?.text}{attention.length > 1 ? ` (+${String(attention.length - 1)})` : ''}</p>;
  const allowDrop = (event: React.DragEvent<HTMLElement>): void => {if (drop !== undefined) event.preventDefault();};
  // The tabbed controls of a two-row card and of a light unfolded on Home: power and brightness with the saved mode,
  // color, scenes and the timer.
  const controls = <><div className="light-tabs" role="tablist" aria-label={`${card.name} controls`}>{tabs.map((name, index) => <button key={name} type="button" role="tab" id={`${id}-${name}`} aria-controls={`${id}-face`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
      onClick={() => { setTab(name); }} onKeyDown={event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : undefined;
        if (next === undefined) return;
        event.preventDefault(); const value = tabs[next]; if (value !== undefined) setTab(value);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
      }}>{name}</button>)}</div>
    <div className="light-face-space"><div key={tab} className="light-face" role="tabpanel" id={`${id}-face`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
      {tab === 'Power' && <>
        <div className="light-power"><button type="button" disabled={!cap.power} aria-pressed={power === true} onClick={() => { act({family: 'power-set', data: {on: true}}); }}>On</button>
          <button type="button" disabled={!cap.power} aria-pressed={power === false} onClick={() => { act({family: 'power-set', data: {on: false}}); }}>Off</button></div>
        <Slider label={observedBrightness === undefined ? 'Brightness · requested' : 'Brightness · observed'} value={brightness} disabled={!cap.brightness} commit={percent => { act({family: 'brightness-set', data: {percent}}); }}/>
        {!cap.power && cap.blocked === undefined && <p className="light-note">Power controls aren’t supported by this model.</p>}
        {modeChoice}
      </>}
      {tab === 'Color' && <>
        {cap.color ? <form onSubmit={event => { event.preventDefault(); act({family: 'lifx-color-set', data: {hue, saturation}}); setPaletteDirty(false); }}>
          <p className="light-note">{colorHue === undefined || colorSaturation === undefined ? 'Current color is mixed or unknown. Choose a color to apply.' : 'Current color · observed'}</p>
          <label className="light-slider"><span>Hue<output>{hue}°</output></span><input aria-label="Hue" className="light-hue" type="range" min="0" max="360" value={hue} onChange={event => { setPaletteDirty(true); setHue(Number(event.target.value)); }}/></label>
          <label className="light-slider"><span>Saturation<output>{saturation}%</output></span><input aria-label="Saturation" type="range" min="0" max="100" value={saturation} onChange={event => { setPaletteDirty(true); setSaturation(Number(event.target.value)); }}/></label>
          <div className="light-power"><button type="submit">Apply color</button><button type="button" onClick={() => { act({family: 'lifx-color-set', data: {hue, saturation: 0}}); }}>Use white</button></div>
        </form> : <p className="light-note">{cap.blocked ?? 'Color isn’t supported by every light in this card. Use native scenes where available.'}</p>}
        {cap.temperature && <Slider label="Temperature" min={1500} max={9000} unit=" K" value={kelvin} disabled={!cap.temperature} commit={value => { act({family: 'lifx-temperature-set', data: {kelvin: value}}); }}/>} 
        {cap.temperature && <p className="light-note">Use white to remove color. Temperature preserves saturation.</p>}
      </>}
      {tab === 'Scenes' && (cap.scenes.length === 0 ? <p className="light-note">{cap.blocked ?? 'No shared native scenes are available in the current modes. Advanced controls show each light’s modes.'}</p>
        : <div className="light-scenes">{cap.scenes.map(scene => <button key={scene} type="button" onClick={() => { act({family: 'scene-activate', data: {sceneId: scene}}); }}>{scene}</button>)}</div>)}
      {tab === 'Timer' && <p className="light-note">Off timers aren’t available in the runtime yet.</p>}
    </div></div></>;

  // The Small square shape is the ring dial (#1931); a room or group with no lights keeps its note. Its top left holds
  // the unfold arrow (#1932) and its top right stays clear for the drag handle (#1933); the options sit bottom right.
  // Unfolded on Home, the dial heads a Large square panel with the full controls and a link to the card's page.
  if ((shape === 'square' || unfold?.open === true) && card.members.length > 0) {
    // A power or brightness request that completed after every member's last report (a LIFX bulb reports on its next
    // read) shows beside the observed state (requested.ts). The ring and the glow keep the observed state; the switch
    // shows the newest power, which is what a press switches away from.
    const newer = (family: 'power-set' | 'brightness-set'): boolean => members.every(member => member !== undefined && newerRequest(member.record, operations, family));
    const powerNewer = newer('power-set'), brightnessNewer = newer('brightness-set');
    const switched = powerNewer ? power ?? observedPower : observedPower ?? power;
    const onOff = (value: boolean | undefined): string => value === undefined ? 'unknown' : value ? 'on' : 'off';
    const requestedLevel = brightnessNewer && switched === true && requestedBrightness !== undefined && requestedBrightness !== observedBrightness ? requestedBrightness : undefined;
    // A drag or a key starts from the newest brightness, an off light's stored one included, so it never jumps to 0.
    const startLevel = brightnessNewer && requestedBrightness !== undefined ? requestedBrightness : observedBrightness ?? requestedBrightness;
    const requested = powerNewer && power !== undefined && power !== observedPower ? `Requested ${onOff(power)} · observed ${onOff(observedPower)}`
      : requestedLevel !== undefined ? `Requested ${String(requestedLevel)}% · observed ${observedBrightness === undefined ? 'unknown' : `${String(observedBrightness)}%`}` : undefined;
    const kind = card.selection.kind === 'device' ? '' : `${String(card.members.length)} lights · `;
    const state = `${kind}${cap.blocked ?? requested ?? (observedPower === undefined ? power === undefined ? 'Mixed / unknown' : `Requested ${power ? 'on' : 'off'}`
      : observedPower ? `On${observedBrightness === undefined ? '' : ` · ${String(observedBrightness)}%`} · observed` : 'Off · observed')}`;
    const dial = <LightDial name={card.name} power={observedPower} brightness={observedBrightness} pressFrom={switched} requestedLevel={requestedLevel}
      startLevel={startLevel} describedBy={`${id}-state`}
      glow={glow} canPower={cap.power} canDim={cap.brightness}
      stale={members.some(member => member?.live !== true)}
      onPower={on => {act({family: 'power-set', data: {on}});}} onBrightness={percent => {act({family: 'brightness-set', data: {percent}});}}/>;
    const lines = <>
      <h3 title={card.name}>{card.name}</h3>
      <p className="light-dial-state" id={`${id}-state`} title={state}>{state}</p>
      {modeNote !== undefined && <p className="light-dial-mode" title={modeNote}>{modeNote}</p>}
    </>;
    // The arrow is the first child in both faces, so it keeps its element, and its focus, as the card opens and closes.
    const toggle = unfold !== undefined && <button ref={arrow} type="button" className="light-unfold" aria-expanded={unfold.open} aria-label={`${card.name} controls`}
      {...(unfold.open ? {'aria-controls': `${id}-unfolded`} : {})} onClick={unfold.toggle}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg></button>;
    const page = pageOf(card);
    if (unfold?.open === true) return <article className="light-card light-dial-card light-unfolded" aria-label={card.name} data-light-card={card.selection.id} data-command-busy={busy} onDragOver={allowDrop} onDrop={drop}>
      {toggle}
      <div className="light-unfolded-head">{dial}<div className="light-unfolded-lines">{lines}{page !== undefined && <a href={page}>Open page</a>}</div>
        <div className="light-dial-options">{options}</div></div>
      {notice !== undefined && <p className="light-card-notice" role="status">{notice}</p>}
      <div className="light-unfolded-controls" id={`${id}-unfolded`} ref={opened}>{controls}</div>
      {attentionLine}
    </article>;
    return <article className="light-card light-dial-card" aria-label={card.name} data-light-card={card.selection.id} data-command-busy={busy} onDragOver={allowDrop} onDrop={drop}>
      {toggle}
      {dial}
      {lines}
      {notice !== undefined && <p className="light-card-notice" role="status" title={notice}>{notice}</p>}
      {attentionLine}
      <div className="light-dial-options">{options}</div>
      {handle}
    </article>;
  }
  return <article className="light-card" aria-label={card.name} data-light-card={card.selection.id} onDragOver={allowDrop} onDrop={drop}>
    <header className="light-card-heading"><div><h3>{card.name}</h3><p title={compact || shape !== undefined ? `${card.selection.kind === 'device' ? 'Light' : `${String(card.members.length)} lights · ${card.selection.kind}`} · ${statusText}` : undefined}>{card.selection.kind === 'device' ? 'Light' : `${card.members.length} lights · ${card.selection.kind}`} · {statusText}</p></div>
      {handle}{options}
    </header>
    {notice !== undefined && <p className="light-card-notice" role="status" title={notice}>{notice}</p>}
    {/* A room or group with no lights says so where its artwork would be, instead of a blank panel (#1672). */}
    <div className="light-artwork" data-light-artwork={card.selection.id} {...(card.members.length === 0 ? {} : lampAttributes(glow))}>{card.members.length === 0 ? <p className="light-empty">No lights in this {card.selection.kind} yet. Assign lights on the Rooms page.</p> : artwork}</div>
    {compact && <div className="light-compact">
      <div className="light-power"><button type="button" disabled={!cap.power} aria-pressed={power === true} onClick={() => { act({family: 'power-set', data: {on: true}}); }}>On</button>
        <button type="button" disabled={!cap.power} aria-pressed={power === false} onClick={() => { act({family: 'power-set', data: {on: false}}); }}>Off</button></div>
      {shape === 'wide' && <Slider label={observedBrightness === undefined ? 'Brightness · requested' : 'Brightness · observed'} value={brightness} disabled={!cap.brightness} commit={percent => { act({family: 'brightness-set', data: {percent}}); }}/>}
      {/* The result of a command sent from this card stays on its face: one line here, each member's detail in its options. */}
      {attentionLine}
    </div>}
    {!compact && controls}
    {attention.length > 0 && <div className="light-attention" role="status">{attention.map(item => <p key={item.name}>{card.members.length > 1 ? `${item.name}: ` : ''}{item.text}</p>)}</div>}
    {drag !== undefined && <button type="button" className="light-drag" draggable onDragStart={drag} aria-label={`Drag ${card.name} to group`}>⠿ <span>Drag to group</span></button>}
  </article>;
}
