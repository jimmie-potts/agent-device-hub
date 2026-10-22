#!/usr/bin/env node
// Local Codex Desktop and CLI share this metadata-only adapter. Never infer their surface.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop', 'Interrupt', 'SessionEnd']);
const START_SOURCES = new Set(['startup', 'resume', 'clear', 'fork']);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}(?![\s\S])/.test(value);

/** Drop child events whole; select only root identity, without examining content fields. */
export function sanitizeMacCodexHook(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.hasOwn(raw, 'agent_id')) return null;
  const {hook_event_name, session_id, turn_id} = raw;
  if (!EVENTS.has(hook_event_name) || !identifier(session_id)) return null;
  if (hook_event_name === 'SessionStart' && !START_SOURCES.has(raw.source)) return null;
  const sessionEvent = hook_event_name === 'SessionStart' || hook_event_name === 'SessionEnd';
  if ((!sessionEvent || Object.hasOwn(raw, 'turn_id')) && !identifier(turn_id)) return null;
  return {hook_event_name, session_id, ...(turn_id === undefined ? {} : {turn_id})};
}

/** Lazy input: runHook verifies the private producer and metadata-only mode before this reads stdin. */
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
  const reading = () => {
    try {
      return process.getActiveResourcesInfo().some(name => name.startsWith('FSReq'));
    } catch {
      return false;
    }
  };
  const finish = () => {
    if (reading()) setTimeout(finish, 10);
    else process.exit(0);
  };
  process.on('uncaughtException', finish);
  process.on('unhandledRejection', finish);
  // Arm before loading runtime dependencies. A stalled file read must not hold up Codex.
  setTimeout(() => {
    if (reading()) process.kill(process.pid, 'SIGKILL');
    else process.exit(0);
  }, Math.max(1, budget - performance.now()));
  try {
    if (process.argv.length === 3) {
      const {runHook, MAX_INPUT_BYTES} = await import('@jimmie-potts/runtime/hook');
      await runHook({
        producer: process.argv[2],
        input: sanitizedInput(process.stdin, MAX_INPUT_BYTES),
        deadline: budget,
        requireMetadataOnly: true,
      });
    }
  } catch {
    // Observational and fail-open: no retry, output, permission decision or fallback enrichment.
  }
  finish();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await main();
