import React, {useId, useRef, useState} from 'react';
import type {RoborockCardData} from './card-data.js';
import './roborock-card.css';

export type RoborockCardProps = {id: string; label?: string | undefined; data: RoborockCardData; onReload: () => void};
type Tab = 'status' | 'run' | 'care';
const tabs: readonly {id: Tab; label: string}[] = [{id: 'status', label: 'Status'}, {id: 'run', label: 'Last run'}, {id: 'care', label: 'Care'}];

function Metrics({duration, area, run = false}: {duration: string; area: string; run?: boolean}): React.JSX.Element {
  return <dl className="roborock-metrics"><div><dt>{run ? 'Duration' : 'Cleaning time'}</dt><dd>{duration}</dd></div><div><dt>{run ? 'Cleaned area' : 'Reported area'}</dt><dd>{area}</dd></div></dl>;
}

/** Presentation only: no source access, device controls or retained private state. */
export function RoborockCard({id, label = 'Roborock', data, onReload}: RoborockCardProps): React.JSX.Element {
  const uid = useId(), warningButton = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<Tab>('status'), [note, setNote] = useState(false);
  const warning = data.notices.length > 0;
  return <article className="widget roborock-card" data-roborock-card="quiet-tabs" data-device={id} data-state={data.availability} aria-label={`${label} card`}
    onKeyDown={event => {if (event.key === 'Escape' && note) {setNote(false); warningButton.current?.focus();}}}>
    <header className="roborock-head"><div><h2>{label}</h2><p className="roborock-state" aria-live="polite">{data.title}</p></div>
      {warning && <button ref={warningButton} type="button" className="roborock-warning" aria-label="Roborock status" aria-expanded={note} aria-controls={`${uid}-notice`} onClick={() => {setNote(value => !value);}}><span aria-hidden="true">!</span></button>}
    </header>
    <div className="roborock-notice" id={`${uid}-notice`} hidden={!warning || !note}>
      {data.notices.map(message => <p key={message}>{message}</p>)}<button type="button" className="secondary" onClick={onReload}>Reload observations</button>
    </div>
    <div className="roborock-art" role="img" aria-label="Illustration of a round Roborock vacuum">
      <div className="roborock-shadow"/><div className="roborock-robot"><div className="roborock-bumper"/><div className="roborock-turret"><span/></div><div className="roborock-buttons"><span/><span/></div><span className="roborock-brand">roborock</span><div className="roborock-seam"/><div className="roborock-sensor"/></div>
    </div>
    <div className="roborock-tabs" role="tablist" aria-label="Roborock information" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); const index = tabs.findIndex(value => value.id === tab);
      const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      if (next !== undefined) {setTab(next.id); document.getElementById(`${uid}-${next.id}`)?.focus();}
    }}>{tabs.map(value => <button type="button" key={value.id} role="tab" id={`${uid}-${value.id}`} aria-controls={`${uid}-${value.id}-panel`} aria-selected={tab === value.id} tabIndex={tab === value.id ? 0 : -1} onClick={() => {setTab(value.id);}}>{value.label}</button>)}</div>
    <div className="roborock-plane">
      <section role="tabpanel" id={`${uid}-status-panel`} aria-labelledby={`${uid}-status`} hidden={tab !== 'status'}>
        <div className="roborock-battery"><span>{data.batteryLabel}</span><strong>{data.battery}</strong></div>
        <div className="roborock-track" role="img" aria-label={`Observed battery: ${data.battery}`}><span style={{width: `${data.batteryPercent ?? 0}%`}}/></div>
        {data.cleaning && <Metrics duration={data.duration} area={data.area}/>}
      </section>
      <section role="tabpanel" id={`${uid}-run-panel`} aria-labelledby={`${uid}-run`} hidden={tab !== 'run'}>
        <p className="roborock-run-state">{data.run.label}</p>
        <p className="roborock-robot-time">{data.run.at === undefined ? 'Latest recorded run' : <>Robot time · <time dateTime={Number.isFinite(new Date(data.run.at).getTime()) ? new Date(data.run.at).toISOString() : undefined} title="Robot-reported start time; clock alignment is unqualified.">{data.run.time}</time><span className="roborock-sr">. Robot and collector clock alignment is unqualified.</span></>}</p>
        <Metrics duration={data.run.duration} area={data.run.area} run/>
      </section>
      <section role="tabpanel" id={`${uid}-care-panel`} aria-labelledby={`${uid}-care`} hidden={tab !== 'care'}>
        <dl className="roborock-care">{data.care.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><p className="roborock-care-note">{data.careNote}</p>
      </section>
    </div>
    <footer className="roborock-foot">{data.historyAvailable ? <a href="#/module/roborock/history">History <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg></a> : <span className="roborock-history-unavailable">History unavailable</span>}</footer>
  </article>;
}
