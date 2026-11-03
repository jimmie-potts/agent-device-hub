// What may reach a provider: the owner's text, imagination, time, season and weather condition words. The context type
// has no other field, so a location or personal data has nowhere to enter. Nothing here is logged, and every prompt
// fits `PROMPT_LIMIT`. Stale or missing weather is left out, so the art makes no claim about it.
import {createHash} from 'node:crypto';
import type {ArtTarget} from '@jimmie-potts/event-contracts/v2/art-state';
import {PROMPT_LIMIT} from './prices.js';
import type {WeatherWords} from './seams.js';
import type {PromptContext} from './store.js';

export const MAX_TEXT = 1500;
export const MAX_IDEA = 1500;
const WEATHER_WORD = /^[A-Za-z0-9° -]{1,32}$/;
const IMAGINATION = ['a moon bakery', 'a lighthouse for lost kites', 'a garden growing clocks', 'a whale crossing a rooftop', 'a tiny train through a teacup valley',
  'a fox who paints constellations', 'a library on a slow turtle', 'a greenhouse in a thundercloud', 'a robot tending paper boats', 'a market of bottled seasons'];

const timeWord = (hour: number): string => hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 21 ? 'evening' : 'night';
/** The owner's season, in the northern hemisphere, from the host's local month. */
const seasonWord = (month: number): string => month < 2 || month === 11 ? 'winter' : month < 5 ? 'spring' : month < 8 ? 'summer' : 'autumn';
/** Only fresh words of the expected shape count; at most three, as #1418's record bounds them. */
export function weatherWords(weather: WeatherWords | null, nowMs: number): string | null {
  if (weather === null || nowMs >= weather.staleAtMs) return null;
  const words = weather.words.filter(word => WEATHER_WORD.test(word)).slice(0, 3);
  return words.length === 0 ? null : words.join(', ');
}
export function contextFor(requestId: string, nowMs: number, weather: WeatherWords | null): PromptContext {
  const date = new Date(nowMs), seed = createHash('sha256').update(requestId).digest()[0] ?? 0;
  return {imagination: IMAGINATION[seed % IMAGINATION.length] ?? 'a quiet surprise', time: timeWord(date.getHours()), season: seasonWord(date.getMonth()), weather: weatherWords(weather, nowMs)};
}
const contextLine = (context: PromptContext): string =>
  `It is ${context.time} in ${context.season}.${context.weather === null ? '' : ` The weather's mood: ${context.weather}.`}`;

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
export const variationIdea = (source: string, text: string | null): string => boundIdea(`A fresh variation on this idea: ${source}${text === null ? '' : ` Change: ${text}`}`);

const COMPOSITION: Readonly<Record<ArtTarget, string>> = {
  tidbyt: 'A bold subject on a plain ground, readable at a glance on a tiny wide panel. Few shapes and strong contrast.',
  pixoo: 'A square scene with a large central subject and few colors, readable on a tiny square panel.',
  ui: 'A rich, wide composition that still reads when cropped to a narrow card.',
};
const SHEET = 'Draw a sprite sheet: six equal frames in three columns and two rows with no gaps or borders. The same stable scene in every frame, with one small gentle movement from frame to frame. Keep every subject fully inside its own frame.';
const FRAME = 'Original imaginative art. No text, letters, logos or watermarks. It states no facts.';
/** One image prompt, always within the limit. */
export function imagePrompt(idea: string, target: ArtTarget, context: PromptContext, sheet: boolean): string {
  return [`Idea: ${boundIdea(idea)}`, contextLine(context), COMPOSITION[target], ...(sheet ? [SHEET] : []), FRAME].join('\n').slice(0, PROMPT_LIMIT);
}
