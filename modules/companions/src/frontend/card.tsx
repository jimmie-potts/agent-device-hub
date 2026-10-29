import React, {useEffect, useId, useRef, useState} from 'react';
import './card.css';

type Face = {id: string; label: string; content: React.ReactNode};
export function CompanionCard({companion, name, caption, faces, notice, footer}: {
  companion: 'reachy' | 'duck'; name: string; caption: string; faces: readonly Face[];
  notice?: React.ReactNode; footer: React.ReactNode;
}): React.JSX.Element {
  const uid = useId(), warning = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState(faces[0]?.id), [showNotice, setShowNotice] = useState(false);
  const hasNotice = notice !== undefined;
  useEffect(() => {if (!hasNotice) setShowNotice(false);}, [hasNotice]);
  return <article className="widget companion-card" data-companion={companion} data-widget={companion === 'duck' ? 'duck-latest' : 'reachy'}
    aria-label={companion === 'duck' ? 'MicroDuck latest meaning' : 'Reachy card'} onKeyDown={event => {
      if (event.key === 'Escape' && showNotice) {setShowNotice(false); warning.current?.focus();}
    }}>
    <header className="companion-head widget-head"><div><h2>{name}</h2><p>{caption}</p></div>
      {notice !== undefined && <button ref={warning} type="button" className="companion-warning" aria-label={`${name} connection notice`}
        aria-expanded={showNotice} aria-controls={`${uid}-notice`} onClick={() => {setShowNotice(value => !value);}}><span aria-hidden="true">!</span></button>}
    </header>
    {notice !== undefined && <aside id={`${uid}-notice`} className="companion-notice" hidden={!showNotice}>{notice}</aside>}
    <div className="companion-art" role="img" aria-label={`Stylized ${name} illustration`}>
      {companion === 'reachy' ? <div className="cp-reachy" aria-hidden="true"><span className="cp-ground"/><span className="cp-r-neck"/><span className="cp-r-base"/>
        <span className="cp-r-antenna"/><span className="cp-r-antenna right"/><span className="cp-r-ear"/><span className="cp-r-ear right"/>
        <span className="cp-r-head"><span className="cp-eye"/><span className="cp-eye right"/></span></div>
        : <div className="cp-duck" aria-hidden="true"><span className="cp-ground"/><span className="cp-d-leg"/><span className="cp-d-leg right"/>
          <span className="cp-d-foot"/><span className="cp-d-foot right"/><span className="cp-d-body"/><span className="cp-d-neck"/>
          <span className="cp-d-head"><span className="cp-eye"/><span className="cp-eye right"/><span className="cp-d-beak"/></span></div>}
    </div>
    <div className="companion-tabs" role="tablist" aria-label={`${name} views`} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = faces.findIndex(face => face.id === tab);
      const next = faces[event.key === 'Home' ? 0 : event.key === 'End' ? faces.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : faces.length - 1)) % faces.length];
      if (next !== undefined) {setTab(next.id); document.getElementById(`${uid}-${next.id}`)?.focus();}
    }}>{faces.map(face => <button key={face.id} type="button" role="tab" id={`${uid}-${face.id}`} aria-controls={`${uid}-${face.id}-panel`}
      aria-selected={tab === face.id} tabIndex={tab === face.id ? 0 : -1} onClick={() => {setTab(face.id);}}>{face.label}</button>)}</div>
    <div className="companion-plane">{faces.map(face => <section key={face.id} role="tabpanel" className="companion-face" data-face={face.id}
      id={`${uid}-${face.id}-panel`} aria-labelledby={`${uid}-${face.id}`} hidden={tab !== face.id} inert={tab !== face.id} aria-hidden={tab !== face.id}>{face.content}</section>)}</div>
    <footer className="companion-foot">{footer}</footer>
  </article>;
}
