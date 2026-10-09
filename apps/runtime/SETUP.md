# Set up a fresh runtime

This is the fresh-cutover and manual-return procedure. The accepted
[#840 record](https://github.com/jimmie-potts/agent-device-hub/issues/840#issuecomment-6086298585)
owns the completed installation and its selected module/health exceptions.
This guide is not a qualified routine upgrade/rollback procedure; the legacy
`apps/hub/bin/hub-install.mjs` installer does not update `bunny-runtime.service`.
Select and qualify an owning runtime upgrade procedure before claiming an
installed delivery. Do not repeat fresh setup against existing runtime state.

This procedure prepares the existing WSL host for the owner-present cutover.
It starts with empty runtime state and manually selected configuration. It does
not transfer data or run the legacy migration tools. Keep the old installation,
its files and its releases intact for a manual return.

Source review and the disposable check below do not authorize installed
discovery, service changes, hook changes or device commands. Perform the installed
steps only in the agreed cutover window, with the owner and permitted targets.

## Choose the inputs

Record these choices privately before changing a service:

| Input | Required choice |
| --- | --- |
| Release | A full, reviewed Git revision with successful applicable CI, in its own clean checkout and built with Node 24. Keep that checkout and its dependencies in place while its service or hook uses them. |
| Node | The absolute executable for the version in the release's `.nvmrc`; obtain it with `fnm exec --using=.nvmrc -- node -p process.execPath` from that release. |
| Fresh state | A new absolute directory on the WSL filesystem, outside Git checkouts and `/mnt`, private to the runtime user. Never use an old module database or state root. |
| Fresh configuration | A new private `runtime-config/1.0` file and owner-selected private secret references, following [Configuration](README.md#configuration). Enter device addresses, routes and module settings explicitly. |
| Gateway | Loopback port 8788 after its old owner stops, preserving existing bookmark and hook addresses. |
| Credentials | An explicitly selected set of credential IDs, sources, digests and scopes in a new private [edge credentials file](README.md#credentials). Do not import or enumerate the old credential inventory. |
| Hook | The exact existing hook link, whether it targets a directory or file, its previous target and the complete script paths used by the selected clients. Qualify these paths and the selected producer files at cutover; do not guess them. |
| Writers | The exact old service units and any separately started processes that own the selected devices or port. Record their prior enabled/active states. |

The existing [boot setup](../hub/SETUP.md#start-the-runtime-at-boot) documents
`codex-nanoleaf-monitor`, `codex-nanoleaf-wall`, `codex-nanoleaf-controller`,
`codex-nanoleaf-mcp`, `pixoo-playlist-controller` and
`agent-device-hub-local-controllers` user services. This is a source inventory
to check with the owner, not proof of what is currently installed. Include any
other confirmed writer in the stop/return list. Leave unrelated services alone.

Use the module guides for the selected [Pixoo](../../modules/pixoo/README.md),
[Nanoleaf](../../modules/nanoleaf/README.md),
[playback](../../modules/playback/README.md), [LIFX](../../modules/lifx/README.md),
[Tidbyt](../../modules/tidbyt/README.md) and
[Codex Desktop](../../modules/codex-desktop/README.md) and
[Wispr](../../modules/wispr/README.md) sections. For Wispr, manually select the
collector's existing aggregate and diagnostics JSON files; leave the collector
and its published files unchanged. Browser exposure and text sharing start off. An omitted or
invalid section can refuse a module; a listening gateway alone does not prove
the desired modules started. Existing selected reader files remain read in
place within their permissions. Do not convert old rules, media, layouts,
settings, session labels or history. Add new content through the supported
settings/pages as needed; fresh state contains no historical records. Module
guides' physical-check examples are references for the owner's selected smoke
sequence, not a required webcam or exhaustive device campaign.

## Prepare the release and service

From the selected clean release, record `git rev-parse HEAD`, then run
`fnm exec --using=.nvmrc -- npm ci` and
`fnm exec --using=.nvmrc -- npm run build`. Use the repository's documented
temporary directory and shared caches. Do not reuse another revision's build.

Create a new `bunny-runtime.service` user unit only after confirming that name
has no other owner. Replace all uppercase placeholders below with the selected
absolute paths. This is a template; do not start it with placeholders intact.

```ini
[Unit]
Description=B.U.N.N.Y. runtime

[Service]
Type=simple
WorkingDirectory=RELEASE_DIRECTORY
ExecStart=NODE_EXECUTABLE RELEASE_DIRECTORY/apps/runtime/dist/src/main.js --port 8788 --state-dir FRESH_STATE_DIRECTORY --config FRESH_CONFIG_FILE --edge --environment production
Restart=on-failure
RestartSec=2
UMask=0077

[Install]
WantedBy=default.target
```

Use paths without spaces in this fixed-host example. The configuration and
secret files must satisfy the runtime's private-file checks. Do not put tokens
in the unit, command line, logs or evidence. The old Hub installer remains the
owner of the old installation; this procedure does not change its receipt or
invoke its upgrade, rollback or conversion commands.

## Switch in the owner-present window

1. Stop the confirmed old writers and prevent their automatic activation for
   this window. Preserve the units and their prior enablement choices. Confirm
   each selected unit is inactive with `MainPID=0`, each separately managed
   writer has exited, and the selected port has no old listener. If a writer's
   state is unknown, stop here; do not start a second writer.
2. Check that the selected state root is still new and that every device target
   and private credential reference is the owner's intended one. Keep the
   fresh roots separate from all old stores.
3. Run `systemctl --user daemon-reload`, then
   `systemctl --user start bunny-runtime.service`. Inspect its `ActiveState`,
   `MainPID`, `ExecStart` and `WorkingDirectory`. They must identify the selected
   Node executable and freshly built release. Compare the release's full Git
   revision with the recorded revision; do not infer the build from a bookmark.
4. Read `http://127.0.0.1:8788/api/runtime/v1/health`. Require `status: ok`, the
   expected core/modules running and healthy, and the lag check active. Inspect
   module refusals before continuing. Do not treat a successful HTTP response
   as successful module startup or physical acceptance.
5. Preserve the qualified hook link's shape and previous target. The documented
   directory link is invoked as `<link>/bin/monitor-hook.mjs`; point that link
   at the retained release's `apps/runtime` directory. If the selected client
   instead invokes a file link directly, point that file link at
   `apps/runtime/bin/monitor-hook.mjs`. Confirm the client's unchanged complete
   script path resolves to that file and its package import resolves from the
   retained release. The selected
   producer's ID/source and token digest must match its explicit new `ingest`
   grant; an unchanged producer file works only when that grant matches.
   See [Agent hooks](README.md#agent-hooks). Do not rewrite client permissions
   or discover credentials from unrelated files.
6. Open the existing dashboard bookmark, confirm a permitted new producer
   observation arrives, and perform only the owner's named device smoke
   sequence. Keep source identity, producer arrival, dashboard behavior and
   physical outcomes distinct. No data comparison, forced outage or soak is
   required. If these checks pass, enable the new unit for the chosen existing
   boot setup with `systemctl --user enable bunny-runtime.service`.

Record the selected revision, unit/path choices and check results privately.
Do not publish personal state, tokens or raw installation receipts.

## Return to the old installation

Stop and disable `bunny-runtime.service`. Confirm its process and listener are
gone before restarting an old writer. Restore the exact previous hook-link
target, then restore the old units' recorded enablement/active states and any
separately managed writers. Check their existing health and producer path.
Keep the fresh runtime state/configuration separately for diagnosis; do not
copy it into the old installation or remove old stores, units or releases.

## Check the source procedure with simulated devices

Use the existing [disposable run adapter](verify/README.md) from a clean,
built revision. Set `TMPDIR` and `APP_VERIFY_STATE_ROOT` to short, private WSL
disk paths outside every checkout; keep `APP_VERIFY_PROOF_ROOT` in the main
checkout's ignored `.local/evidence/` area. Use Node 24 via
`fnm exec --using=.nvmrc --` for each command below.

```text
npm run -s verify:runtime -- start --scenario shipped
npm run -s verify:runtime -- doctor <run-id>
npm run -s verify:runtime -- stop <run-id>
npm run -s verify:runtime -- doctor <run-id>
```

The shipped run creates fresh synthetic configuration/state and uses simulated
transports. Inspect the reported source identity and artifact match, running
core/module health, private-state and no-outbound checks. After stopping,
require clean cleanup and verify the owned processes/listeners are gone. Use
the supported adapter outputs, never dump `receipt.json` or credentials.
Do not use a migrated scenario for this fresh-setup check.

This proves the reviewed runtime starts fresh with its shipped simulated
modules. It does not exercise installed units, hook-link replacement, real
reader files or physical devices; those checks remain in the owner-present
window. The service template and manual return steps receive source review,
not a production-release or recovery campaign.
