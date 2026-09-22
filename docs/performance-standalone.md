# Everyday standalone source qualification

[Hub #30](https://github.com/jimmie-potts/agent-device-hub/issues/30) qualifies the
standalone Linux/WSL source route for personal use. Embedded-host performance in
Pixoo #61, installation, actual agent-client compatibility and physical accuracy
remain separate. This does not deploy or migrate a personal installation.

The [September 22 receipt](performance/standalone-2026-09-22/README.md) records
the qualified run and every development/qualification attempt.

## Run

Use Node 24, system Python 3.12/3.14, bubblewrap and an installed Playwright
Chromium headless shell in its dedicated `chrome-headless-shell-linux64` or
`chrome-headless-shell-linux-arm64` distribution directory. Run `npm ci` in a clean, committed Hub worktree first.
The two source repositories must contain the exact revisions recorded in
`apps/hub/fixtures/pixoo-source.json` and `nanoleaf-shared-source.json`. Dependency
archives for Pixoo must already be available in npm's cache; missing offline
inputs fail preparation. `--npm-cache` can name a cache content directory,
defaulting to `~/.npm/_cacache`. The launcher copies only locked registry tarballs
and sanitized cache metadata. It extracts committed sources, then runs dependency
setup and both builds under namespace/pidfd supervision with fresh HOME/environment
and only owned writable staging. No user npm configuration or logs are mounted.
It neither checks out nor changes either consumer repository.

```bash
npm run test:performance:standalone
npm run qualify:standalone -- \
  --pixoo-repo /path/to/pixoo-source-repository \
  --nanoleaf-repo /path/to/nanoleaf-source-repository \
  --node /absolute/path/to/node24 \
  --browser /absolute/path/to/chrome-headless-shell \
  --output /tmp/new-standalone-result
```

Use a new output directory for every attempt. `report.json` contains the result,
all warm samples, scenario observations, source revisions, runtime/build hashes,
host load, failures and namespace cleanup. `runtime-manifest.json` identifies
staged inputs; `preparation.log` separates setup from measured execution.
`--smoke` uses incomplete sample counts for development and can never qualify.
Retain unsuccessful attempts; do not choose favorable reruns or change targets
after a failure without a documented reviewed decision.

## Measurement and targets

The driver observes hook spawn through process close on one monotonic clock.
A loopback observer records the start of forwarding each event to the actual
host, then the driver records each real consumer projection response. This
conservative receipt interval includes observer and IPC overhead. It is not
isolated reducer, rendering, network-device or optical latency.

The Pixoo remote facade is refreshed once per second. Nanoleaf uses its actual
one-second `Poller`; the driver inspects responses at 25 ms intervals and waits
for each batch's exact session/revision/observed-event timestamp before the next batch. Polling cadence is
separate from hook return. The real hook normalizes synthetic provider input;
no-op hooks or manual MCP transports cannot substitute.

| Check | Target fixed before measurement |
| --- | --- |
| One task, 200 warm calls | Hook p95 <=250 ms |
| Ten concurrent tasks, 200 warm calls | Hook p95 <=500 ms |
| Each real consumer | Receipt p95 <=1,500 ms |
| Every hook, including outages and burst | Return <=3,000 ms |
| Startup and recovery | <=5,000 ms |
| Standalone hub process | Peak RSS <=256 MiB |

The receipt target allows the delivered one-second polling cadence plus 500 ms
processing headroom. Hook targets keep ordinary return subsecond while allowing
a ten-process burst. First-call/startup observations are separate. Nearest-rank
p95 is descriptive for these bounded samples; p99 is not claimed from 200 calls.
Historical legacy-hook percentile ceilings remain diagnostic comparisons and
the original budget JSON and failed receipts are unchanged.

A short 50-task burst checks admission, explicit rejections/loss, resync and
bounded recovery; it does not promise 50 visible slots or sustained throughput.
The report checks dashboard closed/open/reconnect, a guarded Pixoo monitor filter command through the Hub during activity, a label edit,
a paused third stream, an unavailable consumer, host outage, restart, retained
labels/notices and exclusive ownership. It checks Nanoleaf reconnect comet/epoch
behavior and Pixoo current-state projection. Existing consumer presentation tests
remain the evidence for animation/playback behavior, rather than duplicating a
large rendering suite here.

## Isolation and limits

Preparation processes see explicit source/dependency inputs and owned writable
staging. Measured processes see read-only staged runtime inputs, system libraries,
a fresh temporary home/state and private PID/network/mount namespaces. They
cannot see the host home, mounted Windows files, live databases, device network
or host loopback services. The real Pixoo controller, player and presentation use its fake display adapter.
Nanoleaf projects state with physical worker launch suppressed. The supervisor acquires the namespace-init pidfd before releasing the
measurement handshake; success, failure and timeout verify that init has exited,
which terminates its detached descendants too. Missing isolation fails closed.

Each preparation/measurement namespace has a 540-second wall limit and the supervisor caps output.
The measurement process runs the host as a separate child and samples its
lifetime high-water RSS; this is host RSS, not total browser/consumer/harness
memory. Existing bounded host/consumer contract tests complement burst evidence.
No measured receipt is an installation, user-session or physical acceptance.
