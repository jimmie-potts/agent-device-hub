// The route map (Hub #835): every route the old Hub serves, in `apps/hub/src/server.ts` and its route modules, with its
// 2.0 replacement or the reason it is dropped. The runtime serves on the old Hub's port at the cutover (#840), so a
// caller left on a 1.x route gets the registry's `not-found`, and the runtime logs the route it asked for, never its
// path, for the retirement story's check (#839). A route that the dashboard (#922) serves again keeps its path.

export type RouteMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'ANY';
/**
 * One old route: its method and path template, where `{name}` stands for one path segment and a trailing `*` for the
 * rest, and what replaces it. `kept` routes come back on the same path, with the story that serves them.
 */
export type RetiredRoute = {
  readonly method: RouteMethod;
  readonly path: string;
  readonly status: 'replaced' | 'dropped' | 'kept';
  /** The 2.0 route or SDK call that replaces it, or why it is dropped. */
  readonly replacement: string;
  /** The issue that delivers the replacement, when it is not this story. */
  readonly owner?: string;
};

const SDK = 'the SDK over /api/sdk/v1';

export const RETIRED_ROUTES: readonly RetiredRoute[] = [
  {method: 'GET', path: '/', status: 'kept', replacement: 'the dashboard on the runtime', owner: '#922'},
  {method: 'GET', path: '/dashboard.js', status: 'kept', replacement: 'the dashboard on the runtime', owner: '#922'},
  {method: 'GET', path: '/dashboard.css', status: 'kept', replacement: 'the dashboard on the runtime', owner: '#922'},
  {method: 'ANY', path: '/mcp', status: 'kept', replacement: 'MCP on the runtime, with tools from the modules\' manifests'},
  {method: 'POST', path: '/api/dashboard/v1/launch', status: 'replaced', replacement: 'POST /api/v2/browser/launch'},
  {method: 'POST', path: '/api/dashboard/v1/session', status: 'replaced', replacement: 'POST /api/v2/browser/session'},
  {method: 'POST', path: '/api/dashboard/v1/logout', status: 'replaced', replacement: 'POST /api/v2/browser/logout'},
  {method: 'GET', path: '/api/dashboard/v1/context', status: 'replaced', replacement: 'GET /api/v2/modules and GET /api/v2/links'},
  {method: 'GET', path: '/api/hub/v1/authority', status: 'replaced', replacement: 'GET /api/v2/authority'},
  {method: 'GET', path: '/api/hub/v1/health', status: 'replaced', replacement: 'GET /api/runtime/v1/health'},
  {method: 'GET', path: '/api/monitor/v1/sessions', status: 'replaced', replacement: `GET /api/v2/families/session, GET /api/v2/snapshot or ${SDK}: sync session`},
  {method: 'POST', path: '/api/monitor/v1/events', status: 'replaced', replacement: `${SDK}: publish on bunny.event.lifecycle.<session>`, owner: '#926'},
  {
    method: 'POST', path: '/api/monitor/v1/commands', status: 'replaced',
    replacement: `${SDK}: request bunny.cmd.notice-acknowledge.<session> or bunny.cmd.approval-recover.<session>, or POST /api/v2/commands/approval-recover; label has no 2.0 command yet and quiesce is dropped with the supervised migration`,
  },
  {method: 'GET', path: '/api/monitor/v1/changes', status: 'replaced', replacement: `${SDK}: the stream and sync`},
  {method: 'GET', path: '/api/automation/v1/rules', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'POST', path: '/api/automation/v1/rules', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'GET', path: '/api/automation/v1/rules/{rule}', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'PUT', path: '/api/automation/v1/rules/{rule}', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'DELETE', path: '/api/automation/v1/rules/{rule}', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'POST', path: '/api/automation/v1/rules/{rule}/enable', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'POST', path: '/api/automation/v1/rules/{rule}/disable', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'GET', path: '/api/automation/v1/interrupt-set', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'PUT', path: '/api/automation/v1/interrupt-set', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'GET', path: '/api/automation/v1/settings', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'PUT', path: '/api/automation/v1/settings', status: 'replaced', replacement: 'automation on the runtime bus', owner: '#925'},
  {method: 'GET', path: '/api/automation/v1/log', status: 'replaced', replacement: 'automation on the runtime bus, and history', owner: '#925'},
  {method: 'GET', path: '/api/wispr/v1/{operation}', status: 'replaced', replacement: 'the Wispr module', owner: '#927'},
  {method: 'GET', path: '/api/playback/v1/snapshot', status: 'replaced', replacement: `${SDK}: sync playback`, owner: '#929'},
  {method: 'POST', path: '/api/playback/v1/commands', status: 'replaced', replacement: `${SDK}: request bunny.cmd.playback-control.<id>`, owner: '#929'},
  {method: 'GET', path: '/api/controllers/v1/{device}/snapshot', status: 'replaced', replacement: `${SDK}: sync the device's family`},
  {method: 'POST', path: '/api/controllers/v1/{device}/commands', status: 'replaced', replacement: 'the action routes and their dispatcher', owner: '#782'},
  {method: 'POST', path: '/api/controllers/v1/{device}/moment', status: 'replaced', replacement: 'moments on the runtime bus', owner: '#925'},
  {method: 'GET', path: '/api/controllers/v1/{device}/integration/snapshot', status: 'replaced', replacement: `${SDK}: sync the device module's families`},
  {method: 'GET', path: '/api/controllers/v1/{device}/integration/geometry', status: 'replaced', replacement: `${SDK}: sync the device module's families`, owner: '#844'},
  {method: 'POST', path: '/api/controllers/v1/{device}/integration/commands', status: 'replaced', replacement: 'the action routes and their dispatcher', owner: '#782'},
  {method: 'GET', path: '/api/controllers/v1/{device}/integration/receipt', status: 'replaced', replacement: 'the command\'s outcome and history', owner: '#782'},
  {method: 'POST', path: '/api/controllers/v1/{device}/integration/cancel', status: 'replaced', replacement: 'the action routes and their dispatcher', owner: '#782'},
  {method: 'GET', path: '/api/controllers/v1/{device}/integration/catalog/*', status: 'replaced', replacement: 'the Pixoo module\'s pages and content by reference', owner: '#843'},
  {method: 'GET', path: '/api/controllers/v1/{device}/integration/renditions/*', status: 'replaced', replacement: 'the Pixoo module\'s content by reference', owner: '#843'},
  {method: 'GET', path: '/api/controllers/v1/{device}/lighting/snapshot', status: 'replaced', replacement: `${SDK}: sync the LIFX module's families`, owner: '#928'},
  {method: 'POST', path: '/api/controllers/v1/{device}/lighting/commands', status: 'replaced', replacement: 'the action routes and their dispatcher', owner: '#782'},
  {method: 'ANY', path: '/__app-verify/proof/*', status: 'dropped', replacement: 'disposable runs serve their own proof (npm run -s verify:runtime)'},
];

/** A template's segments as a pattern: `{name}` is one segment, a trailing `*` the rest, anything else itself. */
function matcher(template: string): RegExp {
  const escaped = template.split('/').map(segment => {
    if (/^\{[a-z]+\}$/.test(segment)) return '[^/]+';
    if (segment === '*') return '.*';
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return new RegExp(`^${escaped}$`);
}

const MATCHERS = RETIRED_ROUTES.map(route => ({route, pattern: matcher(route.path)}));

/**
 * The old route a request asks for, by its method and path, or undefined. A path the map knows under another method
 * still names that route, so a caller of a 1.x route is logged whatever method it used.
 */
export function retiredRoute(method: string, path: string): RetiredRoute | undefined {
  const matching = MATCHERS.filter(({pattern}) => pattern.test(path)).map(({route}) => route);
  return matching.find(route => route.method === method || route.method === 'ANY') ?? matching[0];
}
