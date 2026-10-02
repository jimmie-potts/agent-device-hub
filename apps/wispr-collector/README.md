# Private Wispr collector

This Windows Node 24 CLI reads one explicitly configured local source and retains private analytics. The aggregate JSON boundary is the only input intended for the Hub in WSL. Neither SQLite database is a WSL input. Development uses synthetic data only; source delivery does not install or schedule collection.

The source profile uses the `History` table with `id`, `timestamp`, `status` and `numWords`; optional numeric fields are `duration`, `speechDuration`, `numWordsCorrected`, `numDictionaryReplacements` and `appName`. Required names/types must qualify. Unknown optional fields are ignored. Installed schema and duration/counter semantics need separate confirmation; unsupported fields never become known zeros. Numeric mode does not select transcript, context, audio or arbitrary source columns.

## Development checks

From the repository root with Node 24:

```sh
npm ci
npm run build
npm run typecheck
npm run test:wispr
npm run test:wispr:package
```

`test:wispr:built` runs synthetic pure, reader, store, contract and CLI checks against fresh build output. `test:wispr:package:built` verifies the extracted offline artifact and isolated contract consumer. These are development checks; they do not use an installed Wispr database.

`npm run test:wispr:native:built` must also run with native Windows Node 24 and synthetic files on a local Windows drive. It must fail, rather than skip and report success, on other platforms. Linux tests do not qualify Windows WAL, locks, ACLs or atomic replacement. See [development checks](../../docs/development.md#wispr-collector-checks) for the required evidence.


## Offline package and commands

Build `npm run package:wispr` on the development host. The reproducible
`artifacts/wispr-collector-1.0.0.tgz` contains compiled code, the shared contract,
pinned installed JavaScript dependencies, their licenses, a file-hash manifest
and synthetic checks. Compare its SHA256 sidecar before extracting. Extraction
needs no registry or network access. Supply native Windows Node 24 separately;
the package does not install Node, change PATH or register a task.

Run the extracted `package/dist/cli.js` with the selected Node executable.
Every command needs `--config` pointing to an owner-restricted JSON file outside
Git and cloud-synced directories. The source, state, config and exports must be
within the configured owner directory, on a fixed local Windows drive, without
symlink/junction redirects. Existing writable state, backups and export files
must not have hard links. Containment checks resolve Windows short-name aliases;
exports cannot replace the source, its SQLite sidecars or the config file.
Allowed Windows ACL principals are the current user,
SYSTEM and Administrators. The collector checks permissions; it never repairs
source permissions. Installation and access to personal data need separate owner
authorization.

Example config (paths are placeholders, not discovered Wispr locations):

```json
{
  "schemaVersion": "1.0",
  "namespace": "11111111-1111-4111-8111-111111111111",
  "ownerDirectory": "C:\\Users\\Owner",
  "sourcePath": "C:\\Users\\Owner\\ExplicitlySelectedSource\\source.sqlite",
  "stateDirectory": "C:\\Users\\Owner\\PrivateWisprAnalytics\\state",
  "timezone": "America/New_York",
  "collectionEnabled": false,
  "language": { "enabled": false }
}
```

Generate a new UUID for the source namespace at authorized setup, then keep it
stable. Set `collectionEnabled` explicitly before collecting. This numeric
collector rejects `language.enabled: true`; the language extension owns that
separate opt-in. The config must stay outside the state directory. State uses
fixed filenames `analytics.sqlite`, `control.json`, `aggregate.json` and
`status.json`; only the last two are intended for the authorized Hub reader.
Never open either SQLite database from WSL.

The following arguments follow `node package/dist/cli.js`:

| Command | Effect |
| --- | --- |
| `collect --config <file>` | One bounded source scan, retained contribution update and aggregate publication. |
| `status --config <file>` | Sanitized revision, generation, last attempt/success, health and store capacity. Completes a committed pending publication. |
| `export --config <file> --format json\|csv --output <file>` | Numeric aggregates only. Output must be a separate private path outside state, source and config. |
| `backup --config <file> --name <name>` | A consistent managed backup at `state/backups/<name>.sqlite`; refuses to overwrite an existing name. |
| `restore --config <file> --name <name>` | Restore numeric history from a backup in the current capture epoch. Never enables language collection. |
| `restore --config <file> --name <name> --historical-reimport` | Explicitly restore older captured backup records across a clear boundary. Other old source rows remain excluded. |
| `clear --config <file>` | Stop overlapping collection, advance generation, empty analytics and exclude source activity at/before this clear. |
| `clear-text --config <file>` | Stop overlapping collection, advance generation and remove text derivatives/managed text backups while keeping numeric history. |
| `reset --config <file> --historical-reimport` | Clear analytics and explicitly allow the next scan to import all eligible source history still available. |
| `rebind --config <file> --confirm-same-source` | Explicitly accept a replacement file as the same source history. |
| `zone --config <file>` | Rebuild retained numeric groups after explicitly editing the config's reporting timezone. |

Commands return JSON with fixed diagnostic codes. They do not print private
paths, row IDs or source values. Node may emit its standard experimental SQLite
warning; use Node's `--disable-warning=ExperimentalWarning` if desired. No command
schedules future work or contacts the Hub, a device or a network service.

## Failure and recovery

A run owns an exclusive SQLite lease until its direct worker exits. A second
ordinary command fails with `collector-busy`. Clear requests cancellation and
waits for the old worker to exit before taking ownership; a timeout does not
permit concurrent writes. A second worker lease prevents a surviving child from
writing alongside a new run after its supervisor crashes. The source read has a
10-second deadline and the full command a 60-second budget. Source limits are
100,000 rows and 256 MiB selected input; combined working memory is bounded at
512 MiB. The worker budget reserves the parent's RSS and 32 MiB; aggregation
checks its budget before committing. The private store cap is 1 GiB and a published snapshot is at most
16 MiB. Capacity failures preserve history. Status reports the store's size and
whether it has reached 90% of its cap. Resolve capacity deliberately; there is
no automatic eviction or backup rotation.

A failed read does not archive rows, change counts or advance last-success time.
An interrupted transaction rolls back. A committed pending revision is published
before another scan, so retrying does not duplicate counts. Aggregate replacement
uses a flushed temporary file beside the destination. If it fails, remove the
external lock or fix the private destination, then retry. Attempt status can be
newer than the aggregate; consumers must match namespace, generation and revision
and treat mismatches as unavailable. Do not use file modification time as freshness.
A failed attempt appears as a collection gap on the next complete snapshot.
Intervals longer than the planned five-minute collection cadence are marked
`not-observed`; these are observation gaps, not evidence of lost dictations or
zero usage. No rows deleted before first capture can be recovered.

Take a named backup before an intentional clear, reset or private schema change.
Keep enough disk capacity for another copy of the store; backup fails rather than
replacing an existing copy. State inspection is bounded to 256 direct entries and
128 backup entries. Move owner-managed archival copies out of the managed state
directory when necessary; those copies remain private and cannot be recalled by
clear. Do not copy an open analytics database manually. The backup command uses
SQLite's backup API and flushes the collector-owned output before its rename.

To recover after losing the working state, keep the same namespace and explicitly
selected source in a private config, choose a new empty state directory, create
its `backups` subdirectory and place the saved numeric backup there. Run
`restore --config <file> --name <name> --historical-reimport`. Recovery can run
while the source is offline. It establishes a current capture boundary and
restores only the approved backup's contributions. A subsequent scan needs the
same file identity or explicit rebinding. An existing analytics database without
its independent `control.json` fails closed: recover into a fresh directory
instead of inventing an old control file. Restoring a backup never rolls back
clear authority or silently restores text derivatives.

A changed source file identity produces `binding-mismatch`. Confirm whether it
is a replacement of the same history before using `rebind`. For a different
account or dataset, use a new namespace and a separate state directory. Disable
collection before switching Wispr accounts. An account change within the same
file is not detectable from the numeric allowlist; the collector never reads
login or session files to infer identity.

Clear never deletes Wispr history. Both clear receipts state that unmanaged
exports/backups cannot be recalled. Ordinary clear removes managed text-bearing
backups, advances the publication generation and preserves the capture fence on
restart. Numeric backups from before clear require explicit historical restore.
An explicit reset instead removes that capture fence for the next complete scan.

## Evidence boundaries

The package includes `tests/package-smoke.mjs`, which runs an internal synthetic
collect/export/status sequence outside the repository, and `tests/native-cli.mjs`,
which exercises the production CLI with a synthetic owner-restricted Windows
fixture. Native tests require `WISPR_TEST_TMPDIR` on a local Windows drive and
must use the qualified Windows Node 24 executable. They never discover or read
an installed Wispr database. Source tests and package checks do not establish
installed field semantics, recurring collection or the owner's dashboard acceptance.
