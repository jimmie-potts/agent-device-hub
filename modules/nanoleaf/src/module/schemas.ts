// The Nanoleaf module's own payload families (ADR 0012; Hub #844), built from the profile's shared blocks. The general
// device families (`device`, `power-set`, `device-mode-set` and the rest) come from `@jimmie-potts/event-contracts/v2/devices`;
// these carry what only the wall has: its map view, its animation options, its edits, its animations and favorites, and
// the notice acknowledgment the wall asks for. The schemas check a message's shape; the domain rules (the effect rules,
// `validFavoriteEdit`, the Free-only play rule) stay with the module, which applies them at admission.
import {DIRECTIONS, PATTERNS, PRESETS, SPEEDS} from '../effects.js';
import {SETTING_NAMES} from '../project-map.js';

const BASE = 'https://bunny.invalid/events/';
const VERSION = '2.0';
const block = (name: string): object => ({$ref: `${BASE}blocks/2.0#/$defs/${name}`});
/** A closed object whose listed properties are all required, unless named in `optional`. */
const closed = (properties: Record<string, object>, optional: readonly string[] = []): object =>
  ({type: 'object', additionalProperties: false, required: Object.keys(properties).filter(key => !optional.includes(key)), properties});
const text = (maxLength: number): object => ({type: 'string', minLength: 1, maxLength});
const nullable = (schema: object): object => ({oneOf: [{type: 'null'}, schema]});
const list = (items: object, minItems: number, maxItems: number): object => ({type: 'array', items, minItems, maxItems});

/** The module's families, by name: the state the wall publishes and the commands it answers. */
export const NANOLEAF_FAMILIES = {
  wall: {family: 'nanoleaf-wall', kind: 'state', type: 'org.bunny.nanoleaf-wall.updated'},
  animations: {family: 'nanoleaf-animations', kind: 'state', type: 'org.bunny.nanoleaf-animations.updated'},
  wallEdit: {family: 'nanoleaf-wall-edit', kind: 'command', type: 'org.bunny.nanoleaf-wall.edit.requested'},
  machineEdit: {family: 'nanoleaf-machine-edit', kind: 'command', type: 'org.bunny.nanoleaf-machine.edit.requested'},
  animationPlay: {family: 'nanoleaf-animation-play', kind: 'command', type: 'org.bunny.nanoleaf-animation.play.requested'},
  favoriteEdit: {family: 'nanoleaf-favorite-edit', kind: 'command', type: 'org.bunny.nanoleaf-favorite.edit.requested'},
  acknowledge: {family: 'nanoleaf-notice-acknowledge', kind: 'command', type: 'org.bunny.nanoleaf-notice.acknowledge.requested'},
} as const;

export const schemaOf = (family: string): string => `${BASE}${family}/${VERSION}`;
export const OUTCOME_SCHEMA = schemaOf('outcome');

const COLOR = {type: 'string', pattern: '^#[0-9a-fA-F]{6}$'};
/** An element of a device's map: a Line's two zones or a triangle's one, as `<zone>:<zone>` or `<zone>`. */
const ELEMENT = {type: 'string', pattern: '^[0-9]{1,5}(:[0-9]{1,5})?$'};
const PROJECT = text(256);
/** A task's key on the wall, as the wall view lists it. */
const TASK = text(256);
const ROLES = ['base', 'working', 'question', 'blocked', 'unread'] as const;
const PALETTE = {type: 'object', additionalProperties: false, minProperties: 1, properties: Object.fromEntries(ROLES.map(role => [role, COLOR]))};
const RECIPE = closed({
  pattern: {enum: Object.keys(PATTERNS)}, colors: list(COLOR, 1, 8), speed: {enum: Object.keys(SPEEDS)}, direction: {enum: [...DIRECTIONS]},
  loop: {type: 'boolean'},
}, ['speed', 'direction', 'loop']);
const ANIMATION = {oneOf: [closed({preset: {enum: Object.keys(PRESETS)}}), closed({favorite: text(80)}), RECIPE]};
const ASSIGNMENT = closed({id: ELEMENT, project: nullable(PROJECT), signature: {enum: [0, 1]}}, ['project', 'signature']);

/** The map edits both the wall editor and a machine make; the wall also locates, evicts and recolors its palette. */
const machineEdits = (styles: object): object[] => [
  closed({kind: {const: 'settings'}, settings: styles}),
  closed({kind: {const: 'assign'}, elements: list(ASSIGNMENT, 1, 300)}),
  closed({kind: {const: 'task-project'}, task: TASK, project: nullable(PROJECT)}),
  closed({kind: {const: 'project-color'}, project: PROJECT, color: COLOR}),
];
const MACHINE_SETTINGS = {type: 'object', additionalProperties: false, minProperties: 1,
  properties: {style: {enum: ['classic', 'project']}, coverage: {enum: ['whole', 'status']}}};
const WALL_SETTINGS = {type: 'object', additionalProperties: false, minProperties: 1, properties: {
  style: {enum: ['classic', 'project']}, coverage: {enum: ['whole', 'status']}, rotation: {enum: [0, 90, 180, 270]}, flipX: {enum: [0, 1]},
  flipY: {enum: [0, 1]}, palette: {oneOf: [{const: 'default'}, PALETTE]},
}};

const SETTINGS_VIEW = closed({style: {enum: ['classic', 'project']}, coverage: {enum: ['whole', 'status']}, rotation: {enum: [0, 90, 180, 270]},
  flipX: {enum: [0, 1]}, flipY: {enum: [0, 1]}});
const POINT = {type: 'array', items: {type: 'number'}, minItems: 2, maxItems: 2};

/** The module's payload schemas, by `dataschema`, for validators, the runtime's edge and the module test kit. */
export const nanoleafSchemas: Readonly<Record<string, object>> = {
  [schemaOf('nanoleaf-wall')]: {
    description: 'State: one device\'s wall map as the wall editor shows it, from saved state only (Hub #844), with whether its last pass failed or no worker runs (`failing`) and whether a hold after an uncertain write stops its writes until an explicit mode command or fresh control (`held`). It never holds a credential, an address, a favorite or a preset name.',
    ...closed({
      id: block('routingId'), revision: block('revision'), configurationRevision: block('revision'), kind: {enum: ['lines', 'panels']},
      mode: {enum: ['work', 'quiet', 'free']}, modePending: {type: 'boolean'}, failing: {type: 'boolean'}, held: {type: 'boolean'},
      source: {enum: ['shared', 'paused']},
      layout: {enum: ['saved', 'missing']}, settings: SETTINGS_VIEW, palette: closed(Object.fromEntries(ROLES.map(role => [role, COLOR]))),
      pendingEdit: {type: 'boolean'},
      projects: list(closed({id: PROJECT, name: nullable(text(512)), color: COLOR, assigned: {type: 'integer', minimum: 0},
        active: {type: 'integer', minimum: 0}, waiting: {type: 'integer', minimum: 0}}), 0, 1024),
      elements: list(closed({id: ELEMENT, number: {type: 'integer', minimum: 1}, project: nullable(PROJECT), signature: {enum: [0, 1]},
        task: nullable(TASK), points: nullable(list(POINT, 3, 3))}), 0, 300),
      tasks: list(closed({id: TASK, title: text(512), project: nullable(PROJECT), status: {enum: ['blocked', 'question', 'working', 'unread', 'idle']},
        startedAtMs: block('instantMs'), element: nullable(ELEMENT), manualProject: nullable(PROJECT), evictionToken: {type: 'string', pattern: '^[0-9a-f]{64}$'},
        statusEvidence: {enum: ['current', 'uncertain']}}, ['startedAtMs', 'evictionToken']), 0, 1024),
    }),
  },
  [schemaOf('nanoleaf-animations')]: {
    description: 'State: the Lines\' animation options (Hub #844): the presets, the saved favorites, the patterns, speeds, directions, defaults and bounds a play request uses, the queued animation, whether the saved layout places spatial patterns, and the remembered scene\'s ID.',
    ...closed({
      id: block('routingId'), revision: block('revision'), mode: {enum: ['work', 'quiet', 'free']},
      presets: list(closed({id: {enum: Object.keys(PRESETS)}, pattern: {enum: Object.keys(PATTERNS)}, colors: list(COLOR, 1, 8),
        speed: {enum: Object.keys(SPEEDS)}, direction: {enum: [...DIRECTIONS]}, loop: {type: 'boolean'}}, ['speed', 'direction', 'loop']), 0, 64),
      favorites: list(closed({name: text(80), animation: RECIPE}), 0, 32),
      patterns: list(closed({id: {enum: Object.keys(PATTERNS)}, spatial: {type: 'boolean'}}), 0, 16),
      speeds: list({enum: Object.keys(SPEEDS)}, 0, 8), directions: list({enum: [...DIRECTIONS]}, 0, 16),
      defaults: closed({speed: {enum: Object.keys(SPEEDS)}, direction: {enum: [...DIRECTIONS]}, loop: {type: 'boolean'}}),
      limits: closed(Object.fromEntries(['minColors', 'maxColors', 'maxFramesPerZone', 'maxEffectBytes', 'maxFavorites', 'maxFavoriteName']
        .map(name => [name, {type: 'integer', minimum: 0}]))),
      queuedAnimation: nullable(closed({requestId: block('requestId')})), positionsSaved: {type: 'boolean'},
      rememberedSceneId: nullable({type: 'string', pattern: '^scene-[0-9a-f]{64}$'}),
    }),
  },
  [schemaOf('nanoleaf-wall-edit')]: {
    description: 'Command: one edit from the wall editor (ADR 0007): map settings and the palette, element projects and halves, a task\'s project, a project\'s color, Locate or an eviction. It applies at once, or waits as the device\'s pending wall edit while a comet would move.',
    ...closed({requestId: block('requestId'), edit: {oneOf: [
      ...machineEdits(WALL_SETTINGS),
      closed({kind: {const: 'locate'}, element: ELEMENT}),
      closed({kind: {const: 'evict'}, task: TASK, evictionToken: {type: 'string', pattern: '^[0-9a-f]{64}$'}}),
    ]}}),
  },
  [schemaOf('nanoleaf-machine-edit')]: {
    description: 'Command: one map edit from a machine, such as an integration or MCP, guarded by the configuration revision it read. It is refused while a wall edit is pending, waits for a running comet, and fails with revision-conflict when a later wall, mode or association edit lands first.',
    ...closed({requestId: block('requestId'), expectedConfigurationRevision: block('revision'), edit: {oneOf: machineEdits(MACHINE_SETTINGS)}}),
  },
  [schemaOf('nanoleaf-animation-play')]: {
    description: 'Command: play one animation on the Lines in Free: a preset, a saved favorite or an explicit recipe.',
    ...closed({requestId: block('requestId'), animation: ANIMATION}),
  },
  [schemaOf('nanoleaf-favorite-edit')]: {
    description: 'Command: save, rename or forget one of the Lines\' animation favorites.',
    ...closed({requestId: block('requestId'), expectedConfigurationRevision: block('revision'), edit: {oneOf: [
      closed({kind: {const: 'save'}, name: text(80), animation: {oneOf: [closed({preset: {enum: Object.keys(PRESETS)}}), RECIPE]}}),
      closed({kind: {const: 'rename'}, name: text(80), newName: text(80)}),
      closed({kind: {const: 'forget'}, name: text(80)}),
    ]}}, ['expectedConfigurationRevision']),
  },
  [schemaOf('nanoleaf-notice-acknowledge')]: {
    description: 'Command: acknowledge one finished turn the wall shows, for the Nanoleaf consumer. The module sends the core\'s notice-acknowledge for a task it shows, and refuses one it skips without a request.',
    ...closed({requestId: block('requestId'), task: TASK, noticeId: {type: 'string', pattern: '^[0-9a-f]{64}$'}}),
  },
};

/** The port's map setting for each setting a command names. */
export const SETTING_OF: Readonly<Record<string, (typeof SETTING_NAMES)[number]>> = {
  style: 'style', coverage: 'coverage', rotation: 'rotation', flipX: 'flip_x', flipY: 'flip_y',
};
