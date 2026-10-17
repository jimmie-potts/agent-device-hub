// Read-only artwork exported by the owner; the shell supplies its existing authenticated read scope.
import React, {useEffect, useRef, useState} from 'react';
import type {FrontendApi} from '@jimmie-potts/sdk/frontend';
import {editorGeometry, legacyWall, type ConnectorGraph, type WallRecord} from './model.js';
import {Prism} from './prism.js';
import {PrismAdapters} from './prism-adapters.js';
export function NanoleafLightVisual({wall, read}: {wall: WallRecord; read: FrontendApi['read']}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState<ConnectorGraph>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (wall.kind !== 'lines') return;
    let closed = false;
    setGraph(undefined); setFailed(false);
    void read(`/modules/nanoleaf/content/editor-layout?device=${encodeURIComponent(wall.id)}`).then(value => {
      if (!closed) setGraph(editorGeometry(value, wall.id));
    }).catch(() => { if (!closed) setFailed(true); });
    return () => { closed = true; };
  }, [wall.id, wall.kind, wall.configurationRevision, read]);
  useEffect(() => {
    if (wall.kind !== 'lines' || graph === undefined || host.current === null) return;
    try {
      const state = legacyWall(wall, [], true, graph);
      const layout = PrismAdapters.fromState(state, element => {
        const task = wall.tasks.find(item => item.id === element.task);
        const color = task === undefined || task.status === 'idle' ? wall.palette.base : wall.palette[task.status];
        return [color, color];
      });
      const renderer = new Prism.Renderer(host.current, layout, {animate: false});
      renderer.setMode(wall.mode);
      return () => { renderer.destroy(); };
    } catch { setFailed(true); }
    return undefined;
  }, [wall, graph]);
  if (wall.kind === 'lines') return <div className="lighting-wall-image" role="img" aria-label={graph === undefined || failed ? 'Nanoleaf Lines placeholder; saved geometry unavailable' : 'Saved Nanoleaf Lines layout'}>
    <div ref={host} inert aria-hidden="true"/>{(graph === undefined || failed) && <span>Lines · {failed ? 'layout unavailable' : 'reading layout'}</span>}
  </div>;
  const points = wall.elements.flatMap(element => element.points ?? []);
  if (wall.layout !== 'saved' || points.length === 0) return <span role="img" aria-label="Nanoleaf panels placeholder; saved geometry unavailable">◇ Panels</span>;
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y;
  const side = Math.max(width, height) + 24;
  return <svg viewBox={`${x + width / 2 - side / 2} ${y + height / 2 - side / 2} ${side} ${side}`} role="img" aria-label="Saved Nanoleaf panel layout">
    <g transform={`translate(${x + width / 2} ${y + height / 2}) rotate(${wall.settings.rotation}) scale(${wall.settings.flipX === 1 ? -1 : 1} ${wall.settings.flipY === 1 ? -1 : 1}) translate(${-x - width / 2} ${-y - height / 2})`}>{wall.elements.map(element => {
      const task = wall.tasks.find(item => item.id === element.task);
      const color = task === undefined || task.status === 'idle' ? wall.palette.base : wall.palette[task.status];
      return element.points === null ? null : <polygon key={element.id} points={element.points.map(point => point.join(',')).join(' ')} fill={color} stroke="currentColor" strokeWidth="2"/>;
    })}</g>
  </svg>;
}
