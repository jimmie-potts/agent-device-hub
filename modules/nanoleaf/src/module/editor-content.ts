// The editor's cached geometry read (Hub #934). This module never reaches a controller or changes saved state.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleContent, ModuleContentRequest} from '@jimmie-potts/sdk';
import {connectorLayout} from '../geometry.js';
import {savedLayout} from './views.js';

const DEVICE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BYTES = 256 * 1024;

/** One explicitly selected configured device; filesystem names never come from the request. */
export function editorContent(directory: string, devices: readonly string[], ref: string, request?: ModuleContentRequest): ModuleContent | ErrorBody | undefined {
  if (ref !== 'editor-layout') return undefined;
  const device = request?.query.device;
  if (request === undefined || Object.keys(request.query).length !== 1 || typeof device !== 'string' || device.length > 128 || !DEVICE.test(device)) {
    return errorBody('invalid-request', {detail: 'Select one configured Nanoleaf device.'});
  }
  if (request.signal.aborted) return errorBody('cancelled', {detail: 'The editor read ended.'});
  if (!devices.includes(device)) return errorBody('not-found', {detail: 'The Nanoleaf device is not configured.'});
  try {
    const layout = savedLayout(directory, device);
    const geometry = layout?.kind === 'lines' ? connectorLayout(layout) : null;
    if (geometry === null || geometry.lines.length > 300 || geometry.nodes.length > 600) {
      return errorBody('invalid-state', {detail: 'Saved connector geometry is unavailable for this device.'});
    }
    const bytes = Buffer.from(JSON.stringify({schema: 'nanoleaf-editor-layout/2.0', device, geometry}));
    if (bytes.length > MAX_BYTES) return errorBody('too-large', {detail: 'Saved connector geometry exceeds the editor limit.'});
    return {type: 'application/json', bytes};
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT') return errorBody('invalid-state', {detail: 'Saved connector geometry is unavailable for this device.'});
    if (code === 'EACCES' || code === 'EPERM' || code === 'EIO') return errorBody('unavailable', {detail: 'Saved connector geometry cannot be read.'});
    throw error;
  }
}
