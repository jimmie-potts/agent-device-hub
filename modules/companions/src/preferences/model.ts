/** Private documents shared with the page, never shared lifecycle payloads. */
export type PreferenceHistory = {action: 'created' | 'edited' | 'deactivated' | 'reactivated' | 'imported';
  source: 'owner' | 'import'; atMs: number; title: string; text: string; active: boolean};
export type Preference = {id: string; title: string; text: string; active: boolean; createdAtMs: number; updatedAtMs: number; history: PreferenceHistory[]};
export type ActivePreference = Omit<Preference, 'history'>;
export type PreferenceLibrary = {schema: 'preference-library/1.0'; entries: Preference[]};
export type PreferenceView = {schema: 'preference-view/1.0'; revision: number; entries: Preference[]};
export type ActivePreferences = {schema: 'preferences/1.0'; revision: number; entries: ActivePreference[]};
export const TITLE_BYTES = 200;
export const TEXT_BYTES = 4096;
export const LIBRARY_BYTES = 8 * 1024 * 1024;
