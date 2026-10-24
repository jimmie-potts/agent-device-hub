# Finite offline runtime Acceptance

This explicit alternative runs the runtime and browser in one disposable Linux
container on an existing Docker engine. It needs no systemd user manager and
publishes no host port. The ordinary managed preview commands are unchanged.
The procedure implements the owner-approved ADR 0009 amendment; a previous
unsupported managed run remains incomplete.

Use a clean, committed candidate in an owned detached review checkout. The
reviewer chooses the relevant scenario and assesses the observations against
the issue. Passing a catalog command alone is not an independent verdict.
Installed Desktop/CLI checks and physical-device qualification remain separate.

## Prepare the exact test image

Use Node 24, `npm ci` and `npm run build` in the clean candidate checkout.
Build preparation may download locked dependencies and the Playwright browser;
the subsequent review operation is offline. Do not install browser tooling on
the host or change its security settings.

Export that exact commit with the original closed exporter in
`deploy/container/context.mjs`:

```js
import {createContext} from './deploy/container/context.mjs';
await createContext({repository: '/absolute/clean/repository',
  revision: '<full 40-character SHA>', destination: '/absolute/new/private/context'});
```

The destination must not exist. Record the archive hash. Extract `context.tar`
only into a new private build directory, then build the core with the selected
commit label. Use fresh unused local tags; never replace an installed image tag.

```sh
docker build --build-arg SOURCE_REVISION=<SHA> -f deploy/container/Dockerfile -t <unused-core-tag> <exported-context>
docker build --build-arg CORE_IMAGE=<unused-core-tag> --build-arg SOURCE_REVISION=<SHA> -f deploy/container/Dockerfile.verify -t <unused-test-tag> <exported-context>
```

Before the derivative build, verify that the core tag resolves to the recorded
immutable core image and exact revision. Afterwards verify the derivative's
immutable image ID, architecture, revision label, `org.bunny.verify.portable=1`
and user `1000:1000`. It contains the lockfile-selected Playwright Chromium and
video tooling. This is a test image, never a replacement for the installed core.
The derivative writes a closed `portable-artifact/1` build manifest from its own
built bytes. Native and closed-image builds may generate different timestamped
identity files: the served artifact is the image's artifact, not the native one.

## Run and inspect

From the built clean review checkout:

```sh
npm run -s verify:runtime -- portable --image sha256:<test-image-ID> --step mac-codex-local --seconds 180
```

The duration is an integer from 30 to 600 seconds and cannot be renewed. The
receipt names the exact commit, artifact digest, immutable image, container,
architecture and run ID. Source drift, a mismatched image or effective isolation
mismatch refuses the run. The in-image driver rechecks the artifact before and
after capture. The closed export replaces the managed route's Git/mtime check;
the existing simulated-transport, outbound and private-state checks still run.
The pending receipt honestly records a null artifact until the host copies and
validates only the fixed image build manifest from the owned created container.
That readback is saved before startup. No native/image mismatch is ignored.

The selected `mac-codex-local` capture invokes the real metadata-only hook against
the synthetic core, observes Working and Finished in the browser, checks retained
completion, content exclusion, source-bound ingest/read/control/admin refusals,
Host/Origin admission, stalled/unavailable receivers and browser recovery. It
uses no installed credential, Codex hook settings, history or personal store.
It does not establish that an installed client emitted every supported hook.
The recording labels its synthetic actions, scrolls the actual status badge
into view and pauses on Working and Finished. Browser recovery uses visible
target/pointer/click cues that respect reduced motion. The final screenshot
keeps the recorded viewport rather than resizing it; other capture steps retain
their existing full-page default. Recovery must show honest Stale evidence and
its retained notice, rather than imply a fresh producer observation.

The container has no networking, host ports, mounts, devices, engine socket or
host namespaces. It runs as UID 1000 with dropped capabilities, no new privileges,
private IPC, `restart=no` and no auto-removal. The candidate is root-owned and
not writable. Synthetic HOME, credentials and runtime state live under
`/var/lib/app-verify/<run-id>` in its disk-backed writable layer, outside the
checkout and outside `/tmp`; no runtime state is placed on tmpfs.

GNU timeout is armed before the application or browser starts. It runs inside
the container independently of the host command and application event loop.
This route provides neither preview handoff/extension/restart nor the managed
route's realtime expiry across sleep. If Docker becomes inaccessible, cleanup
is unknown and cannot pass. Reconcile that exact container when access returns.
A stopped run with an ambiguous nonzero exit is recorded as failed. Exit 137
can also follow a forced stop or OOM, so that code or elapsed wall time alone does not establish
deadline expiry. Independent expiry qualification must observe the prearmed
deadline ending the owned container after caller loss, separately from the
receipt's failed capture and cleanup evidence.

## Proof and cleanup

Private proof is retained under the canonical checkout's ignored
`.local/evidence/verify/<run-id>/`. `portable.json` uses the separate
`app-verification-portable/1` receipt; it has no invented systemd unit or timer.
The `portable-capture/1` manifest binds the source, artifact, step and run to
allowlisted file sizes and SHA256 digests. Allowed exports are:

- `capture/assertions.json`
- `capture/after.png`
- `capture/interaction.webm`
- `capture/checks.json`

Only after authoritative stopped/PID-zero readback does the host copy and
validate these individual regular files. A pass needs passed assertions, a PNG,
a finalized WebM and the Mac-hook check attachment. Unsupported attachments,
private canary content, missing proof or digest mismatch cannot pass. Raw logs,
HOME, configuration, credentials, databases and arbitrary paths are never
exported. Inspect the complete video and screenshot privately, alongside the
assertions and check attachment, before giving an Acceptance verdict.

A successful run removes only its exact owned stopped container after proof
survives on the host, then verifies its absence. Failure, expiry or interrupted
capture cannot become successful. Failed/partial private capture stays inside
the stopped container for inspection; missing or unconfirmed stop preserves
its state. To explicitly recover/clean one owned run:

```sh
npm run -s verify:runtime -- portable-cleanup <run-id>
```

Cleanup exports only validated allowlisted proof before removing that exact
container and its remaining synthetic private state. It never turns a failed
capture into a passed one. An unknown engine result or unconfirmed removal stays
unsuccessful. Retain the receipt and evidence; do not use broad container prune
or remove another run's resources. Remove the review worktree only after its
processes are confirmed stopped and proof is retained.
If removal completed before the final receipt was saved, cleanup establishes
exact-ID absence through a successful complete Docker query and validates the
already-retained manifest and artifacts. It records recovery without promoting
the capture verdict. Missing proof remains unsuccessful even when absence is
known. Early driver failures retain only a fixed stage code, never exception
text or raw diagnostics, in the allowlisted check attachment.

## Source validation

Run `npm run build`, `npm run typecheck`, `npm run lint:js`,
`npm run test:app-verify:built`, `npm run test:app-verify:package:built`,
`npm run test:runtime:verify:built`, `npm run check:workflow` and
`npm run test:workflow`. Existing test discovery includes the portable guard,
proof and cleanup cases and the new runtime capture. The package remains usable
without any other workspace package. Real Docker expiry/caller-loss and browser
qualification on the exact candidate are additional evidence, not inferred from
mocked command tests. Independent Acceptance must use its own run and exact
candidate after implementation qualification.
