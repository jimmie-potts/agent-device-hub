// The control page of a CHOMPI bridge verification run (Hub #853). Plain JavaScript with no dependencies: it builds
// the controller from /api/harness/panel once, sends every operator action as JSON to the run's own harness API,
// and follows /api/harness/state. Controller actions go through the simulator's protocol input, so the bridge sees
// real reports. Updates change elements in place, so keyboard focus survives every refresh.
'use strict';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  for (const child of children) if (child !== null && child !== undefined) node.append(child);
  return node;
};
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setAttr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };

const CLIENT_NAMES = { codex: 'Codex', claude: 'Claude', other: 'Another app' };
let latest = null;
let latch = false;
/** Keys the page holds down in latch mode. */
const latched = new Set();

// Actions run one at a time, in order, so a release never overtakes its press.
let queue = Promise.resolve();
function post(area, body, label) {
  queue = queue.then(async () => {
    try {
      const response = await fetch(`/api/harness/${area}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const answer = await response.json().catch(() => ({}));
      setText($('action-status'), response.ok ? `${label}.` : `${label}: refused (${answer.error ?? response.status}).`);
    } catch {
      setText($('action-status'), `${label}: the run did not answer.`);
    }
    void refresh();
  });
  return queue;
}

// Light names come from the run: each LED is named by what its role can show (describeLights), never by color alone.
const cssColor = rgb => rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : '#000';

// Controller

const keyButtons = new Map();
const ledNodes = [];

function bindHold(button, control, label) {
  let down = false;
  const press = () => { if (down) return; down = true; void post('controller', { op: 'press', control }, `Pressed ${label}`); };
  const release = () => { if (!down) return; down = false; void post('controller', { op: 'release', control }, `Released ${label}`); };
  const toggle = () => {
    const held = latched.has(control);
    if (held) latched.delete(control); else latched.add(control);
    void post('controller', { op: held ? 'release' : 'press', control }, `${held ? 'Released' : 'Holding'} ${label}`);
  };
  button.addEventListener('pointerdown', event => { if (event.button !== 0) return; if (latch) toggle(); else press(); });
  button.addEventListener('pointerup', () => { if (!latch) release(); });
  button.addEventListener('pointerleave', () => { if (!latch) release(); });
  button.addEventListener('pointercancel', () => { if (!latch) release(); });
  button.addEventListener('keydown', event => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat) return;
    if (latch) toggle(); else press();
  });
  button.addEventListener('keyup', event => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!latch) release();
  });
  button.addEventListener('blur', () => { if (!latch) release(); });
  // Activation is handled above; a synthetic click (assistive technology) presses and releases once.
  button.addEventListener('click', event => { if (event.detail === 0 && !latch && !down) void post('controller', { op: 'click', control }, `Pressed and released ${label}`); });
}

function keyButton(key) {
  const led = el('span', { class: 'led', 'aria-hidden': 'true' });
  const light = el('span', { class: 'light' }, 'off');
  // The accessible name carries the light: "Slot 1, light idle".
  const button = el('button', { type: 'button', class: 'key', 'aria-pressed': 'false', 'aria-label': `${key.label}, light off`, 'data-control': key.control },
    led, el('span', { class: 'name', text: key.label }), light);
  bindHold(button, key.control, key.label);
  keyButtons.set(key.control, button);
  ledNodes.push({ index: key.led, led, light, button, label: key.label });
  return button;
}

function encoderCard(encoder, defaultCounts) {
  const headingId = `${encoder.id}-heading`;
  const leds = encoder.leds.map(index => {
    const led = el('span', { class: 'led', 'aria-hidden': 'true' });
    const light = el('span', { class: 'light' }, 'off');
    ledNodes.push({ index, led, light });
    return [led, light];
  });
  const isWheel = encoder.id === 'wheel';
  // The big wheel starts at one card step, knob 4 at one page step, knobs 1 and 2 at one model or effort step and
  // knob 3 at one suggestion step; the volume knob at one count.
  const counts = el('input', { id: `${encoder.id}-counts`, type: 'number', min: '1', max: '96', value: String(defaultCounts[encoder.id] ?? 1), inputmode: 'numeric' });
  const turn = sign => () => {
    const n = Math.max(1, Math.min(96, Number.parseInt(counts.value, 10) || 1));
    void post('controller', { op: 'turn', control: encoder.turn, delta: sign * n }, `Turned ${encoder.label} ${sign > 0 ? 'right' : 'left'} ${n}`);
  };
  const click = el('button', { type: 'button', class: isWheel ? 'wheel-click' : '', 'aria-pressed': 'false', 'aria-label': `${encoder.label} click`, 'data-control': encoder.click }, 'Click');
  bindHold(click, encoder.click, `${encoder.label} click`);
  keyButtons.set(encoder.click, click);
  return el('div', { class: 'encoder', role: 'group', 'aria-labelledby': headingId, 'data-encoder': encoder.id },
    el('h3', { id: headingId }, encoder.label, ...leds.map(([led]) => led)),
    el('span', { class: 'light' }, ...leds.map(([, light], i) => i === 0 ? light : [', ', light]).flat()),
    el('div', { class: 'row' },
      el('label', { for: counts.id }, 'Counts per turn'), counts),
    el('div', { class: 'row' },
      el('button', { type: 'button', 'aria-label': `${encoder.label} turn left`, onclick: turn(-1) }, 'Turn left'),
      el('button', { type: 'button', 'aria-label': `${encoder.label} turn right`, onclick: turn(1) }, 'Turn right'),
      click));
}

function buildController(panel) {
  for (const encoder of panel.encoders) $('encoders').append(encoderCard(encoder, panel.counts ?? {}));
  for (const key of panel.keys) {
    const button = keyButton(key);
    $(key.row === 'white' ? 'white-keys' : key.row === 'black' ? 'black-keys' : 'panel-keys').append(button);
  }
  $('latch').addEventListener('click', () => {
    latch = !latch;
    setAttr($('latch'), 'aria-pressed', String(latch));
    // Turning latch off lets go of every key it held.
    if (!latch) for (const control of [...latched]) { latched.delete(control); void post('controller', { op: 'release', control }, 'Released a latched key'); }
    setText($('action-status'), latch ? 'Latch on: each activation toggles a key.' : 'Latch off: keys are held while pressed.');
  });
  $('plug').addEventListener('click', () => {
    const plugged = latest?.controller?.plugged;
    void post('controller', { op: plugged ? 'unplug' : 'plug' }, plugged ? 'Unplugged the controller' : 'Plugged in the controller');
  });
}

function renderController(controller) {
  setText($('run-controller'), controller ? `${controller.plugged ? 'plugged in' : 'unplugged'}, ${controller.display === 'host' ? 'connected to the bridge' : 'disconnected pattern'}, profile ${controller.profileVersion}, brightness ${controller.brightness}%` : 'not simulated in this run');
  setText($('plug'), controller?.plugged === false ? 'Plug in controller' : 'Unplug controller');
  for (const { index, led, light, button, label } of ledNodes) {
    const rgb = controller?.leds[index];
    const color = cssColor(rgb);
    if (led.style.backgroundColor !== color) led.style.backgroundColor = color;
    setText(light, controller ? controller.lights[index] : 'unavailable');
    if (button) setAttr(button, 'aria-label', `${label}, light ${light.textContent}`);
  }
  for (const [control, button] of keyButtons) setAttr(button, 'aria-pressed', String(!!controller?.pressed.includes(control)));
}

// Desktop

const windows = {};

function windowCard(id) {
  const front = el('span', { class: 'badge' }, 'Behind');
  const card = { root: null, front };
  const header = el('header', {}, el('h3', { id: `${id}-window` }, CLIENT_NAMES[id]), front,
    el('button', { type: 'button', 'aria-label': `Bring ${CLIENT_NAMES[id]} to front`, onclick: () => post('desktop', { op: 'front', window: id }, `Brought ${CLIENT_NAMES[id]} to front`) }, 'Bring to front'));
  if (id === 'other') {
    card.root = el('article', { class: 'window', 'aria-labelledby': `${id}-window`, 'data-window': id }, header, el('p', { text: 'Any other app. Send and the wheel must do nothing here.' }));
    return card;
  }
  card.selected = el('dd', {}, 'none');
  card.composer = el('dd', {}, 'unfocused');
  card.text = el('dd', { class: 'composer-text' }, '(empty)');
  card.submitted = el('dd', {}, 'nothing yet');
  card.cardState = el('dd', {}, 'none');
  card.model = el('dd', {}, 'unknown');
  card.effort = el('dd', {}, 'unknown');
  card.picker = el('dd', {}, 'closed');
  // Claude's next-step band (#907); Codex has none.
  card.suggestions = id === 'claude' ? el('dd', {}, 'none') : null;
  card.stops = el('ol', { class: 'stops', 'aria-label': `${CLIENT_NAMES[id]} card stops` });
  card.tasks = el('ul', { class: 'tasks', 'aria-label': `${CLIENT_NAMES[id]} tasks` });
  const input = el('input', { id: `${id}-type`, type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'synthetic text' });
  const form = el('form', {
    onsubmit: event => {
      event.preventDefault();
      if (!input.value.trim()) return;
      void post('desktop', { op: 'type', client: id, text: input.value }, `Typed into the ${CLIENT_NAMES[id]} composer`);
      input.value = '';
    },
  }, el('label', { for: input.id }, `Type into ${CLIENT_NAMES[id]}`), input, el('button', { type: 'submit' }, 'Type'));
  card.focusButton = el('button', { type: 'button', onclick: () => post('desktop', { op: 'composer-focus', client: id, focused: !latest?.desktop?.windows[id].composer.focused }, `Changed ${CLIENT_NAMES[id]} composer focus`) }, 'Focus composer');
  card.root = el('article', { class: 'window', 'aria-labelledby': `${id}-window`, 'data-window': id }, header,
    el('dl', {},
      el('dt', {}, 'Selected task'), card.selected,
      el('dt', {}, 'Composer'), card.composer,
      el('dt', {}, 'Composer text'), card.text,
      el('dt', {}, 'Last submitted'), card.submitted,
      el('dt', {}, 'Card'), card.cardState,
      el('dt', {}, 'Model'), card.model,
      el('dt', {}, 'Effort'), card.effort,
      el('dt', {}, id === 'claude' ? 'Model menu or slider' : 'Picker'), card.picker,
      ...(card.suggestions ? [el('dt', {}, 'Next steps'), card.suggestions] : [])),
    card.stops,
    form,
    el('div', { class: 'row' }, card.focusButton,
      el('button', { type: 'button', onclick: () => post('desktop', { op: 'clear', client: id }, `Cleared the ${CLIENT_NAMES[id]} composer`) }, 'Clear composer')),
    el('div', { class: 'row' },
      el('button', { type: 'button', onclick: () => post('desktop', { op: 'open-card', client: id, kind: 'approval' }, `Opened an approval card in ${CLIENT_NAMES[id]}`) }, 'Open approval card'),
      el('button', { type: 'button', onclick: () => post('desktop', { op: 'open-card', client: id, kind: 'question' }, `Opened a question card in ${CLIENT_NAMES[id]}`) }, 'Open question card'),
      el('button', { type: 'button', onclick: () => post('desktop', { op: 'close-card', client: id }, `Closed the ${CLIENT_NAMES[id]} card`) }, 'Close card')),
    ...(card.suggestions ? [el('div', { class: 'row' },
      el('button', { type: 'button', onclick: () => post('desktop', { op: 'show-suggestions' }, 'Claude shows three synthetic next steps') }, 'Show next steps'),
      el('button', { type: 'button', onclick: () => post('desktop', { op: 'hide-suggestions' }, 'Claude hides its next steps') }, 'Hide next steps'))] : []),
    el('h4', { class: 'sr-only' }, `${CLIENT_NAMES[id]} tasks`), card.tasks);
  return card;
}

/** Keyed list rendering: existing items are updated in place, so a focused control keeps focus. */
function renderList(container, items, keyOf, build, update) {
  const existing = new Map([...container.children].map(child => [child.dataset.key, child]));
  let previous = null;
  for (const item of items) {
    const key = keyOf(item);
    let node = existing.get(key);
    if (!node) { node = build(item); node.dataset.key = key; }
    existing.delete(key);
    update(node, item);
    const expected = previous ? previous.nextSibling : container.firstChild;
    if (expected !== node) container.insertBefore(node, expected);
    previous = node;
  }
  for (const node of existing.values()) node.remove();
}

function renderDesktop(desktop) {
  if (!desktop) {
    setText($('desktop-front'), 'This run has no simulated desktop.');
    return;
  }
  setText($('desktop-front'), `In front: ${desktop.foreground ? CLIENT_NAMES[desktop.foreground] : 'nothing'}.`);
  setText($('desktop-held'), desktop.held.length ? `Held keys: ${desktop.held.join(' + ')}${desktop.dictating ? ' (dictating)' : ''}.` : 'No keys held.');
  // The synthetic system audio the volume knob changes (#865); no window receives volume keys.
  if (desktop.system) setText($('desktop-audio'), `System volume ${desktop.system.volume}%${desktop.system.muted ? ', muted' : ''}.`);
  for (const id of ['codex', 'claude', 'other']) {
    const card = windows[id];
    const isFront = desktop.foreground === id;
    card.root.classList.toggle('front', isFront);
    card.front.classList.toggle('front', isFront);
    setText(card.front, isFront ? 'In front' : 'Behind');
    if (id === 'other') continue;
    const w = desktop.windows[id];
    const tasks = id === 'codex' ? w.threads.map(t => ({ id: t.id, title: t.title, archived: t.archived })) : w.sessions.map(s => ({ id: s.localId, title: s.title, archived: s.isArchived }));
    const selected = tasks.find(t => t.id === w.selected);
    setText(card.selected, selected ? selected.title : 'none');
    setText(card.composer, w.card && id === 'codex' ? 'replaced by the card' : w.composer.focused ? 'focused' : 'unfocused');
    setText(card.focusButton, w.composer.focused ? 'Unfocus composer' : 'Focus composer');
    setText(card.text, w.composer.text || '(empty)');
    setText(card.submitted, w.composer.submitted.length ? `"${w.composer.submitted.at(-1)}" (${w.composer.submitted.length} submitted)` : 'nothing yet');
    // The model and effort controls the knobs drive (#906): what is open and which entry has focus.
    if (w.picker) {
      setText(card.model, w.picker.model);
      setText(card.effort, w.picker.effort ?? 'none for this model');
      setText(card.picker, w.picker.open ? `${PICKER_NAMES[w.picker.open] ?? w.picker.open} open${w.picker.focus ? `, ${w.picker.focus} focused` : ''}` : 'closed');
    }
    // Claude's next-step band (#907): how many suggestions, which has focus, and whether ghost text shows.
    if (card.suggestions && w.suggestions) {
      const n = w.suggestions.labels.length;
      const focus = w.suggestions.focused === null ? 'none focused' : `suggestion ${w.suggestions.focused + 1} focused`;
      setText(card.suggestions, `${n ? `${n} suggestions, ${focus}` : 'no band'}; ghost text ${w.suggestions.ghost ? 'shown' : 'none'}`);
    }
    setText(card.cardState, w.card ? `${w.card.kind} card, ${w.card.focused === null ? 'no stop focused' : `stop ${w.card.focused + 1} of ${w.card.stops.length} focused`}${w.card.established ? '' : ', not established'}` : 'none');
    renderList(card.stops, w.card ? w.card.stops.map((label, i) => ({ label, i, focused: w.card.focused === i, card: w.card.id })) : [], s => `${s.card}:${s.i}`,
      () => el('li'), (node, s) => { setText(node, s.focused ? `${s.label} (focused)` : s.label); node.classList.toggle('focused', s.focused); });
    renderList(card.tasks, tasks, t => t.id, t => {
      const name = el('span');
      const button = el('button', { type: 'button', 'aria-label': `Select ${t.title} in ${CLIENT_NAMES[id]}`, onclick: () => post('desktop', { op: 'select', client: id, task: t.id }, `Selected ${t.title}`) }, 'Select');
      return el('li', {}, name, button);
    }, (node, t) => setText(node.firstChild, `${t.title}${t.archived ? ' (archived)' : ''}${t.id === w.selected ? ' (selected)' : ''}`));
  }
  renderList($('desktop-log'), desktop.log.slice().reverse(), e => String(e.seq), () => el('li'), (node, e) => setText(node, describe(e)));
}

const PICKER_NAMES = { 'model-menu': 'model menu', 'effort-slider': 'Effort slider', 'picker-main': 'picker', 'picker-list': 'model list' };

/** A picker change in the desktop log (#906): what opened, moved, changed or closed. */
function describePicker(e) {
  const where = CLIENT_NAMES[e.client];
  const at = e.position ? ` ${e.position} of ${e.count}` : '';
  switch (e.action) {
    case 'focus': return `${where} menu focus on entry${at}`;
    case 'pick-model': return `${where} model set to ${e.label}`;
    case 'effort': return `${where} effort set to ${e.label} (${e.position} of ${e.count})`;
    case 'split-pane': return `${where} split a pane (a Codex effort chord reached Claude)`;
    default: return `${where} ${e.action.replaceAll('-', ' ')}${e.label ? `: ${e.label}` : ''}`;
  }
}

/** A next-step band change in the desktop log (#907): shown, focused, filled into the draft, ghost text accepted or hidden. */
function describeSuggestion(e) {
  const at = e.position ? ` ${e.position} of ${e.count}` : '';
  switch (e.action) {
    case 'show-suggestions': return `Claude shows ${e.count} next steps`;
    case 'focus-suggestion': return `Claude next step${at} focused`;
    case 'fill-suggestion': return `Claude next step${at} filled the draft`;
    case 'accept-ghost': return 'Claude ghost text accepted into the draft';
    case 'hide-suggestions': return 'Claude next steps hidden';
    default: return `Claude next steps: ${e.action.replaceAll('-', ' ')}`;
  }
}

function describe(e) {
  const time = new Date(e.at).toISOString().slice(11, 23);
  const where = w => w ? CLIENT_NAMES[w] : 'nothing';
  switch (e.kind) {
    case 'key': return `${time} key ${e.action} ${e.keys.join('+') || '(all)'} in ${where(e.window)}`;
    case 'link': return `${time} link opened ${CLIENT_NAMES[e.client]} task ${e.task.slice(-4)}${e.followed ? '' : ' (no such task)'}`;
    case 'submit': return `${time} Enter submitted "${e.text}" in ${CLIENT_NAMES[e.client]}`;
    case 'card-focus': return `${time} card stop ${e.index + 1} focused in ${CLIENT_NAMES[e.client]}`;
    case 'card-press': return `${time} card stop pressed in ${CLIENT_NAMES[e.client]}: ${e.stop}`;
    case 'scroll': return `${time} scrolled ${CLIENT_NAMES[e.client]} ${e.notches}`;
    case 'dictation': return `${time} dictation ended${e.client ? `, text into ${CLIENT_NAMES[e.client]}` : ', no composer had focus'}`;
    case 'volume': return `${time} system volume key ${e.key}${e.presses > 1 ? ` x${e.presses}` : ''}, no window: volume ${e.volume}%${e.muted ? ', muted' : ''}`;
    case 'picker': return `${time} ${describePicker(e)}`;
    case 'suggestion': return `${time} ${describeSuggestion(e)}`;
    default: return `${time} operator ${e.action}`;
  }
}

// Hub

function renderHub(state) {
  const slots = new Map(state.slots.map(s => [s.taskId, s.slot]));
  const rows = state.hub.sessions.map(s => ({ ...s, slot: slots.get(s.provider === 'claude' ? s.hostSessionId : s.sessionId) ?? null }));
  renderList($('sessions'), rows, s => s.sessionId, s => {
    const activity = el('select', { 'aria-label': `Activity of ${s.title}`, onchange: event => post('hub', { op: 'activity', sessionId: s.sessionId, activity: event.target.value }, `Set ${s.title} ${event.target.value}`) },
      ...['active', 'idle', 'interrupted', 'ended', 'unknown'].map(value => el('option', { value }, value)));
    const attention = el('select', { 'aria-label': `Attention of ${s.title}`, onchange: event => post('hub', { op: 'attention', sessionId: s.sessionId, kind: event.target.value || null }, `Set ${s.title} attention ${event.target.value || 'none'}`) },
      el('option', { value: '' }, 'none'), ...['question', 'approval', 'input'].map(value => el('option', { value }, value)));
    const end = el('button', { type: 'button', 'aria-label': `End the turn of ${s.title}`, onclick: () => post('hub', { op: 'end-turn', sessionId: s.sessionId }, `Ended the turn of ${s.title}`) }, 'End turn');
    return el('tr', {}, el('td'), el('th', { scope: 'row' }), el('td', {}, activity), el('td', {}, attention), el('td'), el('td', {}, end));
  }, (row, s) => {
    const [slot, title, activityCell, attentionCell, notices] = row.children;
    setText(slot, s.slot === null ? 'none' : `Slot ${s.slot}`);
    setText(title, `${s.title} (${CLIENT_NAMES[s.provider]})`);
    const activity = activityCell.firstChild, attention = attentionCell.firstChild;
    if (document.activeElement !== activity && activity.value !== s.activity) activity.value = s.activity;
    const kind = s.attention[0] ?? '';
    if (document.activeElement !== attention && attention.value !== kind) attention.value = kind;
    const open = s.notices.filter(acknowledged => !acknowledged).length;
    setText(notices, open ? `${open} unacknowledged` : 'none');
  });
}

// Scenario and logs

function renderScenario(state) {
  const run = state.run;
  const button = $('scenario-run');
  if (!run.catalog) {
    setText($('scenario-text'), `This run is seeded with "${run.scenario}": ${run.description}. To run a catalog scenario here, reseed the run with npm run -s verify:chompi -- scenario <run-id> <scenario>.`);
    button.hidden = true;
  } else {
    // The button waits until the run is ready, so the scenario's first press reaches a connected controller.
    const waiting = state.ready === true ? '' : ` Waiting for the run to be ready (${state.ready}).`;
    setText($('scenario-text'), `Seeded with the catalog scenario "${run.catalog}". Run it once from this fresh state; its steps drive this page's controller, desktop and Hub.${state.scenario ? '' : waiting}`);
    button.hidden = false;
    button.disabled = !!state.scenario || state.ready !== true;
  }
  const control = $('run-control');
  control.hidden = !run.fault;
  if (run.fault) setText(control, `Negative control run, not a catalog scenario: ${run.description}. Its start fails a boundary check by design.`);
  const result = state.scenario;
  const outcome = $('scenario-outcome');
  setText(outcome, result ? `${result.id}: ${result.state}${result.error ? ` (${result.error})` : ''}` : '');
  outcome.className = `outcome ${result?.state ?? ''}`;
  renderList($('scenario-steps'), (result?.steps ?? []).map((s, i) => ({ ...s, i })), s => String(s.i), () => el('li'), (node, s) => {
    setText(node, `${s.outcome}: ${s.kind} ${s.name}${s.detail ? ` (${s.detail})` : ''}`);
    node.className = s.outcome;
  });
}

function renderLogs(state) {
  renderList($('bridge-log'), state.log.slice().reverse(), entry => String(entry.n), () => el('li'), (node, entry) => setText(node, JSON.stringify(entry.line)));
}

function renderFacts(state) {
  setText($('run-scenario'), state.run.scenario);
  setText($('run-bridge'), state.run.bridge);
  const feed = state.feed;
  setText($('run-feed'), feed ? `${feed.status}${feed.reason ? ` (${feed.reason})` : ''}, revision ${state.hub.revision}` : 'connecting');
  setText($('run-profile'), `version ${state.profileVersion}`);
}

async function refresh() {
  try {
    const response = await fetch('/api/harness/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(String(response.status));
    latest = await response.json();
    renderFacts(latest);
    renderController(latest.controller);
    renderDesktop(latest.desktop);
    renderHub(latest);
    renderScenario(latest);
    renderLogs(latest);
    document.body.dataset.ready = 'true';
  } catch {
    setText($('run-bridge'), 'not answering');
  }
}

async function start() {
  const panel = await (await fetch('/api/harness/panel', { cache: 'no-store' })).json();
  buildController(panel);
  for (const id of ['codex', 'claude', 'other']) {
    windows[id] = windowCard(id);
    $('windows').append(windows[id].root);
  }
  for (const button of document.querySelectorAll('[data-hub-add]')) {
    button.addEventListener('click', () => post('hub', { op: 'add-task', client: button.dataset.hubAdd }, `Added a ${CLIENT_NAMES[button.dataset.hubAdd]} task`));
  }
  $('drop-stream').addEventListener('click', () => post('hub', { op: 'drop-stream' }, 'Restarted the Hub stream'));
  $('profile-alternate').addEventListener('click', () => post('profile', { op: 'alternate' }, 'Saved a profile with another idle color'));
  $('profile-default').addEventListener('click', () => post('profile', { op: 'default' }, 'Saved a profile with the shipped colors'));
  $('scenario-run').addEventListener('click', () => post('scenario', { op: 'run' }, 'Started the scenario'));
  await refresh();
  setInterval(refresh, 250);
}

void start();
