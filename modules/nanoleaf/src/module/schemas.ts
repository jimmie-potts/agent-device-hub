// The Nanoleaf module's own payload families (ADR 0012; Hub #844), built from the profile's shared blocks. The general
// device families (`device`, `power-set`, `device-mode-set` and the rest) come from `@jimmie-potts/event-contracts/v2/devices`;
// these carry what only the wall has: its map view, its animation options, its edits, its animations and favorites, and
// the notice acknowledgment the wall asks for. The schemas check a message's shape; the domain rules (the effect rules,
// `validFavoriteEdit`, the Free-only play rule) stay with the module, which applies them at admission.
import {DIRECTIONS, PATTERNS, PRESETS, SPEEDS} from '../effects.js';
import {SETTING_NAMES} from '../project-map.js';
import {MUSIC_DIRECTIONS} from '../music-recipe-data.js';
import {REACTIVE_ID_PATTERN, REACTIVE_LIMITS, REACTIVE_SCHEMA, REACTIVE_TARGET} from '../music-preset-data.js';
import {SHOW_ID_PATTERN, SHOW_LIMITS, SHOW_TARGET} from '../music-show-data.js';
import {PLACEHOLDERS, RESTORES} from '../music-base.js';
import {MAX_MUSIC_CUES, MAX_MUSIC_DURATION_MS, MIN_MUSIC_CUE_MS} from '../music-timeline.js';

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
  reactivePresets: {family: 'nanoleaf-reactive-presets', kind: 'state', type: 'org.bunny.nanoleaf-reactive-presets.updated'},
  reactivePresetSave: {family: 'nanoleaf-reactive-preset-save', kind: 'command', type: 'org.bunny.nanoleaf-reactive-preset.save.requested'},
  shows: {family: 'nanoleaf-shows', kind: 'state', type: 'org.bunny.nanoleaf-shows.updated'},
  showSave: {family: 'nanoleaf-show-save', kind: 'command', type: 'org.bunny.nanoleaf-show.save.requested'},
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
const REACTIVE_ID = {type: 'string', pattern: REACTIVE_ID_PATTERN, maxLength: REACTIVE_LIMITS.id};
const MUSIC_BASE = {rendererVersion: {const: 1}, palette: list(COLOR, 1, 8), intensity: {type: 'number', minimum: 0, maximum: 1},
  sensitivity: {type: 'number', minimum: 0.1, maximum: 8}, smoothingMs: {type: 'number', minimum: 0, maximum: 2000}};
const musicRecipe = (explicit: boolean): object => ({oneOf: [
  closed({...MUSIC_BASE, effect: {enum: ['level-glow', 'ambient']}}, explicit ? [] : ['intensity', 'sensitivity', 'smoothingMs']),
  closed({...MUSIC_BASE, effect: {const: 'bass-pulse'}, halfLifeMs: {type: 'number', minimum: 100, maximum: 2000}}, explicit ? [] : ['intensity', 'sensitivity', 'smoothingMs', 'halfLifeMs']),
  closed({...MUSIC_BASE, effect: {const: 'spectrum'}, direction: {enum: [...MUSIC_DIRECTIONS]}}, explicit ? [] : ['intensity', 'sensitivity', 'smoothingMs', 'direction']),
  closed({...MUSIC_BASE, effect: {const: 'traveling-wave'}, direction: {enum: [...MUSIC_DIRECTIONS]}, periodMs: {type: 'number', minimum: 400, maximum: 10000}},
    explicit ? [] : ['intensity', 'sensitivity', 'smoothingMs', 'direction', 'periodMs']),
]});
const REACTIVE_PRESET = closed({schema: {const: REACTIVE_SCHEMA}, presetId: REACTIVE_ID, name: text(REACTIVE_LIMITS.name), recipe: musicRecipe(true)});
const SHOW_ID = {type: 'string', pattern: SHOW_ID_PATTERN, maxLength: SHOW_LIMITS.id};
const SHOW_VERSION = {type: 'integer', minimum: 1, maximum: SHOW_LIMITS.versions};
const SHOW_TIMELINE = closed({version: {const: 1}, durationMs: {type: 'integer', minimum: MIN_MUSIC_CUE_MS, maximum: MAX_MUSIC_DURATION_MS},
  cues: list(closed({id: {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'},
    offsetMs: {type: 'integer', minimum: 0, maximum: MAX_MUSIC_DURATION_MS},
    durationMs: {type: 'integer', minimum: MIN_MUSIC_CUE_MS, maximum: MAX_MUSIC_DURATION_MS},
    recipe: {oneOf: [closed({preset: {enum: Object.keys(PRESETS)}}), RECIPE]}, intensity: {type: 'number', minimum: 0, maximum: 1},
  }, ['intensity']), 1, MAX_MUSIC_CUES)});
/** A saved scene's opaque ID, as the device record's capabilities list it. */
const SCENE_ID = {type: 'string', pattern: '^scene-[0-9a-f]{64}$'};
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
  [schemaOf('nanoleaf-reactive-presets')]: {
    description: 'State: the bounded private library of frozen V1 reactive recipes. Metadata only.',
    ...closed({id: {const: REACTIVE_TARGET}, revision: block('revision'), presets: list(REACTIVE_PRESET, 0, REACTIVE_LIMITS.presets)}),
  },
  [schemaOf('nanoleaf-reactive-preset-save')]: {
    description: 'Command: save one immutable named reactive recipe against the current library revision. Metadata only.',
    ...closed({requestId: block('requestId'), presetId: REACTIVE_ID, expectedRevision: block('revision'), name: text(REACTIVE_LIMITS.name), recipe: musicRecipe(false)}),
  },
  [schemaOf('nanoleaf-shows')]: {
    description: 'State: private decorative show heads and immutable named version summaries; no media, device output or execution state.',
    ...closed({id: {const: SHOW_TARGET}, revision: block('revision'), shows: list(closed({id: SHOW_ID, name: text(SHOW_LIMITS.name), version: SHOW_VERSION,
      versions: list(closed({version: SHOW_VERSION, versionName: text(SHOW_LIMITS.name)}), 1, SHOW_LIMITS.versions)}), 0, SHOW_LIMITS.shows)}),
  },
  [schemaOf('nanoleaf-show-save')]: {
    description: 'Command: save one new immutable decorative version against the expected head; zero creates a show. Metadata only, with no device instruction.',
    ...closed({requestId: block('requestId'), showId: SHOW_ID, expectedVersion: {type: 'integer', minimum: 0, maximum: SHOW_LIMITS.versions},
      name: text(SHOW_LIMITS.name), versionName: text(SHOW_LIMITS.name), timeline: SHOW_TIMELINE}),
  },
  [schemaOf('nanoleaf-wall')]: {
    description: 'State: one device\'s wall map as the wall editor shows it, from saved state only (Hub #844), with whether its last pass failed or no worker runs (`failing`) and whether a hold after an uncertain write stops its writes until an explicit mode command or fresh control (`held`). `selection` is the light\'s last read selection (#1614): whether it is a scene saved on the light, by opaque scene ID, or the light\'s own placeholder, what a live Music ending over it would put back, and when it was read; `musicBase` is what the latest live Music session\'s ending puts back. It never holds a credential, an address, a favorite, a preset name or a scene name.',
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
        codexUrl: {type: 'string', pattern: '^codex://threads/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$'},
        statusEvidence: {enum: ['current', 'uncertain']}}, ['startedAtMs', 'evictionToken', 'codexUrl']), 0, 1024),
      selection: nullable(closed({saved: {type: 'boolean'}, sceneId: nullable(SCENE_ID), placeholder: nullable({enum: [...PLACEHOLDERS]}),
        restores: {enum: [...RESTORES]}, readAtMs: block('instantMs')})),
      musicBase: nullable(closed({generation: text(64), restores: {enum: [...RESTORES]}})),
    }, ['selection', 'musicBase']),
  },
  [schemaOf('nanoleaf-animations')]: {
    description: 'State: the device\'s animation options (Hub #844): the presets, the saved favorites, the patterns, speeds, directions, defaults and bounds a play request uses, the queued animation, whether the saved layout places spatial patterns, and the remembered scene\'s ID.',
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
      rememberedSceneId: nullable(SCENE_ID),
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
    description: 'Command: play one animation on Lines or NL22 Light Panels in Free: a preset, a saved favorite or an explicit recipe.',
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
