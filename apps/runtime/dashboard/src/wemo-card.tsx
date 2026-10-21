import React,{useId,useState} from 'react';
import './wemo.css';

export type WemoCardProps={id:string;label:string;power:boolean|undefined;status:string;disabled:boolean;onPower:(on:boolean)=>void;powerControls:React.ReactNode;limit:React.ReactNode;evidence:React.ReactNode};

/** Presentation only. Its caller owns observations, commands and limit saves. */
export function WemoCard({id,label,power,status,disabled,onPower,powerControls,limit,evidence}:WemoCardProps):React.JSX.Element{
  const [tab,setTab]=useState<'power'|'limit'>('power');
  const uid=useId();
  const switchTab=(next:'power'|'limit'):void=>{setTab(next);};
  return <div className="wemo-module">
    <article className="wemo-card" data-device={id} aria-label={label}>
      <header className="wemo-heading"><span>Wemo Mini</span><span className="warning" role="status">{status!==''&&<><span aria-hidden="true">! </span>{status}</>}</span></header>
      <div className="wemo-art" role="img" aria-label="Desk lamp illustration with a smaller Wemo plug" data-on={power===true&&status===''}>
        <div className="wemo-glow"/>
        <div className="wemo-scene" aria-hidden="true">
          <div className="wemo-lamp"><div className="wemo-lamp-beam"/><div className="wemo-lamp-lower"/><div className="wemo-lamp-upper"/><div className="wemo-lamp-joint"/><div className="wemo-lamp-shade"/><div className="wemo-lamp-base"/></div>
          <div className="wemo-plug"><div className="wemo-socket"><b/><b/><em/></div><span className="wemo-brand">wemo</span><span className="wemo-led"/></div>
        </div>
      </div>
      <h2 className="wemo-name">{label}</h2>
      <div className="wemo-tabs" role="tablist" aria-label={`${label} controls`} onKeyDown={event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();const next=event.key==='Home'?'power':event.key==='End'?'limit':tab==='power'?'limit':'power';
        switchTab(next);document.getElementById(`${uid}-${next}-tab`)?.focus();
      }}>
        {(['power','limit'] as const).map(value=><button type="button" key={value} id={`${uid}-${value}-tab`} role="tab" aria-selected={tab===value} aria-controls={`${uid}-${value}-panel`} onClick={()=>{switchTab(value);}}>{value==='power'?'Power':'Auto-off'}</button>)}
      </div>
      <div className="wemo-faces">
        <section id={`${uid}-power-panel`} role="tabpanel" aria-labelledby={`${uid}-power-tab`} hidden={tab!=='power'}>
          <div className="wemo-power-buttons" role="group" aria-label="Set plug power">
            {[true,false].map(on=><button type="button" key={String(on)} aria-label={`Turn ${on?'on':'off'}`} aria-pressed={power===on} disabled={disabled} onClick={()=>{onPower(on);}}>{on?'On':'Off'}</button>)}
          </div>
          {powerControls}
        </section>
        <section id={`${uid}-limit-panel`} role="tabpanel" aria-labelledby={`${uid}-limit-tab`} hidden={tab!=='limit'}>{limit}</section>
      </div>
    </article>
    <details className="wemo-evidence"><summary>Device evidence</summary>{evidence}</details>
  </div>;
}
