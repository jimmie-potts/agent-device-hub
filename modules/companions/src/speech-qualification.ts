export type SpeechQualification = {schema: 'browser-speech-qualification/1.0'; browserVersion: string; platform: 'macos'; qualifiedAt: string;
  voice: {name: string; lang: string; voiceURI: string}};
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identity = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= 512 && Array.from(value).every(character => {const code = character.charCodeAt(0); return code >= 32 && code !== 127;});

/** Parse the selected installation's qualification receipt, never an inferred or default voice. */
export function speechQualification(value: unknown): SpeechQualification | undefined {
  if (!object(value) || !exact(value, ['schema', 'browserVersion', 'platform', 'qualifiedAt', 'voice']) || value.schema !== 'browser-speech-qualification/1.0'
    || value.platform !== 'macos' || typeof value.browserVersion !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,6}\.\d{1,6}$/.test(value.browserVersion)
    || typeof value.qualifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.qualifiedAt)
    || !Number.isFinite(Date.parse(value.qualifiedAt)) || new Date(value.qualifiedAt).toISOString() !== value.qualifiedAt
    || !object(value.voice) || !exact(value.voice, ['name', 'lang', 'voiceURI']) || !identity(value.voice.name) || !identity(value.voice.voiceURI)
    || typeof value.voice.lang !== 'string' || !/^en(?:-[a-zA-Z0-9]{2,8})*$/.test(value.voice.lang)) return undefined;
  return {schema: value.schema, browserVersion: value.browserVersion, platform: value.platform, qualifiedAt: value.qualifiedAt,
    voice: {name: value.voice.name, lang: value.voice.lang, voiceURI: value.voice.voiceURI}};
}
