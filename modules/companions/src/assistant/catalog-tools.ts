import {assistantRoutes, catalogFamily, type CatalogFamily} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {ToolDefinition, ToolInputSchema} from './tool-types.js';

export const READ_HUB_GUIDE = 'read_hub_guide';
export const READ_DEVICE_HISTORY = 'read_device_history';
export const READ_DEVICES = 'read_devices';
export const READ_PLAYBACK = 'read_playback';
export const READ_VACUUM = 'read_roborock';
export const READ_VOLCANO = 'read_volcano';
export const READ_ART = 'read_saved_art';
export const READ_SHOWS = 'read_light_shows';
export const READ_OPERATION = 'read_device_operation';
export const READ_ART_EFFECTS = 'read_art_show_effects';
export const CREATE_SHOW = 'create_light_show_draft';
export const EDIT_SHOW = 'edit_light_show_cue';
export const PREVIEW_SHOW = 'preview_light_show_draft';
export const CREATE_ART = 'create_artwork';
export const SAVE_SHOW = 'save_light_show';
export const MAX_CATALOG_ARGUMENTS = 4096;

const text = (description: string): {type: 'string'; description: string} => ({type: 'string', description});
const integer = (description: string): {type: 'integer'; description: string} => ({type: 'integer', description});
const define = (name: string, effect: ToolDefinition['effect'], description: string, properties: ToolInputSchema['properties']): ToolDefinition =>
  ({name, effect, description, input: {type: 'object', properties, required: Object.keys(properties), additionalProperties: false}});

export function catalogTool(family: CatalogFamily): string {
  if (family === 'art-request') return CREATE_ART;
  return family === 'nanoleaf-show-save' ? SAVE_SHOW : `control_${family.replaceAll('-', '_')}`;
}

export function catalogCommand(name: string): CatalogFamily | undefined {
  if (name === CREATE_ART) return 'art-request';
  if (name === SAVE_SHOW) return 'nanoleaf-show-save';
  if (!name.startsWith('control_')) return undefined;
  const family = name.slice(8).replaceAll('_', '-');
  return catalogFamily(family) && family !== 'nanoleaf-show-save' ? family : undefined;
}

const draft = text('The exact draft ID from the authoring or preview tool.');
const draftRevision = integer('The exact draft revision the owner requested, or the previewed revision if the owner did not specify one.');
const actions = Object.keys(assistantRoutes).filter(catalogFamily).filter(family => family !== 'nanoleaf-show-save' && family !== 'art-request');
export const catalogTools = [
  define(READ_HUB_GUIDE, 'read', 'Discover the Hub sources and read operations that answer current device, deadline and historical power questions.', {}),
  define(READ_DEVICE_HISTORY, 'read', 'Read a bounded page of observed power evidence and deterministic duration totals. Use the same query on later pages.', {
    source: text('Exact device owner from read_devices.'), target: text('Exact device ID from read_devices.'),
    period: {type: 'string', enum: ['', 'yesterday'], description: 'Use yesterday in the owner’s local timezone, or empty for explicit times.'},
    fromAtMs: integer('Inclusive epoch milliseconds, or zero for yesterday.'), toAtMs: integer('Exclusive epoch milliseconds, or zero for yesterday.'),
    cursor: text('Empty to start, or the most recent next cursor.'),
  }),
  define(READ_DEVICES, 'read', 'Find configured devices and observe their status and permitted commands. A named Wemo plug includes its Hub maximum-on timer status and time remaining. Use empty target to list. Return the exact owner and target to use for a control.', {
    target: text('Device name or ID, or empty to list.'), owner: text('Exact owner such as bunny/modules/pixoo, or auto to search installed owners.'),
  }),
  define(READ_PLAYBACK, 'read', 'Read presented playback, current controls and observation time.', {}),
  define(READ_VACUUM, 'read', 'Read Roborock vacuum status. The integration offers no cleaning controls.', {}),
  define(READ_VOLCANO, 'read', 'Read Volcano observations and the app’s session-gap setting. Equipment controls are unavailable.', {}),
  define(CREATE_ART, 'command', 'Propose creating one artwork to include in this reply. Requires owner approval before paid generation. Use only when asked for new artwork. It sends nothing to displays.', {
    format: {type: 'string', enum: ['still', 'gif'], description: 'A still image or animated GIF.'},
    showTargets: {type: 'array', items: {type: 'string'}, description: 'Display names the owner requested for a separate presentation once ready. Use [] for chat alone. Only include browser for an explicit dashboard presentation.'},
    description: text('A short visual description of the requested artwork, used for generation and to describe the image. Include only details the owner wants illustrated.'),
  }),
  define(READ_ART, 'read', 'List saved artwork IDs, usable rendition kinds, and exact configured destinations. Use the routing ID of an eligible destination for a show.', {}),
  define(READ_SHOWS, 'read', 'List saved shows, drafts, or lighting sessions in pages. A draft cannot play.', {
    view: {type: 'string', enum: ['saved', 'drafts', 'lighting'], description: 'Which records to read.'},
    id: text('Exact show, draft or light ID for details, or empty to list.'),
    offset: integer('Use zero to start and nextOffset for the next page.'),
  }),
  define(READ_OPERATION, 'read', 'Read a tracked command result, including evidence and error. Acceptance alone does not confirm the effect.', {requestId: text('Exact operation ID from the tracked action.')}),
  define(READ_ART_EFFECTS, 'read', 'Read per-display preparation and presentation operations for a tracked saved-art show.', {requestId: text('The art-show operation ID.')}),
  define(CREATE_SHOW, 'draft', 'Create a private, editable light-show draft from the chosen starting timeline. Send no lighting command.', {
    name: text('The requested show name.'), starter: {type: 'string', enum: ['ocean', 'warm'], description: 'The starter timeline.'},
  }),
  define(EDIT_SHOW, 'draft', 'Edit one cue in a private light-show draft. Send no lighting command.', {
    draftId: draft, revision: draftRevision, cue: text('Exact cue ID.'), changes: text('JSON object with some of offsetMs, durationMs, intensity, recipe. Recipe fields include pattern, colors, speed, loop, direction.'),
  }),
  define(PREVIEW_SHOW, 'read', 'Preview the draft as a cue storyboard. Send no lighting command.', {draftId: draft}),
  define(SAVE_SHOW, 'command', 'Save the requested draft as an immutable catalog version. Sends no lighting command.', {
    draftId: draft, revision: draftRevision, versionName: text('Name of this saved version.'),
  }),
  ...actions.map(family => define(catalogTool(family), 'command',
    family === 'art-show' ? 'Show the requested saved artwork on all requested display targets. Use hub and bunny/core, with artworkId and targets. Keep status visible with coversStatus=false when requested.'
      : family === 'music-lighting-control' ? 'Use start-show with showId and version on an eligible Nanoleaf light, or stop, pause-show, resume-show, or seek-show for the current generation. Use bunny/core.'
      : family === 'moment-play' ? 'Play a named mood on a configured display. For an immediate moment, ask only for missing display, mood, or duration. Use {} in arguments for this immediate form.'
        : `Run ${family} on a configured, supported target only when explicitly requested by the owner.`, {
    owner: text('The exact owner source returned by the read tool.'), target: text('Exact target ID, or its label if unambiguous.'),
    arguments: text(`JSON object with the appropriate owner command fields: ${assistantRoutes[family].fields}. Do not supply revision or generation guards.`),
  })),
] satisfies readonly ToolDefinition[];
export const isCatalogTool = (name: string): boolean => catalogTools.some(tool => tool.name === name);
