import assert from 'node:assert/strict';
import {it} from './support.js';

type Hook = (api: object, event: object, next: (event: object) => Promise<object>) => Promise<unknown>;
type Element = {kind: string; children?: (string | Element)[]; key?: string; onPress?: () => Promise<void>};
type Register = (on: (name: string, matcher: object | Hook, hook?: Hook) => {catch: (handler: Hook) => void}) => void;
const plugin = await import(new URL('../../plugins/claude-read/hooks/register.js', import.meta.url).href) as {register: Register};

function fixture() {
  const hooks = new Map<string, Hook>(), calls: {action: string; promptId?: string; target?: object}[] = [];
  const state = {version: '2.1.292', surface: 'terminal', sessionId: 'session-a', fail: false, result: 'confirmed', opened: 0};
  const api = {
    session: {id: () => state.sessionId, version: () => ({version: state.version}), surface: () => state.surface},
    env: {get: () => '/synthetic/path'}, command: {register: () => {}},
    process: {run: (_args: string[], options: {stdin: string}) => {
      if (state.fail) throw new Error('synthetic failure');
      const request = JSON.parse(options.stdin) as {action: string; promptId?: string; target?: object};
      calls.push(request);
      const target = {data: {identity: {sessionId: state.sessionId}, turn: {id: request.promptId}}};
      return {exitCode: 0, isStdoutTruncated: false, stdout: JSON.stringify(request.action === 'bind' ? {status: 'ready', target} : {status: state.result})};
    }},
    ui: {open: () => {state.opened += 1;}, invalidate: (event: string) => {assert.equal(event, 'ui.render');}, resolve: () => ({
      Box: (props: Omit<Element, 'kind'>) => ({kind: 'Box', ...props}),
      Text: (props: Omit<Element, 'kind'>) => ({kind: 'Text', ...props}),
      Button: (props: Omit<Element, 'kind'>) => ({kind: 'Button', ...props}),
    })},
  };
  plugin.register((name, matcher, hook) => {hooks.set(name, hook ?? matcher as Hook); return {catch: () => {}};});
  const passthrough = {unchanged: true};
  const fire = async (name: string, event = {}) => {
    const hook = hooks.get(name);
    assert.ok(hook, name);
    return hook(api, event, () => Promise.resolve(passthrough));
  };
  const complete = async (promptId: string, turnId: string, options: {missingPrompt?: boolean; missingStop?: boolean; reason?: string; child?: boolean; isAborted?: boolean} = {}) => {
    if (options.missingPrompt !== true) assert.equal(await fire('classic.UserPromptSubmit', {session_id: state.sessionId, prompt_id: promptId}), passthrough);
    assert.equal(await fire('turn.start', {turnId}), passthrough);
    if (options.missingStop !== true) assert.equal(await fire('classic.Stop', {session_id: state.sessionId, prompt_id: promptId}), passthrough);
    assert.equal(await fire('turn.complete', {turnId, reason: options.reason ?? 'answer', isAborted: options.isAborted ?? false, ...(options.child === true ? {agentId: 'child'} : {})}), passthrough);
  };
  const render = async (surface = state.surface) => await fire('ui.render', {requestId: 'bunny-read', surface}) as Element;
  const button = (tree: Element) => tree.children?.find((child): child is Element => typeof child !== 'string' && child.kind === 'Button');
  return {state, calls, fire, complete, render, button, passthrough};
}

it('a native pane captures the lifecycle prompt of its reply, and rendering or completion sends no read', async () => {
  const world = fixture();
  await world.complete('prompt-a', 'native-a');
  assert.equal(world.calls.length, 0);
  await world.fire('command.run');
  const tree = await world.render(), old = world.button(tree);
  assert.ok(old?.onPress);
  assert.deepEqual(world.calls.map(call => call.action), ['bind']);
  await world.complete('prompt-b', 'native-b');
  await old.onPress();
  assert.deepEqual(world.calls[1]?.target, {data: {identity: {sessionId: 'session-a'}, turn: {id: 'prompt-a'}}});
  await old.onPress();
  assert.equal(world.calls.length, 2, 'an old callback cannot publish twice');
  await world.fire('command.run');
  assert.equal(world.calls[2]?.promptId, 'prompt-b');
});

it('missing correlation, unsuccessful or child completion, a new session and an unqualified version have no action', async () => {
  for (const options of [{missingPrompt: true}, {missingStop: true}, {reason: 'error'}, {child: true}, {isAborted: true}]) {
    const world = fixture();
    await world.complete('prompt-a', 'native-a', options);
    await world.fire('command.run');
    assert.equal(world.button(await world.render()), undefined);
    assert.deepEqual(world.calls, []);
  }
  for (const edit of [(state: ReturnType<typeof fixture>['state']) => {state.version = '2.1.293';},
    (state: ReturnType<typeof fixture>['state']) => {state.surface = 'desktop';},
    (state: ReturnType<typeof fixture>['state']) => {state.sessionId = 'new-session';}]) {
    const world = fixture();
    await world.complete('prompt-a', 'native-a');
    edit(world.state);
    await world.fire('command.run');
    assert.equal(world.button(await world.render()), undefined);
    assert.deepEqual(world.calls, []);
  }
});

it('a failed binding still opens a panel explaining that no read action is available', async () => {
  const world = fixture();
  await world.complete('prompt-a', 'native-a');
  world.state.fail = true;
  await world.fire('command.run');
  assert.equal(world.state.opened, 1);
  assert.equal(world.button(await world.render()), undefined);
  assert.match(JSON.stringify(await world.render()), /cannot be marked read/);
  assert.deepEqual(world.calls, []);
});

it('session clearing invalidates retained callbacks, other surfaces cannot render an action, and failures stay unconfirmed', async () => {
  const world = fixture();
  await world.complete('prompt-a', 'native-a');
  await world.fire('command.run');
  const old = world.button(await world.render());
  assert.ok(old?.onPress);
  assert.equal(world.button(await world.render('desktop')), undefined);
  assert.equal(await world.fire('session.end'), world.passthrough);
  world.state.sessionId = 'cleared-session';
  await old.onPress();
  assert.equal(world.calls.length, 1);
  await world.complete('prompt-c', 'native-c');
  await world.fire('command.run');
  world.state.fail = true;
  await world.button(await world.render())?.onPress?.();
  assert.match(JSON.stringify(await world.render()), /not confirmed/);
  assert.doesNotMatch(JSON.stringify(await world.render()), /Marked read/);
});
