# Run and maintain the personal B.U.N.N.Y. container

This is the small manual container profile for one operator. Mac Docker Desktop
is the normal target; Windows Docker Desktop is an alternate target with its own
qualification. It uses the existing Node 24 runtime and embedded stores. The
separate sealed-package prototype and installed WSL upgrade procedure remain
unchanged. This profile does not claim their acceptance or perform a live cutover.

Run the host commands below from the repository root with Node 24, Docker Desktop's
Linux engine and its Compose plugin available. Use an already built, reviewed
local image; the operator commands never pull or build one. Keep the operator
scripts and image at the same source revision.

## Manual operation after Mac sign-in

[ADR 0008](decisions/0008-runtime-hosting.md) selects the Mac Mini as the primary,
self-sufficient hub host. The PC is optional to its normal operation. This guide
operates the delivered container profiles; their qualification limits still apply.
The local browser profile below is loopback-only and runs the core plus only the
modules that reach no device. Production
remote-client and device operation require their own qualified profile and inputs;
do not enable them by weakening the local profile's admission rules.

Keep one selected release outside active development and preview checkouts: the
reviewed immutable image, matching operator scripts, owned Compose file, project
name and private state/config/secrets volumes. Record those identities privately.
Use the same explicit project and Compose selection for every operation. The
fresh-volume examples below are setup/rehearsal examples, not a daily startup
procedure for an existing instance.

1. After a Mac restart, unlock FileVault, sign in and start Docker Desktop's Linux
   engine. Waiting for the operator is accepted downtime; this procedure installs
   no unattended pre-login startup or automatic restart.
2. Select the existing owned instance and inspect its process state with the
   operator's `status`. Confirm the selected image and mounts before `start`.
   Never rerun fresh provisioning or create replacement empty volumes as a way
   to resume an existing personal instance.
3. Use `start`, then `status` and the runtime health command in
   [Start, stop and inspect](#start-stop-and-inspect). For the local browser profile,
   supply its owned `--compose LOCAL_COMPOSE` file every time and verify the actual
   rendered dashboard at its loopback URL. Docker process state alone is not health.
4. Before maintenance, use `stop` and verify the selected container is stopped
   with PID zero. Keep other operators and restart actors out of the window. Take
   and verify a [consistent backup](#back-up-a-stopped-instance), retaining the exact
   private configuration and external credentials separately.
5. For image replacement, assess the actual storage changes, select the reviewed
   replacement image and matching scripts manually, then follow
   [Replace an image](#replace-an-image). Preserve the previous image and latest
   state if the new start fails; do not assume an older reader can reopen changed
   stores.
6. For owner-selected recovery, preserve the failed/latest instance and state,
   state the snapshot's data gap and [restore into a separate empty instance](#restore-into-a-separate-empty-instance)
   at the archive's source revision. A partial restore stays stopped for inspection.
   There is no automatic snapshot restoration, format conversion or command replay.

This is not a WSL-to-Mac transfer recipe. The delivered restore requires the same
source revision and configuration/reference pairing; same-architecture acceptance
does not qualify cross-architecture transfer. The owning cutover must qualify the
actual stores, assets, native dependencies and host-specific paths. Stop and disable
old writers and their restart actors before making the Mac the selected device
writer, retaining the source for explicit manual return. A local lease cannot
exclude another computer. The [WSL upgrade procedure](../apps/runtime/UPGRADE.md)
continues to apply only to that established installation.

## Mac-local browser profile

The explicit `deploy/container/compose.local.yaml` profile serves the existing
dashboard at `http://127.0.0.1:18788/`. It requires an image built from source
that includes this profile; the earlier isolated image cannot supply it by
changing Compose alone. Device control is literal `disabled`, client credentials
are empty, MCP and the launcher are off, and restart remains manual. This creates
a persistent fresh core, not device or collector setup and not old-state adoption.

This is **trusted-local browser sign-in**, not password/identity verification.
The normal same-origin session flow issues its HttpOnly/SameSite=Strict cookie;
never print, copy or publish it. No API token is generated or imported. Another
program trusted on the host may access that local sign-in. The container socket
binds its private network interface, while allowed Host/Origin values remain
only `127.0.0.1:18788` and `localhost:18788` with the existing browser checks.
Only host `127.0.0.1:18788` is published. The dedicated `local` bridge is an ordinary
bridge, with outbound connectivity permitted, IPv6 disabled and not attachable;
no other container belongs on it. This is not an outbound-isolated profile. A reachable
container could forge Host/Origin headers, so this network is part of the trust
boundary. Do not attach Tronbyt, enable host networking, add ports, or widen the
host address. This profile supplies no LAN or remote-PC ingress.

Before creation, verify that project `bunny-mac-personal`, its `_state`, `_config`,
`_secrets` volumes and `_local` network do not exist, and port 18788 has no listener.
An access/connection error is not absence. Use another unused project name only
after reviewing its ownership; do not reuse retained acceptance resources.
Select the reviewed image ID and copy `compose.local.yaml` to an owned separate
file, changing only `image:` to that immutable ID. In the following commands,
replace `LOCAL_COMPOSE` and `IMAGE_ID` with that file and image. Use that same
file for every operator invocation, from the matching reviewed source checkout.

```text
docker compose -f LOCAL_COMPOSE -p bunny-mac-personal create --no-build --pull never core
node scripts/bunny.mjs status --project bunny-mac-personal --compose LOCAL_COMPOSE
```

Keep it stopped. Verify the image revision/user and actual resolved mounts,
network, exact loopback port, disabled control and no restart policy. These new
image-initialized volumes use UID1000, mode700 directories and mode600 files.
Provision only this new instance's public-shape browser config with the reviewed
one-shot helper. It refuses any non-seeded config, pre-existing credential file,
extra entry, unsafe mode or link; a partial failure is preserved for inspection
and cannot be blindly retried. Never use this command on existing personal volumes.

```text
docker run --rm --pull never --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --mount type=volume,source=bunny-mac-personal_config,target=/etc/bunny --mount type=volume,source=bunny-mac-personal_secrets,target=/run/secrets/bunny --entrypoint node IMAGE_ID /opt/bunny/deploy/container/provision-local.mjs
node scripts/bunny.mjs start --project bunny-mac-personal --compose LOCAL_COMPOSE
node scripts/bunny.mjs status --project bunny-mac-personal --compose LOCAL_COMPOSE
docker compose -f LOCAL_COMPOSE -p bunny-mac-personal ps -q core
docker exec CONTAINER_ID node /opt/bunny/deploy/container/entrypoint.mjs status
```

The helper writes `runtime-config/1.0` with `modules: {}` and an edge referring
to `/run/secrets/bunny/edge.json`, `browserAccess: trusted-loopback`, `launcher:
false`, `mcp: false`. The referenced `edge-credentials/1.0` document has an empty
`credentials` list. No private source is discovered or imported. Runtime startup
refuses device sections, another credential path or any client grant in this
browser-only profile. [Admitted module sections](#admit-a-module-that-reaches-no-device)
are the only addition it accepts. Normal core startup initializes its own private state.

Open the local URL and use its existing sign-in. Require actual rendered core
navigation and healthy core-only status, not just a listening port. Verify actual
Docker metadata has one effective loopback TCP binding, one ordinary project-only network
and no other attached container. Wrong Host and cross-origin requests must refuse.
If isolation differs, stop only this new owned instance and preserve its volumes
for inspection. The operator checks configured admission before start and effective
publication after it; it also
retains a stop path when an owned profile has a bad binding. Do not widen access
to repair a failed browser test.

Use the ordinary manual stop/status and named-volume backup below, supplying
`--compose LOCAL_COMPOSE` every time. The operator permits only this exact opted-in
binding/network; all private volume, stopped/PID-zero, image, lease, integrity and
empty-restore checks remain. Maintenance workers still run with network `none`.
For a requested separate restore, use an unused project, the same local Compose
and image, and the same fresh public-shape provisioning before restore; do not
start its target before restoration. No restore or migration is part of initial
everyday activation. PC stays stopped until a separately selected manual handoff.

### Admit a module that reaches no device

The profile keeps device control disabled. It accepts a section in the private
`runtime.json` only for a shipped module that declares no device simulation, and
it starts the core and each module that has a section, in shipped order. Today
those modules are `companions` and `wispr`. Startup refuses with the fixed
refusal, before state effects, for:

- a section for a shipped module that declares a device simulation, or for an
  unknown name;
- a section with a `secrets` member;
- a section whose module starts after a module without a section;
- an accepted configuration that names a device.

A future module that sends device commands without declaring a simulation needs
review against this rule before it ships. Device modules on the Mac wait for the
one-writer cutover in [Hub #568](https://github.com/jimmie-potts/agent-device-hub/issues/568).

The stopped backup below accepts an absolute path in `runtime.json` only under
`/run/secrets/bunny`, and it records each such file. Any other absolute path
makes every later backup refuse until the section is removed. `companions` needs
no path. `wispr` needs two absolute source-file paths, and this profile mounts
no Wispr source, so it is admitted by the rule but has no qualified source here.
Do not configure it on this profile until a source mapping is qualified.

Adding a section is the owner's manual private edit; the provisioning helper still
writes `modules: {}`. Keep the complete new `runtime.json` outside every checkout
and cloud-sync folder. Its edge section stays exactly as provisioned. Stop the
profile and take the stopped backup below. Then replace the file through a
one-shot container that mounts only the config volume. The script prints a fixed
refusal for input that is not JSON and syncs the file and its directory:

```text
docker run --rm -i --pull never --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --mount type=volume,source=bunny-mac-personal_config,target=/etc/bunny --entrypoint node IMAGE_ID -e "const fs=require('node:fs');let next;try{next=JSON.stringify(JSON.parse(fs.readFileSync(0,'utf8')));}catch{console.error('refused: the input is not JSON');process.exit(2);}const file=fs.openSync('/etc/bunny/runtime.json.next','wx',0o600);fs.writeFileSync(file,next);fs.fsyncSync(file);fs.closeSync(file);fs.renameSync('/etc/bunny/runtime.json.next','/etc/bunny/runtime.json');const dir=fs.openSync('/etc/bunny','r');fs.fsyncSync(dir);fs.closeSync(dir);" < PRIVATE_RUNTIME_JSON
```

Start the profile with the operator, then read health. It must list `core`
running and each admitted module. A module that refuses its section or fails to
start shows `refused` or `failed`. The core and the other modules keep running,
and health is `degraded`, so `entrypoint.mjs status` exits non-zero until the
owner fixes or removes that section. To remove a module, write the file again
without its section. Its private state stays in the state volume. An image from
before this rule refuses any section, so remove every section before returning
to such an image.

### Replace the initial stopped profile without replacing its data

If the initial internal-network attempt was already created, its network cannot
be changed in place. Replace only that new profile's stopped container and
dedicated network after the owner approves the ordinary-bridge arrangement.
Do not use `down -v`, `rm -v`, prune, or remove any data volume.

First select the reviewed replacement image and matching source, and prepare the
separate Compose file as above. Use operator `stop` and `status`; independently
inspect the exact old container ID, project/service labels, PID zero, stopped
state and `restart=no`. Record its three named mounts and confirm they are
distinct ordinary local volumes with the expected read/write directions. Inspect
the exact old project network ID and require zero attached containers. An
unexpected owner, member, running process or Docker read error stops replacement.

Only after those checks, remove that exact stopped container with `docker rm
OLD_CONTAINER_ID` (without `-v`) and that exact empty network with `docker network
rm OLD_NETWORK_ID`. Retain the recorded image and all three volumes. Recreate the
same project with the new Compose file:

```text
docker compose -f LOCAL_COMPOSE -p bunny-mac-personal create --no-build --pull never core
node scripts/bunny.mjs status --project bunny-mac-personal --compose LOCAL_COMPOSE
```

Verify the recreated container uses exactly the recorded state/config/secrets
volumes and the selected immutable image. Do not run the fresh-provisioning helper
again, import credentials or replace configuration. This profile change does not
change the runtime storage format. Start only after source review, then verify
actual `NetworkSettings.Ports`, browser access, core health and strict local
admission. Preserve the data and stop the new profile if verification fails.

## Replace an image

`start` resumes the selected existing container; it does not apply a changed
Compose image. First stop and verify PID zero, take and verify a consistent
backup, and assess the replacement's actual storage changes as described above.
Record the exact owned container ID, immutable image ID, project/service labels,
state/config/secrets volume names and network. Keep the old image and backup.

Prepare the owned Compose file with the reviewed replacement image ID and use
operator scripts from that same revision. Remove only the verified stopped
container with `docker rm OLD_CONTAINER_ID`, without `-v`. Retain its volumes and
network. Recreate the same project using that Compose file's `create --no-build
--pull never core`, as in the selected profile's creation example. Do not run
fresh provisioning again. Before starting, inspect that the new container uses
exactly the recorded private volumes, intended image, network, admission settings
and `restart=no`; stop on an ownership mismatch or an unreadable result.

Use the operator's explicit project/Compose selection to start, then verify
process state, runtime health and the selected client path. If verification fails,
stop the owned replacement and preserve its latest state for diagnosis. Returning
to an old image or snapshot requires the separate compatibility and recovery
decision above; deleting volumes is never part of ordinary replacement.

## Prepare private persistent volumes

The examples use `bunny-core:local` and two new project names: `bunny` and
`bunny-restore`. Choose unused names so existing state and configuration stay
intact. Inspect the selected image before creating either instance:

```text
docker image inspect bunny-core:local
docker compose -f deploy/container/compose.yaml -p bunny create --no-build --pull never core
```

Check the image's full `org.opencontainers.image.revision`, architecture and
`1000:1000` user. If the reviewed image has a different local tag or image ID,
copy `deploy/container/compose.yaml` to a separate file and change only its
`image:` value. Use `-f FILE` for every Compose command and `--compose FILE` for
every operator command below, on both the source and restore projects. Do not
replace an unrelated image tag or use a different revision for restore.

`create` leaves the container stopped. Docker initializes its three new named
volumes from the image's private directories: state, configuration and secrets,
owned by UID 1000 with mode 700. The initial `runtime.json` is mode 600 and contains
`{"schema":"runtime-config/1.0","modules":{}}`. This is sufficient for the
core-only health path; no real credentials or device configuration are supplied.
Use `docker compose -f deploy/container/compose.yaml -p bunny ps -a` to inspect
the stopped container. Never remove volumes to repair an ordinary startup failure.

## Start, stop and inspect

Start the prepared instance and inspect its process state:

```text
node scripts/bunny.mjs start --project bunny
node scripts/bunny.mjs status --project bunny
```

The Compose service is `core`, running as `1000:1000`, with no automatic restart
and no published ports. Its listener is `127.0.0.1:8788` inside the container.
`status` reports Docker process state; it does not claim runtime health. For a
running instance, get its single `core` container ID, then replace `CONTAINER_ID`
in the health command with that ID:

```text
docker compose -f deploy/container/compose.yaml -p bunny ps -q core
docker exec CONTAINER_ID node /opt/bunny/deploy/container/entrypoint.mjs status
```

Require a successful health command and the real `core` module in `running` state.
If it is still starting, inspect again before treating startup as healthy.
Stop explicitly when finished with `node scripts/bunny.mjs stop --project bunny`.
Authenticated workflow probes also run inside it using explicitly supplied
credentials. A browser on the host cannot reach this internal-only listener.

The fixed locations are:

| Location | Purpose |
| --- | --- |
| `/opt/bunny` | Reviewed image source and build |
| `/var/lib/bunny` | Private persistent state volume, read/write |
| `/etc/bunny/runtime.json` | Existing `runtime-config/1.0`, config volume mounted read-only |
| `/run/secrets/bunny` | Explicit existing credential files, volume mounted read-only |

Keep directories mode 700 and files mode 600, owned by UID 1000. Configuration
can omit the edge for core health; authenticated sessions need its explicit
credential reference. The isolated acceptance rehearsal provisioned synthetic
`edge-credentials/1.0` files at `/run/secrets/bunny/edge.json` and identical
configuration/reference bytes in the source and separate restore volumes before
either runtime started. Its config used
`"edge":{"credentials":"/run/secrets/bunny/edge.json"}`. That rehearsal does not
provision an installed client or real credentials. Keep existing private
configuration and its exact external reference files separately available; never
put them in the image, checkout or command output. No credential is generated by
the operator commands. The image starts with device control disabled and
instantiates only the real session core.
Enabling shipped modules is an explicit separate configuration choice.

Before enabling device control on another host, manually stop and verify the old
host's device writer, including any restart actor. The local state lease prevents
two cooperating processes from opening the same volume; it cannot prevent two
hosts with separate volumes from controlling one device. Do not use a copied
volume or a control flag as proof of a device handoff. An already accepted device
command can still finish; no maintenance command replays it.

## Back up a stopped instance

Use the same simple named-volume backup path on Mac and Windows. Choose a new
archive volume name distinct from both projects' state, config and secrets.
First check that it does not already exist; an existing volume must be preserved
and a different name selected. A connection/permission error is not evidence
that the name is unused.

```text
docker volume inspect bunny-archives
```

After Docker specifically reports that this volume does not exist, create it.
The first mount at the image's existing private `/var/lib/bunny` directory uses
Docker's image copy-up to initialize the new root as UID 1000, mode 700. The
unprivileged helper verifies that ownership, mode and emptiness; it does not
chown anything or bind a host path. Stop if it fails.

```text
docker volume create bunny-archives
docker run --rm --pull never --network none --read-only --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 --memory 4g --cpus 2 --mount type=volume,source=bunny-archives,target=/var/lib/bunny --entrypoint node bunny-core:local -e "const fs=require('node:fs'),assert=require('node:assert/strict');const s=fs.statSync('/var/lib/bunny');assert.equal(s.uid,1000);assert.equal(s.mode&511,448);assert.equal(fs.readdirSync('/var/lib/bunny').length,0)"
node scripts/bunny.mjs stop --project bunny
node scripts/bunny.mjs backup snapshot-1 --archive-volume bunny-archives --project bunny
```

Use the same selected image tag/ID for this helper if you changed the Compose
image. Reuse the archive volume for later snapshots, each with a new name;
do not repeat its empty-volume initialization after creating a snapshot.

The archive volume must already exist, use the local driver without driver options,
and be separate from state, configuration and secrets. Those three input volumes
must also be distinct local volumes without driver options. Provision its root as
UID 1000, mode 700 as above. The operator helper never creates or changes its
permissions. A snapshot name is a single relative name
starting with a letter or digit, followed only by letters, digits, dots, hyphens
or underscores (at most 128 characters). The worker mounts only that selected
archive volume at `/backup`, read-only for restore, with no host bind mount. All
archive integrity, state-lock and empty-target checks below still apply. Native
Windows host-directory export remains unsupported. This volume is local storage;
keeping it on the same Docker disk does not protect against loss of that disk.

Private POSIX-directory export is a separate Mac option: stop first, then use
`node scripts/bunny.mjs backup /ABSOLUTE/PRIVATE/BACKUPS/snapshot-1 --project bunny`.
The existing parent must belong to you, have mode 700, be reached without
symlinks and be outside every checkout. Native Windows host-directory export
remains refused pending ACL qualification; use the named-volume path above.

The helper inspects the exact selected container: stopped, no remaining PID,
no restart policy, expected private volume mounts and no published ports. A
one-shot worker from that exact image takes the runtime's existing SQLite state
lease. A competing runtime or maintenance worker refuses. Keep other operators,
Compose updates, legacy starts and restart actors out of this maintenance window.

The resulting directory archive contains `manifest.json`, `runtime.json` and
`state/`. It retains every regular private state file, including inactive module
data, SQLite WAL/journals, assets and internal request-digest keys. Keys stay
paired with their database and are checked through the SDK's existing verifier;
no missing key is generated. The empty core coordination file is recreated on
restore, and the launcher socket is omitted. Reading the held coordination file
would risk dropping its POSIX lock, so the backup never opens it.

External credentials are not copied. The private manifest records their selected
paths and hashes. Keep those exact private files separately available for restore.
This first profile accepts external configuration paths only under the selected
secrets root; host-local collectors, sockets and other external source mappings
need their owning follow-up qualification. It never exports a source directory
implicitly or rewrites configuration paths. Missing references refuse completion.

Files are copied with integrity checks and synchronized before success. Database
checks run on disposable copies so SQLite recovery cannot alter the archive.
An error leaves partial output for inspection and does not count as a backup.
Keep archives, manifests, keys and raw evidence private and outside Git, GitHub,
build contexts and shared artifacts. This local backup is not encrypted.

## Restore into a separate empty instance

Preserve the failed/latest instance and its state. Create a separate stopped
Compose instance with an empty state volume, the same reviewed source revision,
and the exact archived configuration and external credentials. Do not run the
new instance before restore. Copy configuration and credentials only through the
explicit private provisioning procedure; the helper does not discover or rotate
them. For an archive made with the unchanged seeded core-only configuration,
the new image-seeded config already matches and there are no external references.
For a customized archive, the exact private config/reference files must be
provisioned before restore; the default config cannot stand in for them.

Create a different, unused project with the same selected image. This creates
its private volumes without ever starting a runtime or initializing its state:

```text
docker compose -f deploy/container/compose.yaml -p bunny-restore create --no-build --pull never core
node scripts/bunny.mjs status --project bunny-restore
node scripts/bunny.mjs restore snapshot-1 --archive-volume bunny-archives --project bunny-restore
node scripts/bunny.mjs status --project bunny-restore
```

Require restore to report `status: complete` and `startup: stopped`; the subsequent
process status must still be stopped (`created` or `exited`). Do not run `start`
before restore. For the optional POSIX archive path, replace the restore arguments
with the absolute snapshot directory instead of `snapshot-1 --archive-volume ...`.

Restore validates the entire archive and configuration/reference pairing before
writing. It refuses a different source revision, corruption, unsafe files,
missing keys, occupied state or a previous partial restore. It then holds the
same state lease, writes `.restore-pending`, copies the state and verifies it.
Startup must refuse while that marker exists. Only a successful, synchronized
restore removes it. Failure leaves the partial target for inspection; preserve
it and use another empty target after correcting the cause. Never remove the
marker merely to make a partial restore start.

Restore leaves the instance stopped. Check it first with device control disabled
and inspect the selected records/assets. Snapshot restoration loses changes
since `createdAt` in the private manifest. State the actual data gap before an
owner-selected live handoff; retaining the original avoids destroying that later
state. There is no automatic rollback, schema conversion or command replay.

For the isolated core-only rehearsal, explicitly start the restored project,
check health using its own container ID, inspect retained records, then stop:

```text
node scripts/bunny.mjs start --project bunny-restore
docker compose -f deploy/container/compose.yaml -p bunny-restore ps -q core
docker exec CONTAINER_ID node /opt/bunny/deploy/container/entrypoint.mjs status
node scripts/bunny.mjs stop --project bunny-restore
```

Keep the original stopped instance and all its volumes. Do not enable another
host's device controller as part of this rehearsal.

For an ordinary image replacement, stop, take and verify a backup, select the
reviewed replacement manually, then start and check. Assess any actual storage
format change before starting it. Older readers are not assumed safe. The
established WSL installation still follows [its upgrade procedure](../apps/runtime/UPGRADE.md).

## Source validation

Build with Node 24, then run:

```text
npm run build
npm run lint:js
npm run typecheck
node --test scripts/tests/bunny.test.mjs scripts/tests/bunny-backup.test.mjs deploy/container/tests/context.test.mjs deploy/container/tests/entrypoint.test.mjs deploy/container/tests/runtime.test.mjs deploy/container/tests/provision-local.test.mjs
```

Linux tests exercise real lease contention, committed WAL records, retained
assets, database/key pairing, unsafe files, corrupt archives and interruption
with a pending marker. The host wrapper tests exact Docker selections. Actual
operator acceptance is separate from those source tests. At code revision
`b7d7e488f1c4c9087a6455cfd1030dd78f437e33`, Windows-hosted Linux AMD64 and
Mac-hosted Linux ARM64 each passed 47 focused Linux tests and an independent
10-check operator journey, including a stopped backup and restore into a separate
empty instance on that same architecture. The journey also checked authenticated
synthetic ingestion, anonymous refusal, restart persistence
with explicit uncertainty, and clean shutdown. These results do not qualify
transferring an archive between architectures, a native Windows/macOS core,
host browser access, real collectors/devices or live deployment. No full
verification harness is required for this lane.
