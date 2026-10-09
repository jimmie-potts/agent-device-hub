import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configured} from '@jimmie-potts/sdk';
import {isAbsolute, normalize} from 'node:path';
import {isIPv4} from 'node:net';

export type WisprConfig = {
  sourceId: string; aggregatePath: string; diagnosticsPath: string;
  freshnessMs: number; exposeToDashboard: boolean; shareTextAggregates: boolean;
};

const members = new Set(['sourceId', 'aggregatePath', 'diagnosticsPath', 'freshnessMs', 'exposeToDashboard', 'shareTextAggregates', 'secrets']);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const refused = (): ErrorBody => errorBody('invalid-request', {detail: 'the Wispr section is invalid'});

/** Adapted from apps/hub/src/wispr.ts at bf11587c; fresh manual configuration, without conversion or client grants. */
export function configureWispr(section: unknown): Configured<WisprConfig> | ErrorBody {
  if (!object(section) || Object.keys(section).some(key => !members.has(key))) return refused();
  const {sourceId, aggregatePath, diagnosticsPath, freshnessMs, exposeToDashboard, shareTextAggregates} = section;
  if (typeof sourceId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}(?![\s\S])/.test(sourceId) || isIPv4(sourceId)
    || sourceId === 'hub-service') return refused();
  for (const path of [aggregatePath, diagnosticsPath]) {
    if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path || !path.endsWith('.json') || path.length > 4096 || Array.from(path).some(char => char.charCodeAt(0) < 32 || char === '\\')
      || /(?:^|\/)(?:\.git|onedrive[^/]*|dropbox|google drive|icloud ?drive)(?:\/|$)/i.test(path)) return refused();
  }
  if (aggregatePath === diagnosticsPath || [exposeToDashboard, shareTextAggregates].some(flag => flag !== undefined && typeof flag !== 'boolean')
    || (freshnessMs !== undefined && (!Number.isSafeInteger(freshnessMs) || Number(freshnessMs) < 1000 || Number(freshnessMs) > 86400000))) return refused();
  return {config: {sourceId, aggregatePath: aggregatePath as string, diagnosticsPath: diagnosticsPath as string,
    freshnessMs: (freshnessMs as number | undefined) ?? 600000, exposeToDashboard: exposeToDashboard === true, shareTextAggregates: shareTextAggregates === true}};
}

/** Public read projection: selected paths never leave the module. */
export function showWisprSettings(config: WisprConfig): Readonly<Record<string, unknown>> {
  const {sourceId, freshnessMs, exposeToDashboard, shareTextAggregates} = config;
  return {sourceId, freshnessMs, exposeToDashboard, shareTextAggregates};
}
