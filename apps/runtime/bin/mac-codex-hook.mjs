#!/usr/bin/env node
// Local Codex Desktop and CLI share this metadata-only adapter. Never infer their surface.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

// Root events carry no agent_id. A Codex approval has no request ID, so PermissionRequest needs its turn: the core
// forgets such an approval at that turn's end.
const ROOT_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'Interrupt', 'SessionEnd']);
// Subagent events: the child's agent_id under the parent's session_id. The turn is never forwarded, so a child never
// borrows its parent's turn (Hub #1867).
const CHILD_EVENTS = new Set(['SubagentStart', 'SubagentStop']);
const START_SOURCES = new Set(['startup', 'resume', 'clear', 'fork']);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}(?![\s\S])/.test(value);

/**
 * Select only identity, without examining content fields: a root event's session and turn, or a subagent event's
 * parent session and agent. Any other event with an agent_id, such as a child's PermissionRequest, is dropped whole.
 */
export function sanitizeMacCodexHook(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const {hook_event_name, session_id} = raw;
  if (!identifier(session_id)) return null;
  if (CHILD_EVENTS.has(hook_event_name)) {
    const agent_id = Object.hasOwn(raw, 'agent_id') ? raw.agent_id : undefined;
    return identifier(agent_id) && agent_id !== session_id ? {hook_event_name, session_id, agent_id} : null;
  }
  if (!ROOT_EVENTS.has(hook_event_name) || Object.hasOwn(raw, 'agent_id')) return null;
  if (hook_event_name === 'SessionStart' && !START_SOURCES.has(raw.source)) return null;
  const {turn_id} = raw;
  const sessionEvent = hook_event_name === 'SessionStart' || hook_event_name === 'SessionEnd';
  if ((!sessionEvent || Object.hasOwn(raw, 'turn_id')) && !identifier(turn_id)) return null;
  return {hook_event_name, session_id, ...(turn_id === undefined ? {} : {turn_id})};
}

/** Lazy input: runHook verifies the private producer before this reads stdin. */
export async function* sanitizedInput(input, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of input) {
    size += chunk.length;
    if (size > maxBytes) return;
    chunks.push(chunk);
  }
  try {
    const raw = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
    const sanitized = sanitizeMacCodexHook(raw);
    if (sanitized !== null) yield Buffer.from(JSON.stringify(sanitized));
  } catch {
    // Invalid input sends nothing and never produces diagnostics containing client data.
  }
}

async function main() {
  const budget = 2900;
  const nativeWorkPending = () => {
    try {
      return process.getActiveResourcesInfo().some(name => name.startsWith('FSReq') || name === 'GetAddrInfoReqWrap');
    } catch {
      return false;
    }
  };
  const finish = () => {
    if (nativeWorkPending()) setTimeout(finish, 10);
    else process.exit(0);
  };
  process.on('uncaughtException', finish);
  process.on('unhandledRejection', finish);
  // Arm before loading runtime dependencies. Native filesystem or DNS work must not hold up Codex.
  setTimeout(() => {
    if (nativeWorkPending()) process.kill(process.pid, 'SIGKILL');
    else process.exit(0);
  }, Math.max(1, budget - performance.now()));
  try {
    if (process.argv.length === 3) {
      const {runHook, MAX_INPUT_BYTES} = await import('@jimmie-potts/runtime/hook');
      await runHook({
        producer: process.argv[2],
        input: sanitizedInput(process.stdin, MAX_INPUT_BYTES),
        deadline: budget,
      });
    }
  } catch {
    // Observational and fail-open: no retry, output or permission decision.
  }
  finish();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
