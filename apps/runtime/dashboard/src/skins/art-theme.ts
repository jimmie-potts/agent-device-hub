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
/** A color as OKLCH: lightness 0 to 1, chroma, and hue in radians. */
type Lch = readonly [lightness: number, chroma: number, hue: number];
const lchOf = (hex: string): Lch => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, c = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, Math.hypot(a, c), Math.atan2(c, a)];
};
const channelsOf = ([lightness, chroma, hue]: Lch): number[] => {
  const a = chroma * Math.cos(hue), b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
};
const hexOf = (lightness: number, chroma: number, hue: number): string => {
  // A color outside sRGB keeps its lightness and gives up chroma, so no role moves off its lightness step.
  let channels = channelsOf([lightness, chroma, hue]);
  for (let fitted = chroma; fitted > 0.001 && channels.some(value => value < -0.0005 || value > 1.0005);) {fitted *= 0.9;channels = channelsOf([lightness, fitted, hue]);}
  return `#${channels.map(value => Math.min(1, Math.max(0, value))).map(value => Math.round((value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
};

type Role = (typeof DECORATIVE_ROLES)[number];
/**
 * Each role's fixed lightness and its chroma at full tint. The lightness steps follow Quiet glass, so the page
 * background, inset, panel and raised surfaces stay apart whatever the artwork is (Hub #1920). The artwork
 * supplies the hue and how much of the chroma is used; it never moves a role's lightness.
 */
const STEPS: Record<'light' | 'dark', Record<Role, readonly [lightness: number, chroma: number]>> = {
  light: {bg: [0.945, 0.016], inset: [0.958, 0.012], panel: [0.982, 0.006], raised: [0.925, 0.020], 'shell-rail': [0.930, 0.018],
    'edge-faint': [0.890, 0.020], 'edge-dense': [0.620, 0.040], 'edge-strong': [0.500, 0.050],
    accent: [0.400, 0.070], link: [0.450, 0.100], 'primary-hover': [0.470, 0.070], 'wash-start': [0.915, 0.030], 'wash-end': [0.930, 0.026]},
  dark: {bg: [0.235, 0.030], inset: [0.265, 0.034], panel: [0.315, 0.040], raised: [0.385, 0.046], 'shell-rail': [0.255, 0.034],
    'edge-faint': [0.400, 0.040], 'edge-dense': [0.640, 0.050], 'edge-strong': [0.760, 0.060],
    accent: [0.900, 0.040], link: [0.840, 0.090], 'primary-hover': [0.840, 0.060], 'wash-start': [0.340, 0.070], 'wash-end': [0.310, 0.060]},
};
/** A palette entry below this chroma has no usable hue. Black, white and the grey buckets are exactly zero. */
const HUE_FLOOR = 0.04;
/** The chroma at which an entry tints at full strength; a weaker entry still tints at half. */
const FULL_TINT = 0.12;

export function themeColors(value: unknown): ThemeColors | undefined {
  const palette = themePalette(value);if (palette === undefined) return undefined;
  // The art module lists a picture's most common colors first, and for a dark picture that is black. The tint
  // comes from the first entry that has a hue; the next such entry tints the second wash. A palette with no
  // such entry gives neutral surfaces on the same lightness steps.
  const hued = palette.map(lchOf).filter(([, chroma]) => chroma >= HUE_FLOOR), first = hued[0], second = hued[1] ?? first;
  const color = (scheme: 'light' | 'dark', role: Role): string => {
    const [lightness, chroma] = STEPS[scheme][role], source = role === 'wash-end' ? second : first;
    return source === undefined ? hexOf(lightness, 0, 0) : hexOf(lightness, chroma * Math.min(1, Math.max(0.5, source[1] / FULL_TINT)), source[2]);
  };
  const scheme = (name: 'light' | 'dark'): Record<Role, string> => {
    const colors = {} as Record<Role, string>;
    for (const role of DECORATIVE_ROLES) colors[role] = color(name, role);
    return colors;
  };
  return {light: scheme('light'), dark: scheme('dark')};
}
