import {freezeMusicRecipe, type MusicRecipeV1} from '../music-recipe-data.js';
import {MUSIC_PREVIEW_LIMITS, MUSIC_PREVIEW_MODELS, MUSIC_PREVIEW_PRESETS, MUSIC_PREVIEW_SCHEMA, MUSIC_PREVIEW_STIMULUS,
  musicPreviewDefault, type MusicPreview, type MusicPreviewInput, type MusicPreviewRequest, type MusicPreviewSample, type MusicPreviewZone} from '../music-preview-data.js';

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: object, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = (): Error => new Error('The synthetic preview document is invalid.');
const normalized = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw invalid();
  return value;
};
const channel = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) throw invalid();
  return value;
};

export function musicPreviewProblem(request: MusicPreviewRequest): string | undefined {
  if (!MUSIC_PREVIEW_PRESETS.some(value => value.id === request.preset) || !MUSIC_PREVIEW_MODELS.some(value => value.id === request.model))
    return 'Choose a supported effect and example model.';
  if (request.palette.length < 1 || request.palette.length > 8 || !request.palette.every(color => /^#[0-9a-fA-F]{6}$/.test(color)))
    return 'Use one to eight hex colors.';
  if (!Number.isFinite(request.intensity) || request.intensity < 0 || request.intensity > 1) return 'Intensity must be between 0 and 100 percent.';
  return undefined;
}

/** Only the bounded document for this exact local draft can become a visible result. */
export function parseMusicPreview(value: unknown, request: MusicPreviewInput): MusicPreview {
  const preset = 'preset' in request ? MUSIC_PREVIEW_PRESETS.find(item => item.id === request.preset) : undefined, model = MUSIC_PREVIEW_MODELS.find(item => item.id === request.model);
  if (!('recipe' in request) && preset === undefined || model === undefined || !object(value) || !exact(value, ['schema', 'recipe', 'model', 'stimulus', 'samples'])
      || value.schema !== MUSIC_PREVIEW_SCHEMA || value.model !== request.model || value.stimulus !== MUSIC_PREVIEW_STIMULUS
      || !object(value.recipe) || !Array.isArray(value.samples) || value.samples.length !== MUSIC_PREVIEW_LIMITS.samples) throw invalid();
  const recipe = 'recipe' in request ? freezeMusicRecipe(request.recipe)
    : freezeMusicRecipe({...preset?.recipe, palette: request.palette, intensity: request.intensity});
  const receivedRecipe = value.recipe;
  if (!exact(receivedRecipe, Object.keys(recipe)) || Object.entries(recipe).some(([key, expected]) => key !== 'palette' && receivedRecipe[key] !== expected)
      || !Array.isArray(receivedRecipe.palette) || receivedRecipe.palette.length !== recipe.palette.length
      || receivedRecipe.palette.some((color, index) => color !== recipe.palette[index])) throw invalid();
  const samples = value.samples.map((sample, index): MusicPreviewSample => {
    if (!object(sample) || !exact(sample, ['offsetMs', 'rms', 'bands', 'zones']) || sample.offsetMs !== index * 100
        || !object(sample.bands) || !exact(sample.bands, ['bass', 'mid', 'treble'])
        || !Array.isArray(sample.zones) || sample.zones.length !== model.zones) throw invalid();
    const zones = sample.zones.map((zone, zoneIndex): MusicPreviewZone => {
      if (!object(zone) || !exact(zone, ['id', 'rgb']) || zone.id !== zoneIndex + 1 || !Array.isArray(zone.rgb) || zone.rgb.length !== 3) throw invalid();
      return {id: zoneIndex + 1, rgb: [channel(zone.rgb[0]), channel(zone.rgb[1]), channel(zone.rgb[2])]};
    });
    return {offsetMs: index * 100, rms: normalized(sample.rms),
      bands: {bass: normalized(sample.bands.bass), mid: normalized(sample.bands.mid), treble: normalized(sample.bands.treble)}, zones};
  });
  const result: MusicPreview = {schema: MUSIC_PREVIEW_SCHEMA, model: model.id, stimulus: MUSIC_PREVIEW_STIMULUS, recipe, samples};
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MUSIC_PREVIEW_LIMITS.responseBytes) throw invalid();
  return result;
}

export type MusicPreviewView = Readonly<{draft: MusicPreviewRequest; connected: boolean; pending: boolean;
  loadedRecipe: MusicRecipeV1 | undefined; result: MusicPreview | undefined; sample: number; error: string | undefined}>;
type DraftEdit = Partial<Pick<MusicPreviewRequest, 'preset' | 'palette' | 'intensity' | 'model'>>;

/** One unsaved draft, one explicit read and local sample selection. No timers or commands. */
export class MusicPreviewDraft {
  readonly #read: (path: string) => Promise<unknown>;
  readonly #listeners = new Set<() => void>();
  #view: MusicPreviewView = {draft: musicPreviewDefault(), connected: false, pending: false, loadedRecipe: undefined, result: undefined, sample: 0, error: undefined};
  #generation = 0;
  #flight: object | undefined;
  constructor(read: (path: string) => Promise<unknown>) {this.#read = read;}
  readonly snapshot = (): MusicPreviewView => this.#view;
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {this.#listeners.delete(listener);};
  };
  #show(next: MusicPreviewView): void {
    this.#view = next;
    for (const listener of this.#listeners) listener();
  }
  setConnected(connected: boolean): void {
    if (connected === this.#view.connected) return;
    this.#generation += 1;
    this.#show({...this.#view, connected, result: undefined, sample: 0, error: undefined});
  }
  edit(patch: DraftEdit): void {
    this.#generation += 1;
    const draft = {...this.#view.draft, ...patch};
    const loadedRecipe = patch.preset !== undefined ? undefined : this.#view.loadedRecipe;
    this.#show({...this.#view, draft: {...draft, palette: [...draft.palette]},
      loadedRecipe: loadedRecipe === undefined ? undefined : freezeMusicRecipe({...loadedRecipe, palette: draft.palette, intensity: draft.intensity}),
      result: undefined, sample: 0, error: undefined});
  }
  reset(): void {
    this.#generation += 1;
    this.#show({...this.#view, draft: musicPreviewDefault(), loadedRecipe: undefined, result: undefined, sample: 0, error: undefined});
  }
  recipe(): MusicRecipeV1 {
    const draft = this.#view.draft, preset = MUSIC_PREVIEW_PRESETS.find(value => value.id === draft.preset);
    return freezeMusicRecipe({...this.#view.loadedRecipe ?? preset?.recipe, palette: draft.palette, intensity: draft.intensity});
  }
  load(recipe: MusicRecipeV1): void {
    const frozen = freezeMusicRecipe(recipe);
    this.#generation += 1;
    this.#show({...this.#view, draft: {...this.#view.draft, preset: frozen.effect, palette: [...frozen.palette], intensity: frozen.intensity},
      loadedRecipe: frozen, result: undefined, sample: 0, error: undefined});
  }
  selectSample(sample: number): void {
    if (this.#view.result === undefined || !Number.isInteger(sample) || sample < 0 || sample >= this.#view.result.samples.length) return;
    this.#show({...this.#view, sample});
  }
  async preview(): Promise<void> {
    if (!this.#view.connected || this.#flight !== undefined) return;
    const problem = musicPreviewProblem(this.#view.draft);
    if (problem !== undefined) {this.#show({...this.#view, error: problem}); return;}
    const request: MusicPreviewInput = this.#view.loadedRecipe === undefined ? {...this.#view.draft, palette: [...this.#view.draft.palette]}
      : {version: 1, recipe: this.recipe(), model: this.#view.draft.model};
    const generation = this.#generation;
    const flight = {};
    this.#flight = flight;
    this.#show({...this.#view, pending: true, result: undefined, sample: 0, error: undefined});
    try {
      const document = await this.#read(`/modules/nanoleaf/content/music-preview?request=${encodeURIComponent(JSON.stringify(request))}`);
      if (generation !== this.#generation || !this.#view.connected) return;
      this.#show({...this.#view, result: parseMusicPreview(document, request), sample: 6});
    } catch {
      if (generation === this.#generation && this.#view.connected)
        this.#show({...this.#view, error: 'The synthetic preview is unavailable. Preview again to retry.'});
    } finally {
      if (this.#flight === flight) {
        this.#flight = undefined;
        this.#show({...this.#view, pending: false});
      }
    }
  }
}
