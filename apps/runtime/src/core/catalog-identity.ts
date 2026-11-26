// Read a fixed owner content reference through the module host. Only an opaque ID crosses back into Companions.
import type {CatalogIdentityRead} from '@jimmie-potts/companions';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import type {ModuleScheduler} from '@jimmie-potts/sdk';
import type {ArtCatalogHost} from './art-catalog.js';

const SCENE_ID = /^scene-[a-f0-9]{64}$/u;
const ASSET_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu;

const sceneReference = 'scene-id-by-name';
const assetReference = 'asset-id-by-name';

export const privateCatalogIdentityReference = (owner: string, ref: string): boolean =>
  owner === 'nanoleaf' && ref === sceneReference || owner === 'pixoo' && ref === assetReference;

export function hostedCatalogIdentity(host: ArtCatalogHost, scheduler: ModuleScheduler): CatalogIdentityRead {
  return async (input, timeoutMs) => {
    const scene = input.kind === 'scene';
    const name = scene ? 'nanoleaf' : 'pixoo';
    const contentRef = scene ? sceneReference : assetReference;
    const query: Readonly<Record<string, string>> = scene
      ? {device: input.deviceId, name: input.name}
      : {...(input.id === undefined ? {name: input.name} : {id: input.id}),
        ...(input.currentText === undefined ? {} : {currentText: input.currentText})};
    const owner = host.modules().find(module => module.name === name && module.admitted);
    const content = owner?.manifest.content;
    if (content === undefined) return errorBody('unavailable');
    const controller = new AbortController();
    let cancel = (): void => {};
    const late = new Promise<ErrorBody>(resolve => {
      cancel = scheduler.after(timeoutMs, () => {controller.abort(); resolve(errorBody('unavailable'));});
    });
    try {
      const read = host.invoke(name, () => content(contentRef, {signal: controller.signal, query: Object.freeze(query)}));
      const result = await Promise.race([read, late]);
      if (result === undefined || controller.signal.aborted) return errorBody('unavailable');
      if ('error' in result) return errorBody(result.error.code);
      if (result.type !== 'application/json' || result.bytes.byteLength > 128) return errorBody('unavailable');
      const payload: unknown = JSON.parse(new TextDecoder().decode(result.bytes));
      if (typeof payload !== 'object' || payload === null || !('id' in payload) || Object.keys(payload).length !== 1 ||
        typeof payload.id !== 'string' || !(scene ? SCENE_ID : ASSET_ID).test(payload.id)) return errorBody('unavailable');
      return {id: payload.id};
    } catch {
      return errorBody('unavailable');
    } finally {
      cancel();
    }
  };
}
