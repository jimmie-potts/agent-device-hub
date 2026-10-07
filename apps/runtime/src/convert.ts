// The cutover's conversion of the old Hub's edge settings (Hub #835), which the installer (#935) runs offline at the
// cutover (#840): the Hub's configuration file's `credentials`, `browserAccess`, `mcp`, `editorLinks` and `placeLinks`
// become the runtime's credentials file and its configuration's `edge` section. Each credential keeps its ID, its
// token's digest and every scope, so the token the client already holds authenticates unchanged; it gains the source it
// acts as, `bunny/parts/<id>` in routing form. Its device grant is dropped, since no runtime grant limits a client to
// some devices (owner decision, 2026-10-07), and the conversion lists, by ID, each credential that dropping it widened.
// Nothing here reads a token: the Hub kept only digests.
import {DASHBOARD_SOURCE, parseCredentials, type EdgeCredential} from './credentials.js';
import {RuntimeError, checkEdgeSection, type EdgeConfig} from './state.js';

/**
 * What the conversion gives the installer: the credentials to write, the `edge` section without their file's path, and
 * `widened`, the IDs alone of the credentials that reach more devices than the Hub let them, for the owner to review at
 * the cutover.
 */
export type ConvertedEdge = {credentials: EdgeCredential[]; edge: Omit<EdgeConfig, 'credentials'>; widened: string[]};

/**
 * The scopes the Hub limited to the devices a credential named: a `read` saw, and a `control` commanded, only those.
 * The runtime limits neither, so a credential with either is wider than it was, whatever devices it named, as a device
 * added later is its too. `ingest` and `admin` named no device.
 */
const DEVICE_SCOPES: readonly string[] = ['read', 'control'];

const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const refuse = (detail: string): RuntimeError => new RuntimeError('convert-invalid', `the Hub's configuration ${detail}`);

/**
 * The source a Hub credential acts as: its ID in lowercase, with every run of other characters one hyphen. The browser
 * sessions' own source, `bunny/parts/dashboard`, is theirs alone, so a credential called `dashboard` acts as
 * `bunny/parts/dashboard-credential`.
 */
export function sourceForHubId(id: string): string | undefined {
  const token = id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (token === '') return undefined;
  const source = `bunny/parts/${token}`;
  return source === DASHBOARD_SOURCE ? `${DASHBOARD_SOURCE}-credential` : source;
}

/** A link of the Hub's, kept as the runtime's configuration reader would accept it, or a refusal. */
function linksOf(value: unknown, what: string, key: (name: string) => boolean): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw refuse(`has ${what} that are not an object`);
  const links: Record<string, string> = {};
  for (const [name, href] of Object.entries(value)) {
    if (!key(name) || typeof href !== 'string') throw refuse(`has ${what} keyed by ${name}, which the runtime does not take; rename it before the cutover`);
    links[name] = href;
  }
  return links;
}

/**
 * Converts the old Hub's configuration, as its `hub.json` holds it, into the runtime's credentials and `edge` section.
 * It refuses, with `convert-invalid`, a Hub configuration whose credentials are malformed, whose IDs give two
 * credentials one source, or whose editor links name a device that is not a routing ID, which the runtime's modules
 * would not answer to; the owner renames those before the cutover. Each credential's device grant is dropped unread.
 * The runtime's own reader checks the result again: `parseCredentials` here, and the configuration reader when the
 * runtime starts. No refusal quotes a digest.
 */
export function convertHubEdge(hub: unknown): ConvertedEdge {
  if (!isRecord(hub)) throw refuse('is not an object');
  const listed = hub.credentials;
  if (!Array.isArray(listed)) throw refuse('has no credentials list');
  const sources = new Map<string, string>();
  const credentials = listed.map((entry: unknown): EdgeCredential => {
    if (!isRecord(entry)) throw refuse('has a credential that is not an object');
    const {id, digest, scopes} = entry;
    if (typeof id !== 'string') throw refuse('has a credential without an ID');
    const source = sourceForHubId(id);
    if (source === undefined) throw refuse(`has a credential, ${id}, whose ID gives no source`);
    const taken = sources.get(source);
    if (taken !== undefined) throw refuse(`gives ${taken} and ${id} one source, ${source}; rename one before the cutover`);
    sources.set(source, id);
    return {id, source, digest: digest as string, scopes: scopes as EdgeCredential['scopes']};
  });
  let checked: EdgeCredential[];
  try {
    checked = parseCredentials({schema: 'edge-credentials/1.0', credentials});
  } catch (error) {
    if (error instanceof RuntimeError) throw new RuntimeError('convert-invalid', `the Hub's credentials do not convert: ${error.code}`);
    throw error;
  }
  const {browserAccess, mcp = false} = hub;
  if (browserAccess !== undefined && browserAccess !== 'trusted-loopback') throw refuse('has a browserAccess other than trusted-loopback');
  if (typeof mcp !== 'boolean') throw refuse('has an mcp that is not true or false');
  // The old Hub always served its launcher, and served MCP only with `mcp: true`, which the runtime keeps.
  const edge: Omit<EdgeConfig, 'credentials'> = {
    ...(browserAccess === undefined ? {} : {browserAccess: 'trusted-loopback' as const}), launcher: true, mcp,
    editorLinks: linksOf(hub.editorLinks, 'editor links', name => ROUTING_ID.test(name)),
    placeLinks: linksOf(hub.placeLinks, 'place links', name => /^[A-Za-z0-9_.-]{1,128}$/.test(name) && name !== 'bunny'),
  };
  // The runtime's own reader checks the section at the conversion, links and their counts included, so a link it would
  // refuse fails here, not at the cutover's first start. The credentials path is the installer's; any absolute one serves.
  try {
    checkEdgeSection({credentials: '/edge-credentials.json', ...edge});
  } catch (error) {
    if (error instanceof RuntimeError) throw refuse('has links the runtime does not take: each a loopback http link without credentials, query or fragment, at most 16 editor links and 8 place links with a port');
    throw error;
  }
  const widened = checked.filter(credential => credential.scopes.some(scope => DEVICE_SCOPES.includes(scope))).map(credential => credential.id);
  return {credentials: checked, edge, widened};
}
