// What may reach a provider: the owner's text, imagination, time, season and weather condition words. The context type
// has no other field, so a location or personal data has nowhere to enter. Nothing here is logged, and every prompt
// fits `PROMPT_LIMIT`. Stale or missing weather is left out, so the art makes no claim about it.
import {createHash} from 'node:crypto';
import type {ArtContext} from '@jimmie-potts/event-contracts/v2/art';
import type {ArtTarget} from '@jimmie-potts/event-contracts/v2/art-state';
import {PROMPT_LIMIT} from './prices.js';
import type {WeatherWords} from './seams.js';
import type {PromptContext} from './store.js';

/** `art-request`'s own bound on the owner's text. */
export const MAX_TEXT = 2000;
export const MAX_IDEA = 2000;
export const MAX_VARIATION_IDEA = 3000;
/** `v2/art`'s pattern for `context.weather`: lowercase words, so a temperature such as `48°F` cannot pass. */
const CONDITION_WORD = /^[a-z]+(?: [a-z]+)*$/;
/** #1418's words also name the hour's part of the day, which the time word already says. */
const DAY_PARTS: readonly string[] = ['morning', 'afternoon', 'evening', 'night'];
const MAX_WEATHER = 64;
const IMAGINATION = ['a moon bakery', 'a lighthouse for lost kites', 'a garden growing clocks', 'a whale crossing a rooftop', 'a tiny train through a teacup valley',
  'a fox who paints constellations', 'a library on a slow turtle', 'a greenhouse in a thundercloud', 'a robot tending paper boats', 'a market of bottled seasons'];

const timeWord = (hour: number): string => hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
/** The owner's season, in the northern hemisphere, from the host's local month. */
const seasonWord = (month: number): string => month < 2 || month === 11 ? 'winter' : month < 5 ? 'spring' : month < 8 ? 'summer' : 'autumn';
/** Only fresh condition words count. Anything else in the record, a temperature or a place, has no way in. */
export function weatherWords(weather: WeatherWords | null, nowMs: number): string | null {
  if (weather === null || nowMs >= weather.staleAtMs) return null;
  const words = weather.words.filter(word => CONDITION_WORD.test(word) && !DAY_PARTS.includes(word)).join(' ');
  return words === '' || words.length > MAX_WEATHER ? null : words;
}
/** The job's words: what the command's validated `context` names, then what the module knows. */
export function contextFor(requestId: string, nowMs: number, weather: WeatherWords | null, given: ArtContext = {}): PromptContext {
  const date = new Date(nowMs), seed = createHash('sha256').update(requestId).digest()[0] ?? 0;
  const base = {imagination: IMAGINATION[seed % IMAGINATION.length] ?? 'a quiet surprise', time: given.time ?? timeWord(date.getHours()), season: given.season ?? seasonWord(date.getMonth())};
  if (given.weather !== undefined) return {...base, weather: given.weather, weatherSource: 'request'};
  const words = weatherWords(weather, nowMs);
  return words !== null && weather !== null ? {...base, weather: words, weatherSource: 'observation', weatherStaleAtMs: weather.staleAtMs}
    : {...base, weather: null, weatherSource: 'none'};
}
/** Observation freshness is checked again at each dispatch. Explicit context is requested inspiration, not an observation. */
export const freshContext = (context: PromptContext, nowMs: number): PromptContext =>
  context.weatherSource === 'observation' && nowMs >= context.weatherStaleAtMs
    ? {imagination: context.imagination, time: context.time, season: context.season, weather: null, weatherSource: 'none'} : context;
const contextLine = (context: PromptContext): string =>
  `It is ${context.time} in ${context.season}.${context.weather === null ? '' : context.weatherSource === 'request' ? ` Requested weather inspiration: ${context.weather}.` : ` The weather's mood: ${context.weather}.`}`;

const IDEA_SYSTEM = 'You invent one short, warm, playful, occasionally surreal idea for an original picture. Answer with the idea alone, in at most three sentences. '
  + 'Describe a scene, not facts: name no real person, place or event, and ask for no text in the picture.';
export const ideaSystem = (): string => IDEA_SYSTEM;
export function ideaPrompt(text: string | null, context: PromptContext): string {
  return [text === null ? `Let this inspire you: ${context.imagination}.` : `The owner asks for: ${text}`, contextLine(context)].join('\n');
}
/** Plain words for an idea when no model wrote one, which costs nothing. */
export const localIdea = (text: string | null, context: PromptContext): string => text ?? context.imagination;
const clean = (value: string): string => Array.from(value, character => (character.codePointAt(0) ?? 0) < 32 ? ' ' : character).join('').replace(/ {2,}/g, ' ').trim();
export const boundIdea = (value: string): string => clean(value).slice(0, MAX_IDEA);
export function variationIdea(source: string, text: string | null): string {
  const prefix = 'A fresh variation on this idea: ', change = text === null ? '' : ` Change: ${clean(text).slice(0, MAX_TEXT)}`;
  return `${prefix}${clean(source).slice(0, MAX_VARIATION_IDEA - prefix.length - change.length)}${change}`;
}

const COMPOSITION: Readonly<Record<ArtTarget, string>> = {
  tidbyt: 'A bold subject on a plain ground, readable at a glance on a tiny wide panel. Few shapes and strong contrast.',
  pixoo: 'A square scene with a large central subject and few colors, readable on a tiny square panel.',
  ui: 'A rich, wide composition that still reads when cropped to a narrow card.',
};
const MOTION = 'An animated loop: the same stable scene throughout, with one small gentle movement.';
const FRAME = 'Original imaginative art. No text, letters, logos or watermarks. It states no facts.';
/** One image prompt, always within the limit. */
export function imagePrompt(idea: string, target: ArtTarget, context: PromptContext): string {
  const ending = ['', contextLine(context), COMPOSITION[target], ...(target === 'ui' ? [] : [MOTION]), FRAME].join('\n');
  return `Idea: ${clean(idea).slice(0, PROMPT_LIMIT - ending.length - 6)}${ending}`;
}
