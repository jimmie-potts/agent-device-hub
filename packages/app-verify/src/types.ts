/**
 * The plug-in interface of @jimmie-potts/app-verify.
 *
 * The core owns the run lifecycle described in the Hub's docs/app-verification.md:
 * transient systemd user unit and lease timer, receipt and events.jsonl, doctor,
 * frozen proof, Playwright capture, the preview card and the storage roots. An
 * adapter supplies only what is specific to its application, as one `AppPlugin`,
 * and a two-line wrapper that calls `runCli(plugin, argv)`.
 */

/**
 * Playwright objects are typed loosely so the core carries no Playwright type
 * dependency; Playwright is a peer the consumer installs. Annotate them in the
 * plug-in when you want types, for example `const page: Page = t.page`.
 */
export type PlaywrightPage = any;
export type PlaywrightContext = any;

/** Whether a part of the run is the real application code or a stand-in. */
export type ComponentKind = 'actual' | 'simulated';

export interface Component {
  /** Stable id, for example `hub`, `dashboard`, `wall-controller`. */
  id: string;
  kind: ComponentKind;
  /** Where the stand-in comes from, for a reader of the receipt. */
  note?: string;
}

/** Paths every plug-in callback receives. All are absolute. */
export interface RunPaths {
  /** `<app>-<UTC start, yyyymmddThhmmssZ>-<6 hex>`. */
  runId: string;
  /** The checkout the adapter serves: the plug-in's `root`. */
  root: string;
  /**
   * The run's private directory, `<state root>/<run-id>/`, mode 0700, outside
   * every Git checkout and off the /tmp tmpfs. The core keeps `stdout.log`,
   * `stderr.log`, `tmp/` (the app's TMPDIR) and `home/` (the app's HOME)
   * here; `stop` deletes the whole directory.
   */
  runtimeDir: string;
  /**
   * `<runtimeDir>/data/`: the application's disposable state. It is empty
   * whenever `seed` runs. Write run-generated credentials here with mode 0600;
   * never put them in `LaunchSpec.env`.
   */
  dataDir: string;
}

/**
 * A run's inputs by name: non-secret values the caller gave with
 * `--input <name>=<value>`, each 1 to 512 printable ASCII characters. Empty
 * when the plug-in declares none. Added in 1.1.
 */
export type RunInputs = Readonly<Record<string, string>>;

/** One input a plug-in accepts (1.1). */
export interface InputDeclaration {
  /** One line for `help`. */
  description: string;
  /** `start` refuses without it. Default `false`. */
  required?: boolean;
}

export interface SeedContext extends RunPaths {
  /** The scenario being seeded. */
  scenario: string;
  /** The run's inputs (1.1). A relaunch passes the recorded ones again. */
  inputs: RunInputs;
}

/** A named, deterministic synthetic seed owned by the adapter's test fixtures. */
export interface Scenario {
  /** One line for `help` and the card. */
  description: string;
  /**
   * Optional (1.1): declared inputs this scenario cannot run without, even
   * when the plug-in declares them optional. `start`, `scenario`, a `fresh`
   * step, `handoff --reset` and `restart` refuse, as a usage error before
   * anything stops, to seed it without them.
   */
  requiredInputs?: readonly string[];
  /**
   * Write this scenario's state into the empty `dataDir`. Runs before the
   * application starts: on `start`, on `scenario` and on `handoff --reset`
   * (the core stops the application first and relaunches it on the same port
   * afterwards). Throw to fail with cause `seed-failed`.
   */
  seed(context: SeedContext): void | Promise<void>;
}

export interface LaunchContext extends RunPaths {
  /** Resolved retained proof directory for this run (1.2). Never put private runtime data here. */
  proofDir: string;
  scenario: string;
  /**
   * The port to bind on 127.0.0.1: `0` on `start` (the kernel picks one and the
   * application reports it in its ready line), or the run's recorded port when
   * the core relaunches the application after a reseed.
   */
  port: number;
  /**
   * Absolute path of the Node.js binary running the adapter. The unit does not
   * inherit the caller's shell, so launch Node through this path.
   */
  node: string;
  /** The run's inputs (1.1). */
  inputs: RunInputs;
  /**
   * The ports of the extra endpoints the run recorded, by name (1.1): empty on
   * `start`; on a relaunch after a reseed, bind each named endpoint on its
   * port again, as the application does with `port`. A relaunch that moves
   * or drops a recorded endpoint fails with `port-changed`.
   */
  endpointPorts: Readonly<Record<string, number>>;
}

export interface LaunchSpec {
  /**
   * Program and arguments of the application process. A program without a
   * slash is resolved on the adapter's PATH before launch.
   */
  argv: readonly string[];
  /**
   * Extra environment. It is visible in `systemctl --user show`, so it must
   * never hold a credential. The core sets `TMPDIR=<runtimeDir>/tmp`,
   * `HOME=<runtimeDir>/home` (so the app never reads the caller's personal
   * files) and `PATH` (the adapter's PATH with the Node directory first).
   * Entries here override those three; an app that genuinely needs the real
   * home opts out with `HOME: process.env.HOME` and owns that choice. `start`
   * records the overridden names (never values), and `stop` removes only
   * `runtimeDir`, so an overridden HOME or TMPDIR is the plug-in's to clean.
   */
  env?: Readonly<Record<string, string>>;
  /** Working directory of the application; defaults to `root`. */
  cwd?: string;
}

/** What a ready line announces. */
export interface ReadyLine {
  /** Loopback origin, `http://127.0.0.1:<port>/`, optionally with a path. */
  url: string;
  /**
   * Optional (1.1): other loopback listeners of the same application, such as
   * a fake controller another run must reach, by name. A name is a letter
   * followed by up to 63 letters, digits, `_` or `-`, and a ready line names
   * at most 16 endpoints. Each is an `http://127.0.0.1:<port>/` URL. They are recorded as
   * `receipt.owned.endpoints`, printed in the card, held to their ports on a
   * relaunch, refused on a reserved port and checked by `doctor`'s listener
   * read.
   */
  endpoints?: Readonly<Record<string, string>>;
}

export interface ProbeContext extends RunPaths {
  scenario: string;
  /** The URL from the ready line. */
  url: string;
  /** The port the application actually bound. */
  port: number;
  /** The run's inputs (1.1). */
  inputs: RunInputs;
  /** The extra endpoints from the ready line, by name (1.1); empty when it named none. */
  endpoints: Readonly<Record<string, string>>;
  /** Aborted when the operation's deadline passes. */
  signal: AbortSignal;
}

export type ProbeResult = {ok: true} | {ok: false; reason: string};

export interface Readiness {
  /**
   * Called with each line the application writes to stdout. Return the URL
   * when the line announces readiness, for example the hub's
   * `{"ready":true,"url":…}` or a server's "listening at" line.
   */
  line(line: string): ReadyLine | undefined;
  /**
   * A loopback read of the application's own readiness route, such as
   * `GET /api/hub/v1/health`. `start` requires `{ok: true}`; `doctor` reports
   * it as the run's health.
   */
  probe(context: ProbeContext): Promise<ProbeResult>;
  /** Milliseconds from launch until a ready line and a passing probe. Default 30000. */
  timeoutMs?: number;
  /**
   * Optional: name why a start or reseed failed. The core passes the last
   * 4 KB of the application's stderr, in memory only, and appends the
   * returned line to `failure.detail`. Return only a stable, non-secret cause
   * line that you match exactly, such as `hub-start-failed: EINVAL`, or
   * `undefined`. The core drops a value that is not printable ASCII of at
   * most 200 characters, and ignores a throw; raw log text is never written
   * anywhere.
   */
  failureCause?(stderrTail: string): string | undefined;
}

export interface BuildSource {
  /** Package version recorded as `build.version`. Informational. */
  version: string;
  /**
   * The served bundle whose SHA-256 becomes `build.artifactDigest`: a route
   * read over loopback from the running application (the hub's
   * `/dashboard.js`), a file under `root`, or several files under `root`.
   * For `files` the digest is the SHA-256 of the lines
   * `<sha256 of the file>  <path>\n` in the listed order, which is what
   * `sha256sum <paths…> | sha256sum` prints for the same list.
   */
  artifact: {route: string} | {file: string} | {files: readonly string[]};
  /**
   * Optional: bring the served artifact up to date with the checkout, for
   * example `npm run build`, before `start` and `restart` launch it. Runs after
   * the `starting` receipt exists; throw to fail with cause `build-failed`.
   * Omit it when the adapter documents a separate build step.
   */
  prepare?(context: {root: string; signal: AbortSignal}): Promise<void>;
}

export type CheckOutcome = {outcome: 'passed'} | {outcome: 'failed' | 'skipped'; reason: string};

/** A start-time check of the simulated boundary, for example "health reports simulator mode". */
export interface BoundaryCheck {
  /** Receipt check id, kebab-case. */
  id: string;
  /**
   * Also re-run by `doctor` against an active run and reported in its row.
   * Set it only for read-only checks: doctor never changes a run.
   */
  doctor?: boolean;
  /** Runs after readiness during `start`. `failed` fails the start with cause `check-failed`. */
  run(context: ProbeContext): Promise<CheckOutcome>;
}

export interface CaptureContext extends ProbeContext {
  /** A fresh page in a fresh Chromium context that records video. */
  page: PlaywrightPage;
  context: PlaywrightContext;
  /**
   * Record one named assertion. `check` fails it by throwing, rejecting or
   * returning `false` (so Playwright predicates such as `isVisible()` work);
   * the failure is logged, the step ends and the capture is `failed`. Any
   * other return value passes. A step that records no assertion is `failed`:
   * a screenshot alone never passes.
   */
  expect(name: string, check: () => unknown): Promise<void>;
  /** Append a line to the capture's assertion log. */
  note(message: string): void;
  /** Save an extra screenshot `<name>.png` beside the core's `after.png`. */
  screenshot(name: string): Promise<void>;
  /**
   * Write an extra file into this capture's directory, for example an exact
   * simulator frame or a JSON label. `name` is a plain file name
   * (`[A-Za-z0-9][A-Za-z0-9._-]*`, no separators or dotfiles) that is not
   * `after.png`, `interaction.webm`, `assertions.json` or an existing file; at
   * most 16 MB. Attachments are listed in the capture record and assertion
   * log, and handoff freezes them with the rest of the verified set. A bad
   * name throws, which fails the step.
   */
  attach(name: string, content: string | Uint8Array): Promise<void>;
}

export interface CaptureStep {
  /** One line for `help` and the assertion log. */
  description: string;
  /** When set, `capture` refuses a run seeded with another scenario (or, with `fresh`, reseeds to it). */
  scenario?: string;
  /**
   * Start from newly seeded state: before the step, the core stops the
   * application, reseeds `scenario` (or the run's current scenario) and
   * relaunches it on the same port, and the capture log records it. Use it
   * for steps that change state; without it, state persists from earlier
   * captures, so assert deltas.
   */
  fresh?: boolean;
  /** Default 1280×800. */
  viewport?: {width: number; height: number};
  /** Milliseconds for `run`. Default 30000. */
  timeoutMs?: number;
  /** Drive the real page and assert the expected observations with `expect`. */
  run(context: CaptureContext): Promise<void>;
}

/**
 * Where `runCaptureStep` drives an already-running application. Starting the
 * application in the right state is the caller's job: `runCaptureStep` never
 * reseeds, so for a `fresh` step start a newly seeded application.
 */
export interface CaptureStepOptions {
  /** `http://127.0.0.1:<port>/` of the running application. */
  url: string;
  /** New or empty directory for `after.png`, `interaction.webm` and `assertions.json`. */
  outputDir: string;
  /**
   * Scenario the application was seeded with; default the plug-in's default.
   * A step pinned to another scenario is refused.
   */
  scenario?: string;
  /** Passed to the step as `dataDir`/`runtimeDir`/`runId` when it needs them. */
  dataDir?: string;
  runtimeDir?: string;
  runId?: string;
  /**
   * The inputs the application was started with (1.1), checked as `start`
   * checks them: declared, not secret-like, printable ASCII, required ones
   * present.
   */
  inputs?: Readonly<Record<string, string>>;
  /** The application's extra endpoints (1.1), each an `http://127.0.0.1:<port>/` URL. */
  endpoints?: Readonly<Record<string, string>>;
  /**
   * Optional (1.1): the candidate's recorded `build.artifactDigest`. When
   * given, the served artifact is re-read before and after the step, and a
   * different one fails it, as `capture` does.
   */
  artifactDigest?: string;
}

export interface CaptureStepResult {
  outcome: CaptureOutcome;
  reason?: string;
  /** Absolute paths; `null` when not produced. */
  screenshot: string | null;
  video: string | null;
  log: string;
  /** Absolute paths of `t.screenshot` and `t.attach` files. */
  attachments: string[];
  assertions: {name: string; outcome: 'passed' | 'failed'; at: string; error?: string}[];
}

export interface BrowserOptions {
  /**
   * Module names tried in order, resolved from `root`, that export
   * `chromium`. Default `['playwright', '@playwright/test']`.
   */
  modules?: readonly string[];
}

/** A local observation, never proof that a preview operation will succeed. */
export interface PrerequisiteCheck {
  id: string;
  phase: 'launch' | 'capture' | 'handoff';
  status: 'present' | 'missing' | 'unknown' | 'unsupported';
  /** Stable kebab-case cause, without paths, values or tool output. */
  reason: string;
  /** A short, non-secret action for the first missing requirement. */
  next?: string;
}

export interface PrerequisiteResult extends Record<string, unknown> {
  operation: 'prerequisites';
  app: string;
  coreVersion: string;
  scope: 'local-read-only';
  checks: PrerequisiteCheck[];
  phases: Record<'launch' | 'capture' | 'handoff', {prerequisites: 'present' | 'missing' | 'unknown'; operation: 'unproven'}>;
  next: string;
}

/** Everything the core needs from one application. */
export interface AppPlugin {
  /** Opt in (1.2) only when launch mounts createProofHandler on the preview listener. */
  servesProof?: true;
  /** Lowercase name used in run ids and unit names: `hub`, `wall`, `pixoo`. At most 16 characters. */
  app: string;
  /** GitHub `owner/name`, recorded in the receipt. */
  repository: string;
  /** How a person invokes the adapter, printed in the card: `npm run verify --`. */
  command: string;
  /** Absolute path of the checkout the adapter serves, usually derived from `import.meta.url`. */
  root: string;
  /** Scenario used when `start` has no `--scenario`. */
  defaultScenario: string;
  scenarios: Readonly<Record<string, Scenario>>;
  /**
   * Optional (1.1): the run inputs this plug-in accepts, by name (a letter,
   * then letters, digits, `_` or `-`; at most 64 characters). Callers give
   * them with `start --input <name>=<value>` and replace them with
   * `scenario <run-id> <name> --input …`; every other relaunch reuses the
   * recorded values. They are recorded in the receipt and events, so a name
   * matching /token|secret|password|credential|key/i is refused: an input
   * never carries a credential.
   */
  inputs?: Readonly<Record<string, InputDeclaration>>;
  build: BuildSource;
  /** The application process. It must bind 127.0.0.1 on `port` and print a ready line. */
  launch(context: LaunchContext): LaunchSpec | Promise<LaunchSpec>;
  readiness: Readiness;
  /** Actual and simulated parts, copied into the receipt. */
  components: readonly Component[];
  /** Start-time boundary checks. */
  checks?: readonly BoundaryCheck[];
  /** Named capture steps with assertions. */
  captureSteps: Readonly<Record<string, CaptureStep>>;
  browser?: BrowserOptions;
  /** Optional app-specific local inspection. It must not write, build, bind, fetch or launch. */
  prerequisites?: {inspect(): Promise<readonly PrerequisiteCheck[]>};
  /**
   * Ports a run must never serve on, added to the installed services' ports
   * (8788, 8765, 8787, 8791, 41230, 41231). A run whose ready line announces
   * one, as its URL or an extra endpoint, fails with `port-reserved`.
   */
  reservedPorts?: readonly number[];
}

/** Options for `runCli`, mainly for tests. */
export interface RunOptions {
  /**
   * Environment read by the core. Default `process.env`. Recognized:
   * `APP_VERIFY_STATE_ROOT` (default `~/.local/state/app-verify`),
   * `APP_VERIFY_PROOF_ROOT` (default `<canonical checkout>/.local/evidence/verify`),
   * `APP_VERIFY_WINDOWS_CHECK=off` (skip the Windows reachability read).
   */
  env?: Readonly<Record<string, string | undefined>>;
  /** Receives the one JSON result line. Default: process.stdout. */
  stdout?: (line: string) => void;
  /** Receives progress lines and the card. Default: process.stderr. */
  stderr?: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Receipt (docs/app-verification.md, "Receipt").

export const RECEIPT_VERSION = 'app-verification/1';

export type RunState = 'starting' | 'running' | 'failed' | 'expired' | 'stopped';

/** `doctor` adds `stale` for a receipt that disagrees with live state; it never writes it. */
export type AssessedState = RunState | 'stale';

/**
 * Causes the core records in `failure.cause`: `supervisor-unavailable`,
 * `proof-root-unusable`, `runtime-root-unusable`, `build-failed`,
 * `seed-failed`, `lease-failed`, `launch-failed`, `unit-exited`,
 * `readiness-timeout`, `port-changed`, `port-reserved`,
 * `artifact-unreadable`, `check-failed`, `reset-failed`.
 */
export type FailureCause = string;

export interface CheckRecord {
  id: string;
  outcome: 'passed' | 'failed' | 'skipped';
  reason?: string;
}

export type CaptureOutcome = 'passed' | 'failed' | 'unavailable';

export interface CaptureRecord {
  /** Capture number, 1-based across the run. */
  n: number;
  step: string;
  /** The scenario the run was seeded with when this step ran. Always written by 1.0.0; optional for readers of older records. */
  scenario?: string;
  /** `true` when the core reseeded `scenario` just before this step. */
  fresh?: true;
  /** `verified` before handoff (frozen by it), `after-handoff` afterwards. */
  set: 'verified' | 'after-handoff';
  /** Written as `failed` with reason `interrupted` before the step runs, so a killed capture never reads as passed. */
  outcome: CaptureOutcome;
  reason?: string;
  /** Paths relative to the proof directory; `null` when the file was not produced. */
  screenshot: string | null;
  video: string | null;
  log: string;
  /** Extra files from `t.screenshot` and `t.attach`, relative to the proof directory. Optional. */
  attachments?: string[];
  startedAt: string;
  finishedAt: string | null;
}

export interface CleanupItem {
  kind: 'unit' | 'lease-timer' | 'runtime-dir';
  name: string;
  /** `removed` by this operation, `absent` already, `left` still present, `unknown` when the readback failed. */
  outcome: 'removed' | 'absent' | 'left' | 'unknown';
}

export interface Receipt {
  receiptVersion: typeof RECEIPT_VERSION;
  runId: string;
  app: string;
  repository: string;
  /** The two storage roots, as `<canonical checkout>/.local/evidence/verify` and `~/.local/state/app-verify` unless overridden. */
  roots: {proof: string; runtime: string};
  state: RunState;
  startedAt: string;
  /** The run id this run restarts. Optional. */
  restarts?: string;
  /**
   * The run's inputs (1.1). Optional; written by 1.1 whenever the plug-in
   * declares inputs, as `{}` when none was given, and never otherwise.
   */
  inputs?: Record<string, string>;
  build: {sourceRevision: string; dirty: boolean; artifactDigest: string | null; version: string};
  scenario: {name: string; version: string; seededAt: string | null};
  components: Component[];
  checks: CheckRecord[];
  captures: CaptureRecord[];
  preview: {url: string; expiresAt: string; leaseMinutes: number} | null;
  owned: {
    unit: string;
    leaseTimer: string;
    port: number | null;
    runtimeDir: string;
    proofDir: string;
    /** Identity of the live process, compared by `doctor`; `null` until running. */
    mainPid: number | null;
    mainStartMonotonic: number | null;
    /** The extra endpoints the ready line announced, by name (1.1). Optional; present only when it named any. */
    endpoints?: Record<string, string>;
  };
  proof: {frozenAt: string | null};
  /** Why the run failed or was stopped by the core; `null` otherwise. */
  failure: {cause: FailureCause; at: string; detail?: string} | null;
  cleanup: {result: 'clean' | 'partial' | 'unknown' | null; at?: string; items?: CleanupItem[]};
  secrets: 'none recorded';
}
