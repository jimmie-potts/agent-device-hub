import {HabitatPage} from './habitat.tsx';
import {HomeLayout} from './home-layout.tsx';
import type {HomeCardDefinition} from './home-catalog.ts';
import type {HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {LightingWorkspace} from './lighting-workspace.tsx';
import {DeviceDirectory} from './device-directory.tsx';
import {NavLink, ShellNavigation, useRoute} from './navigation.tsx';
import {InboxPanel, type InboxFocus} from './inbox.tsx';
import {Timeline, TimelinePanel} from './timeline.tsx';
import {AutomationPage} from './automation.tsx';
// The B.U.N.N.Y. dashboard on the runtime (Hub #922), converted from `apps/dashboard/src/main.tsx` at main 5abbae9: the
// shell, its hash routes, the Places navigation, browser sign-in on the runtime's gateway and the agent sessions, which
// the page syncs from the core and follows live (ADR 0012). Device cards, music and module pages join in the story's
// later slices; the Hub mode (#924) and the inbox (#923) have their panels on the home now.
import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {InboxItem, PowerLimitRecord, ModeState, OperationRecord, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';
import {HubMode} from './hub-mode.tsx';
import {DeviceModesProvider} from './device-mode.tsx';
import {DeviceCard} from './device-controls.tsx';
import {WemoDeviceCard} from './wemo-device-card.tsx';
import {PlaybackWorkspace} from './playback-workspace.tsx';
import {BuildIdentity} from './build-identity.tsx';
import {FRONTENDS} from '@bunny/module-frontends';
import {ModuleFrontend, ModulePageView} from './module-page.tsx';
import {PixooDisplay} from '@jimmie-potts/pixoo/frontend';
import {TidbytDisplay} from '@jimmie-potts/tidbyt/frontend';
import {WisprWidget} from '@jimmie-potts/wispr/frontend';
import {DuckWidget} from '@jimmie-potts/companions/frontend';
import placesManifest from '../../../../docs/skins/places.json';
import {DashboardConnection, type DashboardState} from './connection.ts';
import {navigationDestination} from './routes.ts';
import {age, sessionRows} from './sessions.ts';
import {AgentSessions} from './agent-sessions.tsx';
import {OperatorTools} from './operator-tools.tsx';
import {currentSession, launchCode, launchSignIn, previewPlaces, signOut, trustedSignIn} from './signin.ts';
import {Facts, InfoTip} from './ui.tsx';
import {widgetDefinition, type Placement, type WidgetSize} from './widgets.ts';
import './style.css';
import './shell.css';

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
function Widget({id, size, children, showHeading = true}: {id: string; size: WidgetSize; children: React.ReactNode; showHeading?: boolean}): React.JSX.Element {
  const definition = widgetDefinition(id);
  return <article className="widget" role="region" data-widget={id} data-size={size} aria-labelledby={`widget-${id}`}>
    {showHeading && <header className="widget-head"><h2 id={`widget-${id}`}>{definition?.name ?? id}</h2></header>}
    {children}
  </article>;
}

/** A panel the layout places now and another story fills; it reads nothing and sends nothing. */
function SlotWidget({placement}: {placement: Placement}): React.JSX.Element {
  const text = 'Failed and uncertain device commands will be listed here. This page does not show them yet.';
  return <Widget id={placement.widget} size={placement.size}><p className="hint slot" data-slot={placement.widget}>{text}</p></Widget>;
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
  const [inboxFocus, setInboxFocus] = useState<InboxFocus>();
  // The clock only ages what the page shows; it reads nothing.
  useEffect(() => {
    const clock = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(clock); };
  }, []);
  const rows = useMemo(() => sessionRows(state.sessions.records), [state.sessions.records]);
  const live = state.feed === 'connected' && state.sessions.synced;
  const notice = liveNotice(state);
  const runtime = state.runtime;
  const devices = runtime.copies.filter(copy => copy.family === 'device').flatMap(copy => (copy.records as readonly DeviceRecord[]).map(record => ({record, copy})));
  const playback = runtime.copies.filter(copy => copy.family === 'playback').flatMap(copy => (copy.records as readonly PlaybackState[]).map(record => ({record, copy})));
  const operationsCopy = runtime.copies.find(copy => copy.family === 'operation');
  const operations = (operationsCopy?.records ?? []) as readonly OperationRecord[];
  const operationsLive = state.feed === 'connected' && operationsCopy?.synced === true;
  const modeCopy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'mode');
  const mode = (modeCopy?.records as readonly ModeState[] | undefined)?.find(record => record.id === 'hub');
  const modeDevices = devices.map(({record, copy}) => ({record, owner: copy.owner, live: state.feed === 'connected' && copy.synced}));
  const inboxCopy = runtime.copies.find(copy => copy.owner === 'bunny/core' && copy.family === 'inbox-item');
  const inboxItems = (inboxCopy?.records ?? []) as readonly InboxItem[];
  const inboxLive = state.feed === 'connected' && inboxCopy?.synced === true;
  const limitsCopy=runtime.copies.find(copy=>copy.owner==='bunny/core'&&copy.family==='power-limit');
  const limits=(limitsCopy?.records??[]) as readonly PowerLimitRecord[];
  const selectedDevice = route.kind === 'component' && devices.some(({record}) => record.id === route.id);
  const selectedPlayback = route.kind === 'playback' && playback.some(({record}) => record.id === route.sourceId);
  const selectedModule = route.kind === 'module' ? runtime.modules?.find(module => module.name === route.module) : undefined;
  const selectedPage = route.kind === 'module' ? selectedModule?.pages.find(page => page.id === route.page) : undefined;
  const known = route.kind === 'habitat' || route.kind === 'devices' || route.kind === 'settings' || route.kind === 'audio' || route.kind === 'rooms' || (route.kind === 'lighting-brand' && runtime.modules?.some(module => module.name === route.brand && module.serves.includes('device')) === true) || route.kind === 'timeline' || route.kind === 'automation' || route.kind === 'home' || route.kind === 'connections' || selectedDevice || selectedPlayback || selectedPage !== undefined;
  const contextModule = route.kind === 'module' ? selectedModule : route.kind === 'lighting-brand' ? runtime.modules?.find(module => module.name === route.brand)
    : route.kind === 'component' ? runtime.modules?.find(module => devices.some(device => device.record.id === route.id && device.copy.owner === `bunny/modules/${module.name}`)) : undefined;
  const deviceCard = ({record, copy}: (typeof devices)[number]): React.ReactNode => (record.kind === 'pixoo' && copy.owner === 'bunny/modules/pixoo' && runtime.modules?.some(module => module.name === 'pixoo' && module.serves.includes('pixoo-display')) === true && (route.kind === 'home' || route.kind === 'component' && record.id === route.id) ? <>
            <ModuleFrontend module="pixoo" connection={connection} connected={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1 && !runtime.catalogFailed}
              control={runtime.control} operations={operations} operationsLive={operationsLive} Component={PixooDisplay}/>
            {route.kind === 'component' && <details><summary>Advanced device controls</summary><DeviceCard record={record} owner={copy.owner}
              live={state.feed === 'connected' && copy.synced} control={runtime.control} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} now={now}/></details>}
          </> : record.kind === 'tidbyt' && copy.owner === 'bunny/modules/tidbyt' && runtime.modules?.some(module => module.name === 'tidbyt' && module.state === 'running' && module.pages.some(page => page.id === 'display')) === true && (route.kind === 'home' || route.kind === 'component' && record.id === route.id) ? <><ModuleFrontend
            module="tidbyt" connection={connection} connected={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1 && !runtime.catalogFailed}
            control={false} operations={operations} operationsLive={operationsLive} Component={TidbytDisplay}/>
            {route.kind === 'component' && <details><summary>Device evidence</summary><DeviceCard record={record} owner={copy.owner}
              live={state.feed === 'connected' && copy.synced} control={false} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} now={now}/></details>}
          </> : record.kind==='wemo'&&copy.owner==='bunny/modules/wemo'?<WemoDeviceCard record={record} owner={copy.owner}
            live={state.feed==='connected'&&copy.synced&&devices.filter(item=>item.record.id===record.id).length===1} control={runtime.control} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} now={now}
            limit={{target:record.id,record:limits.find(value=>value.id===record.id),live:state.feed==='connected'&&limitsCopy?.synced===true&&copy.synced&&devices.filter(item=>item.record.id===record.id).length===1,control:runtime.control,operations,operationsLive,refresh:connection.refreshDevices}}/>
          : <DeviceCard record={record} owner={copy.owner} live={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1}
            control={runtime.control} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} now={now} {...(record.kind==='wemo'&&copy.owner==='bunny/modules/wemo'?{limit:{target:record.id,record:limits.find(value=>value.id===record.id),live:state.feed==='connected'&&limitsCopy?.synced===true&&copy.synced&&devices.filter(item=>item.record.id===record.id).length===1,control:runtime.control,operations,operationsLive,refresh:connection.refreshDevices}}:{})} compact={route.kind === 'home'}/>);
  const place = (definition: HomeCardDefinition, placement: HomePlacement, selections: import('@jimmie-potts/event-contracts/v2/families').LightingSelection[]): React.ReactNode => {
    if (definition.source.kind === 'device') {
      const source = definition.source, device = devices.find(item => item.copy.owner === source.owner && item.record.id === source.instance);
      return device === undefined ? <article className="card"><h2>{definition.name}</h2><p>Device unavailable.</p></article> : deviceCard(device);
    }
    if (definition.source.kind === 'light') return <LightingWorkspace runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive} connection={connection} route={{kind: 'home'}} homeSelection={definition.source.selection} homeSelections={selections}/>;
    if (definition.source.kind === 'music') return <PlaybackWorkspace runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive} connection={connection} route={{kind: 'home'}} homeSource={definition.source}/>;

    if (placement.widget === 'wispr') {
      const exposed = runtime.modules?.some(module => module.name === 'wispr' && module.state === 'running' && module.pages.some(page => page.id === 'analytics'));
      if (route.kind !== 'home' || state.feed !== 'connected' || exposed !== true) return null;
      return <ModuleFrontend key="wispr" module="wispr" connection={connection} connected={true} control={false}
        operations={operations} operationsLive={operationsLive} Component={WisprWidget}/>;
    }
    if (placement.widget === 'duck-latest') return <ModuleFrontend key="duck-latest" module="companions" connection={connection}
      connected={state.feed === 'connected'} control={false} operations={operations} operationsLive={operationsLive} Component={DuckWidget}/>;
    if (placement.widget === 'hub-mode') return <Widget key="hub-mode" id="hub-mode" size={placement.size} showHeading={false}><HubMode record={mode} devices={modeDevices}
      live={state.feed === 'connected' && modeCopy?.synced === true} control={runtime.control} operations={operations} operationsSynced={operationsLive}
      items={inboxItems} inboxSynced={inboxLive} headingId="widget-hub-mode" onCheckInbox={id => {setInboxFocus(previous => ({id, serial: (previous?.serial ?? 0) + 1}));}}/></Widget>;
    if (placement.widget === 'timeline') return <Widget key="timeline" id="timeline" size={placement.size} showHeading={false}><TimelinePanel headingId="widget-timeline" connected={state.feed === 'connected'}/></Widget>;
    if (placement.widget === 'inbox') {
      return <Widget key="inbox" id="inbox" size={placement.size} showHeading={false}><InboxPanel items={inboxItems} live={inboxLive} control={runtime.control}
        devices={devices.map(({record}) => record)} focus={inboxFocus} headingId="widget-inbox"/></Widget>;
    }
    if (widgetDefinition(placement.widget)?.slot !== undefined) return <SlotWidget key={placement.widget} placement={placement}/>;
    if (placement.widget === 'sessions') return <Widget key="sessions" id="sessions" size={placement.size}><AgentSessions records={state.sessions.records}
      synced={state.sessions.synced} live={live} control={state.runtime.control} now={now}/></Widget>;
    return null;
  };
  return <DeviceModesProvider value={{record: mode, live: state.feed === 'connected' && modeCopy?.synced === true, control: runtime.control, operations, operationsLive, devices: modeDevices}}><div className="shell">
    <a className="skip" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <aside>
      <div className="brand"><span className="rabbit">◈</span><div>B.U.N.N.Y.<small>LOCAL INTEGRATION</small></div></div>
      <ShellNavigation route={route}/>
      <div className="sidebar-foot">
        <FeedIndicator state={state} now={now}/>
        {state.feed === 'ended' && <button type="button" onClick={signInAgain}>Sign in again</button>}
      </div>
    </aside>
    <main id="main" tabIndex={-1} data-feed={state.feed} data-revision={state.sessions.revision} data-syncs={state.sessions.syncs}>
      <header className="top"><span>{state.feed === 'ended' ? 'Signed out' : runtime.control ? 'Control enabled' : 'Read-only'} · Local</span><nav aria-label="Utilities"><NavLink route={{kind: 'settings'}} selected={navigationDestination(route) === 'settings'}>Settings</NavLink></nav></header>
      {navigationDestination(route) === 'devices' && route.kind !== 'devices' && <nav className="shell-breadcrumb" aria-label="Breadcrumb"><NavLink route={{kind: 'devices'}}>All devices</NavLink></nav>}
      {contextModule !== undefined && contextModule.pages.length > 0 && <nav className="feature-navigation" aria-label={`${contextModule.name} pages`}>{contextModule.pages.map(page => <NavLink key={page.id} route={{kind: 'module', module: contextModule.name, page: page.id}} current={route}>{page.title}</NavLink>)}</nav>}
      {route.kind === 'connections' && <nav className="shell-breadcrumb" aria-label="Breadcrumb"><NavLink route={{kind: 'settings'}}>Back to Settings</NavLink></nav>}
      {route.kind === 'home' && <section aria-label="Home">
        {notice !== undefined && <p role="alert" className="warning">{notice}</p>}
        <HomeLayout runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive}
          attention={rows.some(row => row.attention.length > 0)} inbox={inboxItems.length > 0} renderCard={place}/>
      </section>}
      <DeviceDirectory runtime={runtime} connected={state.feed === 'connected'} active={route.kind === 'devices'}/>
      {route.kind === 'settings' && <section aria-label="Settings"><header className="page"><h1>Settings</h1></header>
        <div className="settings-grid"><article className="card"><h2>Connections</h2><p className="hint">Connection evidence, running build and operator tools.</p><NavLink route={{kind: 'connections'}}>Connections</NavLink></article>
          <article className="card"><h2>Browser session</h2><FeedIndicator state={state} now={now}/><div className="actions"><button type="button" className="secondary" onClick={disconnect}>Disconnect</button></div></article>
          <article className="card"><PlacesNav links={links}/></article></div>
      </section>}
      {route.kind !== 'home' && <LightingWorkspace runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive} connection={connection} route={route}/>}
      {route.kind === 'component' && <section aria-label="Devices">
        {selectedDevice && route.kind === 'component' && <header className="page"><h1>{devices.find(({record}) => record.id === route.id)?.record.label ?? route.id}</h1></header>}
        {runtime.catalogFailed && <p role="alert">The module catalog is unavailable. Retrying the read; controls stay unavailable.</p>}
        {runtime.modules?.filter(module => module.state === 'failed' || module.state === 'refused').map(module => <p className="warning" key={module.name}>{module.name}: {module.state}. Its devices are unavailable.</p>)}
        {runtime.copies.filter(copy => copy.family === 'device' && !copy.synced).map(copy => <p className="warning" key={copy.owner}>{copy.owner}: device records unavailable or stale{copy.refused === undefined ? '' : ` (${copy.refused})`}.</p>)}
        {runtime.modules !== undefined && devices.length === 0 && <p className="hint">No device records are available.</p>}
        <div className="cards">{devices.map(({record, copy}) => <div key={`${copy.owner}:${record.id}`} hidden={route.kind === 'component' && record.id !== route.id}>
          {deviceCard({record, copy})}
        </div>)}</div>
      </section>}
      {route.kind !== 'home' && <PlaybackWorkspace runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive} connection={connection} route={route}/>}
      {selectedPage !== undefined && selectedModule !== undefined && <section aria-label={selectedPage.title}><header className="page"><h1>{selectedPage.title}</h1></header>
        <ModulePageView key={`${selectedModule.name}:${selectedPage.id}`} module={selectedModule} page={selectedPage} frontends={FRONTENDS} connection={connection}
          connected={state.feed === 'connected'} control={runtime.control} operations={operations} operationsLive={operationsLive}/>
      </section>}
      {route.kind === 'habitat' && <HabitatPage records={state.sessions.records} live={live}/>}
      {route.kind === 'timeline' && <Timeline connected={state.feed === 'connected'}/>}
      {route.kind === 'automation' && <AutomationPage connection={connection} live={state.feed === 'connected'} control={runtime.control}/>}
      {route.kind === 'connections' && <ConnectionsPage state={state} now={now}/>}
      {!known && <section aria-label="Not found"><div className="empty">
        <h2>{route.kind === 'component' ? `No component named ${route.id}` : 'Nothing at this address'}</h2>
        <p>This address is not declared by the current runtime. <NavLink route={{kind: 'home'}}>Go to the home</NavLink>.</p>
      </div></section>}
      <footer>B.U.N.N.Y. / Source observations and deliberate controls</footer>
    </main>
  </div></DeviceModesProvider>;
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
