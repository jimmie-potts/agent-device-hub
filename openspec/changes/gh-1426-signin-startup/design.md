## Context

The operator refuses a core container with any restart policy, and its `start` takes the operation lease and refuses an unfinished deployment. Docker Desktop's sign-in setting was already on, and Tronbyt already uses `unless-stopped`. Manual `node scripts/bunny.mjs` hangs on the Mac (#1410).

## Goals / Non-Goals

**Goals:** everything returns after sign-in with no manual step, a refusal is visible, and the diagnostics stack depends on no release.

**Non-Goals:** pre-login startup, restarting the core after a crash or an engine restart during a session, and fixing #1410 or #1331.

## Decisions

- **A launchd agent for the core, not a restart policy.** A Docker restart would skip the lease and the hold, and would need the operator's refusal relaxed. The agent runs once, with no `KeepAlive`, so it cannot loop on a broken state. The owner chose sign-in only, and chose that sign-in starts the core even after a deliberate stop.
- **The operator comes from the container's own labels.** The image revision selects the release and the Compose label selects the file, so a deployment needs no change to the starter. A missing or unusable operator is a refusal, never a fallback to `docker start`.
- **The starter imports the operator.** This is the route used successfully on 2026-11-03. `maintain` and `parse` hold the same checks, and the entry point's hang does not apply. It stays correct after #1410 is fixed.
- **A copied folder for diagnostics.** A plain folder with a revision file and one previous copy. Baking the configuration into images would add a build step for a few files. Recreating is what applies a new copy, so the install always forces it. Volumes stay.
- **`KeepAlive` for the route.** It holds no state and sends no device command, so restarting it needs no judgment, and it waits out Tailscale's own start.

## Risks / Trade-offs

- Health can be `ok` while LAN devices are unavailable, under Proton VPN or after a failed first Roborock poll (#1331) → documented; the operator sees it on the dashboard.
- A maintenance window that spans a reboot would restart the core → the guide says to boot out the agent first. An unfinished deployment is already held by the operator.
- The agents use one Node version's path, as the coding worker's does → the guide says to reinstall after removing it.
