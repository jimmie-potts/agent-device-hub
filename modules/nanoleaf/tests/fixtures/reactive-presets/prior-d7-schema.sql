-- Schema emitted by initialize at d7d7213df069aa87d02a0e5c3f885d0577d04cfa on a fresh in-memory SQLite database.
CREATE TABLE activity (session TEXT PRIMARY KEY, turn TEXT, status TEXT, started REAL);
CREATE TABLE animation_favorites (name TEXT PRIMARY KEY, recipe TEXT NOT NULL);
CREATE TABLE comets (session TEXT NOT NULL, turn TEXT, queued REAL, source INTEGER, started REAL, device TEXT NOT NULL DEFAULT 'wall', PRIMARY KEY (device, session));
CREATE TABLE control_holds (device TEXT PRIMARY KEY, request_id TEXT NOT NULL, held_at_ms INTEGER NOT NULL);
CREATE TABLE control_journal (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, device TEXT NOT NULL, kind TEXT NOT NULL,
    command TEXT NOT NULL, mode_revision INTEGER NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('queued', 'attempting')),
    completed INTEGER NOT NULL DEFAULT 0, uncertain INTEGER NOT NULL DEFAULT 0, accepted REAL NOT NULL, expires REAL NOT NULL);
CREATE TABLE control_scenes (device TEXT PRIMARY KEY, scene_key TEXT NOT NULL, names TEXT NOT NULL);
CREATE TABLE display_v3 (id INTEGER PRIMARY KEY, snapshot TEXT, looping INTEGER, rendered REAL, device TEXT NOT NULL DEFAULT 'wall');
CREATE TABLE line_prefs (line_id TEXT NOT NULL, project TEXT, signature INTEGER DEFAULT 0, device TEXT NOT NULL DEFAULT 'wall', PRIMARY KEY (device, line_id));
CREATE TABLE locate (id INTEGER PRIMARY KEY, line_id TEXT, started REAL, device TEXT NOT NULL DEFAULT 'wall');
CREATE TABLE map_pending (id INTEGER PRIMARY KEY, payload TEXT, device TEXT NOT NULL DEFAULT 'wall');
CREATE TABLE map_settings (id INTEGER PRIMARY KEY, style TEXT, coverage TEXT, rotation INTEGER, flip_x INTEGER, flip_y INTEGER, device TEXT NOT NULL DEFAULT 'wall');
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE nanoleaf_show_catalog (id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
CREATE TABLE nanoleaf_show_versions (show_id TEXT NOT NULL, version INTEGER NOT NULL, version_name TEXT NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY (show_id, version));
CREATE TABLE nanoleaf_shows (id TEXT PRIMARY KEY, version INTEGER NOT NULL, name TEXT NOT NULL);
CREATE TABLE palette (role TEXT PRIMARY KEY,color TEXT NOT NULL);
CREATE TABLE projects (id TEXT PRIMARY KEY,name TEXT,color TEXT,roots TEXT);
CREATE TABLE receipts (session TEXT PRIMARY KEY, turn TEXT, completed REAL, observed INTEGER);
CREATE TABLE sessions (id TEXT PRIMARY KEY, turn TEXT, status TEXT, updated REAL);
CREATE TABLE shared_ack (id INTEGER PRIMARY KEY, payload TEXT, result TEXT);
CREATE TABLE shared_evictions (session TEXT, device TEXT, token TEXT NOT NULL, PRIMARY KEY (session,device));
CREATE TABLE shared_input (id INTEGER PRIMARY KEY, source TEXT, generation INTEGER, config TEXT, envelope TEXT, received REAL, connection TEXT, error TEXT, backup TEXT);
CREATE TABLE shared_stale (session TEXT PRIMARY KEY);
CREATE TABLE shared_suppressed_waves (session TEXT PRIMARY KEY, epoch REAL);
CREATE TABLE slots (session TEXT NOT NULL, slot INTEGER NOT NULL, device TEXT NOT NULL DEFAULT 'wall', PRIMARY KEY (device, session), UNIQUE (device, slot));
CREATE TABLE task_info (session TEXT PRIMARY KEY,title TEXT,cwd TEXT,project TEXT,manual_project TEXT,turn TEXT,started REAL);
CREATE TABLE waits (session TEXT, turn TEXT, key TEXT, kind TEXT, tool TEXT, PRIMARY KEY(session, turn, key));
CREATE UNIQUE INDEX display_v3_device ON display_v3 (device);
CREATE UNIQUE INDEX locate_device ON locate (device);
CREATE UNIQUE INDEX map_pending_device ON map_pending (device);
CREATE UNIQUE INDEX map_settings_device ON map_settings (device);
