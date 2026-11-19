import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DECORATIVE_ROLES, themeColors, themePalette, themePreference, tintStrength, type ThemeColors} from '../src/skins/art-theme.ts';

const luminance = (hex: string): number => {
  const values = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (values[0] ?? 0) * 0.2126 + (values[1] ?? 0) * 0.7152 + (values[2] ?? 0) * 0.0722;
};
const contrast = (a: string, b: string): number => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
const skin = readFileSync(new URL('../src/skins/quiet-glass.css', import.meta.url), 'utf8');
const fixed = (role: string, scheme: 'light' | 'dark'): string => {
  const values = skin.match(new RegExp(`--${role}:light-dark\\((#[a-f0-9]{6}),(#[a-f0-9]{6})\\)`));
  const value = values?.[scheme === 'light' ? 1 : 2];assert.ok(value !== undefined, `fixed ${role} exists`);return value;
};

void test('art decoration accepts bounded palette data and rejects styling, paths, textures and empty input', () => {
  assert.deepEqual(themePalette(['#ff0066', '#00AACC']), ['#FF0066', '#00AACC']);
  for (const value of [[], Array(1), ['#abc'], ['red'], ['url(file:///private/theme)'], ['#123456;--text:transparent'], Array(9).fill('#FFFFFF'), {palette: ['#123456'], texture: 'url(https://example.invalid/a)'}]) {
    assert.equal(themePalette(value), undefined);assert.equal(themeColors(value), undefined);
  }
});

void test('contrasting and extreme art palettes preserve actual skin text, focus and action contrast', () => {
  const themes = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#00FFFF', '#FF00FF', '#777777'].map(color => themeColors([color]));
  for (const theme of themes) {
    assert.ok(theme !== undefined);
    for (const scheme of ['light', 'dark'] as const) {
      const colors: ThemeColors[typeof scheme] = theme[scheme];assert.deepEqual(Object.keys(colors).sort(), [...DECORATIVE_ROLES].sort());
      for (const surface of ['bg', 'panel', 'raised', 'inset', 'shell-rail', 'wash-start', 'wash-end'] as const) {
        for (const role of ['text', 'muted-dense', 'pending-text']) assert.ok(contrast(fixed(role, scheme), colors[surface]) >= 4.5, `${scheme} ${role} on ${surface}`);
        assert.ok(contrast(fixed('focus', scheme), colors[surface]) >= 3, `${scheme} focus on ${surface}`);
        assert.ok(contrast(colors.link, colors[surface]) >= 4.5, `${scheme} link on ${surface}`);
      }
      for (const fill of ['accent', 'primary-hover'] as const) assert.ok(contrast(fixed('accent-ink', scheme), colors[fill]) >= 4.5, `${scheme} text on ${fill}`);
      assert.ok(contrast(colors['edge-dense'], colors.panel) >= 3, `${scheme} control edge`);
      assert.ok(contrast(colors['edge-strong'], colors.panel) >= 3, `${scheme} selected control edge`);
      assert.ok(Object.values(colors).every(color => /^#[0-9A-F]{6}$/.test(color)), 'only inert colors leave the boundary');
    }
  }
  assert.notDeepEqual(themeColors(['#FF0000']), themeColors(['#0000FF']), 'contrasting scenes have different decoration');
});

/** Twelve vivid colors around the hue circle. At full tint several roles leave sRGB for some of them. */
const VIVID = ['#FF0000', '#FF8000', '#FFFF00', '#80FF00', '#00FF00', '#00FF80', '#00FFFF', '#0080FF', '#0000FF', '#8000FF', '#FF00FF', '#FF0080'];
/** OKLab lightness, from the published matrices. */
const lightness = (hex: string): number => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) + 0.7936177850 * Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    - 0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
};
const spread = (hex: string): number => {
  const channels = [1, 3, 5].map(at => Number.parseInt(hex.slice(at, at + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
};

void test('every accepted palette keeps the background, inset, panel and raised surfaces apart (Hub #1920)', () => {
  // The fixed skin separates these surfaces by about 1.28 and 1.30 in dark appearance and 1.12 and 1.16 in light.
  // Its inset and its rail stand off the page background by 1.13 and 1.10 in dark and by 1.04 and 1.04 in light.
  const least = {dark: {panel: 1.2, raised: 1.2, inset: 1.09, rail: 1.07}, light: {panel: 1.08, raised: 1.1, inset: 1.02, rail: 1.03}};
  for (const palette of [['#000000'], ['#FFFFFF'], ['#777777'], ['#202020', '#000000'], ...VIVID.map(color => [color]), ['#000000', '#000020', '#E0A040'], ['#000020'], ['#604020']]) {
    const theme = themeColors(palette);assert.ok(theme !== undefined);
    for (const scheme of ['light', 'dark'] as const) {
      const colors: ThemeColors[typeof scheme] = theme[scheme], name = `${scheme} ${palette.join(' ')}`;
      assert.ok(contrast(colors.panel, colors.bg) >= least[scheme].panel, `${name}: a panel stands off the page background`);
      assert.ok(contrast(colors.raised, colors.panel) >= least[scheme].raised, `${name}: a raised surface stands off its panel`);
      assert.ok(contrast(colors.inset, colors.panel) >= 1.05, `${name}: an inset surface stands off its panel`);
      assert.ok(contrast(colors.inset, colors.bg) >= least[scheme].inset, `${name}: an inset surface stands off the page background`);
      assert.ok(contrast(colors['shell-rail'], colors.bg) >= least[scheme].rail, `${name}: the rail stands off the page background`);
      const light = [colors.bg, colors.inset, colors.panel].map(luminance);
      assert.ok((light[0] ?? 1) < (light[1] ?? 0) && (light[1] ?? 1) < (light[2] ?? 0), `${name}: background, inset and panel keep their order`);
      assert.equal(luminance(colors.raised) > luminance(colors.panel), scheme === 'dark', `${name}: raised is lighter than its panel in dark and darker in light`);
    }
  }
});

void test('the tint comes from the first palette color that has a hue, and a palette without one stays neutral (Hub #1920)', () => {
  const black = themeColors(['#000000']), warm = themeColors(['#000000', '#202020', '#E0A040', '#0000E0']), cool = themeColors(['#000000', '#0000E0', '#E0A040']);
  assert.ok(black !== undefined && warm !== undefined && cool !== undefined);
  for (const scheme of ['light', 'dark'] as const) {
    for (const surface of ['bg', 'panel', 'raised', 'inset', 'shell-rail', 'wash-start', 'wash-end'] as const) assert.ok(spread(black[scheme][surface]) <= 2, `${scheme} ${surface} has no invented hue`);
    assert.ok(spread(warm[scheme].accent) >= 12 && spread(cool[scheme].accent) >= 12, `${scheme}: a dark picture with a colored entry is tinted`);
    assert.notDeepEqual(warm[scheme], black[scheme]);assert.notDeepEqual(warm[scheme], cool[scheme]);
  }
  assert.deepEqual(themeColors(['#000000', '#E0A040']), themeColors(['#202020', '#E0A040']), 'entries without a hue do not change the tint');
  assert.deepEqual(themeColors(['#E0A040']), themeColors(['#E0A040', '#E0A040']), 'one colored entry also supplies the second wash');
  assert.notDeepEqual(warm.dark['wash-end'], themeColors(['#E0A040'])?.dark['wash-end'], 'the second colored entry tints the second wash');
});

void test('a near-black entry with a hue tints only after every lighter one (Hub #1920)', () => {
  // The art module's bucket #000020 holds near-black blues. The picture's visible color is the amber.
  const dark = themeColors(['#000000', '#000020', '#E0A040']), amber = themeColors(['#E0A040']), blue = themeColors(['#000020']);
  assert.ok(dark !== undefined && amber !== undefined && blue !== undefined);
  for (const scheme of ['light', 'dark'] as const) {
    for (const role of DECORATIVE_ROLES) {
      if (role === 'wash-end') assert.equal(dark[scheme][role], blue[scheme][role], `${scheme}: the near-black entry tints the second wash`);
      else assert.equal(dark[scheme][role], amber[scheme][role], `${scheme} ${role} takes the lighter entry's hue`);
    }
    assert.ok(spread(blue[scheme].accent) >= 12, `${scheme}: a near-black hue still tints when it is the only one`);
  }
  assert.deepEqual(themeColors(['#000020', '#200000', '#E0A040', '#2060C0']), themeColors(['#E0A040', '#2060C0']), 'lighter entries keep their order and near-black ones are not reached');
});

void test('a weak color tints at half strength and a vivid one at full strength (Hub #1920)', () => {
  assert.deepEqual([0, 0.04, 0.06, 0.09, 0.12, 0.3].map(tintStrength), [0.5, 0.5, 0.5, 0.75, 1, 1]);
});

void test('every role keeps its lightness step for every hue, also where the full tint leaves sRGB (Hub #1920)', () => {
  const neutral = themeColors(['#000000']);assert.ok(neutral !== undefined);
  for (const color of VIVID) {
    const theme = themeColors([color]);assert.ok(theme !== undefined);
    for (const scheme of ['light', 'dark'] as const) for (const role of DECORATIVE_ROLES) {
      assert.ok(Math.abs(lightness(theme[scheme][role]) - lightness(neutral[scheme][role])) <= 0.004, `${scheme} ${role} for ${color} stays on its step`);
    }
  }
});

void test('theme preferences persist follow, default, locked colors and locked default without invented palette', () => {
  for (const value of [{version: 1, mode: 'follow'}, {version: 1, mode: 'default'}, {version: 1, mode: 'locked', palette: null}, {version: 1, mode: 'locked', palette: ['#FF0066']}]) {
    assert.deepEqual(themePreference(JSON.stringify(value)), value);
  }
  for (const value of [null, '{', '{}', JSON.stringify({version: 2, mode: 'default'}), JSON.stringify({version: 1, mode: 'locked'}), JSON.stringify({version: 1, mode: 'locked', palette: []}), JSON.stringify({version: 1, mode: 'default', texture: 'url(file:///private/a)'}), JSON.stringify({version: 1, mode: 'follow', palette: ['#FFFFFF']})]) assert.equal(themePreference(value), undefined);
});
