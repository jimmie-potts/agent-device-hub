# Development setup

## Bootstrap commands

Use Node 24 and npm from the assigned worktree root:

```bash
npm ci
npm run check:workflow
npm run test:workflow
```

Both checks must exit zero. The current specification inventory is zero
capabilities, zero active changes and zero archived changes. That is a valid
bootstrap, not an implemented behavior baseline.

OpenSpec 1.12.0 is pinned locally. Use npm run openspec -- <arguments>. Its wrapper
isolates configuration and suppresses telemetry/completion migration. Initialize
using init --tools none --profile core --no-animation. Do not generate local
skill integrations or run a global OpenSpec installation.

For a WSL sandbox with a read-only npm cache, use a writable temporary cache.
Keep dependency caches, browser binaries and all runtime state outside source.

GitHub CI runs Workflow checks on ubuntu-latest and windows-latest. Both execute
npm ci and the two workflow commands. Product tests/build/type/browser checks
must be introduced with their implementing issues and become required jobs;
these bootstrap checks do not validate agent or device behavior.

## Shared tooling provenance

The bootstrap wrapper, validator and fixtures adapt the existing Pixoo tooling
at revision 4fd259b08ff22dcf73938162f7dff67b71d23ed9. They preserve its CLI and
configuration-isolation behavior. This temporary bootstrap copy is recorded;
[agent-device-hub#10](https://github.com/jimmie-potts/agent-device-hub/issues/10) owns publishing the common package, and [divoom-app-upgrade#38](https://github.com/jimmie-potts/divoom-app-upgrade/issues/38) and
[codex-nanoleaf#31](https://github.com/jimmie-potts/codex-nanoleaf/issues/31) own replacing the device copies. No shared skill is vendored.

## Agent setup

Use the reviewed [agent-skills catalog](https://github.com/jimmie-potts/agent-skills)
outside this checkout. The workflow uses code-review, tdd,
grill-with-docs, grilling, domain-modeling, writing-for-agents, unslop and the
OpenSpec propose/explore/apply/update/sync/archive skills.

Use [docs/sdlc.md](sdlc.md) for delivery. The catalog's retired github-delivery
name is no longer a prerequisite. Its replacement, deliver-work, requires the
user to invoke it explicitly and does not replace repository gates.

Inspect installed paths first. Provision only missing skills through the catalog
manager when the user authorizes personal setup; preserve conflicts and the source
checkout supporting installed links. Do not copy methods or external symlinks here.

Codex reads root AGENTS.md; Claude reads CLAUDE.md, which imports @AGENTS.md.
[Codex discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [Claude imports](https://code.claude.com/docs/en/memory#agentsmd) define those
mechanisms. Links to docs are conditional read instructions, not automatic imports.

Verify actual discovery in a fresh authorized host session before claiming
host compatibility. A filesystem link, static instruction exercise or CI pass
alone does not establish live Codex/Claude loading or lifecycle events. Check
root and each nested controller launch directory independently. For controller
work launched at the root, AGENTS.md explicitly requires reading the scoped
README.md and AGENTS.md. Each controller CLAUDE.md imports its local AGENTS.md;
the scoped instructions require the root rules too.

Keep personal Claude/Codex settings, authentication, trust, hook files and runtime
data outside the repository. One branch/worktree and coordinating writer owns each
active deliverable; shared Git operations and installations still need ownership.

## Future package and controller validation

The chosen development direction is Node 24, TypeScript and npm workspaces for
new shared packages and the Tidbyt/LIFX controllers. No workspace packages or
runtime entry points are created by the documentation bootstrap. The first
implementing issue adds the needed manifests, package boundaries and executable
commands to this document and CI. The migrated Nanoleaf worker remains Python;
sharing a repository does not require a common runtime or combined process.

Reserve shared contracts, root package/lockfile changes and CI for the coordinating
writer. Work on separate deliverables uses separate worktrees, even for different
controller directories. Reconcile the latest shared changes before validation.
Run changed-package build/type/tests and every affected contract consumer, plus
the repository workflow checks. A green unrelated package does not validate a
controller. Use fake transports and temporary runtime data for source checks;
ordinary setup must never discover or contact physical devices.

[agent-device-hub#2](https://github.com/jimmie-potts/agent-device-hub/issues/2) owns provider qualification; [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) owns the device
contract and cross-language fixtures. [agent-device-hub#3](https://github.com/jimmie-potts/agent-device-hub/issues/3) owns reusable core/package
tests. Consumer changes must run those fixtures against supported contract
versions without private metadata or a physical device.

Define versioned artifacts and a compatibility matrix before a second repository
depends on an exported package. Never import a package from another developer's
checkout path. Changes to shared contracts must validate every affected consumer.

Installation and physical testing follow docs/sdlc.md and the owning device guide.
No bootstrap command installs the app, changes hooks, reads live device credentials
or sends device requests.

## Instruction validation

For instruction-only changes, check these branches statically and report the
files that resolve each rule. Live host discovery requires a separately
authorized session and must be reported separately.

| Task | Expected instruction path and boundary |
| --- | --- |
| Root-launched Tidbyt edit | Root AGENTS.md directs the reader to controllers/tidbyt/README.md and AGENTS.md; cloud source work uses fakes. |
| Nested LIFX launch | Ancestor/root instructions plus controllers/lifx/AGENTS.md; do not infer the exact model or scan the LAN. |
| Claude controller work | Root CLAUDE.md imports root AGENTS.md; controller CLAUDE.md imports scoped AGENTS.md. Scoped rules require the root rules. |
| Shared contract or lockfile edit | Read architecture, linked contracts and this guide; coordinate ownership and test every affected consumer. |
| Request to implement a future controller | Read its exact issue and readiness decisions; bootstrap completion alone grants no implementation or installation authority. |
| Source-only Tronbyt change | Qualify connection behavior with fakes; firmware, server installation and physical transition require separate explicit authorization. |
