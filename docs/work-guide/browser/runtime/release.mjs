// Production Node implementation of the approved #545 algorithms; fixture conformance is tested.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Ajv from 'ajv';

const schema = JSON.parse(readFileSync(new URL('../../contracts/epic-guide/release.schema.json', import.meta.url)));
const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);
export const VERSION = 'guide-release/1.0';
const reject = (code, detail) => { throw new Error(`${code}: ${detail}`); };
const check = (condition, code, detail) => { if (!condition) reject(code, detail); };
export const fileHash = bytes => createHash('sha256').update(bytes).digest('hex');

// A release is everything deployed together. Build time is diagnostic; artifacts form a set.
export function releaseIdentity(manifest) {
  const content = structuredClone(manifest);
  delete content.releaseId;
  delete content.builtAt;
  content.artifacts.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']'
    : x !== null && typeof x === 'object' ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}'
    : JSON.stringify(x);
  return 'sha256:' + createHash('sha256').update(canonical(content)).digest('hex');
}

// Every part of a release must come from that release; any disagreement is a mixed release.
export function validateRelease(manifest, { dataset, catalogId, files = {} } = {}) {
  check(manifest?.schemaVersion === VERSION, 'release-unsupported', String(manifest?.schemaVersion));
  check(validate(manifest), 'release-schema', ajv.errorsText(validate.errors, { separator: '; ' }));
  check(manifest.releaseId === releaseIdentity(manifest), 'release-identity', manifest.releaseId);
  const paths = manifest.artifacts.map(x => x.path);
  check(new Set(paths).size === paths.length, 'release-schema', 'duplicate artifact path');
  for (const kind of ['records', 'catalog']) check(manifest.artifacts.filter(x => x.kind === kind).length === 1, 'release-schema', `one ${kind} artifact`);
  if (dataset) {
    check(dataset.schemaVersion === manifest.recordsVersion && dataset.datasetId === manifest.datasetId && dataset.asOf === manifest.asOf,
      'mixed-release', 'records differ from the release');
  }
  if (catalogId) check(catalogId === manifest.catalogId, 'mixed-release', 'catalog differs from the release');
  for (const [path, bytes] of Object.entries(files)) {
    const artifact = manifest.artifacts.find(x => x.path === path);
    check(artifact && artifact.sha256 === fileHash(bytes), 'mixed-release', `${path} is not this release's artifact`);
  }
  return manifest;
}

// A view or reply built for one release is valid only in that release.
export function checkBinding(manifest, input) {
  check(input.datasetId === manifest.datasetId && input.catalogId === manifest.catalogId, 'mixed-release', 'view binding differs from the release');
  return input;
}

const supported = (manifest, supports) => supports.release.includes(manifest.schemaVersion)
  && supports.records.includes(manifest.recordsVersion) && supports.views.includes(manifest.viewsVersion);

// What an open client does when it sees a release; it never combines two releases.
export function compatibility({ pinned = null, incoming, supports, pinnedAssetsAvailable = true }) {
  if (!supported(incoming, supports)) return pinned ? 'update-required' : 'unavailable';
  if (!pinned) return 'load';
  if (incoming.releaseId === pinned.releaseId) return pinnedAssetsAvailable ? 'current' : 'reload-required';
  return pinnedAssetsAvailable ? 'newer-available' : 'reload-required';
}

// Ask may run only on a release the client fully supports, and a reply only counts for the
// release its request was made against, while that release is still the one on screen.
export const mayInvokeModel = (manifest, supports) => supported(manifest, supports);
export function acceptReply({ requestReleaseId, currentReleaseId, replyReleaseId }) {
  return replyReleaseId === requestReleaseId && requestReleaseId === currentReleaseId ? 'accept' : 'obsolete';
}
