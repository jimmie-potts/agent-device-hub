// A synthetic Nanoleaf bridge state directory in the installed release's shape (Hub #933), for the migration's tests and
// the disposable run a reviewer migrates. It is built with the port's own code, which reproduces the bridge's: its schema
// (`initialize`, the bridge's `connect_state`, without the port's own journal tables and with the bridge's controller
// ledger and integration tables), its favorite saves, its layout discovery from the simulated controllers and its JSON
// writer. It holds the Lines (`wall`) and NL22 Light Panels (`panels`), with what the migration carries and what it
// leaves in the backup: tasks, reservations, comets, a Locate, display caches, epochs, a hold, the controller ledger, a
// legacy task backup, the shared-input configuration's `bindings`, and the rows of a device the registry no longer
// names. Every name, address, path and token is made up.
import {closeSync, mkdirSync, openSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {loadConfig} from '../configuration.js';
import {initialize} from '../database.js';
import {metaKey, sceneFile} from '../devices.js';
import {favoriteEdit} from '../favorites.js';
import {writeJson} from '../jsonfile.js';
import {LINES_ADDRESS, PANELS_ADDRESS, SimulatedNanoleaf, SYNTHETIC_TOKEN} from '../module/simulated.js';
import type {Source} from '../shared-input.js';
import {execute} from '../sqlite.js';

/** The bridge's own tables that the port's schema leaves out: the controller ledger and the integration API's. */
const BRIDGE_TABLES = `
  CREATE TABLE controller_credentials (principal TEXT PRIMARY KEY, digest TEXT NOT NULL, scopes TEXT NOT NULL, active INTEGER NOT NULL);
  CREATE TABLE controller_events (sequence INTEGER PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE controller_meta (id INTEGER PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE controller_requests (sequence INTEGER PRIMARY KEY, request TEXT NOT NULL, receipt TEXT NOT NULL, principal TEXT NOT NULL,
    phase TEXT NOT NULL, created REAL NOT NULL, mode_revision INTEGER NOT NULL);
  CREATE TABLE integration_meta (id INTEGER PRIMARY KEY, sequence INTEGER NOT NULL);
  CREATE TABLE integration_requests (sequence INTEGER PRIMARY KEY, principal TEXT, request TEXT, receipt TEXT, phase TEXT, created REAL, revision TEXT)`;

/** The qualified source the synthetic configuration names when the caller names none. */
export const SYNTHETIC_SOURCE: Source = Object.freeze({provider: 'codex', client: 'desktop', hostId: 'host-fixture', sourceId: 'source-fixture'});

export type SyntheticOptions = {
  /** Each device's address: the simulated controllers' by default. */
  addresses?: {wall?: string; panels?: string};
  /** Every device's token: the simulated controllers' synthetic token by default. */
  token?: string;
  /** The qualified sources the shared-input configuration names; `null` leaves shared input never configured. */
  qualifiedSources?: readonly Source[] | null;
  /** Codex Desktop's metadata paths in `config.json`, when given. */
  codexMetadata?: {path: string; titleIndexPath?: string};
};

/** What a synthetic state holds, for a test to compare a migration against. */
export type SyntheticNanoleafState = {
  devices: number; projects: number; palette: number; elements: number; mapSettings: number; pendingEdits: number; favorites: number;
  deviceState: number; layouts: number; scenes: number;
  /** What stays in the backup. */
  sessions: number; reservations: number; comets: number; bindings: number; unregistered: number;
  /** Every project, favorite and scene name, the addresses and the token, so a test can show that none reaches a report. */
  markers: string[];
};

/** Writes the synthetic state into `directory`, which must exist and be empty. */
export async function writeSyntheticNanoleafState(directory: string, options: SyntheticOptions = {}): Promise<SyntheticNanoleafState> {
  const wall = options.addresses?.wall ?? LINES_ADDRESS;
  const panels = options.addresses?.panels ?? PANELS_ADDRESS;
  const token = options.token ?? SYNTHETIC_TOKEN;
  const config: Record<string, unknown> = {
    ip: wall, token, 'token@panels': token, wall_port: 8765, controller_port: 41231, mcp_port: 41230,
    devices: {wall: {kind: 'lines', ip: wall, token_ref: 'token'}, panels: {kind: 'panels', ip: panels, token_ref: 'token@panels'}},
    ...(options.codexMetadata === undefined ? {} : {
      metadata_path: options.codexMetadata.path, ...(options.codexMetadata.titleIndexPath === undefined ? {} : {title_index_path: options.codexMetadata.titleIndexPath}),
    }),
  };
  writeJson(join(directory, 'config.json'), config);

  // Each device's layout, discovered from its simulated controller as the bridge's worker discovers it, and saved under the
  // layout lock as the bridge saves it.
  const controllers = new SimulatedNanoleaf({token, devices: {[wall]: 'lines', [panels]: 'panels'}});
  for (const device of ['wall', 'panels']) await loadConfig(directory, device, controllers.request);

  const db = new DatabaseSync(join(directory, 'status.sqlite'));
  try {
    initialize(db, () => 1_790_000_000);
    db.exec(`DROP TABLE control_journal; DROP TABLE control_scenes; ${BRIDGE_TABLES}`);
    db.exec('BEGIN IMMEDIATE');
    // Carried: projects and their colors, the palette, each element's project and halves, map settings, a pending wall edit,
    // favorites, and each device's mode, revisions and native overrides.
    const projects = [['project-alpha', 'Alpha Marker Project', '#aa55ff', '["/home/fixture/alpha"]'], ['project-beta', 'Beta Marker Project', '#123456', '[]'],
      ['project-gamma', 'Gamma Marker Project', '#00aa88', '["/home/fixture/gamma"]']] as const;
    for (const project of projects) execute(db, 'INSERT INTO projects (id,name,color,roots) VALUES (?,?,?,?)', ...project);
    execute(db, "INSERT INTO palette VALUES ('working','#11aa22'), ('unread','#cc33ff')");
    execute(db, "INSERT INTO line_prefs (line_id,project,signature,device) VALUES ('100:101','project-alpha',1,'wall'), ('102:103','project-alpha',0,'wall'), "
      + "('104:105','project-beta',1,'wall'), ('200','project-beta',0,'panels'), ('201','project-gamma',0,'panels')");
    execute(db, "UPDATE map_settings SET style='project',coverage='status',rotation=90,flip_x=1,flip_y=0 WHERE device='wall'");
    execute(db, "INSERT INTO map_settings (style,coverage,rotation,flip_x,flip_y,device) VALUES ('classic','whole',180,0,1,'panels')");
    execute(db, 'INSERT INTO map_pending (payload,device) VALUES (?,?)', '{"settings": {}, "lines": {"106:107": {"project": "project-gamma"}}, "tasks": {}}', 'wall');
    for (const [name, animation] of [['Marker Favorite Calm', {pattern: 'breathe', speed: 'slow', colors: ['#112233', '#445566']}],
      ['Marker Favorite Wave', {pattern: 'wave', speed: 'fast', direction: 'left', colors: ['#ff0000', '#00ff00', '#0000ff']}]] as const) {
      favoriteEdit(db, {kind: 'animation.save', name, animation: {...animation, colors: [...animation.colors]}}, true);
    }
    for (const [key, value] of [['mode', 'work'], ['mode_revision', '4'], ['mode_applied', '4'], ['controller_brightness', '40'],
      [metaKey('mode', 'panels'), 'quiet'], [metaKey('mode_revision', 'panels'), '2'], [metaKey('mode_applied', 'panels'), '1'],
      [metaKey('controller_power', 'panels'), '1']] as const) {
      execute(db, 'INSERT OR REPLACE INTO meta VALUES (?,?)', key, value);
    }

    // Left in the backup: live tasks and what follows them, epochs, caches, a hold, the ledger and the integration API.
    execute(db, "INSERT INTO sessions VALUES ('shared-task-1','t1','working',1789999000.5), ('shared-task-2','t1','unread',1789999100.0)");
    execute(db, "INSERT INTO activity VALUES ('shared-task-1','t1','working',1789999000.5)");
    execute(db, "INSERT INTO task_info VALUES ('shared-task-1','Marker Task Title','/home/fixture/alpha','project-alpha',NULL,'t1',1789999000.0)");
    execute(db, "INSERT INTO slots (session,slot,device) VALUES ('shared-task-1',0,'wall'), ('shared-task-2',1,'wall'), ('shared-task-1',0,'panels')");
    execute(db, "INSERT INTO comets (session,turn,queued,source,started,device) VALUES ('shared-task-2','t1',1789999100.0,1,NULL,'wall')");
    execute(db, "INSERT INTO receipts VALUES ('shared-task-2','t1',1789999100.0,1)");
    execute(db, "INSERT INTO locate (line_id,started,device) VALUES ('100:101',NULL,'wall')");
    execute(db, "INSERT INTO display_v3 (snapshot,looping,rendered,device) VALUES ('[]',0,1789999101.0,'wall')");
    execute(db, "INSERT INTO shared_stale VALUES ('shared-task-2')");
    for (const [key, value] of [['wave_cutoff', '1789998000.0'], ['event_revision', '42'], ['dirty', '1'], ['shared_wave_cutoff', '1789998500.0'],
      [metaKey('controller_hold_revision', 'panels'), '2'], [metaKey('control_error', 'panels'), 'Light update failed; retrying.']] as const) {
      execute(db, 'INSERT OR REPLACE INTO meta VALUES (?,?)', key, value);
    }
    execute(db, "INSERT INTO controller_credentials VALUES ('codex','0000000000000000000000000000000000000000000000000000000000000000','[\"read\"]',1)");
    execute(db, "INSERT INTO controller_meta VALUES (1,'{}')");
    execute(db, "INSERT INTO integration_meta VALUES (1,1)");
    // A device the registry no longer names: its rows and meta value stay in the backup.
    execute(db, "INSERT INTO line_prefs (line_id,project,signature,device) VALUES ('300','project-alpha',0,'old-panels')");
    execute(db, 'INSERT OR REPLACE INTO meta VALUES (?,?)', metaKey('mode', 'old-panels'), 'free');
    // Shared input, selected, with the 1.x feed's settings, legacy `bindings` and a legacy task backup.
    const sources = options.qualifiedSources === undefined ? [SYNTHETIC_SOURCE] : options.qualifiedSources;
    const shared = sources === null ? null : JSON.stringify({
      version: 1, ownerId: 'owner-fixture', consumerId: 'nanoleaf', endpoint: 'http://127.0.0.1:8788/api/monitor/v1', tokenFile: '/home/fixture/hub-token',
      clearOnNewTurn: true, qualifiedSources: sources, bindings: [{legacy: 'task-legacy-1', shared: 'shared-task-1'}, {legacy: 'task-legacy-2', shared: 'shared-task-2'}],
    });
    execute(db, "UPDATE shared_input SET source='shared',generation=3,config=?,envelope='{}',received=1789999100.0,connection='current',backup=? WHERE id=1",
      shared, '{"tasks": [["task-legacy-1", "t1", "working"]]}');
    db.exec('COMMIT');
  } finally {
    db.close();
  }

  // Each device's remembered scene, as the bridge's scene restorer saves it.
  writeJson(join(directory, sceneFile('wall')), {version: 1, scene: {name: 'Marker Scene Beach', brightness: 43}, owned: true, quiet_scene: null, quiet_brightness: null});
  writeJson(join(directory, sceneFile('panels')), {version: 1, scene: {name: 'Marker Scene Lights', brightness: 60}, owned: false,
    quiet_scene: 'Marker Scene Lights', quiet_brightness: 10});
  writeJson(join(directory, sceneFile('old-panels')), {version: 1, scene: null, owned: false, quiet_scene: null});
  // The workers' lock files, as each device's worker leaves them.
  for (const name of ['notification-lock.sqlite', 'notification-lock.panels.sqlite']) closeSync(openSync(join(directory, name), 'w', 0o600));
  mkdirSync(join(directory, 'hooks-backup'), {mode: 0o700});

  return {
    devices: 2, projects: 3, palette: 2, elements: 5, mapSettings: 2, pendingEdits: 1, favorites: 2, deviceState: 8, layouts: 2, scenes: 2,
    sessions: 2, reservations: 3, comets: 1, bindings: 2, unregistered: 3,
    markers: [wall, panels, token, 'Marker', '/home/fixture', 'task-legacy', 'owner-fixture'],
  };
}
