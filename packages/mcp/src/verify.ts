import { createHash } from 'node:crypto';
import { readFile, lstat, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const CONTRACT_ARTIFACT_SHA256 = '5e0b30ac92e6e8e1e38d8249b740b565de66e3cc810a04bc6fac23e182e84e87';
export async function verifyArchiveChecksum(path: string, expected: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(expected) || checksum(await readFile(path)) !== expected) throw new Error('Artifact checksum mismatch');
}
async function verifyFiles(directory: string, hashes: Record<string, string>): Promise<void> {
  if (!hashes || !Object.keys(hashes).length) throw new Error('Missing file manifest');
  for (const [name, expected] of Object.entries(hashes)) {
    if (name.includes('\\') || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')
        || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid manifest entry');
    const path = resolve(directory, name);
    if (relative(resolve(directory), path).startsWith('..')) throw new Error('Invalid manifest path');
    let current = resolve(directory);
    for (const component of name.split('/')) { current = join(current, component); if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink in artifact'); }
    if (!(await lstat(path)).isFile() || checksum(await readFile(path)) !== expected) throw new Error('Artifact file mismatch');
  }
}
/** Run after installing an archive whose SHA-256 was verified against its release receipt. */
export async function verifyInstalledMcpPackage(directory: string): Promise<void> {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  if (manifest.artifact !== '@jimmie-potts/device-mcp' || manifest.version !== '1.0.1' || manifest.contractVersion !== '1.0.0'
      || manifest.contractSha256 !== CONTRACT_ARTIFACT_SHA256 || manifest.sdk !== '@modelcontextprotocol/sdk@1.30.0'
      || manifest.fixtureFormat !== 1) throw new Error('Unsupported artifact version');
  await verifyFiles(directory, manifest.files);
  const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (packageJson.version !== manifest.version || packageJson.dependencies['@jimmie-potts/device-contracts'] !== '1.0.0'
      || packageJson.dependencies['@modelcontextprotocol/sdk'] !== '1.30.0') throw new Error('Artifact dependency mismatch');
  const contract = join(directory, 'node_modules/@jimmie-potts/device-contracts');
  const contractManifest = JSON.parse(await readFile(join(contract, 'manifest.json'), 'utf8'));
  if (contractManifest.version !== '1.0.0' || contractManifest.apiVersion !== '1.0') throw new Error('Unsupported contract version');
  await verifyFiles(contract, contractManifest.files);
  async function inventory(path: string, prefix = ''): Promise<string[]> {
    const result: string[] = [];
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (!prefix && ['node_modules', 'manifest.json'].includes(entry.name)) continue;
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) result.push(...await inventory(join(path, entry.name), name));
      else if (entry.isFile()) result.push(name);
      else throw new Error('Unexpected artifact entry');
    }
    return result;
  }
  if (JSON.stringify((await inventory(directory)).sort()) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error('Artifact inventory mismatch');
}
