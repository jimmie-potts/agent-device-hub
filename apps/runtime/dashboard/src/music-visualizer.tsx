/**
 * The music visualizer's browser surfaces (#1619): a panel on the Audio page, a full view that fills the window and can
 * go full screen, and a Home card. Each reads the existing capture state and derived feature stream through the page's
 * shared read-only scope; none sends a command, starts capture or touches a light. Effects draw on a canvas at the display's
 * frame rate.
 */
import React, {useEffect, useId, useRef, useState, useSyncExternalStore} from 'react';
import type {DashboardConnection} from './connection.ts';
import type {MusicCaptureView} from './music-capture-feed.ts';
import {useMusicCapture} from './music-capture-scope.ts';
import {effectById, visualizerEffects} from './music-visualizer-effects.ts';
import {VisualizerEngine, visualizerSignal, type Shape, type VisualizerEffect, type VisualizerSignal} from './music-visualizer-model.ts';
import {EffectChoiceStore} from './music-visualizer-preference.ts';
import './music-visualizer.css';

const FULL_VIEW = '#/audio/visualizer';
/** One choice per browser, shared by every surface on the page and followed across this browser's tabs. */
const effectChoice = new EffectChoiceStore(() => window.localStorage);
try {window.addEventListener('storage', event => {effectChoice.storageChanged(event.key, event.newValue);});} catch {/* No cross-tab follow. */}
const useEffectChoice = (): VisualizerEffect => effectById(useSyncExternalStore(effectChoice.subscribe, effectChoice.getSnapshot, effectChoice.getSnapshot));

const empty: MusicCaptureView = {synced: false, state: undefined, features: undefined, clockQualified: false, rechecking: false};
const emptySubscribe = (): (() => void) => () => {};
const emptySnapshot = (): MusicCaptureView => empty;
/** The page's shared read-only capture scope; opening it neither starts capture nor opens an endpoint. */
function useCaptureView(connection: DashboardConnection, connected: boolean, coreLive: boolean): {view: MusicCaptureView; live: boolean} {
  const scope = useMusicCapture(connection, connected, coreLive);
  const view = useSyncExternalStore(scope?.subscribe ?? emptySubscribe, scope?.getSnapshot ?? emptySnapshot, emptySnapshot);
  return {view, live: connected && coreLive && scope !== undefined && view.synced};
}

function paint(context: CanvasRenderingContext2D, scene: readonly Shape[], scale: number): void {
  context.setTransform(scale, 0, 0, scale, 0, 0);
  for (const shape of scene) {
    context.globalAlpha = shape.alpha;
    if (shape.kind === 'rect') {context.fillStyle = shape.fill; context.fillRect(shape.x, shape.y, shape.width, shape.height); continue;}
    context.beginPath(); context.arc(shape.x, shape.y, Math.max(0, shape.radius), 0, Math.PI * 2);
    if (shape.kind === 'circle') {context.fillStyle = shape.fill; context.fill();}
    else {context.lineWidth = shape.lineWidth; context.strokeStyle = shape.stroke; context.stroke();}
  }
  context.globalAlpha = 1;
}
const levelsText = (signal: {levels: {level: number; bass: number; mid: number; treble: number}}): string =>
  [signal.levels.level, signal.levels.bass, signal.levels.mid, signal.levels.treble].map(value => value.toFixed(2)).join(' ');

/** Paints the chosen effect every display frame; a resting scene is painted once until something changes. */
function VisualizerCanvas({signal, effect, className}: {signal: VisualizerSignal; effect: VisualizerEffect; className: string}): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null), latest = useRef({signal, effect});
  latest.current = {signal, effect};
  useEffect(() => {
    const element = canvas.current, context = element?.getContext('2d');
    if (element === null || element === undefined || context === null || context === undefined) return;
    const engine = new VisualizerEngine(latest.current.effect);
    let frame = 0, rested = '', painted = 0;
    const mark = (name: string, value: string): void => {if (element.dataset[name] !== value) element.dataset[name] = value;};
    const draw = (time: number): void => {
      const scale = Math.min(2, Math.max(1, window.devicePixelRatio)), width = element.clientWidth, height = element.clientHeight;
      const pixelWidth = Math.max(1, Math.round(width * scale)), pixelHeight = Math.max(1, Math.round(height * scale));
      const resized = element.width !== pixelWidth || element.height !== pixelHeight;
      if (resized) {element.width = pixelWidth; element.height = pixelHeight;}
      engine.use(latest.current.effect);
      const result = engine.frame(latest.current.signal, time, {width, height});
      const restKey = result.state === 'resting' ? `${engine.effect.id}/${String(pixelWidth)}x${String(pixelHeight)}` : '';
      if (result.state === 'live' || resized || restKey !== rested) {paint(context, result.scene, scale); painted += 1;}
      rested = restKey;
      mark('visualizerState', result.state); mark('visualizerEffect', engine.effect.id); mark('visualizerPainted', String(painted));
      if (result.state === 'live') {mark('visualizerSequence', String(result.sequence)); mark('visualizerLevels', levelsText(result));}
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => {cancelAnimationFrame(frame);};
  }, []);
  const label = `${effect.name} visualizer. ${signal.kind === 'resting' ? `Resting: ${signal.reason}` : 'Showing measured Music.'}`;
  return <canvas ref={canvas} className={className} role="img" aria-label={label}/>;
}

function EffectPicker({effect}: {effect: VisualizerEffect}): React.JSX.Element {
  const id = useId();
  return <div className="music-visualizer-picker">
    <label htmlFor={id}>Effect</label>
    <select id={id} value={effect.id} onChange={event => {effectChoice.choose(event.target.value);}}>
      {visualizerEffects.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}
    </select>
  </div>;
}
const statusText = (signal: VisualizerSignal, effect: VisualizerEffect): string => signal.kind === 'resting' ? `Resting. ${signal.reason}` : `Showing ${effect.name} from measured Music.`;

/** The Audio page surface. */
export function MusicVisualizerPanel({connection, connected, coreLive}: {connection: DashboardConnection; connected: boolean; coreLive: boolean}): React.JSX.Element {
  const {view, live} = useCaptureView(connection, connected, coreLive), effect = useEffectChoice(), heading = useId();
  const signal = visualizerSignal(view, live);
  return <section className="music-visualizer-panel" aria-labelledby={heading}>
    <div className="music-visualizer-heading"><h2 id={heading}>Music visualizer</h2><a href={FULL_VIEW}>Fill window</a></div>
    <EffectPicker effect={effect}/>
    <VisualizerCanvas className="music-visualizer-canvas" signal={signal} effect={effect}/>
    <p role="status" className="music-note">{statusText(signal, effect)}</p>
    <p className="music-note">Draws the measurement in this browser. It sends no commands and controls no lights.</p>
  </section>;
}

/** The window-filling view; Full screen uses the browser's Fullscreen API. Escape or Exit returns to Audio. */
export function MusicVisualizerFullView({connection, connected, coreLive}: {connection: DashboardConnection; connected: boolean; coreLive: boolean}): React.JSX.Element {
  const {view, live} = useCaptureView(connection, connected, coreLive), effect = useEffectChoice();
  const signal = visualizerSignal(view, live), stage = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false), [idle, setIdle] = useState(false);
  const exit = (): void => {
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {});
    location.hash = '#/audio';
  };
  useEffect(() => {
    const changed = (): void => {setFullscreen(document.fullscreenElement !== null);};
    const key = (event: KeyboardEvent): void => {if (event.key === 'Escape' && document.fullscreenElement === null) {event.preventDefault(); location.hash = '#/audio';}};
    document.addEventListener('fullscreenchange', changed); document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('fullscreenchange', changed); document.removeEventListener('keydown', key);
      if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  // The controls fade after a few still seconds so the screen shows only the effect; any movement or key brings them back.
  const [activity, setActivity] = useState(0);
  useEffect(() => {setIdle(false); const timer = setTimeout(() => {setIdle(true);}, 3000); return () => {clearTimeout(timer);};}, [activity]);
  const wake = (): void => {setActivity(value => value + 1);};
  return <div ref={stage} className={`music-visualizer-full${idle ? ' is-idle' : ''}`} role="region" aria-label="Music visualizer full view" onPointerMove={wake} onKeyDown={wake} onFocus={wake}>
    <VisualizerCanvas className="music-visualizer-full-canvas" signal={signal} effect={effect}/>
    <div className="music-visualizer-controls">
      <EffectPicker effect={effect}/>
      {fullscreen ? <button type="button" className="secondary" onClick={() => {void document.exitFullscreen().catch(() => {});}}>Leave full screen</button>
        : <button type="button" className="secondary" disabled={!document.fullscreenEnabled} onClick={() => {void stage.current?.requestFullscreen().catch(() => {});}}>Full screen</button>}
      <button type="button" onClick={exit}>Exit full view</button>
      <p role="status">{statusText(signal, effect)}</p>
    </div>
  </div>;
}

/** The Home card: the chosen effect, why it rests when it does, and a link to the full view. */
export function MusicVisualizerCard({connection, connected, coreLive}: {connection: DashboardConnection; connected: boolean; coreLive: boolean}): React.JSX.Element {
  const {view, live} = useCaptureView(connection, connected, coreLive), effect = useEffectChoice();
  const signal = visualizerSignal(view, live);
  return <div className="music-visualizer-card">
    <VisualizerCanvas className="music-visualizer-canvas" signal={signal} effect={effect}/>
    <p className="music-note" role="status"><strong>{effect.name}</strong> · {signal.kind === 'live' ? 'Showing measured Music.' : `Resting. ${signal.reason}`}</p>
    <a href={FULL_VIEW}>Open full view</a>
  </div>;
}
