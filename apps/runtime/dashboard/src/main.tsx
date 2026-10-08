// The B.U.N.N.Y. dashboard on the runtime (Hub #922), converted from `apps/dashboard/src/main.tsx` at main 5abbae9: the
// shell, its hash routes, the Places navigation, browser sign-in on the runtime's gateway and the agent sessions, which
// the page syncs from the core and follows live (ADR 0012). Device cards, music and module pages join in the story's
// later slices; the Hub mode (#924) and the inbox (#923) have their panels on the home now.
import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {ModeState, OperationRecord, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {HubMode} from './hub-mode.tsx';
import {DeviceCard, PlaybackCard} from './device-controls.tsx';
import {BuildIdentity} from './build-identity.tsx';
import placesManifest from '../../../../docs/skins/places.json';
import {DashboardConnection, type DashboardState} from './connection.ts';
import {parseRoute, routeHash, type Route} from './routes.ts';
import {age, matches, sessionRows, type NoticeRow, type SessionRow} from './sessions.ts';
import {OperatorTools} from './operator-tools.tsx';
import {LabelEditor} from './label-editor.tsx';
import {currentSession, launchCode, launchSignIn, previewPlaces, signOut, trustedSignIn} from './signin.ts';
import {Badge, Facts, InfoTip, Select} from './ui.tsx';
import {homeLayout, widgetDefinition, type Placement, type WidgetSize} from './widgets.ts';
import './style.css';

/** The current page comes from the location hash, so every page has a URL and the back button walks the history. */
const routeListeners = new Set<() => void>();
const emitRoute = (): void => { for (const listener of routeListeners) listener(); };
addEventListener('hashchange', emitRoute);
const subscribeRoute = (listener: () => void): (() => void) => {
  routeListeners.add(listener);
  return () => { routeListeners.delete(listener); };
};
const useRoute = (): Route => parseRoute(useSyncExternalStore(subscribeRoute, () => location.hash));
/**
 * Setting the hash updates `location.hash` at once; only the hashchange event is deferred, so the listeners are told now.
 * A link click applies its route in the same event, so two pages are never shown at once.
 */
function navigate(hash: string): void {
  if (location.hash !== hash) location.hash = hash;
  emitRoute();
}

/** A navigation link: a plain anchor with the route's hash, so it opens in a new tab with a modifier key. */
function NavLink({route, current, children}: {route: Route; current?: Route; children: React.ReactNode}): React.JSX.Element {
  const href = routeHash(route);
  return <a href={href} aria-current={current !== undefined && routeHash(current) === href ? 'page' : undefined} onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(href);
  }}>{children}</a>;
}

type Place = {id: string; label: string; group: 'Public' | 'Local'; publicUrl?: string; localUrl?: string};
const places = placesManifest.places as Place[];
const GUIDE = 'https://jimmie-potts.github.io/agent-device-guide/';
/** A loopback `http` link with no credentials, query or fragment, or undefined. */
function loopbackLink(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.username === '' && url.password === '' && url.search === '' && url.hash === '' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
/**
 * The installed runtime serves the dashboard on B.U.N.N.Y.'s own place port. Anywhere else, such as a disposable
 * verification run, the page is a preview (Hub #495): a Local place leads only where the runtime's links name it, so a
 * preview never links to an installed service.
 */
const installed = (): boolean => new URL(places.find(place => place.id === 'bunny')?.localUrl ?? 'http://127.0.0.1:8788/').port === location.port;

function PlacesNav({links}: {links: Readonly<Record<string, string>> | undefined}): React.JSX.Element {
  return <div className="places-group"><p className="nav-label">PLACES</p><nav aria-label="Places" data-links={links === undefined ? 'loading' : 'loaded'}>{places.map(place => {
    if (place.id === 'bunny') return <span key={place.id} aria-current="page">{place.label}<small>Local</small></span>;
    if (place.group === 'Local') {
      // Local links wait for the runtime's links, so a preview never shows an installed destination while it loads.
      if (links === undefined) return null;
      const href = loopbackLink(links[place.id] ?? (installed() ? place.localUrl : undefined));
      if (href === undefined) return null;
      return <a key={place.id} href={href} target="_blank" rel="noopener noreferrer">{place.label}<small>Local</small></a>;
    }
    const href = place.publicUrl;
    if (href === undefined || !href.startsWith(GUIDE)) return null;
    return <a key={place.id} href={href} target="_blank" rel="noopener noreferrer">{place.label}</a>;
  })}</nav></div>;
}

/** The frame every widget renders in: a labelled region, so assistive technology groups its content under its name. */
function Widget({id, size, children}: {id: string; size: WidgetSize; children: React.ReactNode}): React.JSX.Element {
  const definition = widgetDefinition(id);
  return <article className="widget" role="region" data-widget={id} data-size={size} aria-labelledby={`widget-${id}`}>
    <header className="widget-head"><h2 id={`widget-${id}`}>{definition?.name ?? id}</h2></header>
    {children}
  </article>;
}

/** A panel the layout places now and another story fills; it reads nothing and sends nothing. */
function SlotWidget({placement}: {placement: Placement}): React.JSX.Element {
  const text = 'Failed and uncertain device commands will be listed here. This page does not show them yet.';
  return <Widget id={placement.widget} size={placement.size}><p className="hint slot" data-slot={placement.widget}>{text}</p></Widget>;
}

/**
 * One retained notice of a finished turn and who acknowledged it. The row offers no acknowledgment of its own (owner
 * decision, 2026-10-08): the record clears a finished turn, and clearing one on every device is #1009's.
 */
function Notice({notice}: {notice: NoticeRow}): React.JSX.Element {
  const by = notice.acknowledgedBy.length === 0 ? 'none' : notice.acknowledgedBy.join(', ');
  return <div className="notice">
    <p>Turn {notice.turn} ended</p>
    <p className="hint">Acknowledged by: {by}. This does not establish success or readership.</p>
  </div>;
}

/** The name, state and attention stay visible; the evidence and the rare facts sit behind Details. */
function SessionRowView({row, live, now, control}: {row: SessionRow; live: boolean; now: number; control: boolean}): React.JSX.Element {
  const stale = row.uncertain || !live;
  const elapsed = Math.max(0, now - row.lastEvidenceAtMs);
  return <article className="session" data-session={row.id} data-chip={row.chip}>
    <div className="session-head">
      <span className="session-dot" data-chip={row.chip} aria-hidden="true"/>
      <div className="session-id"><h3>{row.name}</h3><p className="muted">{row.where}</p></div>
      <span className="chip" data-chip={row.chip}>{row.chipText}</span>
      <InfoTip warning={stale} label={<><span aria-hidden="true">{stale ? '◷' : '●'}</span> {stale ? 'Stale evidence' : 'Current'}</>}>
        Activity: {row.facts.activity}. Last evidence: {age(elapsed)} ago. {stale ? 'Freshness is uncertain.' : 'Current observation; not a completion estimate.'}
      </InfoTip>
    </div>
    {control && <LabelEditor row={row} live={live}/>}
    {row.attention.length > 0 && <p className="attention">{row.attention.join(' · ')}</p>}
    {row.notices.length > 0 && <><h4>Retained notices</h4>{row.notices.map(notice => <Notice key={notice.id} notice={notice}/>)}</>}
    <details className="details session-details"><summary>Details</summary><Facts className="strip" items={[
      ['Source', row.facts.source], ['Session ID', row.facts.sessionId], ['Activity', row.facts.activity], ['Last evidence', `${age(elapsed)} ago`],
      ['Read evidence', row.facts.read], ['Parent', row.facts.parent], ['Attributable children', row.facts.children],
    ]}/></details>
  </article>;
}

function SessionsWidget({state, rows, live, now, size}: {
  state: DashboardState; rows: readonly SessionRow[]; live: boolean; now: number; size: WidgetSize;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [provider, setProvider] = useState('');
  const records = state.sessions.records;
  const shown = new Set(records.filter(record => matches(record, query, provider)).map(record => record.id));
  const filtering = query !== '' || provider !== '';
  return <Widget id="sessions" size={size}>
    <p className="hint">Current state, synced from the core. A finished turn stays unread until the next turn starts, the session record shows it read, or a device acknowledges it.</p>
    <div className="filters">
      <label>Find a session<input type="search" maxLength={120} value={query} onChange={event => { setQuery(event.target.value); }} placeholder="Label, title, project or session ID"/></label>
      <Select label="Provider" value={provider} onChange={setProvider} options={[{value: '', label: 'All providers'}, {value: 'codex', label: 'codex'}, {value: 'claude', label: 'claude'}]}/>
    </div>
    {shown.size === 0 && <div className="empty"><h3>{filtering ? 'No matching sessions' : state.sessions.synced ? 'No sessions observed' : 'Sessions not synced yet'}</h3>
      <p>{filtering ? 'Change the filters to see other sessions.' : 'The page shows sessions as soon as the core reports them.'}</p></div>}
    <div className="sessions">{rows.map(row => <div key={`${row.id}:${row.generation}`} hidden={!shown.has(row.id)}>
      <SessionRowView row={row} live={live} now={now} control={state.runtime.control}/>
    </div>)}</div>
  </Widget>;
}

function AttentionWidget({rows, size}: {rows: readonly SessionRow[]; size: WidgetSize}): React.JSX.Element {
  const waiting = rows.filter(row => row.attention.length > 0);
  if (waiting.length === 0) return <p className="attention-summary" data-widget="attention">No attention needed.</p>;
  return <Widget id="attention" size={size}><ul className="plain">{waiting.map(row =>
    <li key={row.id}><span className="attention">{row.chipText}</span> · {row.name}</li>)}</ul></Widget>;
}

const FEED_TEXT: Readonly<Record<DashboardState['feed'], string>> = {connecting: 'Connecting', connected: 'Feed connected', reconnecting: 'Reconnecting', ended: 'Signed out'};

/** The link's health in one indicator; its details say what the page last synced, never that work succeeded. */
function FeedIndicator({state, now}: {state: DashboardState; now: number}): React.JSX.Element {
  const {feed, sessions} = state;
  const healthy = feed === 'connected' && sessions.synced;
  const label = feed === 'connected' && !sessions.synced ? 'Syncing sessions' : FEED_TEXT[feed];
  return <InfoTip warning={!healthy} label={<><span aria-hidden="true">{healthy ? '●' : '⚠'}</span> {label}</>}>
    <span className="tip-line">Core sessions: {sessions.synced ? 'synced' : 'not synced'}</span>
    <span className="tip-line">Core revision: {sessions.revision ?? 'Unknown'}</span>
    <span className="tip-line">Last change: {sessions.changedAtMs === undefined ? 'Unknown' : `${age(Math.max(0, now - sessions.changedAtMs))} ago`}</span>
    {sessions.refused !== undefined && <span className="tip-line">Last sync refused: {sessions.refused}</span>}
    Connection health does not prove task success.
  </InfoTip>;
}

/** What the home says while the page cannot show live state. */
function liveNotice(state: DashboardState): string | undefined {
  switch (state.feed) {
    case 'ended':
      return 'Your session ended. Sign in again to follow live changes; these are the last records the page had.';
    case 'reconnecting':
      return 'Reconnecting. These are the last records the page had.';
    case 'connecting':
      return undefined;
    case 'connected':
      return state.sessions.synced || state.sessions.refused === undefined ? undefined : `The core's sessions could not be synced (${state.sessions.refused}). Trying again.`;
  }
}

function ConnectionsPage({state, now}: {state: DashboardState; now: number}): React.JSX.Element {
  const {sessions} = state;
  const sources = [...new Set(sessions.records.map(record => `${record.identity.provider} / ${record.identity.hostId} / ${record.identity.sourceId}`))];
  return <section aria-label="Connections"><header className="page"><h1>Connections</h1></header><div className="cards two">
    <div className="card"><h2>Connection</h2><Facts items={[
      ['Feed', FEED_TEXT[state.feed]], ['Core sessions', sessions.synced ? 'Synced' : 'Not synced'], ['Core revision', sessions.revision ?? 'Unknown'],
      ['Syncs', sessions.syncs], ['Last change', sessions.changedAtMs === undefined ? 'Unknown' : `${age(Math.max(0, now - sessions.changedAtMs))} ago`],
      ['Last sync refusal', sessions.refused ?? 'None observed'],
    ]}/></div>
    <BuildIdentity/>
    <OperatorTools sessions={sessions} live={state.feed === 'connected'} control={state.runtime.control}
      operations={state.runtime.copies.filter(copy => copy.owner === 'bunny/core' && copy.family === 'operation').flatMap(copy => copy.records as readonly OperationRecord[])}
      operationsSynced={state.runtime.copies.some(copy => copy.owner === 'bunny/core' && copy.family === 'operation' && copy.synced)}/>
    <div className="card"><h2>Observed sources</h2>{sources.map(source => <p key={source}>{source}</p>)}
      {sources.length === 0 && <p>No source evidence yet.</p>}
      <p className="hint">A connected feed does not prove a fresh session, successful task, read chat or physical device result.</p></div>
  </div></section>;
}

function Dashboard({connection, links, disconnect, signInAgain}: {
  connection: DashboardConnection; links: Readonly<Record<string, string>> | undefined; disconnect: () => void; signInAgain: () => void;
}): React.JSX.Element {
  const state = useSyncExternalStore(connection.subscribe, connection.getState);
  const route = useRoute();
  const [now, setNow] = useState(Date.now());
  // The clock only ages what the page shows; it reads nothing.
  useEffect(() => {
    const clock = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(clock); };
  }, []);
  const rows = useMemo(() => sessionRows(state.sessions.records), [state.sessions.records]);
  const live = state.feed === 'connected' && state.sessions.synced;
  const working = rows.filter(row => row.chip === 'working').length;
  const notice = liveNotice(state);
  const layout = homeLayout();
  const runtime = state.runtime;
  const devices = runtime.copies.filter(copy => copy.family === 'device').flatMap(copy => (copy.records as readonly DeviceRecord[]).map(record => ({record, copy})));
  const playback = runtime.copies.filter(copy => copy.family === 'playback').flatMap(copy => (copy.records as readonly PlaybackState[]).map(record => ({record, copy})));
  const operationsCopy = runtime.copies.find(copy => copy.family === 'operation');
  const operations = (operationsCopy?.records ?? []) as readonly OperationRecord[];
  const operationsLive = state.feed === 'connected' && operationsCopy?.synced === true;
  const modeCopy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'mode');
  const mode = (modeCopy?.records as readonly ModeState[] | undefined)?.find(record => record.id === 'hub');
  const selectedDevice = route.kind === 'component' && devices.some(({record}) => record.id === route.id);
  const selectedPlayback = route.kind === 'playback' && playback.some(({record}) => record.id === route.sourceId);
  const selectedPage = route.kind === 'module' ? runtime.modules?.find(module => module.name === route.module)?.pages.find(page => page.id === route.page) : undefined;
  const known = route.kind === 'home' || route.kind === 'connections' || selectedDevice || selectedPlayback || selectedPage !== undefined;
  const place = (placement: Placement): React.ReactNode => {
    if (placement.widget === 'hub-mode') return <Widget key="hub-mode" id="hub-mode" size={placement.size}><HubMode record={mode}
      live={state.feed === 'connected' && modeCopy?.synced === true} control={runtime.control} operations={operations} operationsSynced={operationsLive}
      devices={devices.map(({record}) => record)}/></Widget>;
    if (widgetDefinition(placement.widget)?.slot !== undefined) return <SlotWidget key={placement.widget} placement={placement}/>;
    if (placement.widget === 'sessions') return <SessionsWidget key="sessions" state={state} rows={rows} live={live} now={now} size={placement.size}/>;
    if (placement.widget === 'attention') return <AttentionWidget key="attention" rows={rows} size={placement.size}/>;
    return null;
  };
  return <div className="shell">
    <a className="skip" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <aside>
      <div className="brand"><span className="rabbit">◈</span><div>B.U.N.N.Y.<small>LOCAL INTEGRATION</small></div></div>
      <nav aria-label="Main navigation">
        <NavLink route={{kind: 'home'}} current={route}>Home <span>{rows.length}</span></NavLink>
        <NavLink route={{kind: 'connections'}} current={route}>Connections</NavLink>
        {devices.map(({record, copy}) => <NavLink key={`${copy.owner}:${record.id}`} route={{kind: 'component', id: record.id}} current={route}>{record.label ?? record.id}</NavLink>)}
        {playback.map(({record}) => <NavLink key={record.id} route={{kind: 'playback', sourceId: record.id}} current={route}>Music</NavLink>)}
        {runtime.modules?.flatMap(module => module.pages.map(page => <NavLink key={`${module.name}:${page.id}`} route={{kind: 'module', module: module.name, page: page.id}} current={route}>{page.title}</NavLink>))}
      </nav>
      <PlacesNav links={links}/>
      <div className="sidebar-foot">
        <Badge warning={!live}>{FEED_TEXT[state.feed]}</Badge>
        <p>Inspection sends no device commands.</p>
        {state.feed === 'ended' && <button type="button" onClick={signInAgain}>Sign in again</button>}
        <button type="button" className="secondary" onClick={disconnect}>Disconnect</button>
      </div>
    </aside>
    <main id="main" tabIndex={-1} data-feed={state.feed} data-revision={state.sessions.revision} data-syncs={state.sessions.syncs}>
      <header className="top"><span>YOUR WORKSPACE / INTEGRATION</span><span>{state.feed === 'ended' ? 'Signed out' : runtime.control ? 'Control enabled' : 'Read-only'} · Local</span></header>
      <section hidden={route.kind !== 'home'} aria-label="Home">
        <header className="page"><h1>Home</h1><div className="home-status">
          <span>{working} working · {rows.length} sessions</span><FeedIndicator state={state} now={now}/>
        </div></header>
        {notice !== undefined && <p role="alert" className="warning">{notice}</p>}
        <div className="home-columns">
          <div className="home-wide">{layout.wide.map(place)}</div>
          <div className="home-narrow">{layout.narrow.map(place)}</div>
        </div>
      </section>
      {(route.kind === 'home' || route.kind === 'component') && <section aria-label="Devices">
        {route.kind === 'home' && <h2>Devices</h2>}
        {selectedDevice && route.kind === 'component' && <header className="page"><h1>{devices.find(({record}) => record.id === route.id)?.record.label ?? route.id}</h1></header>}
        {runtime.catalogFailed && <p role="alert">The module catalog is unavailable. Retrying the read; controls stay unavailable.</p>}
        {runtime.modules?.filter(module => module.state === 'failed' || module.state === 'refused').map(module => <p className="warning" key={module.name}>{module.name}: {module.state}. Its devices are unavailable.</p>)}
        {runtime.copies.filter(copy => copy.family === 'device' && !copy.synced).map(copy => <p className="warning" key={copy.owner}>{copy.owner}: device records unavailable or stale{copy.refused === undefined ? '' : ` (${copy.refused})`}.</p>)}
        {runtime.modules !== undefined && devices.length === 0 && <p className="hint">No device records are available.</p>}
        <div className="cards">{devices.map(({record, copy}) => <div key={`${copy.owner}:${record.id}`} hidden={route.kind === 'component' && record.id !== route.id}>
          <DeviceCard record={record} owner={copy.owner} live={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1}
            control={runtime.control} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} compact={route.kind === 'home'}/>
        </div>)}</div>
      </section>}
      {(route.kind === 'home' || route.kind === 'playback') && <section aria-label="Music"><div className="cards">{playback.map(({record, copy}) =>
        <PlaybackCard key={record.id} record={record} live={state.feed === 'connected' && copy.synced} control={runtime.control} operations={operations} operationsLive={operationsLive}/>)}</div></section>}
      {selectedPage !== undefined && <section aria-label={selectedPage.title}><header className="page"><h1>{selectedPage.title}</h1></header>
        <iframe className="module-page" title={selectedPage.title} src={selectedPage.path} sandbox="allow-same-origin"/>
      </section>}
      {route.kind === 'connections' && <ConnectionsPage state={state} now={now}/>}
      {!known && <section aria-label="Not found"><div className="empty">
        <h2>{route.kind === 'component' ? `No component named ${route.id}` : 'Nothing at this address'}</h2>
        <p>This address is not declared by the current runtime. <NavLink route={{kind: 'home'}}>Go to the home</NavLink>.</p>
      </div></section>}
      <footer>B.U.N.N.Y. / Source observations and deliberate controls</footer>
    </main>
  </div>;
}

/** Where sign-in stands: checking, signed in with a connection, or signed out with the reason the page shows. */
type Phase =
  | {kind: 'starting'}
  | {kind: 'signed-in'; connection: DashboardConnection}
  | {kind: 'signed-out'; reason: 'disconnected' | 'launcher' | 'failed' | 'launch-failed'};

function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({kind: 'starting'});
  const [links, setLinks] = useState<Readonly<Record<string, string>> | undefined>(undefined);
  const attempt = useRef(0);
  const connection = phase.kind === 'signed-in' ? phase.connection : undefined;

  /** Opens the dashboard on a live session: its connection, and the runtime's links read once. */
  const open = (mine: number): void => {
    if (mine !== attempt.current) return;
    const next = new DashboardConnection({url: location.origin});
    setPhase({kind: 'signed-in', connection: next});
    void next.start();
    void previewPlaces().then(found => { if (mine === attempt.current) setLinks(found ?? {}); });
  };
  /**
   * Signs in after a person's click or on load, never again by itself. A live session that the browser already holds,
   * as another tab opened, is used as it is, so no session outlives the cookie that names it.
   */
  const signIn = async (): Promise<void> => {
    const mine = ++attempt.current;
    setPhase({kind: 'starting'});
    if (await currentSession() === 'live') {
      open(mine);
      return;
    }
    if (mine !== attempt.current) return;
    const result = await trustedSignIn();
    if (mine !== attempt.current) return;
    if (result === 'signed-in') open(mine);
    else setPhase({kind: 'signed-out', reason: result === 'off' ? 'launcher' : 'failed'});
  };

  /**
   * Signs the page in as it loads: with the launcher's code from the address, else with the browser's live session, which
   * a reload or a second tab shares, and only without one by asking for a new one.
   */
  const boot = (): void => {
    const mine = ++attempt.current;
    // A page address (`#/...`) is a route, not a launch code: a bookmarked page signs in and keeps its address.
    if (location.hash.startsWith('#launch=')) {
      const code = launchCode(location.hash);
      history.replaceState(null, '', location.pathname + location.search);
      if (code === undefined) {
        setPhase({kind: 'signed-out', reason: 'launch-failed'});
        return;
      }
      void launchSignIn(code).then(result => {
        if (result === 'signed-in') open(mine);
        else if (mine === attempt.current) setPhase({kind: 'signed-out', reason: 'launch-failed'});
      });
      return;
    }
    void currentSession().then(session => {
      if (mine !== attempt.current) return;
      if (session === 'live') open(mine);
      else if (session === 'none') void signIn();
      else setPhase({kind: 'signed-out', reason: 'failed'});
    });
  };
  // The page's own functions, as its effects reach them: they change with each render, the effects do not.
  const actions = useRef({boot});
  actions.current = {boot};
  useEffect(() => {
    actions.current.boot();
    // A page restored from the back-forward cache checks its session again, as a fresh load would.
    const restored = (event: PageTransitionEvent): void => { if (event.persisted) actions.current.boot(); };
    addEventListener('pageshow', restored);
    return () => { removeEventListener('pageshow', restored); };
  }, []);

  // The connection ends with the page.
  useEffect(() => () => { void connection?.close(); }, [connection]);

  const disconnect = (): void => {
    attempt.current += 1;
    void connection?.close();
    void signOut();
    setPhase({kind: 'signed-out', reason: 'disconnected'});
  };

  if (phase.kind === 'signed-in') {
    return <Dashboard connection={phase.connection} links={links} disconnect={disconnect} signInAgain={() => { void signIn(); }}/>;
  }
  const starting = phase.kind === 'starting';
  const reason = phase.kind === 'signed-out' ? phase.reason : undefined;
  return <main className="login">
    <p className="eyebrow">B.U.N.N.Y. / LOCAL INTEGRATION</p>
    <h1>{starting ? 'Connecting to the local runtime…' : reason === 'disconnected' ? 'You’re signed out.' : 'Open B.U.N.N.Y. with the launcher.'}</h1>
    {reason === 'disconnected' && <button type="button" onClick={() => { void signIn(); }}>Sign in</button>}
    {reason === 'failed' && <p role="alert">B.U.N.N.Y. couldn’t sign you in. Reload to try again, or use the launcher.</p>}
    {reason === 'launch-failed' && <p role="alert">That launch expired or failed. Run the launcher again.</p>}
    {!starting && reason !== 'disconnected' && <p className="hint">The launcher opens this page and signs it in.</p>}
  </main>;
}

const root = document.getElementById('root');
if (root !== null) createRoot(root).render(<App/>);
