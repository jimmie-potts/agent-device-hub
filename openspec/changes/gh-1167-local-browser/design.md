## Context and decision

The approved target is one new Mac project with fresh state and devices disabled.
Keep isolated/native defaults. An explicit container startup option binds the
container socket to0.0.0.0 while the canonical URL and Host/Origin allowlist stay
127.0.0.1/localhost on the same18788 port. No extra forwarder or host-network mode.

## Trust and admission

The dedicated bridge is ordinary, non-attachable and IPv4-only. The initial
internal-network attempt had healthy core operation but no effective host port;
the owner explicitly approved the ordinary bridge and its outbound connectivity.
Only its one core belongs to it; Docker publishes only127.0.0.1 TCP18788. Reachable containers can
forge Host/Origin, so actual network isolation is part of acceptance. The operator
checks created configuration before start and effective port/network metadata after start; an
isolation failure stops the new owned profile. A new binding never exempts the
existing stopped/PID/restart, private-volume, lease or archive protections.

Replacing the initial stopped container and its empty dedicated network is
explicitly authorized; all private volumes are reused without reprovisioning.
The replacement image and host operator share the same reviewed source revision.

Fresh stopped volumes receive only the public browser config and an empty
credentials list through a refusing, synchronized one-shot helper. Config is
published last; partial preparation is preserved and not blindly retried. Normal
browser sessions generate private ephemeral cookies; no bearer/API credential
is generated/imported and no session secret enters evidence.

## Errors, effects and verification

Reuse existing generic CLI refusal and ADR0012 gateway errors. Host and
cross-origin refusals have no state/device effects. Failed preparation preserves
partial new volumes; unknown command outcomes require inspection before retry.
No change to diagnostic payloads or trace continuity. Test admission with negative
binding/network/control inputs, unchanged default socket, real local session
flow, safe provisioning refusal and stopped backup/empty restore safeguards.
Actual Mac browser/health/network checks remain distinct from synthetic source
tests. PC stays stopped; device/WSL handoff and old-state adoption are deferred.
