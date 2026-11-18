// Golden hook output (Hub #1865, tasks 2.1 and 2.2), and what the hook's module loads. Every hook fixture below, at each producer lifecycle version and
// with each title source, runs through `runHook` as a client's hook command runs it, against a loopback edge that keeps
// the bytes of each publication. Beside it runs the retained path: agent-state's `normalizeHook`, or `enrichHook` for a
// producer that selected 1.1 or 1.2, then the earlier mapping (`fixtures/retained-hook.ts`). The hook's publication must
// equal `fixtures/hook-golden.json` byte for byte, apart from the message's random ID and trace, and its observation
// must be the retained path's, byte for byte. The golden file was written on main 6adad7e7's hook, before the adapter
// moved into the runtime; regenerate it only for an intended change of the wire, with BUNNY_WRITE_HOOK_GOLDEN=1.
// Every identity, title, path, token and payload here is synthetic, and the Codex home is a new directory: no test reads
// a real client's transcript, Codex home or environment.
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {chmod, mkdir, mkdtemp, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {enrichHook, normalizeHook, type SourceConfiguration} from '@jimmie-potts/agent-state/providers';
import {REMOTE_SCHEMA} from '@jimmie-potts/sdk';
import {HOOK_BUDGET_MS, runHook} from '../src/hook/index.js';
import {observationOf} from './fixtures/retained-hook.js';
import {it} from './support.js';

const GOLDEN = fileURLToPath(new URL('../../tests/fixtures/hook-golden.json', import.meta.url));
/** A producer token in the Hub's form, 43 base64url characters. It travels only in the call's header. */
const TOKEN = 'tok_SYNTHETIC1865_golden_'.padEnd(43, 'x');
/** Content a hook carries that the allowlist drops. */
const CANARY = 'PRIVATE_CANARY_1865';
const NOW = 1_790_000_000_000;

type Version = '1.1' | '1.2';
const VERSIONS: readonly (Version | undefined)[] = [undefined, '1.1', '1.2'];
const versionName = (version: Version | undefined): string => version ?? '1.0';

type Configuration = Record<string, unknown>;
const CLAUDE: Configuration = {provider: 'claude', client: 'code', hostId: 'host-sim', sourceId: 'claude-code-hooks'};
const CODEX_CLI: Configuration = {provider: 'codex', client: 'cli', hostId: 'host-sim', sourceId: 'codex-cli-hooks'};
const CODEX_DESKTOP: Configuration = {provider: 'codex', client: 'desktop', hostId: 'host-sim', sourceId: 'codex-desktop-hooks'};
const CODEX_LOCAL: Configuration = {provider: 'codex', client: 'local', hostId: 'host-sim', sourceId: 'codex-local-hooks'};
/** Every hook either provider maps, and hooks neither maps or only the other maps. */
const HOOKS = {
  claude: ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd', 'SubagentStart', 'SubagentStop',
    'Interrupt', 'Notification', 'PreToolUse'],
  codex: ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd', 'SubagentStart', 'SubagentStop',
    'PostToolUse', 'Notification', 'PreToolUse'],
} as const;
/** The 1.2 environment of a Claude Code session that Claude Desktop runs. */
const DESKTOP = {CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', CLAUDE_CODE_HOST_SESSION_ID: 'local_0123abcd'};
const id128 = (letter: string): string => letter.repeat(128);
const astral = (count: number): string => '\u{1F600}'.repeat(count);
/**
 * Titles for the widest root at 1.2, around the 1.x envelope's 2048 bytes: with 144 four-byte characters and a
 * three-byte one the envelope is 2048 bytes and keeps its title, and with 145 it is 2049 and drops it.
 */
const BOUND_TITLES: Record<string, string> = {
  'a 60-character title': astral(60), 'a 2048-byte envelope': `${astral(144)}\u20AC`, 'a 2049-byte envelope': astral(145), 'a 160-character title': astral(160),
};

type Case = {
  name: string;
  configuration: Configuration;
  version?: Version | undefined;
  /** The hook's JSON. */
  input: unknown;
  /** The hook process's environment; none by default, so the run's own never reaches it. */
  environment?: Record<string, string>;
  /** The Codex home the title read uses: the shared synthetic one by default. */
  codexHome?: string;
  nowMs?: number;
};

type Files = {root: string; codexHome: string; emptyCodexHome: string; bigCodexHome: string; transcript: (name: string) => string; fifo: string};

/** A hook payload with the fields every client sends and some that the allowlist drops. */
function payload(provider: 'claude' | 'codex', hook: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hook_event_name: hook, session_id: 'session-1', [provider === 'codex' ? 'turn_id' : 'prompt_id']: 'turn-1', cwd: '/home/owner/projects/demo',
    source: 'startup', reason: 'clear', prompt: CANARY, tool_name: 'Bash', tool_input: {command: CANARY}, tool_response: {output: CANARY}, tool_use_id: 'tool-1',
    ...extra,
  };
}

function cases(files: Files): Case[] {
  const all: Case[] = [];
  const add = (entry: Case): void => { all.push(entry); };
  const titled = files.transcript('titled');

  // Every hook of every source at every version, for a root and for a child; the roots carry a title source.
  for (const [label, configuration] of [['claude', CLAUDE], ['codex-cli', CODEX_CLI], ['codex-desktop', CODEX_DESKTOP], ['codex-local', CODEX_LOCAL]] as const) {
    const provider = configuration.provider as 'claude' | 'codex';
    for (const version of VERSIONS) {
      for (const hook of HOOKS[provider]) {
        const titleSource = provider === 'claude' ? {transcript_path: titled} : {};
        const environment = provider === 'claude' ? DESKTOP : {};
        add({name: `${label} ${versionName(version)} ${hook} root`, configuration, version, input: payload(provider, hook, titleSource), environment});
        add({name: `${label} ${versionName(version)} ${hook} child`, configuration, version, input: payload(provider, hook, {...titleSource, agent_id: 'helper-1', agent_type: 'Explore'}), environment});
      }
    }
  }

  // Input the normalizers refuse or read narrowly, for each provider at 1.0 and 1.2.
  for (const [provider, configuration] of [['claude', CLAUDE], ['codex', CODEX_CLI]] as const) {
    const turnField = provider === 'codex' ? 'turn_id' : 'prompt_id';
    const otherTurnField = provider === 'codex' ? 'prompt_id' : 'turn_id';
    for (const version of [undefined, '1.2'] as const) {
      const at = (name: string, input: unknown, extra: Partial<Case> = {}): void => {
        add({name: `${provider} ${versionName(version)} ${name}`, configuration, version, input, ...extra});
      };
      const base = (hook: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
        ({hook_event_name: hook, session_id: 'session-2', [turnField]: 'turn-2', ...extra});
      at('no session ID', {hook_event_name: 'SessionStart'});
      for (const [what, sessionId] of [['an empty', ''], ['a spaced', 'has spaces'], ['a 129-character', 'a'.repeat(129)], ['a 128-character', id128('a')],
        ['a newline-ended', 'session\n'], ['a numeric', 7], ['a null', null]] as const) at(`${what} session ID`, base('SessionStart', {session_id: sessionId}));
      at('no turn', {hook_event_name: 'Stop', session_id: 'session-2'});
      for (const [what, turn] of [['an empty', ''], ['a spaced', 'bad turn'], ['a null', null], ['a 128-character', id128('t')], ['a numeric', 3]] as const) {
        at(`${what} turn`, base('UserPromptSubmit', {[turnField]: turn}));
      }
      at('only the other provider\'s turn field', {hook_event_name: 'UserPromptSubmit', session_id: 'session-2', [otherTurnField]: 'turn-2'});
      for (const [what, agent] of [['its own session as child', 'session-2'], ['an empty child', ''], ['a spaced child', 'bad child'], ['a null child', null],
        ['a numeric child', 9], ['a 128-character child', id128('c')]] as const) {
        at(`SessionStart with ${what}`, base('SessionStart', {agent_id: agent}));
        at(`SubagentStop with ${what}`, base('SubagentStop', {agent_id: agent}));
      }
      at('SubagentStart without a child', base('SubagentStart'));
      at('Interrupt', base('Interrupt'));
      for (const [what, extra] of [['a tool use ID', {tool_use_id: 'toolu_01'}], ['no tool use ID', {}], ['an empty tool use ID', {tool_use_id: ''}],
        ['a spaced tool use ID', {tool_use_id: 'bad id'}], ['a numeric tool use ID', {tool_use_id: 7}], ['no turn', {tool_use_id: 'toolu_01', [turnField]: undefined}],
        ['a child', {tool_use_id: 'toolu_01', agent_id: 'helper-1'}], ['a 128-character tool use ID', {tool_use_id: id128('u')}]] as const) {
        at(`PostToolUse with ${what}`, base('PostToolUse', extra));
        at(`PostToolUseFailure with ${what}`, base('PostToolUseFailure', extra));
      }
      at('a hook name that is not a string', {hook_event_name: 7, session_id: 'session-2'});
      at('an array', []);
      at('null', null);
      at('a string', 'SessionStart');
      at('an observation at time 0', base('SessionStart'), {nowMs: 0});
      at('an observation at the last time a message can carry', base('SessionStart'), {nowMs: 8.64e15});
      // The message's time cannot carry it, so the hook ends there.
      at('an observation at the last safe time', base('SessionStart'), {nowMs: Number.MAX_SAFE_INTEGER});
      at('an observation at a negative time', base('SessionStart'), {nowMs: -1});
      at('an observation at a fractional time', base('SessionStart'), {nowMs: NOW + 0.5});
    }
  }

  // Source configurations the normalizers refuse, and members they ignore.
  for (const [what, configuration] of [
    ['codex as code', {...CODEX_CLI, client: 'code'}], ['claude as cli', {...CLAUDE, client: 'cli'}], ['claude as local', {...CLAUDE, client: 'local'}],
    ['claude as desktop', {...CLAUDE, client: 'desktop'}], ['an unknown provider', {...CLAUDE, provider: 'gemini'}],
    ['an inherited provider name', {...CLAUDE, provider: 'constructor'}], ['an unknown client', {...CLAUDE, client: 'web'}], ['no client', {...CLAUDE, client: undefined}],
    ['a spaced host', {...CLAUDE, hostId: 'bad host'}], ['a 129-character host', {...CLAUDE, hostId: 'h'.repeat(129)}], ['an empty source', {...CLAUDE, sourceId: ''}],
    ['a numeric source', {...CLAUDE, sourceId: 5}], ['a 128-character host and source', {...CLAUDE, hostId: id128('h'), sourceId: id128('s')}],
    ['an extension member', {...CLAUDE, description: 'synthetic legacy extension'}], ['its own hook member', {...CLAUDE, hook: 'Stop'}],
  ] as const) {
    for (const version of [undefined, '1.2'] as const) {
      add({name: `source with ${what} ${versionName(version)}`, configuration, version, input: payload('claude', 'SessionStart', {transcript_path: titled})});
    }
  }

  // Title sources, at 1.1 and 1.2, for a root's SessionStart.
  const claudeTitles: [string, unknown][] = [
    ['a custom title', titled], ['an AI title', files.transcript('ai')], ['an AI title then a custom one', files.transcript('ai-then-custom')],
    ['a custom title then an AI one', files.transcript('custom-then-ai')], ['two custom titles', files.transcript('two-custom')],
    ['a valid custom title then an invalid one', files.transcript('custom-then-invalid')], ['a credential-like custom title', files.transcript('secret')],
    ['a title with a control character', files.transcript('control')], ['a 200-character title', files.transcript('long')],
    ['a 160-character astral title', files.transcript('astral')], ['an empty title', files.transcript('empty-title')],
    ['a numeric title', files.transcript('numeric-title')], ['another session\'s titles', files.transcript('other-session')],
    ['malformed and non-object lines', files.transcript('malformed')], ['a title on a line over 64 KiB', files.transcript('long-line')],
    ['a custom title before a 1 MiB tail with an AI title in it', files.transcript('big-custom-outside')],
    ['a custom title inside a 1 MiB tail', files.transcript('big-custom-inside')], ['more than 8192 lines', files.transcript('many-lines')],
    ['an empty transcript', files.transcript('empty')], ['a missing transcript', join(files.root, 'transcripts', 'missing.jsonl')],
    ['a transcript that is not JSONL', files.transcript('not-jsonl.txt')], ['a relative transcript path', 'transcripts/titled.jsonl'],
    ['a transcript path with a control character', `${titled}\u0007`], ['a FIFO transcript', files.fifo], ['a directory transcript', join(files.root, 'transcripts', 'directory.jsonl')],
    ['a Windows transcript path', 'C:\\synthetic-bunny-1865\\missing.jsonl'], ['a numeric transcript path', 7], ['no transcript path', undefined],
  ];
  for (const version of ['1.1', '1.2'] as const) {
    for (const [what, path] of claudeTitles) {
      add({name: `claude ${version} title from ${what}`, configuration: CLAUDE, version, input: payload('claude', 'SessionStart', {session_id: 'session-1', transcript_path: path})});
    }
    for (const [what, sessionId, home] of [
      ['a thread name', 'codex-titled', undefined], ['a renamed thread', 'codex-renamed', undefined], ['a cleared thread name', 'codex-cleared', undefined],
      ['no row', 'codex-unlisted', undefined], ['a 200-character thread name', 'codex-long', undefined], ['a credential-like thread name', 'codex-secret', undefined],
      ['a thread name with a control character', 'codex-control', undefined], ['a numeric thread name', 'codex-numeric', undefined],
      ['a row without a thread name', 'codex-unnamed', undefined], ['no session index', 'codex-titled', files.emptyCodexHome],
      ['a thread name before a 1 MiB tail', 'codex-early', files.bigCodexHome], ['a thread name inside a 1 MiB tail', 'codex-late', files.bigCodexHome],
    ] as const) {
      add({name: `codex ${version} title from ${what}`, configuration: CODEX_CLI, version, input: payload('codex', 'SessionStart', {session_id: sessionId, transcript_path: titled}),
        ...(home === undefined ? {} : {codexHome: home})});
    }
  }

  // Projects from the hook's working directory.
  for (const [what, cwd] of [['a POSIX path', '/home/owner/projects/demo'], ['a trailing separator', '/home/owner/projects/demo//'],
    ['a Windows path', 'C:\\Users\\owner\\projects\\demo\\'], ['the root', '/'], ['a dot', '/home/owner/.'], ['two dots', '/home/owner/..'],
    ['a credential-like name', '/home/owner/token=abcdef123456'], ['a control character', '/home/owner/de\u0007mo'], ['an 80-character name', `/home/${'p'.repeat(80)}`],
    ['an 81-character name', `/home/${'p'.repeat(81)}`], ['an astral name', `/home/${'\u{1F600}'.repeat(80)}`], ['an empty path', ''], ['a numeric path', 7]] as const) {
    for (const version of VERSIONS) add({name: `claude ${versionName(version)} project from ${what}`, configuration: CLAUDE, version, input: payload('claude', 'SessionStart', {cwd})});
  }

  // Host sessions from the 1.2 environment.
  for (const [what, environment] of [
    ['Claude Desktop', DESKTOP], ['another entrypoint', {...DESKTOP, CLAUDE_CODE_ENTRYPOINT: 'cli'}], ['no host session', {CLAUDE_CODE_ENTRYPOINT: 'claude-desktop'}],
    ['a spaced host session', {...DESKTOP, CLAUDE_CODE_HOST_SESSION_ID: 'bad id'}], ['a 128-character host session', {...DESKTOP, CLAUDE_CODE_HOST_SESSION_ID: id128('l')}],
    ['an empty environment', {}],
  ] as const) {
    for (const version of VERSIONS) {
      add({name: `claude ${versionName(version)} host session with ${what}`, configuration: CLAUDE, version, input: payload('claude', 'UserPromptSubmit'), environment});
    }
    add({name: `codex 1.2 host session with ${what}`, configuration: CODEX_DESKTOP, version: '1.2', input: payload('codex', 'UserPromptSubmit'), environment});
  }

  // The 2048-byte bound of the 1.x envelope, which drops the title first, then the project, then the host session.
  const wide = {...CLAUDE, hostId: id128('h'), sourceId: id128('s')};
  for (const name of Object.keys(BOUND_TITLES)) {
    for (const version of VERSIONS) {
      add({name: `claude ${versionName(version)} metadata bound with ${name}`, configuration: wide, version, environment: {...DESKTOP, CLAUDE_CODE_HOST_SESSION_ID: id128('l')},
        input: {hook_event_name: 'PostToolUse', session_id: id128('a'), prompt_id: id128('t'), tool_use_id: id128('u'), cwd: `/home/${'\u{1F600}'.repeat(80)}`,
          transcript_path: files.transcript(`bound-${name.replaceAll(' ', '-')}`)}});
    }
  }
  return all;
}

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;
const custom = (title: unknown, sessionId = 'session-1'): string => line({type: 'custom-title', sessionId, customTitle: title});
const ai = (title: unknown, sessionId = 'session-1'): string => line({type: 'ai-title', sessionId, aiTitle: title});
const filler = (bytes: number): string => {
  const row = line({type: 'user', sessionId: 'session-1', message: 'f'.repeat(1000)});
  return row.repeat(Math.ceil(bytes / row.length));
};

async function writePrivate(file: string, text: string): Promise<void> {
  await writeFile(file, text, {mode: 0o600});
  await chmod(file, 0o600);
}

/** The synthetic transcripts, Codex homes and FIFO the title cases read, in a new private directory. */
async function writeFiles(root: string): Promise<Files> {
  const transcripts = join(root, 'transcripts');
  await mkdir(transcripts, {mode: 0o700});
  const transcript = (name: string): string => join(transcripts, name.includes('.') ? name : `${name}.jsonl`);
  const texts: Record<string, string> = {
    'titled': custom('Synthetic custom title'),
    'ai': ai('Synthetic AI title'),
    'ai-then-custom': ai('Synthetic AI title') + custom('Synthetic custom title'),
    'custom-then-ai': custom('Synthetic custom title') + ai('Synthetic AI title'),
    'two-custom': custom('First custom title') + custom('Second custom title'),
    'custom-then-invalid': custom('Synthetic custom title') + custom('token=abcdef123456') + ai('Synthetic AI title'),
    'secret': custom('Bearer abcdefghijklmnop'),
    'control': custom('Synthetic\u0007title') + ai('Synthetic AI title'),
    'long': custom('L'.repeat(200)),
    'astral': custom('\u{1F600}'.repeat(160)),
    'empty-title': custom('') + ai('Synthetic AI title'),
    'numeric-title': custom(7),
    'other-session': custom('Another session', 'session-9') + ai('Another AI title', 'session-9'),
    'malformed': '{not json\n[1,2]\nnull\n"text"\n' + custom('Synthetic custom title') + '\n\n',
    'long-line': line({type: 'custom-title', sessionId: 'session-1', customTitle: 'Hidden title', padding: 'p'.repeat(70_000)}) + ai('Synthetic AI title'),
    'big-custom-outside': custom('Early custom title') + filler(1_100_000) + ai('Late AI title'),
    'big-custom-inside': filler(1_100_000) + custom('Late custom title'),
    'many-lines': '{}\n'.repeat(9000) + custom('Synthetic custom title'),
    'empty': '',
    'not-jsonl.txt': custom('Synthetic custom title'),
  };
  for (const [name, title] of Object.entries(BOUND_TITLES)) texts[`bound-${name.replaceAll(' ', '-')}`] = custom(title, id128('a'));
  for (const [name, text] of Object.entries(texts)) await writePrivate(transcript(name), text);
  await mkdir(join(transcripts, 'directory.jsonl'));
  const fifo = join(transcripts, 'fifo.jsonl');
  execFileSync('mkfifo', ['-m', '600', fifo]);

  const codexHome = join(root, 'codex');
  await mkdir(codexHome, {mode: 0o700});
  const row = (id: string, name?: unknown): string => line(name === undefined ? {id, updated_at: '2026-11-18T00:00:00Z'} : {id, thread_name: name, updated_at: '2026-11-18T00:00:00Z'});
  await writePrivate(join(codexHome, 'session_index.jsonl'), [
    row('codex-titled', 'Synthetic thread'), row('session-1', 'Synthetic session thread'), row('codex-renamed', 'First name'), '{broken\n', row('codex-renamed', 'Second name'),
    row('codex-cleared', 'Cleared name'), row('codex-cleared', null), row('codex-long', 'N'.repeat(200)), row('codex-secret', 'password: hunter2'),
    row('codex-control', 'Thread\u0007name'), row('codex-numeric', 4), row('codex-unnamed'), row('session-9', 'Another thread'),
  ].join(''));
  const emptyCodexHome = join(root, 'codex-empty');
  await mkdir(emptyCodexHome, {mode: 0o700});
  const bigCodexHome = join(root, 'codex-big');
  await mkdir(bigCodexHome, {mode: 0o700});
  await writePrivate(join(bigCodexHome, 'session_index.jsonl'), row('codex-early', 'Early thread') + row('codex-filler', 'f'.repeat(1000)).repeat(1100) + row('codex-late', 'Late thread'));
  return {root, codexHome, emptyCodexHome, bigCodexHome, transcript, fifo};
}

/** One producer file per source configuration and version, without a receipt, as the earlier migration API left it. */
function producers(root: string, port: number): (configuration: Configuration, version: Version | undefined) => Promise<string> {
  const made = new Map<string, string>();
  return async (configuration, version) => {
    const key = JSON.stringify([configuration, version ?? null]);
    const known = made.get(key);
    if (known !== undefined) return known;
    const dir = join(root, `producer-${made.size}`);
    await mkdir(dir, {mode: 0o700});
    const path = join(dir, 'producer.json');
    await writePrivate(path, JSON.stringify({...(version === undefined ? {} : {lifecycleVersion: version}), enabled: true, qualified: true, source: configuration,
      endpoint: `http://127.0.0.1:${port}/api/monitor/v1/events`, token: TOKEN}));
    made.set(key, path);
    return path;
  };
}

/** What the golden file keeps of one case: how the hook ended and, for a publication, the call's body. */
type Golden = {name: string; result: string; body?: string};

const isFields = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

it('every hook fixture, lifecycle version and title source publishes the golden bytes, which are the retained path\'s observation', async context => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bunny-hook-golden-')));
  await chmod(root, 0o700);
  context.after(() => rm(root, {recursive: true, force: true}));
  const files = await writeFiles(root);
  // A loopback edge that takes every publication and keeps its body.
  const bodies: string[] = [];
  const edge = createServer((request, response) => {
    let text = '';
    request.setEncoding('utf8').on('data', (chunk: string) => { text += chunk; }).once('end', () => {
      bodies.push(text);
      response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({schema: REMOTE_SCHEMA, status: 'published'}));
    });
  });
  edge.listen(0, '127.0.0.1');
  await once(edge, 'listening');
  context.after(() => { edge.closeAllConnections(); edge.close(); });
  const producerOf = producers(root, (edge.address() as AddressInfo).port);
  const codexHome = process.env.CODEX_HOME;
  context.after(() => { if (codexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codexHome; });

  const all = cases(files);
  assert.equal(new Set(all.map(entry => entry.name)).size, all.length, 'case names are unique');
  const records: Golden[] = [];
  for (const entry of all) {
    process.env.CODEX_HOME = entry.codexHome ?? files.codexHome;
    const nowMs = entry.nowMs ?? NOW;
    const environment = entry.environment ?? {};
    bodies.length = 0;
    const result = await runHook({
      producer: await producerOf(entry.configuration, entry.version), input: Readable.from([Buffer.from(JSON.stringify(entry.input))]),
      deadline: performance.now() + HOOK_BUDGET_MS, now: () => nowMs, environment,
    });
    const record: Golden = {name: entry.name, result: result.status === 'skipped' ? `skipped: ${result.reason}` : result.status === 'published' ? 'published' : `${result.status}: ${result.code}`};
    if (result.status === 'published') {
      assert.equal(bodies.length, 1, `${entry.name}: one call`);
      const body = bodies[0] ?? '';
      const {message} = JSON.parse(body) as {message: {id: string; traceparent: string}};
      assert.equal(result.messageId, message.id, entry.name);
      record.body = body.replace(message.id, '<id>').replace(message.traceparent, '<traceparent>');
    } else {
      assert.equal(bodies.length, 0, `${entry.name}: nothing sent`);
    }
    records.push(record);

    // The retained path beside it: the normalizers, then the earlier mapping.
    if (!isFields(entry.input) || typeof entry.input.hook_event_name !== 'string') {
      assert.equal(record.result, 'skipped: input', entry.name);
      continue;
    }
    const source = {...entry.configuration, hook: entry.input.hook_event_name} as unknown as SourceConfiguration;
    const envelope = entry.version === undefined ? normalizeHook(entry.input, source, nowMs)
      : await enrichHook(entry.input, source, nowMs, {lifecycleVersion: entry.version, environment});
    const retained = envelope === null ? undefined : observationOf(envelope);
    if (retained === undefined) assert.equal(record.result, 'skipped: event', entry.name);
    else if (record.body === undefined) assert.notEqual(record.result, 'skipped: event', entry.name);
    else assert.ok(record.body?.endsWith(`,"data":${JSON.stringify(retained)}}}`), `${entry.name}: the retained path's observation, byte for byte`);
  }

  if (process.env.BUNNY_WRITE_HOOK_GOLDEN === '1') {
    await writeFile(GOLDEN, `[\n${records.map(record => JSON.stringify(record)).join(',\n')}\n]\n`);
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden[];
  assert.deepEqual(records.map(record => record.name), golden.map(record => record.name), 'the same cases in the same order');
  for (const [index, record] of records.entries()) assert.deepEqual(record, golden[index], record.name);
  // The cases reach every outcome they are meant to: titles of both sources, each metadata member and the bound.
  const published = golden.filter(record => record.body !== undefined).map(record => record.body ?? '');
  for (const member of ['"title":{"value":"Synthetic custom title","source":"user"}', '"title":{"value":"Synthetic AI title","source":"provider"}',
    '"title":{"value":"Synthetic thread","source":"provider"}', '"project":"demo"', '"hostSessionId":"local_0123abcd"', '"kind":"attention-resolved"',
    '"parent":{"status":"known"']) {
    assert.ok(published.some(body => body.includes(member)), member);
  }
  const bound = (name: string): string => golden.find(record => record.name === `claude 1.2 metadata bound with ${name}`)?.body ?? '';
  assert.deepEqual(['a 2048-byte envelope', 'a 2049-byte envelope'].map(name => [bound(name).includes('"title"'), bound(name).includes('"project"'), bound(name).includes('"hostSessionId"')]),
    [[true, true, true], [false, true, true]], 'the bound keeps a 2048-byte envelope\'s title and drops a 2049-byte one\'s');
  for (const secret of [CANARY, TOKEN]) assert.equal(published.some(body => body.includes(secret)), false, 'a dropped field or the token was published');
}, 120_000);

/** Loads a module in a new Node process and prints every module it loaded, by URL. */
const LIST_LOADED = `
import {registerHooks} from 'node:module';
const loaded = [];
registerHooks({load(url, context, next) { loaded.push(url); return next(url, context); }});
await import(process.argv[1]);
process.stdout.write(JSON.stringify(loaded));
`;

it('the hook\'s module loads its adapter, the SDK and the contracts, and no other runtime code or agent-state', () => {
  const hookModule = new URL('../src/hook/index.js', import.meta.url).href;
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', LIST_LOADED, hookModule], {encoding: 'utf8', timeout: 10_000});
  assert.equal(ran.status, 0, ran.stderr);
  const loaded = (JSON.parse(ran.stdout) as string[]).filter(url => url.startsWith('file:'));
  const runtime = new URL('../', import.meta.url).href;
  const hookDir = new URL('../src/hook/', import.meta.url).href;
  assert.deepEqual(loaded.filter(url => url.startsWith(runtime) && !url.startsWith(hookDir)), [], 'runtime code outside src/hook');
  assert.ok(loaded.includes(new URL('../src/hook/adapter.js', import.meta.url).href), 'the adapter');
  const packages = [...new Set(loaded.flatMap(url => /\/packages\/([^/]+)\//.exec(url)?.[1] ?? []))].sort();
  assert.deepEqual(packages, ['event-contracts', 'lifecycle-contracts', 'sdk'], 'the workspace packages the hook loads');
});
