import { readFileSync, statSync } from 'node:fs';
import { INSTALLATION_ID, TidbytConfigurationError } from './connection.js';

export type TidbytCredentials = { deviceId: string; apiKey: string; installationId: string };

const KEYS = { TIDBYT_DEVICE_ID: 'deviceId', TIDBYT_API_KEY: 'apiKey', TIDBYT_INSTALLATION_ID: 'installationId' } as const;
export const DEFAULT_INSTALLATION_ID = 'agentdevicehub';

/**
 * Load operator credentials from a private KEY=VALUE file outside Git. Secrets never
 * come from arguments or the environment, and errors never include file contents.
 */
export function loadTidbytCredentials(file: string): TidbytCredentials {
  let text: string;
  try {
    const mode = statSync(file).mode;
    if (process.platform !== 'win32' && (mode & 0o077) !== 0) throw new TidbytConfigurationError('credentials-permissions');
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof TidbytConfigurationError) throw error;
    throw new TidbytConfigurationError('credentials-unreadable');
  }
  return parseTidbytCredentials(text);
}

/** Parse already-private bytes without performing another file read. */
export function parseTidbytCredentials(text: string): TidbytCredentials {
  const values: Partial<Record<'deviceId' | 'apiKey' | 'installationId', string>> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    const key = line.slice(0, at).trim();
    if (at < 1 || !Object.hasOwn(KEYS, key)) throw new TidbytConfigurationError('credentials-invalid');
    const field = KEYS[key as keyof typeof KEYS];
    if (values[field] !== undefined) throw new TidbytConfigurationError('credentials-invalid');
    values[field] = line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  const installationId = values.installationId ?? DEFAULT_INSTALLATION_ID;
  if (!values.deviceId || !values.apiKey || !INSTALLATION_ID.test(installationId)) {
    throw new TidbytConfigurationError('credentials-invalid');
  }
  return { deviceId: values.deviceId, apiKey: values.apiKey, installationId };
}
