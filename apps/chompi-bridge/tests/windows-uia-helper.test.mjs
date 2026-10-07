import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { HELPER_FOCUS_SETTLE_MS } from './routing-helpers.mjs';
import { asciiJson, encodeHelperCommand, HELPER_LOADER, HELPER_SCRIPT_ENV, helperLaunch, helperScriptPath, UiaHelper } from '../dist/windows/index.js';

/** A scripted stand-in for the PowerShell helper process. */
class FakeChild extends EventEmitter {
  constructor({ ready = true, reply } = {}) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.requests = [];
    this.killed = false;
    this.ended = false;
    this.reply = reply;
    this.writes = [];
    this.stdin = Object.assign(new EventEmitter(), {
      write: chunk => {
        this.writes.push(chunk);
        if (this.onWrite?.(chunk, this) === false) return true;
        for (const line of String(chunk).split('\n').filter(Boolean)) {
          const request = JSON.parse(line);
          this.requests.push(request);
          this.reply?.(request, this);
        }
        return true;
      },
      end: () => { this.ended = true; queueMicrotask(() => this.exit(0)); },
    });
    if (ready) queueMicrotask(() => this.out({ ready: true, protocol: 1 }));
  }
  out(value) { this.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
  raw(text) { this.stdout.emit('data', Buffer.from(text)); }
  exit(code) { if (this.exited) return; this.exited = true; this.emit('exit', code, null); }
  kill() { this.killed = true; queueMicrotask(() => this.exit(null)); return true; }
}

function spawner(make) {
  const children = [];
  const spawn = () => { const child = make(children.length); children.push(child); return child; };
  return { spawn, children };
}

const echo = (request, child) => queueMicrotask(() => child.out({ id: request.id, ok: true, value: { op: request.op } }));

test('requests and replies are newline-delimited JSON matched by request ID', async () => {
  const { spawn, children } = spawner(() => new FakeChild({
    reply: (request, child) => {
      // Reply out of order, split across chunks, with two replies in one chunk.
      if (request.id === 1) return;
      const first = JSON.stringify({ id: 1, ok: true, value: { pong: true } });
      const second = JSON.stringify({ id: 2, ok: true, value: { focused: false } });
      queueMicrotask(() => { child.raw(second.slice(0, 7)); child.raw(second.slice(7) + '\n' + first + '\n'); });
    },
  }));
  const helper = new UiaHelper({ spawn });
  const [a, b] = await Promise.all([helper.request('ping'), helper.request('composerFocused', { hwnd: 5, processId: 9 })]);
  assert.deepEqual(a, { ok: true, value: { pong: true } });
  assert.deepEqual(b, { ok: true, value: { focused: false } });
  assert.equal(children.length, 1);
  assert.deepEqual(children[0].requests[1], { id: 2, op: 'composerFocused', hwnd: 5, processId: 9 });
  await helper.close();
  assert.equal(children[0].ended, true);
});

test('a request timeout kills the helper and the next request starts a fresh one', async () => {
  const { spawn, children } = spawner(index => new FakeChild({ reply: index === 0 ? undefined : echo }));
  const helper = new UiaHelper({ spawn, requestTimeoutMs: 30 });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-timeout' });
  assert.equal(children[0].killed, true);
  assert.deepEqual(await helper.request('ping'), { ok: true, value: { op: 'ping' } });
  assert.equal(children.length, 2);
  await helper.close();
});

test('a crash fails pending requests and the helper restarts on demand', async () => {
  const { spawn, children } = spawner(index => new FakeChild({
    reply: index === 0 ? (request, child) => queueMicrotask(() => child.exit(1)) : echo,
  }));
  const helper = new UiaHelper({ spawn });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-exited' });
  assert.deepEqual(await helper.request('ping'), { ok: true, value: { op: 'ping' } });
  assert.equal(children.length, 2);
  await helper.close();
});

test('a helper that never reports ready is stopped', async () => {
  const { spawn, children } = spawner(() => new FakeChild({ ready: false }));
  const helper = new UiaHelper({ spawn, startTimeoutMs: 30 });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-start-timeout' });
  assert.equal(children[0].killed, true);
  await helper.close();
});

test('a spawn failure is an unknown reason, not an exception', async () => {
  const helper = new UiaHelper({ spawn: () => { throw new Error('ENOENT powershell.exe'); } });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-spawn-failed' });
  const erroring = new UiaHelper({ spawn: () => { const child = new FakeChild({ ready: false }); queueMicrotask(() => child.emit('error', new Error('spawn EACCES'))); return child; } });
  assert.deepEqual(await erroring.request('ping'), { ok: false, reason: 'helper-exited' });
});

test('the queue is bounded', async () => {
  const { spawn } = spawner(() => new FakeChild());
  const helper = new UiaHelper({ spawn, maxPending: 2, requestTimeoutMs: 50 });
  const first = helper.request('ping');
  const second = helper.request('ping');
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-busy' });
  await Promise.all([first, second]);
  await helper.close();
});

test('restarts are rate limited', async () => {
  const { spawn, children } = spawner(() => new FakeChild({ reply: (request, child) => queueMicrotask(() => child.exit(1)) }));
  let now = 0;
  const helper = new UiaHelper({ spawn, restartBudget: { count: 2, windowMs: 1000 }, now: () => now });
  assert.equal((await helper.request('ping')).reason, 'helper-exited');
  assert.equal((await helper.request('ping')).reason, 'helper-exited');
  assert.equal((await helper.request('ping')).reason, 'helper-restart-limit');
  assert.equal(children.length, 2);
  now = 1001;
  assert.equal((await helper.request('ping')).reason, 'helper-exited');
  assert.equal(children.length, 3);
  await helper.close();
});

test('oversized or malformed output is a protocol error and never echoed', async () => {
  const canary = 'CANARY-conversation-title-1f3a';
  const { spawn, children } = spawner(index => new FakeChild({
    reply: index === 0
      ? (request, child) => queueMicrotask(() => child.raw('x'.repeat(70000)))
      : (request, child) => queueMicrotask(() => child.out({ id: request.id, ok: false, reason: `Exception: ${canary}` })),
  }));
  const helper = new UiaHelper({ spawn, maxLineLength: 65536 });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-protocol-error' });
  assert.equal(children[0].killed, true);
  const reply = await helper.request('ping');
  assert.deepEqual(reply, { ok: false, reason: 'helper-error' }, 'free-text reasons are replaced');
  assert.equal(JSON.stringify(reply).includes(canary), false);
  await helper.close();
});

test('requests after close are refused without spawning', async () => {
  const { spawn, children } = spawner(() => new FakeChild({ reply: echo }));
  const helper = new UiaHelper({ spawn });
  await helper.close();
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-closed' });
  assert.equal(children.length, 0);
});

/** The body of a top-level helper function, or undefined. */
const functionBody = (script, name) => new RegExp(`^function ${name}(?:\\(\\$request\\)|\\([^)]*\\))? \\{\\n([\\s\\S]*?)\\n\\}$`, 'm').exec(script)?.[1]
  ?? new RegExp(`^function ${name}\\([^)]*\\) \\{ (.*) \\}$`, 'm').exec(script)?.[1];
const PICKER_FUNCTIONS = ['PickerLabel', 'MenuAbove', 'WindowFocus', 'MenuEntries', 'SettingButtons', 'ButtonExpanded', 'PrefixedButton', 'CodexPickerButton', 'SettingButton', 'QualifiedMenu', 'EntryIndex', 'EffortSlider', 'SliderRange', 'PickerAnnouncement', 'PickerClient', 'PickerState'];
const CARD_FUNCTIONS = ['CardButtonList', 'ClaudeStops', 'CodexGroupStops', 'FocusedIndex', 'CardContainer', 'CardId', 'CardButtons', 'CardRequest', 'FocusCardButton', 'InvokeCardButton'];

test('the shipped helper script changes UI state only inside the card operations and the setting actions, one kind of change each', () => {
  // #821 narrowed the old "never focuses or invokes" rule to the two card operations; #906 adds the seven setting
  // actions on the model and effort controls. Everything else stays read-only, and nothing in the helper types.
  const script = readFileSync(helperScriptPath(), 'utf8');
  const actions = {
    FocusCardButton: /\.SetFocus\(\)/g, InvokeCardButton: /\.Invoke\(\)/g, ExpandSetting: /\.Expand\(\)/g, CollapseSetting: /\.Collapse\(\)/g,
    InvokeSelectModel: /\.Invoke\(\)/g, FocusMenuEntry: /\.SetFocus\(\)/g, SelectMenuOption: /\.Select\(\)/g, SetSliderValue: /\.SetValue\(/g, FocusComposer: /\.SetFocus\(\)/g,
  };
  let rest = script;
  for (const [name, own] of Object.entries(actions)) {
    const body = functionBody(script, name);
    assert.ok(body, `${name} is a top-level function`);
    assert.equal(body.match(own)?.length, 1, `${name} makes its one change once`);
    for (const change of [/\.SetFocus\(\)/, /\.Invoke\(\)/, /\.Expand\(\)/, /\.Collapse\(\)/, /\.Select\(\)/, /\.SetValue\(/, /\.Toggle\(/, /AddToSelection/, /SendKeys/i, /SendInput/i]) {
      if (change.source !== own.source) assert.equal(change.test(body), false, `${name} must not use ${change}`);
    }
    rest = rest.replace(body, '');
  }
  for (const forbidden of [
    /SetFocus/i, /\.Invoke\(/, /\.Expand\(/, /\.Collapse\(/, /SetValue/, /\.Select\(\)/, /AddToSelection/, /\.Toggle\(/,
    /SendKeys/i, /SendInput/i, /keybd_event/i, /mouse_event/i, /Start-Process/i, /Invoke-Item/i, /ShellExecute/i,
    /Out-File/i, /Set-Content/i, /Add-Content/i, /Write-Host/i, /Write-Output/i,
  ]) assert.equal(forbidden.test(rest), false, `outside the card and setting actions the helper must not use ${forbidden}`);
  // Names reach a reply only through the picker read (#906), which returns model and effort labels.
  const outsidePicker = PICKER_FUNCTIONS.reduce((text, name) => text.replace(functionBody(script, name), ''), rest);
  assert.equal(/Current\.Name\s*\}|Cached\.Name\s*\}/.test(outsidePicker), false, 'no other operation returns a Name');
});

test('the helper starts from a short encoded loader that reads the script path from its environment', () => {
  // The script with the card operations is longer than a Windows command line allows as base64 UTF-16 (32767
  // characters), so only a loader is encoded. The path travels in the environment, never inside the command, so no
  // character in it can end a PowerShell string: PowerShell treats typographic apostrophes (U+2018-U+201B) as quotes.
  assert.equal(HELPER_LOADER, `. ([System.Management.Automation.ScriptBlock]::Create([System.IO.File]::ReadAllText($env:${HELPER_SCRIPT_ENV}, [System.Text.Encoding]::UTF8)))`);
  for (const path of ["C:\\Users\\o'neil\\uia-helper.ps1", 'C:\\Users\\o\u2018ne\u2019il\u201a\u201b\\uia-helper.ps1', 'C:\\Users\\"x"; Start-Process calc\\uia-helper.ps1']) {
    const launch = helperLaunch(path, { SystemRoot: 'C:\\Windows', KEEP: '1' });
    assert.equal(launch.env[HELPER_SCRIPT_ENV], path, 'the exact path, unquoted');
    assert.equal(launch.env.KEEP, '1', 'the rest of the environment is kept');
    assert.ok(launch.command.startsWith('C:\\Windows') && /WindowsPowerShell.v1\.0.powershell\.exe$/.test(launch.command), 'Windows PowerShell 5.1 by absolute path');
    assert.deepEqual(launch.args.slice(0, -1), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand']);
    const decoded = Buffer.from(launch.args.at(-1), 'base64').toString('utf16le');
    assert.equal(decoded, HELPER_LOADER);
    assert.equal(decoded.includes('Users'), false, 'the command carries no path');
  }
  assert.ok(encodeHelperCommand(HELPER_LOADER).length < 4000);
  assert.match(readFileSync(helperScriptPath(), 'utf8'), /^[\x00-\x7f]*$/, 'the script is ASCII, so its UTF-8 read is exact');
});

test('the helper approval check is scoped to the target window, bounded and reads class names only', () => {
  const script = readFileSync(helperScriptPath(), 'utf8');
  assert.match(script, /'approvalVisible' \{ \$value = ApprovalVisible \$request \}/);
  const body = /^function ApprovalVisible\(\$request\) \{\n([\s\S]*?)\n\}$/m.exec(script)?.[1];
  assert.ok(body, 'ApprovalVisible is a top-level function');
  assert.match(body, /^\s+\$window = TargetWindow \$request$/m, 'it refuses a window that is not the requested process');
  assert.match(script, /\$ClaudeApprovalToken = 'epitaxy-approval-card'/);
  // Claude counts the token on every element, so a card under another control type cannot read as absent.
  assert.match(body, /'claude' \{ \$condition = \[System\.Windows\.Automation\.Condition\]::TrueCondition; \$token = \$ClaudeApprovalToken; \$key = 'approvalCards' \}/);
  assert.match(body, /'codex' \{ \$condition = Condition \$AE::ControlTypeProperty \(\[System\.Windows\.Automation\.ControlType\]::Edit\); \$token = \$ComposerToken; \$key = 'composers' \}/);
  assert.equal(/ControlType\]::Group/.test(body), false, 'the Claude count is not limited to Group elements');
  assert.match(body, /HasToken \$element\.Cached\.ClassName \$token/);
  assert.match(body, /\$window\.FindAll\(\$Scope::Descendants, \$condition\)/);
  assert.match(body, /\$cache\.Add\(\$AE::ClassNameProperty\)/);
  for (const forbidden of [/TreeWalker/, /NameProperty(?<!ClassNameProperty)/, /\.Name\b/, /ValuePattern/, /\.Value\b/, /FocusedElement/]) {
    assert.equal(forbidden.test(body), false, `approval check must not use ${forbidden}`);
  }
  assert.match(body, /return @\{ \$key = \$count \}/);
  assert.match(body, /Fail 'invalid-client'/);
});

test('the card operations are scoped to the target window, bounded, and read no Name or Value', () => {
  const script = readFileSync(helperScriptPath(), 'utf8');
  for (const op of ['cardButtons', 'focusCardButton', 'invokeCardButton']) {
    const name = op[0].toUpperCase() + op.slice(1);
    assert.match(script, new RegExp(`'${op}' \\{ \\$value = ${name} \\$request \\}`), `${op} is dispatched`);
    assert.match(functionBody(script, name), /^\s+\$window = TargetWindow \$request$/m, `${name} refuses a window that is not the requested process`);
  }
  for (const name of CARD_FUNCTIONS) {
    const body = functionBody(script, name);
    assert.ok(body, `${name} is a top-level function`);
    for (const forbidden of [/NameProperty(?<!ClassNameProperty)/, /\.Name\b/, /ValuePattern/, /\.Value\b/]) {
      assert.equal(forbidden.test(body), false, `${name} must not use ${forbidden}`);
    }
  }
  assert.match(script, /\$MaxCardButtons = 64/);
  const list = functionBody(script, 'CardButtonList');
  assert.match(list, /\.FindAll\(\$scope, \(Condition \$AE::ControlTypeProperty \(\[System\.Windows\.Automation\.ControlType\]::Button\)\)\)/, 'buttons only: text fields are never listed');
  for (const property of ['IsEnabledProperty', 'IsInvokePatternAvailableProperty', 'IsExpandCollapsePatternAvailableProperty']) assert.match(list, new RegExp(`\\$cache\\.Add\\(\\$AE::${property}\\)`));
  assert.match(list, /-gt \$MaxCardButtons\) \{ Fail 'card-too-many-buttons' \}/);
  const container = functionBody(script, 'CardContainer');
  assert.match(container, /HasToken \$element\.Cached\.ClassName \$ClaudeApprovalToken/, 'Claude: the approval-card token');
  assert.match(container, /\$classes\.StartsWith\(\$CodexRowPrefix, \$Ordinal\) -and \(HasToken \$classes \$CodexSelectedToken\)/, 'Codex: selected sidebar rows are counted');
  assert.match(container, /\$selectedRows -ne 1\) \{ return \$none \}/, 'Codex: exactly one selected row, the thread view');
  assert.match(functionBody(script, 'CardRequest'), /\(CardId \$card\.container\), \[string\]\$request\.cardId, \$Ordinal\)\) \{ Fail 'card-changed' \}/, 'focus and press act only on the card named');
  assert.match(functionBody(script, 'CardId'), /GetRuntimeId\(\)/, 'a card is identified by its runtime ID, not text');
  for (const name of ['FocusCardButton', 'InvokeCardButton']) {
    const body = functionBody(script, name);
    assert.match(body, /\$buttons\.Count -ne \$count\) \{ Fail 'card-changed' \}/, `${name} refuses a changed card`);
  }
  const invoke = functionBody(script, 'InvokeCardButton');
  const compare = invoke.indexOf('[System.Windows.Automation.Automation]::Compare($buttons[$index], $focused)');
  assert.ok(compare > 0 && compare < invoke.indexOf('.Invoke()'), 'InvokeCardButton checks keyboard focus before it invokes');
  assert.match(invoke, /return @\{ invoked = \$false \}/);
});

test('FocusCardButton reads focus back in a bounded poll, because Claude applies focus asynchronously', () => {
  const script = readFileSync(helperScriptPath(), 'utf8');
  assert.match(script, /^\$FocusPollMs = 25$/m);
  assert.match(script, /^\$FocusSettleMs = 400$/m, 'well inside the 4 s helper request timeout and the 2 s adapter call timeout');
  assert.equal(HELPER_FOCUS_SETTLE_MS, 400, 'the routing fake adapter models the same read-back bound');
  const body = functionBody(script, 'FocusCardButton');
  const setFocus = body.indexOf('.SetFocus()');
  const poll = body.indexOf('while ($observed -ne $index -and $clock.ElapsedMilliseconds -lt $FocusSettleMs) {');
  assert.ok(setFocus > 0 && poll > setFocus, 'the poll follows the single SetFocus');
  assert.match(body, /\$clock = \[System\.Diagnostics\.Stopwatch\]::StartNew\(\)/, 'a monotonic bound');
  assert.match(body, /Start-Sleep -Milliseconds \$FocusPollMs/);
  assert.equal(body.match(/\$observed = FocusedIndex \$buttons/g)?.length, 2, 'focus is only compared, never read as text');
  assert.match(body, /return @\{ focused = \$observed \}/, 'the reply shape is unchanged: the index observed, or -1');
});

test('a Claude question card stops only on its answer rows; permission cards and Codex keep every actionable button', () => {
  const script = readFileSync(helperScriptPath(), 'utf8');
  assert.match(script, /^\$ClaudeAnswerToken = 'text-left'$/m);
  const stops = functionBody(script, 'ClaudeStops');
  assert.match(stops, /HasToken \$b\.Cached\.ClassName \$ClaudeAnswerToken/, 'an exact class token, not text');
  assert.match(stops, /if \(\$answers\.Count -gt 0\) \{ return ,\$answers \}\n\s+return ,\$buttons/, 'no answer row: every actionable button');
  assert.match(functionBody(script, 'CardButtonList'), /\$cache\.Add\(\$AE::ClassNameProperty\)/);
  const container = functionBody(script, 'CardContainer');
  assert.match(container, /buttons = \(ClaudeStops \(CardButtonList \$cards\[0\] \$Scope::Descendants\)\)/, 'Claude cards use the stop rule');
  assert.match(container, /\$stops = CodexGroupStops \$group\n/, 'Codex cards do not');
  assert.equal(container.match(/ClaudeStops/g).length, 1);
});

test('a Codex card is found by structure, without needing focus: one on-screen group with text and two actionable buttons', () => {
  // Live check on 2026-10-05: Codex showed its escalation card with no element focused, so the card cannot be found
  // from the focused button.
  const script = readFileSync(helperScriptPath(), 'utf8');
  assert.match(script, /^\$MaxCardGroups = 512$/m);
  const container = functionBody(script, 'CardContainer');
  const codex = container.slice(container.indexOf('$composers = 0; $selectedRows = 0'));
  assert.match(codex, /if \(\$composers -ne 0 -or \$selectedRows -ne 1\) \{ return \$none \}/, 'a composer present, or not exactly one selected row: no search');
  assert.match(codex, /\$groupCache\.Add\(\$AE::ClassNameProperty\)\n\s+\$groupCache\.Add\(\$AE::IsOffscreenProperty\)/, 'one cached FindAll of Group elements');
  assert.match(codex, /\$window\.FindAll\(\$Scope::Descendants, \(Condition \$AE::ControlTypeProperty \(\[System\.Windows\.Automation\.ControlType\]::Group\)\)\)/);
  assert.match(codex, /if \(\$groups\.Count -gt \$MaxCardGroups\) \{ Fail 'card-too-many-groups' \}/, 'bounded');
  assert.match(codex, /if \(\[bool\]\$group\.GetCachedPropertyValue\(\$AE::IsOffscreenProperty\)\) \{ continue \}/, 'off-screen groups are ignored');
  assert.match(codex, /\$none\.cardGroups = \$candidates\.Count\n\s+if \(\$candidates\.Count -ne 1\) \{ return \$none \}/, 'zero or several candidates: no card');
  assert.equal(/FocusedElement|focusElsewhere|InsideWindow/.test(codex), false,
    'focus never decides the Codex card: a focused sidebar row or menu button outside the stops leaves it established');
  assert.match(codex, /return @\{ composers = 0; selectedRows = 1; cardGroups = 1; cards = 1; container = \$card\.group; buttons = \$card\.buttons \}/);
  assert.equal(/GetParent|TreeWalker/.test(codex), false, 'the card no longer starts from the focused button');
  const stops = functionBody(script, 'CodexGroupStops');
  assert.match(stops, /\$group\.FindAll\(\$Scope::Children, \$TextOrButton\)/, 'one cached read of the direct children per candidate');
  assert.match(stops, /if \(\$texts -lt 1 -or \$buttons -gt \$MaxCardButtons -or \$stops\.Count -lt 2\) \{ return \$null \}/,
    'a group without text (the side strip), with over 64 buttons or with fewer than two actionable buttons (message actions) is not a card');
  assert.match(stops, /-not \[bool\]\$child\.GetCachedPropertyValue\(\$AE::IsExpandCollapsePatternAvailableProperty\)/, 'the menu button is not a stop');
  for (const forbidden of [/NameProperty(?<!ClassNameProperty)/, /\.Name\b/, /ValuePattern/, /\.Value\b/]) {
    assert.equal(forbidden.test(stops) || forbidden.test(codex), false, `the Codex card search must not use ${forbidden}`);
  }
});

const NON_ASCII_TITLES = ['Résumé café', 'Plan \u2014 review', '\u4efb\u52a1\u8def\u7531', 'Ship it \u{1f680}', 'mixed \u00e9\u2014\u4e2d\u{1f600}\u0000\u007f'];

/** Windows PowerShell 5.1 reads redirected stdin in the console code page; decoding bytes as Latin-1 models that. */
const powershellStyleDecode = line => JSON.parse(Buffer.from(line, 'utf8').toString('latin1'));

test('request lines are pure ASCII and non-ASCII titles survive a code-page decoder', () => {
  for (const title of NON_ASCII_TITLES) {
    const line = asciiJson({ id: 1, op: 'codexSelectedTitle', title });
    assert.match(line, /^[\x00-\x7f]*$/, JSON.stringify(title));
    assert.equal(powershellStyleDecode(line).title, title, 'escapes decode to the exact UTF-16 string');
  }
  assert.equal(asciiJson({ t: '\u{1f680}' }), '{"t":"\\ud83d\\ude80"}', 'a surrogate pair becomes two escapes');
  // Raw UTF-8 would not survive the same decoder: this is the bug the escaping prevents.
  assert.notEqual(powershellStyleDecode(JSON.stringify({ title: NON_ASCII_TITLES[0] })).title, NON_ASCII_TITLES[0]);
});

test('the helper client writes only ASCII to the helper stdin', async () => {
  const { spawn, children } = spawner(() => new FakeChild({ reply: (request, child) => queueMicrotask(() => child.out({ id: request.id, ok: true, value: { matches: false, sameTitleRows: 0 } })) }));
  const helper = new UiaHelper({ spawn });
  for (const title of NON_ASCII_TITLES) {
    assert.deepEqual(await helper.request('codexSelectedTitle', { hwnd: 1, processId: 2, title }), { ok: true, value: { matches: false, sameTitleRows: 0 } });
  }
  for (const chunk of children[0].writes) assert.match(chunk, /^[\x00-\x7f]*$/);
  assert.deepEqual(children[0].writes.map(chunk => powershellStyleDecode(chunk.trim()).title), NON_ASCII_TITLES);
  await helper.close();
});

test('a reply split inside a multi-byte character still decodes', async () => {
  const { spawn } = spawner(() => new FakeChild({
    reply: (request, child) => queueMicrotask(() => {
      const bytes = Buffer.from(JSON.stringify({ id: request.id, ok: true, value: { note: '\u00e9\u{1f680}' } }) + '\n');
      const cut = bytes.indexOf(0xf0) + 2; // inside the four-byte emoji
      child.stdout.emit('data', bytes.subarray(0, cut));
      child.stdout.emit('data', bytes.subarray(cut));
    }),
  }));
  const helper = new UiaHelper({ spawn });
  assert.deepEqual(await helper.request('ping'), { ok: true, value: { note: '\u00e9\u{1f680}' } });
  await helper.close();
});

test('a broken stdin pipe is a helper failure, not a crash, and the next request restarts', async () => {
  const { spawn, children } = spawner(index => {
    const child = new FakeChild({ reply: index === 0 ? undefined : echo });
    if (index === 0) child.onWrite = (chunk, self) => { queueMicrotask(() => self.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))); return false; };
    return child;
  });
  const helper = new UiaHelper({ spawn });
  assert.deepEqual(await helper.request('ping'), { ok: false, reason: 'helper-exited' });
  assert.equal(children[0].killed, true);
  assert.deepEqual(await helper.request('ping'), { ok: true, value: { op: 'ping' } });
  assert.equal(children.length, 2);
  await helper.close();
});

test('the helper script escapes non-ASCII replies and answers a decode probe without echoing text', () => {
  const script = readFileSync(helperScriptPath(), 'utf8');
  assert.match(script, /\$NonAscii = \[regex\]'\[\^\\x00-\\x7F\]'/);
  assert.match(script, /Reply\(\$value\) \{\n\s+\[Console\]::Out\.WriteLine\(\$NonAscii\.Replace\(/);
  assert.match(script, /probeLength = \$text\.Length; probeSum = \$sum/);
  assert.equal(/\[Console\]::(Out\.Write|WriteLine)\((?!\$NonAscii)/.test(script), false, 'every reply goes through the escaper');
});

test('the picker read returns only the qualified shapes\' labels, and every setting action re-reads its target before acting (#906)', () => {
  const script = readFileSync(helperScriptPath(), 'utf8');
  for (const op of ['pickerState', 'expandSetting', 'collapseSetting', 'invokeSelectModel', 'focusMenuEntry', 'selectMenuOption', 'setSliderValue', 'focusComposer']) {
    const name = op[0].toUpperCase() + op.slice(1);
    assert.match(script, new RegExp(`'${op}' \\{ \\$value = ${name} \\$request \\}`), `${op} is dispatched`);
    assert.match(functionBody(script, name), /^\s+\$window = TargetWindow \$request$/m, `${name} refuses a window that is not the requested process`);
  }
  for (const name of PICKER_FUNCTIONS) {
    const fn = functionBody(script, name);
    assert.ok(fn, `${name} is a top-level function`);
    for (const forbidden of [/SetFocus/, /\.Invoke\(/, /\.Select\(\)/, /\.Toggle\(/, /\.Expand\(/, /\.Collapse\(/, /SetValue/, /Automation\.ValuePattern/, /TextPattern/, /DocumentRange/]) {
      assert.equal(forbidden.test(fn), false, `${name} must not use ${forbidden}`);
    }
  }
  // F3: only the qualified menus are read; any other menu, such as one listing tasks or projects, is never named.
  const qualified = functionBody(script, 'QualifiedMenu');
  assert.match(qualified, /StartsWith\(\$ClaudeModelButton, \$Ordinal\)/, 'Claude: the "Model: " menu only');
  assert.match(qualified, /\[string\]::Equals\(\$_\.Cached\.Name, \$CodexPickerName, \$Ordinal\)/, 'Codex: the "Select effort" picker');
  assert.match(qualified, /if \(\$null -ne \$button -and \(ButtonExpanded \$button\)\)/, 'the Codex model list only while the picker button is expanded');
  assert.match(qualified, /Where-Object \{ \$_\.kind -ne 'option' \}\)\.Count -eq 0/, 'a model list holds model options only');
  assert.match(functionBody(script, 'PickerState'), /\$qualified = QualifiedMenu \$window \$client/);
  assert.match(script, /^\$MaxPickerEntries = 64$/m);
  assert.match(script, /^\$MaxPickerLabel = 128$/m);
  assert.match(functionBody(script, 'MenuEntries'), /-gt \$MaxPickerEntries\) \{ Fail 'picker-too-many-entries' \}/);
  assert.match(script, /^\$ClaudeModelButton = 'Model: '$/m);
  assert.match(script, /^\$ClaudeEffortButton = 'Effort: '$/m);
  assert.match(functionBody(script, 'PrefixedButton'), /Fail 'composer-setting-count'/);
  assert.match(functionBody(script, 'CodexPickerButton'), /Fail 'codex-picker-button-ambiguous'/, 'the picker button is the one expandable button near the composer');
  // Fresh-read checks before each action (F1, F2).
  assert.match(functionBody(script, 'ExpandSetting'), /-ne \[System\.Windows\.Automation\.ExpandCollapseState\]::Collapsed\) \{ Fail 'setting-not-collapsed' \}/);
  const collapse = functionBody(script, 'CollapseSetting');
  assert.match(collapse, /if \(\$control -eq 'codex-picker'\) \{ Fail 'collapse-unsupported' \}/, 'Codex closes with one Escape instead');
  assert.match(collapse, /-ne \[System\.Windows\.Automation\.ExpandCollapseState\]::Expanded\) \{ Fail 'setting-not-expanded' \}/);
  assert.match(functionBody(script, 'InvokeSelectModel'), /\$qualified\.kind -ne 'codex-picker'\) \{ Fail 'menu-absent' \}/);
  const request = functionBody(script, 'MenuRequest');
  assert.match(request, /\$qualified\.kind -ne \[string\]\$request\.menu\) \{ Fail 'menu-absent' \}/);
  assert.match(request, /\$qualified\.entries\.Count -ne \[int\]\$count\) \{ Fail 'menu-changed' \}/);
  const select = functionBody(script, 'SelectMenuOption');
  assert.match(select, /if \(\$entry\.kind -ne 'option'\) \{ Fail 'not-an-option' \}/);
  const compare = select.indexOf('[System.Windows.Automation.Automation]::Compare($entry.element, $focused)');
  assert.ok(compare > 0 && compare < select.indexOf('.Select()'), 'Select only on the option holding keyboard focus');
  assert.match(functionBody(script, 'SetSliderValue'), /\$range\.value -ne \$from -or \[Math\]::Abs\(\$to - \$from\) -ne \$range\.step -or \$to -lt \$range\.min -or \$to -gt \$range\.max\) \{ Fail 'slider-changed' \}/);
  assert.match(functionBody(script, 'FocusComposer'), /if \(\$composers\.Count -ne 1\) \{ Fail 'composer-count' \}/);
  assert.match(script, /^\$SettleMs = 400$/m, 'actions read their effect back for at most 400 ms');
  assert.match(script, /ConvertTo-Json -InputObject \$value -Compress -Depth 6/, 'the reply keeps the menu entries');
});
