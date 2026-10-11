export const KEYS = ['up', 'down', 'left', 'right', 'select', 'back', 'home', 'play-pause'] as const;
export type Key = typeof KEYS[number];
export const APPS = ['youtube', 'stremio'] as const;
export type App = typeof APPS[number];
const codes: Readonly<Record<Key, number>> = {up: 19, down: 20, left: 21, right: 22, select: 23, back: 4, home: 3, 'play-pause': 85};
const packages: Readonly<Record<App, string>> = {youtube: 'com.google.android.youtube.tv', stremio: 'com.stremio.one'};
export const keyCommand = (key: string): string | undefined => KEYS.some(value => value === key) ? `input keyevent ${codes[key as Key]}` : undefined;
/** This initial input alphabet is source-qualified; other characters remain visibly unsupported. */
export const textCommand = (text: string): string | undefined => /^[A-Za-z0-9 ._-]{1,256}$/.test(text) ? `input text '${text.replaceAll(' ', '%s')}'` : undefined;
export const launcherCommand = (app: string): string | undefined => APPS.some(value => value === app)
  ? `cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER ${packages[app as App]}` : undefined;
export const launchCommand = (app: string, output: string): string | undefined => {
  if (!APPS.some(value => value === app)) return undefined;
  const component = output.trim(), selected = packages[app as App];
  if (!component.startsWith(`${selected}/`) || !/^[a-zA-Z0-9_.]+\/[a-zA-Z_.][a-zA-Z0-9_.]*$/.test(component)) return undefined;
  return `am start -W -n ${component}`;
};
/** Only the selected foreground token is read; other package names never leave this parser. */
export const CURRENT_APP_COMMAND = "dumpsys activity activities | sed -n 's|.*mResumedActivity[=:].* u[0-9][0-9]* \\([^ /}]*\\)/.*|\\1|p;s|.*topResumedActivity[=:].* u[0-9][0-9]* \\([^ /}]*\\)/.*|\\1|p' | head -c 4096";
export type CurrentApp = App | 'other' | 'none';
export const currentApp = (output: string): CurrentApp | undefined => {
  const values = [...new Set(output.trim().split(/\s+/))];
  if (values.length !== 1) return undefined;
  const value = values[0] ?? '';
  if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(value)) return undefined;
  if (value === packages.youtube) return 'youtube';
  if (value === packages.stremio) return 'stremio';
  return 'other';
};
