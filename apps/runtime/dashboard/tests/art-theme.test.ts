import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DECORATIVE_ROLES, themeColors, themePalette, themePreference, type ThemeColors} from '../src/skins/art-theme.ts';

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

void test('theme preferences persist follow, default, locked colors and locked default without invented palette', () => {
  for (const value of [{version: 1, mode: 'follow'}, {version: 1, mode: 'default'}, {version: 1, mode: 'locked', palette: null}, {version: 1, mode: 'locked', palette: ['#FF0066']}]) {
    assert.deepEqual(themePreference(JSON.stringify(value)), value);
  }
  for (const value of [null, '{', '{}', JSON.stringify({version: 2, mode: 'default'}), JSON.stringify({version: 1, mode: 'locked'}), JSON.stringify({version: 1, mode: 'locked', palette: []}), JSON.stringify({version: 1, mode: 'default', texture: 'url(file:///private/a)'}), JSON.stringify({version: 1, mode: 'follow', palette: ['#FFFFFF']})]) assert.equal(themePreference(value), undefined);
});
