## 1. Contracts and core admission

- [x] 1.1 Add the `assistant-dispatch` command family and schema and the additive `provider`, `model` and `tools` fields of `assistant-state`; verify with the event-contract fixture and registry tests that valid messages pass and unknown fields or sources are refused.
- [x] 1.2 Add the core responder that forwards an allowlisted `assistant-dispatch` from `bunny/modules/companions` to the tracked dispatcher; verify with a runtime core test that a forwarded `mode-set` becomes one operation requested by the module and that another source, family or target is refused with `forbidden` or `invalid-request` and records nothing.

## 2. Provider and configuration

- [x] 2.1 Add `configure` for the companions section with the optional `assistant` block and secret name; verify with module tests that a missing section is synthetic, a hosted provider without its secret or with an unsupported provider is refused, and the allowlist is parsed.
- [x] 2.2 Add the Anthropic Messages API adapter behind the turn contract with a transport seam; verify with fake-transport tests the request headers and body, text and tool-use parsing, usage tokens, refusal, 401/429/5xx and malformed answers mapped to registry codes, and abort on the signal.
- [x] 2.3 Drive the synthetic provider through the same turn contract as a labelled scenario; verify with module tests that it makes no network call and walks question, read tool and approval paths deterministically.

## 3. Engine loop, tools and approval

- [x] 3.1 Replace the fixed graph with the turn → ask/tool/approve-act loop under the new limits; verify with module tests restart after a question, after an approval question and after an admitted call, duplicate answers, cancellation and limit exhaustion.
- [x] 3.2 Add `read_sessions` from the synced session copy and `set_mode` as a proposal whose approval dispatches `mode-set` with the recorded revision; verify with module tests the bounded read result, allowlist refusal, decline, stale approval (`revision-conflict`) and uncertain dispatch without retry.
- [x] 3.3 Record usage tokens on calls and provider, model and tools in public state; verify with module and event tests that no key, prompt or transcript text reaches state, outcomes, logs or spans.

## 4. Owner interface and catalog

- [x] 4.1 Turn the page into the conversation panel with provider, tools and usage facts and approve/decline controls; verify with the companions browser journey start, question, approval by keyboard, reload while waiting, decline, cancel, read-only, disconnection, narrow viewport and axe.
- [x] 4.2 Update the `assistant-task` catalog scenario for the loop and add an approval scenario that changes the Hub mode through the real core over both transports; verify in the in-memory catalog and a disposable runtime that the mode changes once, a stale approval is refused and public records hold no conversation text.

## 5. Guides and checks

- [x] 5.1 Update the companions README, runtime README, architecture, container network paths and development checks for the conversation, provider configuration and secret; verify by instruction readback that each command named exists and runs.
- [x] 5.2 Run root build, typecheck, lint, companions, event, runtime, runtime-dashboard and workflow checks with the catalog scenarios over both transports; then synchronize and archive this change on the delivery branch before final review. Final review and CI remain delivery gates after archive.
