# ADR 0002: Issue-owned planning and reviewed delivery

Status: Accepted.

GitHub issues own scope, acceptance, dependencies and status. OpenSpec owns
capability scenarios. The hub's architecture owns shared decisions; each device
repository retains its local contracts and delivery policy. Shared methods stay
in agent-skills.

Use the [SDLC](../sdlc.md) with one coordinating writer, isolated worktrees,
independent fixed-comparison Standards and Specification review, all configured
PR/main CI and guarded squash merges. Authorized delivery includes verified
installation under the owner’s standing authority for the established target;
physical work retains its explicit authority. UI changes retain automated/browser
verification without a human approval gate. Reassess current project alignment
at every issue pickup under the SDLC scope defaults.

Node 24 and OpenSpec 1.12.0 match the existing projects. Reuse the proven workflow
validation behavior during bootstrap, with common-tool extraction and consumer
adoption tracked separately. The empty specification inventory does not claim
a runtime capability. The initial GitHub README commit is the sole branch-
initialization exception; subsequent changes go through PRs.
