## Context

The worker runs `claude -p` in a fresh worktree and reports progress on its one endpoint (#502). Its credential role
grants `coding-work`, `coding-progress` and `coding-endpoint` only. The companions coordinator owns the coding state.
ADR 0012 asks for no new message format, one version per producer, no automatic retry and an uncertain outcome where
the fate is unknown.

## Goals / Non-Goals

**Goals:** readiness without side effects; a usage limit as its own outcome with the reset the tool gave; a question
as its own outcome; the subscription sign-in as the only credential the harness uses; replay of real recordings.

**Non-Goals:** a Codex harness, a second machine, provider choice, resuming at the reset, push or pull-request
authority, showing readiness on the dashboard.

## Decisions

1. **Readiness rides on the existing declaration.** A new family would add a message format and a credential grant.
   `coding-endpoint/2.1` lets an enable carry `readiness`, and `coding-state/2.1` holds the selected endpoint's latest
   record or null. An enable from the selected endpoint is already accepted again, so a later enable is how the worker
   refreshes it; the coordinator changes the revision only when the record changed. A delegation proposal stays
   bound to the revision of the last change of endpoint, availability or work, so a readiness report never refuses an
   approval with `revision-conflict`. A disable or a lost endpoint clears it. The worker sends that extra enable once after a run that reported limit windows and never retries it.
2. **What readiness reads.** `claude --version` and `claude auth status --json`, each with no input, the harness's
   environment and a ten-second deadline. Only `loggedIn` and `subscriptionType` are read; the account, organization,
   e-mail and directories are not. A missing executable is `installed: no`; a probe that times out or prints nothing
   readable is `unknown`. The tool reports limit windows only during a run, so `limits` are the latest run's
   `rate_limit_event` windows with the time they were observed, or null before any.
3. **A usage limit is what the tool says it is.** The stream schema documents `rate_limit_event` with status
   `rejected`, and an assistant message typed `usage_limit_reached` with `api_error_params.rate_limit_info`. Either one,
   on a run that did not end with a successful structured result, gives `usage-limit` with the window and reset from
   that information, null where absent. A generic `rate_limit` error is not a usage limit, because the tool uses it for
   throttling and policy refusals too. A cancel or timeout keeps its own reason.
4. **A question is the model's structured outcome.** Headless runs have no question tool, so the result schema gains
   `waiting-for-owner` and the appended instruction asks for it, with the question first in findings.
5. **Credentials stay out of the harness.** Every `ANTHROPIC_` variable, the `CLAUDE_CODE_USE_` provider switches,
   `CLAUDE_CODE_OAUTH_` tokens, `CLAUDE_CODE_API_KEY_` helpers and `AWS_BEARER_TOKEN_BEDROCK` are removed, as are the
   worker's own `BUNNY_` variables. A key that still reaches the tool from a project setting shows as the stream's
   `apiKeySource` and becomes a limitation on the result.
6. **Fixtures.** Real runs recorded with synthetic prompts in an empty directory, scrubbed of identifiers, paths,
   account values and usage figures. A real usage limit cannot be provoked, so the limit fixtures are constructed from
   the documented shapes and named `constructed-`. A test fails on a home path or e-mail address in any fixture.

## Risks / Trade-offs

- The limit event shapes are documented by the tool, not observed at a real limit. The constructed fixtures say so,
  and a stream without either signal stays an ordinary failure rather than a guessed limit.
- Streaming output keeps the `--json-schema` result; the final `result` event carries `structured_output` as before.
- Consumers that know only 2.0 are not affected: 2.0 stays registered and the producers in this repository move to 2.1.
