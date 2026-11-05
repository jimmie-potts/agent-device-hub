/** Bounded decorative values. No caller supplies CSS, selectors, assets or semantic tokens. */
export const ART_THEME_KEY = 'bunny.art-theme.v1';
export type ThemePreference = {version: 1; mode: 'follow' | 'default'} | {version: 1; mode: 'locked'; palette: readonly string[] | null};
export const DECORATIVE_ROLES = ['bg', 'panel', 'raised', 'inset', 'edge-dense', 'edge-strong', 'edge-faint', 'accent', 'link', 'primary-hover', 'shell-rail', 'wash-start', 'wash-end'] as const;
export type ThemeColors = Record<'light' | 'dark', Record<(typeof DECORATIVE_ROLES)[number], string>>;

export function themePalette(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return undefined;
  const items: readonly unknown[] = value, colors = [...items];
  return colors.every((color): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    ? colors.map(color => color.toUpperCase()) : undefined;
}
export function themePreference(raw: string | null): ThemePreference | undefined {
  if (raw === null || raw.length > 1024) return undefined;
  let value: unknown;try {value = JSON.parse(raw);} catch {return undefined;}
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('version' in value) || value.version !== 1 || !('mode' in value)) return undefined;
  if ((value.mode === 'follow' || value.mode === 'default') && Object.keys(value).length === 2) return {version: 1, mode: value.mode};
  if (value.mode !== 'locked' || !('palette' in value) || Object.keys(value).length !== 3) return undefined;
  const palette = value.palette === null ? null : themePalette(value.palette);
  return palette === undefined ? undefined : {version: 1, mode: 'locked', palette};
}
const mix = (color: string, base: 0 | 255, weight: number): string => `#${[1, 3, 5].map(at => Math.round(Number.parseInt(color.slice(at, at + 2), 16) * weight + base * (1 - weight)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
export function themeColors(value: unknown): ThemeColors | undefined {
  const palette = themePalette(value), first = palette?.[0];if (first === undefined) return undefined;
  const second = palette?.[1] ?? first;
  return {
    light: {bg: mix(first, 255, 0.10), panel: mix(first, 255, 0.025), raised: mix(first, 255, 0.10), inset: mix(first, 255, 0.06),
      'edge-dense': mix(first, 0, 0.35), 'edge-strong': mix(first, 0, 0.25), 'edge-faint': mix(first, 255, 0.18),
      accent: mix(first, 0, 0.32), link: mix(first, 0, 0.28), 'primary-hover': mix(first, 0, 0.40), 'shell-rail': mix(first, 255, 0.10),
      'wash-start': mix(first, 255, 0.10), 'wash-end': mix(second, 255, 0.08)},
    dark: {bg: mix(first, 0, 0.075), panel: mix(first, 0, 0.13), raised: mix(first, 0, 0.19), inset: mix(first, 0, 0.075),
      'edge-dense': mix(first, 255, 0.45), 'edge-strong': mix(first, 255, 0.30), 'edge-faint': mix(first, 0, 0.24),
      accent: mix(first, 255, 0.22), link: mix(first, 255, 0.22), 'primary-hover': mix(first, 255, 0.35), 'shell-rail': mix(first, 0, 0.09),
      'wash-start': mix(first, 0, 0.16), 'wash-end': mix(second, 0, 0.14)},
  };
}
