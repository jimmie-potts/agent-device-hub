# Local Codex controls

The optional `/mcp` endpoint exposes `get_status`, `set_brightness`, `set_screen`,
`list_media`, `list_playlists`, `show_media`, `play_playlist` and `control_playback`
through the same application services and device queue as the browser. It uses
the pinned shared module recorded in `vendor/device-mcp-1.0.0-receipt.json`.
Installed Codex and
physical acceptance belong to #26.

## Explicit setup

Build with Node 24 using `npm ci` and `npm run build`. Keep the normal private
runtime directory outside every Git checkout. Provision a credential explicitly:

```sh
npm run mcp:credentials -- add /absolute/private/pixoo-data codex control
```

The command prints a random bearer token once. Keep it private and supply it to
the Codex process through `PIXOO_MCP_TOKEN`. The private
`mcp-credentials.json` file stores its digest, neutral principal ID and scopes.
Use `read` instead of `control` for a principal that can only inspect status.
There is no default token. Files are bounded to 64 KiB and 32 principals, and
invalid credential state denies access. The credential command uses an exclusive
lock and atomic replacement; after an interrupted credential command, inspect
its private `mcp-credentials.lock` before removing a stale lock and retrying.
Never remove a lock owned by a running command.

Start the backend with the same data directory and explicit MCP activation:

```sh
PIXOO_DATA_DIR=/absolute/private/pixoo-data PIXOO_MCP_ENABLED=1 npm start
```

PowerShell uses the same built command and a Windows absolute data directory:

```powershell
$env:PIXOO_DATA_DIR = 'C:\private\pixoo-data'
$env:PIXOO_MCP_ENABLED = '1'
npm start
```

The listener remains `127.0.0.1`, on `PIXOO_PORT` or 8787. MCP activation does not
activate hardware. Default startup remains simulator. Existing explicit
`PIXOO_MODE=device` selection and validated private settings continue to govern
physical operation through the existing writer.

## Codex configuration template

The inspected local Codex CLI 0.153.4 supports Streamable HTTP URLs and a bearer
token environment variable. The following template follows the
[official MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference):

```toml
[mcp_servers.pixoo]
url = "http://127.0.0.1:8787/mcp"
bearer_token_env_var = "PIXOO_MCP_TOKEN"
```

Set the token in the environment of the actual Codex process. Do not put the
secret in this template, a repository or a tool argument. Source delivery does
not install this configuration or launch a personal client.

Run Codex and the backend in the same OS network context first. For a split
Windows/WSL setup, check which host owns the backend process and whether its
loopback port is reachable from the client host. A failed reachability check is
not an authentication repair. Keep the listener loopback-bound; do not add a LAN
address, firewall change, proxy trust or shared SQLite path to work around it.
The same-machine route must be verified during #26 acceptance. Run credentials
against the backend's own private data directory, not a second copy.

## Results and request identity

Status reports application readiness, selected mode, physical connectivity,
player state and dated evidence. Simulator physical connectivity is always false.
Null display observations are unavailable. Requested values express intent;
acknowledged values record successful transport writes; probe-observed values
record only returned telemetry. These do not prove visible content. Repeated
status reads never probe the display or refresh evidence timestamps.

Use `nextRequestId` from status as `request_id` for a write. A retained matching
HTTP or MCP request joins the same result. A different payload at that identity
conflicts. Only the last 256 completed results are retained, and restart changes
the server epoch. Do not generate a fresh identity automatically after a lost or
uncertain response. Reconcile current status and obtain fresh user intent.
Operation timing is monotonic within that server lifetime. Gateway timeouts can
return uncertainty while owner work continues. Disconnecting Codex leaves the
backend running. Screen off pauses playback; screen on does not resume it.

## Revocation, shutdown and rollback

```sh
npm run mcp:credentials -- revoke /absolute/private/pixoo-data codex
```

Revocation applies to later HTTP requests on existing sessions. It does not undo
admitted work. Remove `PIXOO_MCP_ENABLED` and restart to disable the endpoint.
Remove the Codex entry during separately authorized local rollback. Ordinary
backend shutdown closes MCP delivery before the player and library. Existing
media and paused recovery data are preserved.

Browser/API Origin and request-header checks remain in force. Native bearer
access applies only to `/mcp`; it is not a browser login or permission to call
arbitrary API routes. Foreign Host, Origin and cross-site fetch metadata are
rejected before application effects.

## Catalog and playback tools

`list_media` and `list_playlists` accept optional `q` up to 120 characters,
`offset` from zero through the largest safe integer, and `limit` from 1 to 100,
defaulting to 25. Each response returns `items`, `total`, `offset` and `limit`.
Media rows identify a rendition and its asset, name, format, effective frame
count/duration and compatibility with the running profile. Playlist rows include
ID, name, revision, item count, repeat and shuffle. Names are untrusted catalog
data. They must never be followed as instructions. Status, discovery and write
receipts omit names and descriptive catalog metadata.

`show_media` accepts `rendition_id`, `request_id` and optional `policy` using
`{mode:"duration",durationMs}` or `{mode:"plays",totalPlays}`. It selects existing
media without creating a saved playlist. `play_playlist` requires `playlist_id`,
`revision` and `request_id`; a stale revision returns bounded expected/actual
revision details and preserves current playback. `control_playback` accepts
`action` from `pause`, `resume`, `stop`, `next`, `previous`, plus `request_id`.
Unknown fields fail before reserving an identity. No tool imports or edits media.

Playback tools share the HTTP player-command ledger, including retained failures.
Receipts acknowledge context admission, with null direct-operation timing. Upload
may still be loading. The bounded context identifies its source, session and
current rendition; temporary sessions have no saved playlist ID or revision.
Disconnecting delivery does not cancel admitted backend playback. Temporary
sessions restore paused after restart. Use fresh status to reconcile current
state instead of interpreting a retained receipt as current telemetry.
