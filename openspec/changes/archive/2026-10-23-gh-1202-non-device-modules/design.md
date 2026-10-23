## Context

See proposal.md for the reason. `checkLocalBrowserConfig` in
`deploy/container/entrypoint.mjs` refuses every module section in the host-local
profile. With device control disabled, `start` builds only the core factory, so
a section would be ignored anyway. The profile is the only place the WSL
runtime's single device writer could be duplicated on the Mac.

## Goals / Non-Goals

**Goals:** start configured modules that control no device on the Mac-local
core. A wrong rule must fail closed.

**Non-goals:** device modules on the Mac (Hub #568), module secrets or client
grants in this profile, automatic configuration or discovery, and changes to the
isolated or native profiles.

## Decisions

1. **A device module is a shipped registration that declares `simulation`.**
   Every module with a device transport declares how the harness simulates it.
   Of the shipped modules, that covers bb8, codex-desktop, lifx, nanoleaf, onn,
   pixoo, playback, roborock, tidbyt and wemo. Today companions and wispr are
   admissible. The alternative, a curated allowlist, would be another list to
   keep in step with the registry. A new flag on the registration would change
   the SDK contract for one profile.
2. **A second check after configuration.** Admission is static. Before the
   runtime starts, the entrypoint also runs the SDK's `checkConfiguration` on
   each admitted module. If an accepted configuration names any device, startup
   refuses with the fixed `container-browser-config-refused` error. A refused
   configuration does not stop startup: the runtime shows that module
   `refused` and keeps the core and other modules running.
3. **Only configured modules start.** The profile builds the core and the
   admitted modules that have a section, in shipped order, rather than the whole
   non-device list. An unconfigured module would only show as refused. A module
   whose `after` names a module without a section is refused, because it would
   start without the module it follows. `hostLocalModules` holds this selection,
   the device check and the build, so the tests exercise what `start` runs.
4. **Module `secrets` stays refused.** A section's `secrets` member is another
   credential path. This profile keeps its single empty edge credential file.
5. **Configured paths stay a backup matter.** The stopped backup already
   accepts absolute paths only under the secrets root. Admission does not repeat
   that rule; the guide states it, and that `wispr` has no qualified source here.

## Risks / Trade-offs

- [A future module controls a device but declares no simulation] → the
  post-configuration device check refuses it when it names a device. A module
  could still send a device command without naming one. A new module of that
  kind needs review against this profile, and the guide says so.
- [A refused admitted module makes health `degraded`] → this is intended. The
  core stays `running`, and `entrypoint.mjs status` exits non-zero until the
  owner fixes or removes the section.

## Migration Plan

No storage or configuration change. Existing core-only configurations behave as
before. Installation is the routine stopped backup and image replacement in
`docs/bunny-container.md`, followed by the owner's manual section edit. To roll
back, remove the section. An earlier image refuses any section, so remove every
section before replacing the image with the previous one.
