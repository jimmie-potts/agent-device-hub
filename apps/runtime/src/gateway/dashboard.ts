// The dashboard's page and its two assets (Hub #922), served from the runtime's gateway as the old Hub served them, on
// the same paths, so a bookmark keeps its address at the cutover. The page holds no secret and signs in only from its
// own origin, so it loads without a session: a sign-in, every read and every change go through the gateway's other
// routes and their checks. The build (`apps/runtime/dashboard/build.mjs`) writes the files to `dist/dashboard/`.
import {readFile} from 'node:fs/promises';
import type {IncomingMessage} from 'node:http';
import {contextOf} from './access.js';

/** Where the build writes the dashboard: `dist/dashboard/` beside the runtime's compiled `dist/src/`. */
export const DASHBOARD_DIR = new URL('../../dashboard/', import.meta.url);

/** Each served path and its built file. Nothing else under the dashboard's folder is served. */
export const DASHBOARD_FILES: Readonly<Record<string, {file: string; type: string}>> = {
  '/': {file: 'index.html', type: 'text/html; charset=utf-8'},
  '/dashboard.js': {file: 'dashboard.js', type: 'text/javascript; charset=utf-8'},
  '/dashboard.css': {file: 'dashboard.css', type: 'text/css; charset=utf-8'},
};

/**
 * The page may run only its own script and style, and reach only this origin; no page may frame it, and the opener
 * policy severs a linking page's handle on its window, so a page that opened it cannot navigate it again and again to
 * pile up sign-ins (Hub #561).
 */
export const DASHBOARD_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'content-security-policy': 'default-src \'none\'; script-src \'self\'; style-src \'self\'; connect-src \'self\'; img-src \'self\'; base-uri \'none\'; frame-ancestors \'none\'; form-action \'self\'',
};

/**
 * Whether a request may load one of the dashboard's paths, as the old Hub decided (Hub #276, #561). Every path loads
 * from this origin's own page or from the browser itself, a bookmark or the launcher, with no other `Origin`. The page
 * alone also loads from a link on another local app's page with the same host name, such as the wall's B.U.N.N.Y. link:
 * a same-site top-level navigation to a document, which only a browser can send. A cross-site navigation, a frame of
 * another site and a fetch from another loopback app are refused.
 */
export function dashboardAllowed(request: IncomingMessage, origin: string, path: string): boolean {
  if (contextOf(request, origin) !== 'cross') return true;
  return path === '/' && request.headers.origin === undefined && request.headers['sec-fetch-site'] === 'same-site'
    && request.headers['sec-fetch-mode'] === 'navigate' && request.headers['sec-fetch-dest'] === 'document';
}

/** One built file of the dashboard, or undefined when the dashboard is not built. */
export async function dashboardFile(dir: URL, path: string): Promise<{bytes: Uint8Array; type: string} | undefined> {
  const served = DASHBOARD_FILES[path];
  if (served === undefined) return undefined;
  try {
    return {bytes: await readFile(new URL(served.file, dir)), type: served.type};
  } catch {
    return undefined;
  }
}
