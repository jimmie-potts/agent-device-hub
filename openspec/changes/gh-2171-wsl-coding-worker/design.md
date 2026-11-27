## Context

The Mac owns job admission, Hub state and installed operators. The PC joins
with its distinct worker-only credential over the existing private HTTPS
route. The PC test profile applies to the selected WSL2 distro.

## Decisions

Use the existing Codex app-server and personal ChatGPT profile checks for WSL2.
The worker accepts a Codex-only PC configuration. Readiness requires a
signed-out local proof first. The actual attempt repeats the proof with its
pinned checkout and the same permission profile that will carry the turn.

Use the official Linux Codex CLI and bubblewrap. Keep the narrow Node, npm and
Git toolchain. The Linux profile denies the WSL mount and interop paths, keeps
settings and credentials out of the tool process, and disables network. The
preflight writes a marker in the checkout and checks a synthetic outside
file, its symlink alias and a private listening socket. It refuses when the
tool returns success without writing the marker.

The worker keeps its checkout, private profile and token on the distro
filesystem. The existing Mac configuration and permission profile continue
to apply on the Mac. Missing Linux confinement stops the turn before the
model gets the job. The Hub keeps the existing attempt identity and uncertainty
rules on disconnect.

The Mac terminal path fences the whole interactive Codex process as well as
the model's shell. The PC worker has no qualified equivalent for that outer
fence. It uses the named web controls until an exact saved-session route can
prove writer release and an independently confined successor.
