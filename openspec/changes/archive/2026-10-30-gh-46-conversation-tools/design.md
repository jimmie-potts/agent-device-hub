## Context

See proposal.md. The companions module owns the task records, a pinned LangGraph saver on the SDK SQLite connection, the outbox and the React page from #499. It already syncs `session` and `mode` from `bunny/core`. The core admits `mode-set` only through its tracked dispatcher, and already answers one companions-only command (`companion-speech-dispatch`) by forwarding it with `CoreHandle.dispatch`. The container's private-proxy profile refuses every module secret; the production profile (#1233) admits secret files under the secrets volume. ADR 0012 governs outcomes, retries and diagnostics; ADR 0011 names Claude as a permitted destination for retained personal data.

## Goals / Non-Goals

**Goals:** one tool-capable turn contract shared by the synthetic and hosted providers; approval bound to the exact proposal and the mode revision; every state change as one tracked core operation; no key, prompt or transcript in public state, logs or history.

**Non-Goals:** a provider registry or SDK dependency, fallback models, a second command, preferences or knowledge in the prompt, coding-worker dispatch (#502), native lifecycle reporting (#505), installation, and any change to who owns modes or devices.

## Decisions

- **Turn contract instead of a text function.** The seam becomes `turn(input, signal) → reply`, where input holds fixed instructions, the task transcript, tool definitions and the current mode, and reply is text, a question, tool calls or a refusal, with usage or null. Alternative: keep the text function and parse tool calls from text. Rejected: brittle, and the Messages API returns typed `tool_use` blocks.
- **Graph loop with four node kinds.** `turn` → (`ask` interrupt | `tool` | `approve` interrupt then `act` | end), looping back to `turn` after a tool result, under the per-task limits. Interrupt nodes do no external work before interrupting, as today. Graph version `conversation-1`; `synthetic-1` tasks stay readable and refuse resume, the existing rule.
- **Fetch with a transport seam, no SDK package.** ADR 0012 limits modules to the SDK and contracts packages, and the lockfile needs coordination; Tidbyt's cloud client sets the precedent. Request shape follows the claude-api reference of 2026-10-21: `x-api-key`, `anthropic-version: 2026-10-21`, `model`, `max_tokens`, `system`, `tools` with `strict: true` and `input_schema`, `messages`, `output_config.effort`, `thinking` omitted. Alternative: `@anthropic-ai/sdk`. Rejected for the dependency rule; consequence: no client retries, which ADR 0012 forbids anyway.
- **Approval as a typed question.** A proposal is a question record with kind `approval`, the family, target, value and the mode revision captured when proposed. The dashboard answers with the literal `approve` or `decline` through the existing input path, bound to the question ID. `set_mode` sends `expectedRevision` so the core refuses a stale approval itself. Alternative: a new control family. Rejected: the question path already binds request, task and question identity and survives restart.
- **Dispatch through a core responder.** `assistant-dispatch` from `bunny/modules/companions` is validated, allowlisted (`mode-set` to `hub`) and forwarded with `CoreHandle.dispatch`, `requestedBy` the module. The module records the dispatcher's answer as the tool call's result; the operation's outcome, inbox item and history belong to the core. Alternative: the module calling `mode-set` directly. Rejected: the mode owner refuses commands without dispatcher admission.
- **Allowlist in the section, checked twice.** `assistant.tools` in `runtime.json` lists tool names; the engine builds tool definitions from that list at start and checks membership again when a call executes, so a changed or stale allowlist cannot widen an effect. Discovery is from module manifests (MCP read tools) and core command families; the first slice registers the two named tools.
- **Secrets and profiles.** The key is `secrets.<name>` in the section, read once at start through the module context and redacted by the runtime logger. Simulated runs and the browser-only profiles name no provider and keep the synthetic default. The section is optional: `configure` accepts a missing section as synthetic so existing installations and the catalog keep starting.
- **Usage.** `units` on a call are the provider's input plus output tokens; the task summary's `usageUnits` sums them and stays null when any call reported none. No dollar estimate is computed or shown.
- **Diagnostics.** Reuse profile 1.6 spans and events with the registered task, run and effect identifiers; provider errors map once to registry codes at the adapter boundary. No new attribute, so no catalog change.

## Risks / Trade-offs

- Live provider behavior unobserved in CI → adapter tests with a fake transport cover request shape, tool-use parsing, refusal, HTTP errors and abort; live use is installed acceptance under #508.
- An Opus turn exceeding the model deadline → 60 s deadline and 300 s active time; a timeout leaves the call uncertain with no retry, visible to the owner.
- Allowlist drift between proposal and execution → membership rechecked at execution; refusal result to the model.
- Stale approval racing a mode change → `expectedRevision` from the proposal; the core's `revision-conflict` is reported, nothing resent.
- Key exposure → read once, held in memory, redacted; never in state, receipts, history or page.

## Migration Plan

Additive schema fields and one additive command family; existing tables keep their rows. Existing synthetic tasks on graph `synthetic-1` remain readable. Installation on the Mac needs the production profile with device control disabled before a section with a secret is admitted; that is #568's first step and not part of this change.
