import React, {useEffect, useId, useRef, useState} from 'react';
import type {LightingCard, LightingDevice, LightingIntent, lightCapabilities} from './lighting.ts';
type Tab = 'Power' | 'Color' | 'Scenes' | 'Timer';
const tabs: Tab[] = ['Power', 'Color', 'Scenes', 'Timer'];
export type LightCardProps = {
  card: LightingCard; devices: readonly LightingDevice[]; capabilities: ReturnType<typeof lightCapabilities>;
  artwork: React.ReactNode; modeChoice?: React.ReactNode; options: React.ReactNode; status: readonly {name: string; text: string; locked: boolean}[];
  act: (intent: LightingIntent) => void; drag?: React.DragEventHandler<HTMLElement>; drop?: React.DragEventHandler<HTMLElement>;
};
function Slider({label, value, min = 0, max = 100, unit = '%', disabled, commit}: {
  label: string; value: number | undefined; min?: number; max?: number; unit?: string; disabled: boolean; commit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? min);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setDraft(value ?? min); }, [value, min]);
  const send = (): void => { if (dirty.current && !disabled) { dirty.current = false; commit(draft); } };
  return <label className="light-slider"><span>{label}<output>{dirty.current ? draft : value === undefined ? 'Mixed / unknown' : value}{(dirty.current || value !== undefined) && unit}</output></span>
    <input type="range" min={min} max={max} step="1" value={draft} disabled={disabled} onChange={event => { dirty.current = true; setDraft(Number(event.target.value)); }}
      onPointerUp={send} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) send(); }}/>
  </label>;
}
function common<T>(values: readonly (T | undefined)[]): T | undefined { return values.length > 0 && values.every(value => value !== undefined && value === values[0]) ? values[0] : undefined; }
/** Artwork and the menu remain mounted. Only the labelled control face changes on a tab switch. */
export function LightCard({card, devices, capabilities: cap, artwork, modeChoice, options, status, act, drag, drop}: LightCardProps): React.JSX.Element {
  const id = useId();
  const [tab, setTab] = useState<Tab>('Power');
  const [hue, setHue] = useState(210), [saturation, setSaturation] = useState(75);
  const [paletteDirty, setPaletteDirty] = useState(false);
  const members = card.members.map(member => devices.find(device => device.record.id === member));
  const requestedBrightness = common(members.map(member => member?.record.desired.brightness.status === 'known' ? member.record.desired.brightness.value : undefined));
  const observedBrightness = common(members.map(member => member?.record.observed.status === 'known' && member.record.observed.brightness.status === 'known' ? member.record.observed.brightness.value : undefined));
  const brightness = observedBrightness ?? requestedBrightness;
  const power = common(members.map(member => member?.record.desired.power.status === 'known' ? member.record.desired.power.value : undefined));
  const observedPower = common(members.map(member => member?.record.observed.status === 'known' && member.record.observed.power.status === 'known' ? member.record.observed.power.value : undefined));
  const kelvin = common(members.map(member => member?.color?.observed.status === 'known' ? member.color.observed.kelvin : undefined));
  const colorHue = common(members.map(member => member?.color?.observed.status === 'known' ? member.color.observed.hue : undefined));
  const colorSaturation = common(members.map(member => member?.color?.observed.status === 'known' ? member.color.observed.saturation : undefined));
  useEffect(() => { if (!paletteDirty) { setHue(colorHue ?? 210); setSaturation(colorSaturation ?? 75); } }, [colorHue, colorSaturation, paletteDirty]);
  const attention = status.filter(item => item.locked || /Refused|Not sent|failed|uncertain|Conflicting/i.test(item.text));
  const statusText = cap.blocked ?? (observedPower === undefined ? power === undefined ? 'Mixed / unknown' : `Requested ${power ? 'on' : 'off'}` : observedPower ? 'On · observed' : 'Off · observed');
  return <article className="light-card" aria-label={card.name} data-light-card={card.selection.id} onDragOver={event => { if (drop !== undefined) event.preventDefault(); }} onDrop={drop}>
    <header className="light-card-heading"><div><h3>{card.name}</h3><p>{card.selection.kind === 'device' ? 'Light' : `${card.members.length} lights · ${card.selection.kind}`} · {statusText}</p></div>
      {options}
    </header>
    <div className="light-artwork" data-light-artwork={card.selection.id}>{artwork}</div>
    <div className="light-tabs" role="tablist" aria-label={`${card.name} controls`}>{tabs.map((name, index) => <button key={name} type="button" role="tab" id={`${id}-${name}`} aria-controls={`${id}-face`} aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
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
    </div></div>
    {attention.length > 0 && <div className="light-attention" role="status">{attention.map(item => <p key={item.name}>{card.members.length > 1 ? `${item.name}: ` : ''}{item.text}</p>)}</div>}
    {drag !== undefined && <button type="button" className="light-drag" draggable onDragStart={drag} aria-label={`Drag ${card.name} to group`}>⠿ <span>Drag to group</span></button>}
  </article>;
}
