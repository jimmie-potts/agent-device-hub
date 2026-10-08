// Browser sign-in on the runtime's gateway (Hub #835, #922). A session is an `HttpOnly` cookie that every tab of this
// origin shares, so a page never holds a token, and a reload or a second tab uses the live session instead of opening
// another. Every change carries `bunny-request: 1` and the page's own `Origin`, which the browser sets.
import {REQUEST_HEADER, childOf} from '@jimmie-potts/sdk/remote';

/** The launcher's one-time code, in the page's address fragment: `#launch=<code>`. */
const CODE = /^[A-Za-z0-9_-]{43}$/;

async function post(path: string, body: object): Promise<number> {
  const response = await fetch(path, {
    method: 'POST', cache: 'no-store', redirect: 'error', credentials: 'same-origin',
    headers: {'content-type': 'application/json', [REQUEST_HEADER]: '1', ...childOf(undefined)}, body: JSON.stringify(body),
  });
  await response.body?.cancel();
  return response.status;
}

/**
 * Whether this browser already holds a live session: `live`, `none`, or `unreachable` when the runtime did not answer.
 * It reads only the session's own authority, never a device or a session record.
 */
export async function currentSession(): Promise<'live' | 'none' | 'unreachable'> {
  try {
    const response = await fetch('/api/v2/authority?scope=read', {cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: childOf(undefined)});
    await response.body?.cancel();
    if (response.status === 200) return 'live';
    return response.status === 401 ? 'none' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/**
 * Asks for a trusted loopback session (Hub #276): `signed-in`, `off` when the runtime does not offer it (404), or
 * `failed`. Only a page load or a person's click calls it; the page never signs in again by itself.
 */
export async function trustedSignIn(): Promise<'signed-in' | 'off' | 'failed'> {
  try {
    const status = await post('/api/v2/browser/session', {});
    return status === 200 ? 'signed-in' : status === 404 ? 'off' : 'failed';
  } catch {
    return 'failed';
  }
}

/** The launcher's code in a fragment such as `#launch=<code>`, or undefined when the fragment holds anything else. */
export function launchCode(hash: string): string | undefined {
  if (!hash.startsWith('#launch=')) return undefined;
  const fragment = new URLSearchParams(hash.slice(1));
  const code = fragment.get('launch');
  return fragment.size === 1 && code !== null && CODE.test(code) ? code : undefined;
}

/** Exchanges the launcher's code for a session, once: `signed-in` or `failed`. */
export async function launchSignIn(code: string): Promise<'signed-in' | 'failed'> {
  try {
    return await post('/api/v2/browser/launch', {code}) === 200 ? 'signed-in' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Ends this browser's session and its streams, in every tab of this origin. */
export async function signOut(): Promise<void> {
  try {
    await post('/api/v2/browser/logout', {});
  } catch {
    // The page shows itself signed out either way; a session the runtime still holds ends at its expiry.
  }
}

/** The places the runtime names for this run, when it is a verification preview (Hub #495), or undefined. */
export async function previewPlaces(): Promise<Readonly<Record<string, string>> | undefined> {
  try {
    const response = await fetch('/api/v2/links', {cache: 'no-store', redirect: 'error', credentials: 'same-origin', headers: childOf(undefined)});
    if (response.status !== 200) {
      await response.body?.cancel();
      return undefined;
    }
    const links = await response.json() as {places?: unknown};
    const {places} = links;
    if (typeof places !== 'object' || places === null || Array.isArray(places)) return undefined;
    return Object.fromEntries(Object.entries(places).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch {
    return undefined;
  }
}
