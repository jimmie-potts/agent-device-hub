// A synthetic catalog and device records for the hardware inventory's unit tests (Hub #1950). Every name and ID is invented.
import type {RuntimeData} from '../src/runtime-feeds.ts';

const page = (module: string, id: string, title: string): {id: string; title: string; path: string; presentation: 'react'} => ({id, title, path: `/modules/${module}/${id}`, presentation: 'react'});
export const hardwareRuntime: RuntimeData = {control: true, catalogFailed: false, modules: [
  {name: 'core', state: 'running', serves: ['session'], pages: []},
  {name: 'lifx', state: 'running', serves: ['device', 'lifx-light'], pages: []},
  {name: 'nanoleaf', state: 'running', serves: ['device', 'nanoleaf-wall'], pages: [page('nanoleaf', 'wall', 'Wall'), page('nanoleaf', 'shows', 'Saved shows')]},
  {name: 'pixoo', state: 'running', serves: ['device'], pages: ['playlists:Playlists', 'library:Library', 'player:Player', 'monitor:Monitor', 'settings:Settings'].map(item => {
    const [id = '', title = ''] = item.split(':'); return page('pixoo', id, title);
  })},
  {name: 'tidbyt', state: 'running', serves: ['device'], pages: [page('tidbyt', 'display', 'Tidbyt display')]},
  {name: 'wemo', state: 'running', serves: ['device'], pages: []},
  {name: 'microduck', state: 'running', serves: ['device'], pages: [page('microduck', 'controls', 'MicroDuck robot')]},
  {name: 'playback', state: 'running', serves: ['playback'], pages: []},
  {name: 'art', state: 'running', serves: ['art'], pages: [page('art', 'gallery', 'Art Gallery')]},
  {name: 'companions', state: 'running', serves: ['assistant-state'], pages: [page('companions', 'reachy', 'Reachy'), page('companions', 'microduck', 'MicroDuck'),
    page('companions', 'assistant', 'Conversation'), page('companions', 'preferences', 'Preferences'), page('companions', 'knowledge', 'Companion knowledge'),
    page('companions', 'duck-conversation', 'Duck conversation')]},
  {name: 'wispr', state: 'failed', serves: [], pages: [page('wispr', 'analytics', 'Wispr')]},
], copies: [
  {owner: 'bunny/modules/lifx', family: 'device', synced: true, records: [{id: 'pendant-1', kind: 'lifx'}, {id: 'strip', kind: 'lifx', label: 'Shelf strip'}]},
  {owner: 'bunny/modules/nanoleaf', family: 'device', synced: true, records: [{id: 'wall', kind: 'nanoleaf'}, {id: 'nl22', kind: 'nanoleaf'}]},
  {owner: 'bunny/modules/nanoleaf', family: 'nanoleaf-wall', synced: true, records: [{id: 'wall', kind: 'lines'}, {id: 'nl22', kind: 'panels'}]},
  {owner: 'bunny/modules/pixoo', family: 'device', synced: true, records: [{id: 'pixoo-1', kind: 'pixoo'}]},
  {owner: 'bunny/modules/tidbyt', family: 'device', synced: false, records: [{id: 'tidbyt', kind: 'tidbyt', label: 'Tidbyt'}]},
  {owner: 'bunny/modules/wemo', family: 'device', synced: true, records: [{id: 'desk-plug', kind: 'wemo'}, {id: 'shelf-plug', kind: 'wemo', label: 'Shelf plug'}]},
] as unknown as RuntimeData['copies']};
