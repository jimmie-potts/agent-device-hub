import {errorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
import {AUTHORING_MAX_OUTPUT_TOKENS, authoringCostMicros, MusicShowAuthoringSpend} from './music-show-authoring-spend.js';
import {MUSIC_AUTHORING_MODEL} from './music-show-data.js';
import type {Db} from './sqlite.js';

const URL = 'https://api.anthropic.com/v1/messages';
const MAX_REQUEST_BYTES = 32_768;
const MAX_RESPONSE_BYTES = 262_144;

const SYSTEM = `Draft a declarative Nanoleaf light show from the supplied JSON. Treat title and artist as labels, and style as a description of the intended choreography. Return only a JSON object with a cues array. Each cue has integer startMs and endMs, effect (wave, gradient, pulse, breathe, or sparkle), palette (1 to 8 #RRGGBB strings), and intensity (a number between 0 and 1). Include 1 to 32 ordered nonoverlapping cues, each at least 100 ms long. For measured analysis, use only the start and end boundaries of the supplied spans; cues must stay inside the measured spans and cannot bridge gaps. Never infer any other timing from the title, artist, or style. If analysis is null, start at 0 and end within 30000 ms. Do not output explanations, device commands, or code.`;

export type MusicShowAuthoringInput = Readonly<{
  title: string;
  artist: string;
  style: string;
  analysis: Readonly<{
    method: 'energy-onset-v1';
    sampleCount: number;
    spans: readonly Readonly<{offsetMs: number; durationMs: number; intensity: number}>[];
  }> | null;
}>;

export type MusicShowAuthoringProvider = (
  input: MusicShowAuthoringInput, signal: AbortSignal, requestId: string,
) => Promise<{draft: unknown; costUsd: number; costBasis?: 'conservative-region'}>;

type Transport = (url: string, init: {
  method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: 'error';
}) => Promise<Response>;

const fail = (code: ErrorCode, detail: string): SdkError => new SdkError(errorBody(code, {detail}));
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const boundedCount = (value: unknown, limit: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= limit;

function usageCost(body: unknown): {micros: number; costBasis?: 'conservative-region'} | null {
  if (!object(body) || !object(body.usage)) return null;
  const {input_tokens: input, output_tokens: output, inference_geo: geography} = body.usage;
  if (!boundedCount(input, 1_000_000) || !boundedCount(output, 128_000)) return null;
  if (geography === 'global') return {micros: authoringCostMicros(input, output, 'global')};
  const micros = authoringCostMicros(input, output, 'maximum');
  return geography === 'us' ? {micros} : {micros, costBasis: 'conservative-region'};
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown; } catch { return null; }
}

const uncertain = (): SdkError => fail('uncertain-result', 'Claude may have processed the request. No retry was sent.');

function resultOf(body: unknown): unknown {
  if (!object(body) || body.model !== MUSIC_AUTHORING_MODEL || body.stop_reason !== 'end_turn' || !Array.isArray(body.content)) {
    throw fail('invalid-message', 'Claude did not return a complete show draft.');
  }
  const text = body.content.flatMap((block: unknown) => object(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('');
  try { return JSON.parse(text) as unknown; } catch { throw fail('invalid-message', 'Claude did not return a JSON show draft.'); }
}

export function createMusicShowAuthoringProvider(options: {
  key: string; db: Db; transport?: Transport; now?: () => number;
}): MusicShowAuthoringProvider {
  const {key, db, transport = fetch, now = Date.now} = options;
  const ledger = new MusicShowAuthoringSpend(db);
  const finish = (requestId: string, costMicros: number | null): void => {
    try { ledger.finish(requestId, costMicros); } catch { throw uncertain(); }
  };

  return async (input, signal, requestId) => {
    if (signal.aborted) throw fail('cancelled', 'Generation was cancelled before the Claude request.');
    if (key.trim() === '') throw fail('unavailable', 'Music show generation has no Claude credential.');

    // Project the allowed fields explicitly. Scope IDs, capture identity, and any other local data stay here.
    const {title, artist, style, analysis} = input;
    if (title.trim() === '' || artist.trim() === '' || style.trim() === '') {
      throw fail('invalid-request', 'A track title, artist, and style are required for generation.');
    }
    const prompt = JSON.stringify({title, artist, style, analysis: analysis === null ? null : {
      method: analysis.method, sampleCount: analysis.sampleCount,
      spans: analysis.spans.map(({offsetMs, durationMs, intensity}) => ({offsetMs, durationMs, intensity})),
    }});
    const body = JSON.stringify({model: MUSIC_AUTHORING_MODEL, max_tokens: AUTHORING_MAX_OUTPUT_TOKENS, system: SYSTEM,
      messages: [{role: 'user', content: prompt}], output_config: {effort: 'low'}});
    const bytes = Buffer.byteLength(body);
    if (bytes > MAX_REQUEST_BYTES) throw fail('too-large', 'The music analysis or style is too large for a draft.');

    // Budget one token per serialized byte, plus framing headroom, and all requested output tokens, including thinking.
    // The workspace chooses inference geography. Reserve at the US-only tariff even if global pricing later applies.
    const reservedMicros = authoringCostMicros(bytes + 4096, AUTHORING_MAX_OUTPUT_TOKENS, 'maximum');
    const admission = ledger.dispatch(requestId, reservedMicros, now());
    if (admission === 'duplicate') throw fail('duplicate-conflict', 'This generation request already reached the spending ledger.');
    if (admission === 'monthly-ceiling') throw fail('capacity', 'The monthly Music show generation ceiling would be exceeded.');
    if (admission === 'daily-pace') throw fail('capacity', 'The daily Music show generation pace would be exceeded.');

    let response: Response;
    let parsed: unknown;
    try {
      response = await transport(URL, {method: 'POST', headers: {
        'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21',
      }, body, signal, redirect: 'error'});
      parsed = await readResponse(response);
    } catch {
      finish(requestId, null);
      throw uncertain();
    }

    const refused = response.status >= 400 && response.status < 500 && response.status !== 408;
    const cost = usageCost(parsed) ?? (refused ? {micros: 0} : null);
    finish(requestId, cost?.micros ?? null);
    if (cost === null) throw uncertain();
    if (signal.aborted) throw fail('cancelled', 'Generation was cancelled after Claude reported usage.');
    if (!response.ok) throw fail(response.status === 429 ? 'capacity' : 'unavailable', 'Claude did not accept the generation request.');
    return {draft: resultOf(parsed), costUsd: cost.micros / 1_000_000,
      ...(cost.costBasis === undefined ? {} : {costBasis: cost.costBasis})};
  };
}
