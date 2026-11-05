import React, {createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState} from 'react';
import {useArtPresentation} from '@jimmie-potts/art/frontend';
import {ART_THEME_KEY, DECORATIVE_ROLES, themeColors, themePalette, themePreference, type ThemePreference} from './skins/art-theme.ts';

type ThemeState = {preference: ThemePreference; palette: readonly string[] | null; notice: string | null};
type ThemeContext = {state: ThemeState; choose: (mode: ThemePreference['mode']) => void};
const initial: ThemeState = {preference: {version: 1, mode: 'follow'}, palette: null, notice: null};
const Context = createContext<ThemeContext>({state: initial, choose: () => {}});
const paletteFor = (preference: ThemePreference, prior: readonly string[] | null): readonly string[] | null => preference.mode === 'locked' ? preference.palette : preference.mode === 'default' ? null : prior;
const property = (role: (typeof DECORATIVE_ROLES)[number]): string => `--${role.startsWith('wash-') ? 'art-' : ''}${role}`;

function restored(): ThemeState {
  try {
    const raw = localStorage.getItem(ART_THEME_KEY);if (raw === null) return initial;
    const preference = themePreference(raw);
    return preference === undefined ? {preference: {version: 1, mode: 'default'}, palette: null, notice: 'Saved artwork colors are invalid. Using default colors.'}
      : {preference, palette: paletteFor(preference, null), notice: null};
  } catch {return {...initial, notice: 'Browser storage is unavailable. Color preferences cannot be restored.'};}
}

/** The shell keeps only local decoration. Catalog state and decoded presentation remain art-owned. */
export function ArtThemeProvider({children}: {children: React.ReactNode}): React.JSX.Element {
  const presentation = useArtPresentation(), [state, setState] = useState(restored);
  useEffect(() => {
    if (presentation.status !== 'ready' || presentation.presented === null) return;
    const palette = themePalette(presentation.presented.palette);if (palette === undefined) return;
    setState(previous => previous.preference.mode !== 'follow' || JSON.stringify(previous.palette) === JSON.stringify(palette) ? previous : {...previous, palette});
  }, [presentation, state.preference.mode]);
  useEffect(() => {
    const changed = (event: StorageEvent): void => {
      if (event.key !== ART_THEME_KEY && event.key !== null) return;
      try {if (event.storageArea !== localStorage) return;} catch {return;}
      const preference = event.newValue === null ? {version: 1, mode: 'follow'} as const : themePreference(event.newValue);
      setState(previous => preference === undefined ? {...previous, notice: 'Saved artwork colors are invalid. Keeping the current colors.'}
        : {preference, palette: paletteFor(preference, previous.palette), notice: null});
    };
    window.addEventListener('storage', changed);return () => {window.removeEventListener('storage', changed);};
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement, colors = themeColors(state.palette);
    root.dataset['artThemeMode'] = state.preference.mode;
    if (colors !== undefined) {
      for (const role of DECORATIVE_ROLES) root.style.setProperty(property(role), `light-dark(${colors.light[role]},${colors.dark[role]})`);
      root.dataset['artTheme'] = 'applied';
    }
    return () => {for (const role of DECORATIVE_ROLES) root.style.removeProperty(property(role));delete root.dataset['artTheme'];delete root.dataset['artThemeMode'];};
  }, [state.palette, state.preference.mode]);
  const choose = useCallback((mode: ThemePreference['mode']): void => {
    const preference: ThemePreference = mode === 'locked' ? {version: 1, mode, palette: state.palette} : {version: 1, mode};
    let notice: string | null = null;
    try {localStorage.setItem(ART_THEME_KEY, JSON.stringify(preference));}
    catch {notice = 'Colors changed for this page only. Browser storage is unavailable; the preference was not saved.';}
    const ready = presentation.status === 'ready' && presentation.presented !== null ? themePalette(presentation.presented.palette) : undefined;
    setState(previous => ({preference, palette: paletteFor(preference, ready ?? previous.palette), notice}));
  }, [presentation, state.palette]);
  const value = useMemo(() => ({state, choose}), [state, choose]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function ArtThemeSettings(): React.JSX.Element {
  const {state, choose} = useContext(Context), mode = state.preference.mode;
  return <section className="card" aria-label="Artwork colors"><h2>Artwork colors</h2>
    <p>Match decorative colors to displayed art, or keep your preferred colors in this browser.</p>
    <p className="art-theme-status" role="status">{mode === 'locked' ? state.palette === null ? 'Default colors are locked in this browser.' : 'Current artwork colors are locked in this browser.'
      : mode === 'default' ? 'Using default colors in this browser.' : state.palette === null ? 'Following artwork. Waiting for a ready image.' : 'Following artwork colors.'}</p>
    <div className="actions"><button type="button" className="secondary" aria-pressed={mode === 'follow'} onClick={() => {choose('follow');}}>Follow artwork</button>
      <button type="button" className="secondary" aria-pressed={mode === 'locked'} onClick={() => {choose('locked');}}>Lock current colors</button>
      <button type="button" className="secondary" aria-pressed={mode === 'default'} onClick={() => {choose('default');}}>Restore default</button></div>
    <p><a href="#/module/art/gallery">Open Art Gallery</a></p>
    {state.notice !== null && <p role="alert">{state.notice}</p>}
  </section>;
}
