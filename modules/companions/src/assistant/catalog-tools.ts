import {assistantRoutes, catalogFamily, catalogRoute, type CatalogFamily} from '@jimmie-potts/event-contracts/v2/assistant-actions';
import {catalogReferenceRoles, type CatalogReferenceRole} from './catalog-grounding.js';
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

const lightingControls = new Set<CatalogFamily>(['power-set', 'brightness-set', 'lifx-color-set', 'lifx-temperature-set']);

export const modelCatalogCommand = (family: CatalogFamily): boolean => family !== 'art-request' && !lightingControls.has(family);
export const draftMutation = (name: string): boolean => name === CREATE_SHOW || name === EDIT_SHOW;
export function modelCatalogTool(name: string): boolean {
  const family = catalogCommand(name);
  return draftMutation(name) || family !== undefined && modelCatalogCommand(family);
}

const draft = text('The exact draft ID or the draft name the owner supplied.');
const draftRevision = integer("Use the owner's exact draft revision when given, or -1 to bind the current revision.");
const actions = Object.keys(assistantRoutes).filter(catalogFamily).filter(family => family !== 'nanoleaf-show-save' && family !== 'art-request');
const QUANTITY = 'For a number, use {"kind":"absolute","amount":30,"literal":"30%","unit":"percent"}. Copy the complete signed quantity including its adjoining unit into literal. If the owner supplies a unit separately, copy it into unit. Never replace an unsupported owner unit with a supported one. Use startingLiteral for a separate starting value. Omit literal for qualitative settings. Ask when the value or unit is unclear.';
const BRIGHTNESS = `JSON with a percent field. ${QUANTITY} Use increase or decrease for percentage points, increase-percent or decrease-percent for a percentage of current brightness, and {"kind":"minimum"} or {"kind":"maximum"} for an extreme.`;
const TEMPERATURE = `JSON with a kelvin field. ${QUANTITY} Use increase for cooler and decrease for warmer, with the amount of change in Kelvin. Use minimum or maximum for the registered Kelvin extremes.`;
const COLOR = `JSON with hue in degrees and saturation in percent. Each field uses a whole number or an absolute quantity. ${QUANTITY}`;
export const catalogTools = [
  define(READ_HUB_GUIDE, 'read', 'Discover the Hub sources and read operations that answer current device, deadline and historical power questions.', {}),
  define(READ_DEVICE_HISTORY, 'read', 'Read a bounded page of observed power evidence and deterministic duration totals. Use the same query on later pages.', {
    source: text('Exact device owner from read_devices.'), target: text('Exact device ID from read_devices.'),
    period: {type: 'string', enum: ['', 'yesterday'], description: 'Use yesterday in the owner’s local timezone, or empty for explicit times.'},
    fromAtMs: integer('Inclusive epoch milliseconds, or zero for yesterday.'), toAtMs: integer('Exclusive epoch milliseconds, or zero for yesterday.'),
    cursor: text('Empty to start, or the most recent next cursor.'),
  }),
  define(READ_DEVICES, 'read', 'Find configured devices and observe their status and permitted commands. A named Wemo plug includes its Hub maximum-on timer status and time remaining. Use empty target to list. Return the exact owner and target to use for a control.', {
    target: text('Device name or ID, or empty to list. Use id:<device-id> to match only that ID.'), owner: text('Use auto when the owner is unknown. Otherwise use the exact owner source, such as bunny/modules/pixoo.'),
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
    draftId: draft, revision: draftRevision, cue: text('Exact cue ID or a one-based cue number written as a string.'), changes: text('JSON object with some of offsetMs, durationMs, intensity, recipe. Recipe fields include pattern, colors, speed, loop, direction.'),
  }),
  define(PREVIEW_SHOW, 'read', 'Preview the draft as a cue storyboard. Send no lighting command.', {draftId: draft}),
  define(SAVE_SHOW, 'command', 'Save the requested draft as an immutable catalog version. Sends no lighting command.', {
    draftId: draft, revision: draftRevision, versionName: text('Name of this saved version.'),
  }),
  ...actions.map(family => define(catalogTool(family), 'command',
    family === 'art-show' ? 'Show the requested saved artwork on all requested display targets. Use hub and bunny/core, with artworkId and targets. Keep status visible with coversStatus=false when requested.'
      : family === 'music-lighting-control' ? 'Use start-show with showId and version on an eligible Nanoleaf light, or stop, pause-show, resume-show, or seek-show for the current generation. Use bunny/core.'
      : family === 'moment-play' ? 'Play a named mood on a configured display. For an immediate moment, supply mood and durationMs and optionally palette and coversStatus. Ask for a missing display, mood or duration.'
      : family === 'scene-activate' ? 'Activate the saved scene the owner requests. Use the scene name directly when the owner gives one. The Hub resolves it on the selected light under current grants. If the scene is missing or ambiguous, ask the owner for clarification. The Hub sends nothing for an unresolved scene.'
        : `Run ${family} on a configured, supported target only when requested in the current owner turn. Interpret ordinary language; never ask the owner for a JSON payload.`, {
    owner: text('The exact owner source returned by the read tool.'), target: text(family === 'playback-control' ? 'Use the requested playback ID, or auto for the unique presented playback record.' : family === 'brightness-set' ? 'Use the device ID returned by read_devices. id:<device-id> also selects that exact ID. An unambiguous label is accepted.' : 'Exact target ID, or its label if unambiguous.'),
    arguments: text(family === 'brightness-set' ? BRIGHTNESS : family === 'lifx-temperature-set' ? TEMPERATURE : family === 'lifx-color-set' ? COLOR
      : family === 'scene-activate'
      ? 'JSON object with sceneId. Supply the owner’s exact scene name, exact scene ID, or "last-activated" when the owner asks for the last activation on the selected light. Include the matching scene reference. The Hub supplies revision and generation guards.'
      : `JSON object with the appropriate owner command fields: ${assistantRoutes[family].fields}. Do not supply revision or generation guards.`),
  })),
] satisfies readonly ToolDefinition[];
export const isCatalogTool = (name: string): boolean => catalogTools.some(tool => tool.name === name);

const references = {
  type: 'array', description: 'Interpret each current target mention and quote its exact words. Include primary and nested selections and exclusions. ' +
    'Use [] only for a fixed route without a selected record. If an owner target cannot be resolved, ask before calling a control.',
  items: {type: 'object', properties: {
    role: {type: 'string', enum: catalogReferenceRoles, description: 'primary is the device or record. Use the specific role for an existing nested target.'},
    kind: {type: 'string', enum: ['named', 'prior', 'last-activated'], description: 'Use named for a current name or ID, prior for a reference to an earlier owner selection, or last-activated for a scene activation history request. For last-activated supply sceneId as last-activated.'},
    disposition: {type: 'string', enum: ['select', 'exclude'], description: 'Select the requested target. Exclude any target the owner rules out. A missing selected name stays selected and must never be replaced with an excluded or older target.'},
    source: {type: 'string', enum: ['request', 'answer'], description: 'Current owner request or its current clarification answer.'},
    quote: text('The complete name or reference for this role, copied verbatim from that owner message. Include an owner name if the owner used it to qualify the device.'),
  }, required: ['role', 'kind', 'disposition', 'source', 'quote'], additionalProperties: false},
} as const satisfies ToolInputSchema['properties'][string];
export function catalogToolWithReferences(tool: ToolDefinition): ToolDefinition {
  if (!modelCatalogTool(tool.name) || tool.name === CREATE_SHOW) return tool;
  return {...tool, description: `${tool.description} If the Hub refuses a target selection or it is unclear, ask the owner which target they mean. Do not substitute a target.`,
    input: {...tool.input, properties: {...tool.input.properties, references}, required: [...tool.input.required, 'references']}};
}

const nestedReferenceRoles: Partial<Record<CatalogFamily, readonly CatalogReferenceRole[]>> = {
  'art-catalog-edit': ['artwork'], 'art-show': ['artwork', 'primary'],
  'media-start': ['playlist'], 'music-lighting-control': ['draft'],
  'nanoleaf-favorite-edit': ['favorite'], 'nanoleaf-notice-acknowledge': ['session', 'notice'],
  'nanoleaf-reactive-preset-save': ['preset'], 'notice-clear': ['notice'],
  'pixoo-asset-change': ['asset'], 'pixoo-media-show': ['rendition'], 'pixoo-notice-dismiss': ['session', 'notice'],
  'pixoo-playlist-change': ['playlist', 'playlist-item', 'rendition'], 'scene-activate': ['scene'], 'wemo-hold-release': ['operation'],
};

export function catalogToolReferenceRoles(name: string): readonly CatalogReferenceRole[] {
  if (name === EDIT_SHOW) return ['draft', 'cue'];
  if (name === SAVE_SHOW) return ['draft'];
  const family = catalogCommand(name);
  if (family === undefined) return [];
  const nested = nestedReferenceRoles[family] ?? [];
  return catalogRoute(family).binding === 'fixed' ? nested : ['primary', ...nested];
}
