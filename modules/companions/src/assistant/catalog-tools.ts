import {assistantRoutes, catalogFamily, type CatalogFamily} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import type {ToolDefinition, ToolInputSchema} from './provider.js';

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
export const SAVE_SHOW = 'save_light_show';
export const MAX_CATALOG_ARGUMENTS = 4096;

const text = (description: string): {type: 'string'; description: string} => ({type: 'string', description});
const integer = (description: string): {type: 'integer'; description: string} => ({type: 'integer', description});
const define = (name: string, effect: ToolDefinition['effect'], description: string, properties: ToolInputSchema['properties']): ToolDefinition =>
  ({name, effect, description, input: {type: 'object', properties, required: Object.keys(properties), additionalProperties: false}});

export function catalogTool(family: CatalogFamily): string {
  return family === 'nanoleaf-show-save' ? SAVE_SHOW : `control_${family.replaceAll('-', '_')}`;
}

export function catalogCommand(name: string): CatalogFamily | undefined {
  if (name === SAVE_SHOW) return 'nanoleaf-show-save';
  if (!name.startsWith('control_')) return undefined;
  const family = name.slice(8).replaceAll('_', '-');
  return catalogFamily(family) && family !== 'nanoleaf-show-save' ? family : undefined;
}

const draft = text('The exact draft ID from the authoring or preview tool.');
const draftRevision = integer('The exact revision from the latest draft preview.');
const actions = Object.keys(assistantRoutes).filter(catalogFamily).filter(family => family !== 'nanoleaf-show-save');
export const catalogTools = [
  define(READ_DEVICES, 'read', 'Find configured devices and observe their status and permitted commands. Use empty target to list. Return the exact owner and target to use for a proposal.', {
    target: text('Device name or ID, or empty to list.'), owner: text('Exact owner such as bunny/modules/pixoo, or auto to search installed owners.'),
  }),
  define(READ_PLAYBACK, 'read', 'Read presented playback, current controls and observation time.', {}),
  define(READ_VACUUM, 'read', 'Read Roborock vacuum status. The integration offers no cleaning controls.', {}),
  define(READ_VOLCANO, 'read', 'Read Volcano observations and the app’s session-gap setting. Equipment controls are unavailable.', {}),
  define(READ_ART, 'read', 'List recent saved artwork IDs and their compositions.', {}),
  define(READ_SHOWS, 'read', 'List saved shows, drafts, or lighting sessions in pages. A draft cannot play.', {
    view: {type: 'string', enum: ['saved', 'drafts', 'lighting'], description: 'Which records to read.'},
    id: text('Exact show, draft or light ID for details, or empty to list.'),
    offset: integer('Use zero to start and nextOffset for the next page.'),
  }),
  define(READ_OPERATION, 'read', 'Read a tracked command result, including evidence and error. Acceptance alone does not confirm the effect.', {requestId: text('Exact operation ID from the approved action.')}),
  define(READ_ART_EFFECTS, 'read', 'Read per-display preparation and presentation operations for an approved saved-art show.', {requestId: text('The art-show operation ID.')}),
  define(CREATE_SHOW, 'draft', 'Create a private, editable light-show draft from the chosen starting timeline. Send no lighting command.', {
    name: text('The requested show name.'), starter: {type: 'string', enum: ['ocean', 'warm'], description: 'The starter timeline.'},
  }),
  define(EDIT_SHOW, 'draft', 'Edit one cue in a private light-show draft. Send no lighting command.', {
    draftId: draft, revision: draftRevision, cue: text('Exact cue ID.'), changes: text('JSON object with some of offsetMs, durationMs, intensity, recipe. Recipe fields include pattern, colors, speed, loop, direction.'),
  }),
  define(PREVIEW_SHOW, 'read', 'Preview the draft as a cue storyboard. Send no lighting command.', {draftId: draft}),
  define(SAVE_SHOW, 'command', 'Propose saving the current draft as an immutable catalog version. Requires approval and sends no lighting command.', {
    draftId: draft, revision: draftRevision, versionName: text('Name of this saved version.'),
  }),
  ...actions.map(family => define(catalogTool(family), 'command',
    family === 'art-show' ? 'Propose showing one saved artwork on exact display targets. Use hub and bunny/core, with artworkId and targets.'
      : family === 'music-lighting-control' ? 'Propose start-show with showId and version on an eligible Nanoleaf light, or stop, pause-show, resume-show, or seek-show for the current generation. Use bunny/core.'
      : `Propose ${family} on a configured, supported target. Requires owner approval.`, {
    owner: text('The exact owner source returned by the read tool.'), target: text('Exact target ID, or its label if unambiguous.'),
    arguments: text(`JSON object with the appropriate owner command fields: ${assistantRoutes[family].fields}. Do not supply revision or generation guards.`),
  })),
] satisfies readonly ToolDefinition[];
export const isCatalogTool = (name: string): boolean => catalogTools.some(tool => tool.name === name);
