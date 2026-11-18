import {artScheduleCopy} from './art-schedule-client.ts';
import {HabitatPage} from './habitat.tsx';
import {ArtPresentationProvider, ArtWidget, scheduledArtNotice} from '@jimmie-potts/art/frontend';
import {ArtThemeProvider, ArtThemeSettings} from './art-theme.tsx';
import {HomeLayout} from './home-layout.tsx';
import type {HomeCardDefinition} from './home-catalog.ts';
import type {HomePlacement} from '@jimmie-potts/event-contracts/v2/families';
import {LightingWorkspace} from './lighting-workspace.tsx';
import {DeviceDirectory} from './device-directory.tsx';
import {NavLink, ShellNavigation, navigate, useRoute} from './navigation.tsx';
import {JumpPalette} from './jump-palette.tsx';
import {DeviceMenu, type DeviceMenuClose} from './device-menu.tsx';
import {PinTargetsProvider, PinToggle, PinnedPages, usePinTargets, usePins} from './pins.tsx';
import {jumpEntries, jumpShortcut, rememberRoute, textInput} from './jump.ts';
import {RailIcon, usePhone, useRail, useRailShort} from './rail.tsx';
import {railAttribute} from './rail-preference.ts';
import {InboxPanel, type InboxFocus} from './inbox.tsx';
import {Timeline, TimelinePanel} from './timeline.tsx';
import {MusicVisualizerCard} from './music-visualizer.tsx';
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
import {RoborockDeviceCard} from './roborock-device-card.tsx';
import {RoborockWidget} from '@jimmie-potts/roborock/frontend';
import {VolcanoDeviceCard} from './volcano-device-card.tsx';
import {PlaybackWorkspace} from './playback-workspace.tsx';
import {BuildIdentity} from './build-identity.tsx';
import {FRONTENDS} from '@bunny/module-frontends';
import {ModuleFrontend, ModulePageView} from './module-page.tsx';
import {moduleCard} from './module-cards.ts';
import {PixooDisplay} from '@jimmie-potts/pixoo/frontend';
import {TidbytDisplay} from '@jimmie-potts/tidbyt/frontend';
import {WisprWidget} from '@jimmie-potts/wispr/frontend';
import {ConversationRail, DuckWidget, ReachyWidget, useConversationWaiting} from '@jimmie-potts/companions/frontend';
import placesManifest from '../../../../docs/skins/places.json';
import {DashboardConnection, type DashboardState} from './connection.ts';
import {navigationDestination, routeHash, type Route} from './routes.ts';
import {age, sessionRows} from './sessions.ts';
import {AgentSessions} from './agent-sessions.tsx';
import {OperatorTools} from './operator-tools.tsx';
import {currentSession, launchCode, launchSignIn, previewPlaces, signOut, trustedSignIn} from './signin.ts';
import {Facts, InfoTip} from './ui.tsx';
import {widgetDefinition, type Placement, type WidgetSize} from './widgets.ts';
import './style.css';
import './shell.css';
import './card-chrome.css';

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

/** The palette's shortcut as this computer's keyboard shows it. */
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const jumpKey = mac ? '⌘K' : 'Ctrl K';

const FEED_TEXT: Readonly<Record<DashboardState['feed'], string>> = {connecting: 'Connecting', connected: 'Feed connected', reconnecting: 'Reconnecting', ended: 'Signed out'};

/**
 * The link's health in one indicator; its details say what the page last synced and whether this session may send
 * commands, never that work succeeded.
 */
function FeedIndicator({state, now, control}: {state: DashboardState; now: number; control: boolean}): React.JSX.Element {
  const {feed, sessions} = state;
  const healthy = feed === 'connected' && sessions.synced;
  const label = feed === 'connected' && !sessions.synced ? 'Syncing sessions' : FEED_TEXT[feed];
  return <InfoTip warning={!healthy} label={<><span aria-hidden="true">{healthy ? '●' : '⚠'}</span><span className="rail-text"> {label}</span></>}>
    <span className="tip-line tip-feed">{label}</span>
    <span className="tip-line">{feed === 'ended' ? 'Signed out' : control ? 'Control enabled' : 'Read-only'}</span>
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

/**
 * The Mac-local diagnostics viewer (Hub #813): Grafana over the runtime's logs and traces, reached only where the
 * runtime's own links name it, as a Local place is, so a preview never links to an installed viewer. The link is the
 * Mac's loopback and is never the private remote entry.
 */
function DiagnosticsCard({links}: {links: Readonly<Record<string, string>> | undefined}): React.JSX.Element {
  const href = links === undefined ? undefined : loopbackLink(links.grafana);
  return <div className="card" data-diagnostics={links === undefined ? 'loading' : href === undefined ? 'absent' : 'linked'}><h2>Diagnostics</h2>
    {href !== undefined && <p><a href={href} target="_blank" rel="noopener noreferrer">Open Grafana <small>Local</small></a></p>}
    {links !== undefined && href === undefined && <p>No diagnostics viewer is configured for this runtime.</p>}
    <p className="hint">Logs and traces open in Grafana on this computer's loopback only. The viewer is not reachable through the private remote entry, and a missing record there is a gap, never proof that nothing happened.</p></div>;
}

function ConnectionsPage({state, now, links}: {state: DashboardState; now: number; links: Readonly<Record<string, string>> | undefined}): React.JSX.Element {
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
    <DiagnosticsCard links={links}/>
  </div></section>;
}

function Dashboard({connection, links, disconnect, signInAgain}: {
  connection: DashboardConnection; links: Readonly<Record<string, string>> | undefined; disconnect: () => void; signInAgain: () => void;
}): React.JSX.Element {
  const state = useSyncExternalStore(connection.subscribe, connection.getState);
  const route = useRoute();
  const [now, setNow] = useState(Date.now());
  const [inboxFocus, setInboxFocus] = useState<InboxFocus>();
  const rail = useRail();
  // On a phone the rail is a drawer. A chosen destination, Escape and an outside tap close it and hand focus back to its button.
  // While it is open the page behind it is inert, so focus stays in the drawer or on its button.
  const phone = usePhone();
  const [drawerWanted, setDrawer] = useState(false);
  const drawer = drawerWanted && phone;
  useEffect(() => { if (!phone) setDrawer(false); }, [phone]);
  const menuButton = useRef<HTMLButtonElement>(null);
  const railElement = useRef<HTMLElement>(null);
  const railShort = useRailShort(railElement, phone);
  const address = routeHash(route);
  // The Devices menu (#1889) opens from its row in the rail. On a phone it covers the drawer, so it is shown only while
  // the drawer is. A page change and a change between phone and wider layouts close it. A drawer that closes under it
  // moves focus to the drawer's button, and the menu closes when focus leaves it.
  const [menuWanted, setMenu] = useState(false);
  const menu = menuWanted && (!phone || drawer);
  const devicesRow = useRef<HTMLButtonElement>(null);
  const pins = usePins();
  useEffect(() => { setDrawer(false); setMenu(false); }, [address]);
  useEffect(() => { setMenu(false); }, [phone]);
  // A menu taken away while it holds focus, by a page change or a change of layout, hands focus on instead of
  // dropping it on the page: to its row, or at phone width to the drawer's button, since the drawer closes with it.
  // The hand-off never scrolls. In a short window the rail scrolls with the page, and bringing the row into view
  // would move the page under a press that is still landing, or under the browser's own return to a scroll position.
  const narrow = useRef(phone);
  narrow.current = phone;
  const menuDropped = (): void => { (narrow.current ? menuButton.current : devicesRow.current)?.focus({preventScroll: true}); };
  const closeMenu = (focus: DeviceMenuClose): void => {
    setMenu(false);
    if (focus === 'row') devicesRow.current?.focus();
    // A chosen page takes focus itself, as it does after the palette. Under the phone drawer the page is inert, and
    // the drawer hands focus to its own button.
    else if (focus === 'page') document.getElementById('main')?.focus();
  };
  useEffect(() => {
    if (!drawer) return;
    (railElement.current?.querySelector<HTMLElement>('nav [aria-current]') ?? railElement.current?.querySelector<HTMLElement>('nav a'))?.focus();
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setDrawer(false);
      menuButton.current?.focus();
    };
    window.addEventListener('keydown', dismiss);
    return () => { window.removeEventListener('keydown', dismiss); };
  }, [drawer]);
  // The clock only ages what the page shows; it reads nothing.
  useEffect(() => {
    const clock = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(clock); };
  }, []);
  const rows = useMemo(() => sessionRows(state.sessions.views), [state.sessions.views]);
  // The jump palette (#1888). jumpShortcut holds the keys that open it. jumpFrom is where focus goes when it closes:
  // back to where it was, or to the page that was chosen.
  const [jump, setJump] = useState(false);
  const jumpFrom = useRef<Element | null>(null);
  const recents = useRef<Route[]>([]);
  const shownRoute = useRef(route);
  useEffect(() => {
    if (routeHash(shownRoute.current) !== address) {
      recents.current = rememberRoute(recents.current, shownRoute.current);
      // The browser's back or forward can change the page under an open palette; it closes rather than stay over a page it was not opened on.
      setJump(false);
    }
    shownRoute.current = route;
  }, [address, route]);
  const openJump = (): void => {
    if (jump) return;
    // The phone drawer closes under the palette, so focus goes back to the button that opens the drawer. The Devices
    // menu closes too, so focus goes back to its row.
    jumpFrom.current = drawer ? menuButton.current : menu ? devicesRow.current : document.activeElement;
    setDrawer(false);
    setMenu(false);
    setJump(true);
  };
  const closeJump = (): void => { setJump(false); };
  const jumpTo = (to: Route): void => {
    // A chosen page takes focus itself, as it does after the skip link.
    jumpFrom.current = document.getElementById('main');
    setJump(false);
    navigate(to);
  };
  // The page is inert until the palette is gone, so focus moves once that render is in the page.
  useEffect(() => {
    if (jump) return;
    const to = jumpFrom.current;
    jumpFrom.current = null;
    if (to instanceof HTMLElement && to.isConnected) to.focus();
  }, [jump]);
  // The palette's own functions, as the key listener reaches them: they change with each render, the listener does not.
  const jumpActions = useRef({jump, openJump, closeJump});
  jumpActions.current = {jump, openJump, closeJump};
  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      // A key that a component already handled is not the palette's.
      if (event.defaultPrevented) return;
      const palette = jumpActions.current, target = event.target instanceof Element ? event.target : null;
      const action = jumpShortcut(event, {mac, open: palette.jump,
        field: target instanceof HTMLElement && (target.isContentEditable || target.closest('textarea, select') !== null
          || (target instanceof HTMLInputElement && textInput(target.type))),
        owned: target !== null && target.closest('[role=dialog], dialog, [role=menu], [role=listbox]') !== null,
        // Both are drawn above everything the shell renders, so the palette would open out of sight.
        modal: document.querySelector('dialog:modal') !== null || document.fullscreenElement !== null});
      if (action === undefined) return;
      event.preventDefault();
      // A held key opens or closes once.
      if (event.repeat) return;
      if (action === 'toggle' && palette.jump) palette.closeJump(); else palette.openJump();
    };
    window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('keydown', shortcut); };
  }, []);
  const live = state.feed === 'connected' && state.sessions.synced;
  const notice = liveNotice(state);
  const runtime = state.runtime;
  const pinnable = usePinTargets(runtime);
  // The palette's list changes only with the catalog, the copies or the page, not with each tick of the shell's clock.
  const jumpPlaces = useMemo(() => jump ? jumpEntries(runtime, recents.current, route) : [], [jump, runtime, route]);
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
  const workspace = selectedModule?.name === 'companions' && selectedPage?.id === 'assistant' && selectedPage.presentation === 'react';
  // The rail's conversation group (#1890) is the companions frontend's own component in its own module scope. It is
  // shown while the catalog declares the Conversation page of a running companions module. The shell imports the
  // group and the hook below and nothing else of that module's conversation.
  const conversations = runtime.modules?.some(module => module.name === 'companions' && module.state === 'running'
    && module.pages.some(page => page.id === 'assistant' && page.presentation === 'react')) === true;
  const conversationWaiting = useConversationWaiting() && conversations;
  const known = route.kind === 'habitat' || route.kind === 'devices' || route.kind === 'settings' || route.kind === 'audio' || route.kind === 'visualizer' || route.kind === 'rooms' || (route.kind === 'lighting-brand' && runtime.modules?.some(module => module.name === route.brand && module.serves.includes('device')) === true) || route.kind === 'timeline' || route.kind === 'automation' || route.kind === 'home' || route.kind === 'connections' || selectedDevice || selectedPlayback || selectedPage !== undefined;
  const contextModule = route.kind === 'module' ? selectedModule : route.kind === 'lighting-brand' ? runtime.modules?.find(module => module.name === route.brand)
    : route.kind === 'component' ? runtime.modules?.find(module => devices.some(device => device.record.id === route.id && device.copy.owner === `bunny/modules/${module.name}`)) : undefined;
  const featureNavigation = contextModule !== undefined && contextModule.pages.length > 0
    ? <nav className="feature-navigation" aria-label={`${contextModule.name} pages`}>{contextModule.pages.map(page =>
      <NavLink key={page.id} route={{kind: 'module', module: contextModule.name, page: page.id}} current={route}>{page.title}</NavLink>)}
    </nav>
    : null;
  const deviceCard = ({record, copy}: (typeof devices)[number]): React.ReactNode => (moduleCard(runtime.modules, copy.owner, record.kind) === 'pixoo' && (route.kind === 'home' || route.kind === 'component' && record.id === route.id) ? <>
            <ModuleFrontend module="pixoo" connection={connection} connected={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1 && !runtime.catalogFailed}
              control={runtime.control} operations={operations} operationsLive={operationsLive} Component={PixooDisplay}/>
            {route.kind === 'component' && <details><summary>Advanced device controls</summary><DeviceCard record={record} owner={copy.owner}
              live={state.feed === 'connected' && copy.synced} control={runtime.control} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} now={now}/></details>}
          </> : moduleCard(runtime.modules, copy.owner, record.kind) === 'tidbyt' && (route.kind === 'home' || route.kind === 'component' && record.id === route.id) ? <><ModuleFrontend
            module="tidbyt" connection={connection} connected={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1 && !runtime.catalogFailed}
            control={false} operations={operations} operationsLive={operationsLive} Component={TidbytDisplay}/>
            {route.kind === 'component' && <details><summary>Device evidence</summary><DeviceCard record={record} owner={copy.owner}
              live={state.feed === 'connected' && copy.synced} control={false} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} now={now}/></details>}
          </> : record.kind === 'roborock' && copy.owner === 'bunny/modules/roborock' && (route.kind === 'home' || route.kind === 'component' && record.id === route.id) ? <RoborockDeviceCard target={record.id} label={record.label} connection={connection}
              live={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1 && !runtime.catalogFailed && runtime.modules?.some(module => module.name === 'roborock' && module.state === 'running' && module.serves.includes('roborock-vacuum')) === true}/>
            : record.kind === 'volcano' && copy.owner === 'bunny/modules/volcano' && (route.kind === 'home' || route.kind === 'component' && record.id === route.id) ? <VolcanoDeviceCard target={record.id} label={record.label} connection={connection} control={runtime.control} operations={operations} operationsLive={operationsLive}
              live={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1 && !runtime.catalogFailed && runtime.modules?.some(module => module.name === 'volcano' && module.state === 'running' && module.serves.includes('volcano-status')) === true}/>
            : record.kind==='wemo'&&copy.owner==='bunny/modules/wemo'?<WemoDeviceCard record={record} owner={copy.owner}
            live={state.feed==='connected'&&copy.synced&&devices.filter(item=>item.record.id===record.id).length===1} control={runtime.control} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} now={now}
            limit={{target:record.id,record:limits.find(value=>value.id===record.id),live:state.feed==='connected'&&limitsCopy?.synced===true&&copy.synced&&devices.filter(item=>item.record.id===record.id).length===1,control:runtime.control,operations,operationsLive,refresh:connection.refreshDevices}}/>
          : <DeviceCard record={record} owner={copy.owner} live={state.feed === 'connected' && copy.synced && devices.filter(item => item.record.id === record.id).length === 1}
            control={runtime.control} operations={operations} operationsLive={operationsLive} refresh={connection.refreshDevices} now={now} {...(record.kind==='wemo'&&copy.owner==='bunny/modules/wemo'?{limit:{target:record.id,record:limits.find(value=>value.id===record.id),live:state.feed==='connected'&&limitsCopy?.synced===true&&copy.synced&&devices.filter(item=>item.record.id===record.id).length===1,control:runtime.control,operations,operationsLive,refresh:connection.refreshDevices}}:{})} compact={route.kind === 'home'}/>);
  const place = (definition: HomeCardDefinition, placement: HomePlacement, selections: import('@jimmie-potts/event-contracts/v2/families').LightingSelection[]): React.ReactNode => {
    if (definition.source.kind === 'device') {
      const source = definition.source, device = devices.find(item => item.copy.owner === source.owner && item.record.id === source.instance);
      if (device === undefined && source.owner === 'bunny/modules/roborock') return <RoborockDeviceCard target={source.instance} connection={connection} live={false}/>;
      if (device === undefined && source.owner === 'bunny/modules/volcano') return <VolcanoDeviceCard target={source.instance} connection={connection} live={false} control={false} operations={[]} operationsLive={false}/>;
      return device === undefined ? <article className="card"><h2>{definition.name}</h2><p>Device unavailable.</p></article> : deviceCard(device);
    }
    if (definition.source.kind === 'light') return <LightingWorkspace runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive} connection={connection} route={{kind: 'home'}} homeSelection={definition.source.selection} homeSelections={selections}/>;
    if (definition.source.kind === 'music') return <PlaybackWorkspace runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive} connection={connection} route={{kind: 'home'}} homeSource={definition.source}/>;

    if (placement.widget === 'art') return <ModuleFrontend module="art" connection={connection}
      connected={state.feed === 'connected' && !runtime.catalogFailed && runtime.modules?.some(module => module.name === 'art' && module.state === 'running') === true}
      control={runtime.control} operations={operations} operationsLive={operationsLive} Component={ArtWidget}/>;
    if (placement.widget === 'module:roborock') return <ModuleFrontend module="roborock" connection={connection}
      connected={state.feed === 'connected' && !runtime.catalogFailed}
      control={false} operations={[]} operationsLive={false} Component={RoborockWidget}/>;
    if (placement.widget === 'wispr') {
      const exposed = runtime.modules?.some(module => module.name === 'wispr' && module.state === 'running' && module.pages.some(page => page.id === 'analytics'));
      if (route.kind !== 'home' || state.feed !== 'connected' || exposed !== true) return null;
      return <ModuleFrontend key="wispr" module="wispr" connection={connection} connected={true} control={false}
        operations={operations} operationsLive={operationsLive} Component={WisprWidget}/>;
    }
    if (placement.widget === 'duck-latest' || placement.widget === 'reachy') return <ModuleFrontend key={placement.widget} module="companions" connection={connection}
      connected={state.feed === 'connected' && !runtime.catalogFailed && runtime.modules?.some(module => module.name === 'companions' && module.state === 'running') === true}
      control={runtime.control} operations={operations} operationsLive={operationsLive} Component={placement.widget === 'reachy' ? ReachyWidget : DuckWidget}/>;
    if (placement.widget === 'hub-mode') return <Widget key="hub-mode" id="hub-mode" size={placement.size} showHeading={false}><HubMode record={mode} devices={modeDevices}
      live={state.feed === 'connected' && modeCopy?.synced === true} control={runtime.control} operations={operations} operationsSynced={operationsLive}
      items={inboxItems} inboxSynced={inboxLive} headingId="widget-hub-mode" onCheckInbox={id => {setInboxFocus(previous => ({id, serial: (previous?.serial ?? 0) + 1}));}}/></Widget>;
    if (placement.widget === 'music-visualizer') return <Widget key="music-visualizer" id="music-visualizer" size={placement.size}><MusicVisualizerCard connection={connection}
      connected={state.feed === 'connected'} coreLive={!runtime.catalogFailed && runtime.modules?.some(module => module.name === 'core' && module.state === 'running') === true}/></Widget>;
    if (placement.widget === 'timeline') return <Widget key="timeline" id="timeline" size={placement.size} showHeading={false}><TimelinePanel headingId="widget-timeline" connected={state.feed === 'connected'}/></Widget>;
    if (placement.widget === 'inbox') {
      return <Widget key="inbox" id="inbox" size={placement.size} showHeading={false}><InboxPanel items={inboxItems} live={inboxLive} control={runtime.control}
        devices={devices.map(({record}) => record)} focus={inboxFocus} headingId="widget-inbox"/></Widget>;
    }
    if (widgetDefinition(placement.widget)?.slot !== undefined) return <SlotWidget key={placement.widget} placement={placement}/>;
    if (placement.widget === 'sessions') return <Widget key="sessions" id="sessions" size={placement.size}><AgentSessions views={state.sessions.views}
      synced={state.sessions.synced} live={live} control={state.runtime.control} now={now}/></Widget>;
    return null;
  };
  const schedule = artScheduleCopy(runtime);
  const artNotice = scheduledArtNotice(schedule.record, state.feed === 'connected' && schedule.synced, operations, operationsLive, now);
  // An ended session expands the rail at every width, so "Sign in again" is never squeezed into the icon rail.
  const ended = state.feed === 'ended', railExpanded = rail.expanded || ended;
  return <ArtPresentationProvider notice={artNotice} timeZone={schedule.record?.timeZone}><ArtThemeProvider><DeviceModesProvider value={{record: mode, live: state.feed === 'connected' && modeCopy?.synced === true, control: runtime.control, operations, operationsLive, devices: modeDevices}}><PinTargetsProvider targets={pinnable}><div className={workspace ? 'shell workspace-shell' : 'shell'}
    data-rail-wide={ended ? 'expanded' : railAttribute(rail.saved.wide)} data-rail-narrow={ended ? 'expanded' : railAttribute(rail.saved.narrow)}
    data-drawer={drawer ? 'open' : undefined} data-rail-short={railShort ? '' : undefined}>
    <a className="skip" href="#main" inert={drawer || jump} onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
    <header className="phone-bar" inert={jump}>
      <button ref={menuButton} type="button" className="secondary rail-button" aria-label="Open navigation" aria-description={conversationWaiting ? 'A conversation needs your answer' : undefined}
        aria-expanded={drawer} aria-controls="rail" onClick={() => { setDrawer(open => !open); }}><RailIcon name="menu"/>{conversationWaiting && <span className="rail-attention"/>}</button>
      <span className="phone-brand">B.U.N.N.Y.</span>
      <button type="button" className="secondary rail-button phone-jump" aria-label="Jump to a page" aria-haspopup="dialog" onClick={openJump}><RailIcon name="search"/></button>
      {ended && <button type="button" className="phone-sign-in" inert={drawer} onClick={signInAgain}>Sign in again</button>}
    </header>
    <aside id="rail" ref={railElement} inert={jump} onClick={event => {
      if (!drawer || !(event.target instanceof Element) || event.target.closest('a') === null) return;
      setDrawer(false);
      menuButton.current?.focus();
    }}>
      <div className="rail-head">
        <div className="brand"><span className="rabbit">◈</span><div>B.U.N.N.Y.<small>LOCAL INTEGRATION</small></div></div>
        <button type="button" className="secondary rail-button rail-toggle" disabled={ended}
          aria-label={railExpanded ? 'Collapse navigation' : 'Expand navigation'} title={railExpanded ? 'Collapse navigation' : 'Expand navigation'}
          onClick={rail.toggle}><RailIcon name="sidebar"/></button>
      </div>
      <button type="button" className="secondary rail-jump" aria-label="Jump to a page" aria-haspopup="dialog" title="Jump to a page" onClick={openJump}>
        <RailIcon name="search"/><span className="rail-text">Jump to…</span><kbd>{jumpKey}</kbd></button>
      <ShellNavigation route={route} devices={{open: menu, menuId: 'devices-menu', button: devicesRow, ownRow: pinnable.has(address) || (workspace && conversations),
        toggle: () => { if (menu) closeMenu('row'); else setMenu(true); }, show: () => { setMenu(true); }}}/>
      <PinnedPages route={route} fallback={devicesRow}/>
      {conversations && <div className="rail-conversations"><ModuleFrontend module="companions" connection={connection} connected={state.feed === 'connected' && !runtime.catalogFailed}
        control={false} operations={[]} operationsLive={false} Component={ConversationRail}/></div>}
      <div className="sidebar-foot">
        <div className="rail-foot-row">
          <nav aria-label="Utilities"><NavLink route={{kind: 'settings'}} selected={navigationDestination(route) === 'settings'}><RailIcon name="settings"/><span className="rail-text">Settings</span></NavLink></nav>
          <FeedIndicator state={state} now={now} control={runtime.control}/>
        </div>
        <p className="rail-text">{state.feed === 'ended' ? 'Signed out' : runtime.control ? 'Control enabled' : 'Read-only'} · Local</p>
        {state.feed === 'ended' && <button type="button" onClick={signInAgain}>Sign in again</button>}
      </div>
      {menu && <DeviceMenu id="devices-menu" runtime={runtime} pins={pins} route={route} row={devicesRow} onClose={closeMenu} onDropped={menuDropped}/>}
    </aside>
    <div className="rail-scrim" onClick={() => { setDrawer(false); menuButton.current?.focus(); }}/>
    {jump && <JumpPalette entries={jumpPlaces} onOpen={jumpTo} onClose={closeJump}/>}
    <main id="main" tabIndex={-1} inert={drawer || jump} data-feed={state.feed} data-revision={state.sessions.revision} data-syncs={state.sessions.syncs}>
      {!workspace && navigationDestination(route) === 'devices' && route.kind !== 'devices' && <nav className="shell-breadcrumb" aria-label="Breadcrumb"><NavLink route={{kind: 'devices'}}>All devices</NavLink></nav>}
      {!workspace && featureNavigation}
      {route.kind === 'connections' && <nav className="shell-breadcrumb" aria-label="Breadcrumb"><NavLink route={{kind: 'settings'}}>Back to Settings</NavLink></nav>}
      {route.kind === 'home' && <section aria-label="Home">
        {notice !== undefined && <p role="alert" className="warning">{notice}</p>}
        <HomeLayout runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive}
          attention={rows.some(row => row.attention.length > 0)} inbox={inboxItems.length > 0} renderCard={place}/>
      </section>}
      <DeviceDirectory runtime={runtime} connected={state.feed === 'connected'} active={route.kind === 'devices'}/>
      {route.kind === 'settings' && <section aria-label="Settings"><header className="page"><h1>Settings</h1></header>
        <div className="settings-grid"><article className="card"><h2>Connections</h2><p className="hint">Connection evidence, running build and operator tools.</p><NavLink route={{kind: 'connections'}}>Connections</NavLink></article>
          <article className="card"><h2>Browser session</h2><FeedIndicator state={state} now={now} control={runtime.control}/><div className="actions"><button type="button" className="secondary" onClick={disconnect}>Disconnect</button></div></article>
          <ArtThemeSettings/><article className="card"><PlacesNav links={links}/></article></div>
      </section>}
      {route.kind !== 'home' && <LightingWorkspace runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive} connection={connection} route={route}/>}
      {route.kind === 'component' && <section aria-label="Devices">
        {selectedDevice && route.kind === 'component' && <header className="page"><h1>{devices.find(({record}) => record.id === route.id)?.record.label ?? route.id}</h1><PinToggle route={route}/></header>}
        {runtime.catalogFailed && <p role="alert">The module catalog is unavailable. Retrying the read; controls stay unavailable.</p>}
        {runtime.modules?.filter(module => module.state === 'failed' || module.state === 'refused').map(module => <p className="warning" key={module.name}>{module.name}: {module.state}. Its devices are unavailable.</p>)}
        {runtime.copies.filter(copy => copy.family === 'device' && !copy.synced).map(copy => <p className="warning" key={copy.owner}>{copy.owner}: device records unavailable or stale{copy.refused === undefined ? '' : ` (${copy.refused})`}.</p>)}
        {runtime.modules !== undefined && devices.length === 0 && <p className="hint">No device records are available.</p>}
        <div className="cards">{devices.map(({record, copy}) => <div key={`${copy.owner}:${record.id}`} hidden={route.kind === 'component' && record.id !== route.id}>
          {deviceCard({record, copy})}
        </div>)}</div>
      </section>}
      {route.kind !== 'home' && <PlaybackWorkspace runtime={runtime} connected={state.feed === 'connected'} operations={operations} operationsLive={operationsLive} connection={connection} route={route}/>}
      {selectedPage !== undefined && selectedModule !== undefined && <section aria-label={selectedPage.title} className={workspace ? 'workspace-page' : undefined}>
        {/* The Conversation page names the open conversation in its own header row (#1890); the page's title stays as its heading and is not drawn. */}
        <header className={workspace ? 'vh' : 'page'}><h1>{selectedPage.title}</h1>
          {!workspace && <PinToggle route={route}/>}
        </header>
        <ModulePageView key={`${selectedModule.name}:${selectedPage.id}`} module={selectedModule} page={selectedPage} frontends={FRONTENDS} connection={connection}
          connected={state.feed === 'connected'} control={runtime.control} operations={operations} operationsLive={operationsLive}/>
      </section>}
      {route.kind === 'habitat' && <HabitatPage views={state.sessions.views} live={live}/>}
      {route.kind === 'timeline' && <Timeline connected={state.feed === 'connected'}/>}
      {route.kind === 'automation' && <AutomationPage connection={connection} live={state.feed === 'connected'} control={runtime.control}/>}
      {route.kind === 'connections' && <ConnectionsPage state={state} now={now} links={links}/>}
      {!known && <section aria-label="Not found"><div className="empty">
        <h2>{route.kind === 'component' ? `No component named ${route.id}` : 'Nothing at this address'}</h2>
        <p>This address is not declared by the current runtime. <NavLink route={{kind: 'home'}}>Go to the home</NavLink>.</p>
      </div></section>}
      {!workspace && <footer>B.U.N.N.Y. / Source observations and deliberate controls</footer>}
    </main>
  </div></PinTargetsProvider></DeviceModesProvider></ArtThemeProvider></ArtPresentationProvider>;
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
