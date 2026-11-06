import React, {useEffect, useRef, useState} from 'react';
import type {HomeArtFormat} from '@jimmie-potts/event-contracts/v2/families';
import {fitArt, type ArtFit} from './home-art.ts';

/** Observe a reserved row or the unused trailing viewport. Art never measures or repacks individual cards. */
export function HomeArtSlot({automatic, format, home, children}: {
  automatic: boolean; format: HomeArtFormat; home: React.RefObject<HTMLDivElement | null>; children: React.ReactNode;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null), [fit, setFit] = useState<ArtFit>();
  useEffect(() => {
    const element = host.current, owner = home.current;
    if (element === null || owner === null) return;
    let pointer = false;
    const measure = (): void => {
      if (automatic && (pointer || owner.classList.contains('is-editing') || (document.activeElement instanceof HTMLElement && owner.contains(document.activeElement) && document.activeElement.matches('button,input,textarea,select,a')))) return;
      const rect = element.getBoundingClientRect();
      const next = fitArt(rect.width, automatic ? window.innerHeight - rect.top - 24 : 2000, format);
      setFit(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const down = (): void => {pointer = true;}, up = (): void => {pointer = false;measure();};
    const blur = (): void => {queueMicrotask(measure);};
    const observer = new ResizeObserver(measure);
    observer.observe(element);const grid = owner.querySelector('.home-layout-grid');if (grid !== null) observer.observe(grid);
    owner.addEventListener('pointerdown', down);window.addEventListener('pointerup', up);window.addEventListener('pointercancel', up);
    owner.addEventListener('focusout', blur);window.addEventListener('resize', measure);measure();
    return () => {observer.disconnect();owner.removeEventListener('pointerdown', down);window.removeEventListener('pointerup', up);window.removeEventListener('pointercancel', up);owner.removeEventListener('focusout', blur);window.removeEventListener('resize', measure);};
  }, [automatic, format, home]);
  return <div className="home-art-slot" ref={host} data-art-placement={automatic ? 'automatic' : 'reserved'}>{fit !== undefined && <div className="home-art-box" data-art-format={fit.format} style={{width: fit.width, height: fit.height}}>{children}</div>}</div>;
}
