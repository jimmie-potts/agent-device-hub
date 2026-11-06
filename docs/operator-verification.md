# Verify the Mac operator

Use this after changing `scripts/bunny*.mjs`, `scripts/deployment/` or
`scripts/mac-signin.mjs`, and before claiming that a source revision, host operator
and Linux ARM64 image are the intended ones. It reuses existing tests and release
evidence. The [container guide](bunny-container.md) owns the commands themselves,
and [development](development.md) owns the wider check lists.

Everything here runs against fakes, disposable Docker resources or read-only GitHub
evidence. It stops, starts, backs up, restores, deploys and reboots nothing on an
installation, sends no device command and reads no private state. Installed
operation belongs to a separately authorized owner, under
[Deploy a qualified batch](bunny-container.md#deploy-a-qualified-batch).

## Steps

Run from the worktree root with Node 24, prefixing commands with
`fnm exec --using=.nvmrc --` if `node --version` is not v24.

1. Set up: `npm ci`, then `npm run build`.
2. Exercise the real command path: `npm run test:deployment`. In
   `scripts/tests/bunny-operations.test.mjs`, the suite runs `node scripts/bunny.mjs`
   as a child process with a fake `docker`, under a 30-second limit. Expect these to
   pass rather than skip on a POSIX host:
   - `stop`, `start`, `backup` and `restore` settle with their expected effect.
   - A held lease and an unfinished operation refuse without touching the container.
   - The `--qualification-request` route settles.
   - The negative control restores a top-level `await` on the entry path. That run must
     exit without a result or refusal and leave the container alone, which the
     other cases treat as a failure.

   A test that imports `bunny.mjs` and calls `maintain` never reaches the command
   path, so it can't qualify this step.
3. Exercise refusals and image binding: `node --test scripts/tests/bunny.test.mjs` and
   `node --test scripts/release/tests/*.test.mjs`. With step 2's suite, which includes
   `scripts/tests/bunny-deployment.test.mjs` and `scripts/tests/mac-host.test.mjs`,
   these cover contention, unfinished-operation and start-hold refusal, failed-deployment
   holds, preserved state, and a wrong image, target or receipt. Add a test only for a
   gap these don't cover.
4. When the change affects real engine behaviour, run the disposable Docker exercises
   that [Qualified Mac batch operator checks](development.md#qualified-mac-batch-operator-checks)
   and [ONN backup and qualified maintenance helper checks](development.md#onn-backup-and-qualified-maintenance-helper-checks)
   describe, including the local image IDs each needs:
   `scripts/tests/bunny-deployment.docker.mjs` and
   `scripts/tests/bunny-maintenance.docker.mjs`. They use random projects and synthetic
   volumes and remove only their own resources. Confirm that with `docker ps -a`,
   `docker volume ls` and `docker network ls` filtered by the project name. If Docker or
   those images aren't available, report this step as not run.
5. To name a candidate, read its evidence from GitHub. Reuse an unchanged accepted
   result rather than starting a new qualification run for this purpose. Replace
   `<sha>`, `<run>` and `<attempt>` with the observed values:
   ```bash
   gh api repos/jimmie-potts/agent-device-hub/actions/runs/<run>/attempts/<attempt> --jq '[.path,.head_sha,.conclusion,.run_attempt]'
   ```
   ```bash
   gh api --paginate repos/jimmie-potts/agent-device-hub/actions/runs/<run>/attempts/<attempt>/jobs --jq '.jobs[]|[.name,.conclusion]'
   ```
   ```bash
   gh api --paginate repos/jimmie-potts/agent-device-hub/actions/runs/<run>/artifacts --jq '.artifacts[]|select(.name|endswith("<sha>-<run>-<attempt>"))|[.name,.expired]'
   ```
   The workflow must be `release-qualification.yml`, the SHA the candidate, the
   conclusion `success`, and the attempt's own `release-image-…` and
   `release-evidence-…` artifacts must exist and not be expired.

   This shows that the candidate is qualified, not that a host runs it. The deployment
   owner confirms the rest: `npm run deploy:batch` verifies the downloaded archive hash
   and loaded image identity, and the owner's private release record names the host
   operator's revision. This procedure reads no private records.

## Report

State each result separately, and name what was not run. One tier never implies
another.

| Tier | Evidence | Doesn't establish |
| --- | --- | --- |
| Fake and disposable | Steps 2 to 4: commands, pass counts, cleanup readback | A hosted release |
| Authentic release | Step 5: run, attempt, SHA, job results, artifact names | That a host runs it |
| Installation | The deployment owner's verified record and operator identity | Any device result |
| Physical | Explicitly authorized device observation | Anything from the tiers above |

Missing or mismatched evidence refuses the positive claim: report the gap and what
would close it. A partial rerun whose attempt has no image of its own stays
`incomplete`, as [release qualification](development.md#release-qualification)
explains.
