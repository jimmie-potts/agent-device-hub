import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';

export type PresentedArt = {artworkId: string; compositionId: string; renditionId: string; palette: readonly string[]};
export type ArtPresentation = {presented: PresentedArt | null; status: 'idle' | 'loading' | 'ready' | 'stale' | 'unavailable'};
type PresentationContext = {value: ArtPresentation; update: (value: ArtPresentation) => void};
const empty: ArtPresentation = {presented: null, status: 'idle'};
const Context = createContext<PresentationContext>({value: empty, update: () => {}});

/** Transient visible-image evidence only. The art module and core retain catalog and layout ownership. */
export function ArtPresentationProvider({children}: {children: React.ReactNode}): React.JSX.Element {
  const [value, setValue] = useState(empty);
  const update = useCallback((next: ArtPresentation) => {setValue(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);}, []);
  const context = useMemo(() => ({value, update}), [value, update]);
  return <Context.Provider value={context}>{children}</Context.Provider>;
}
export const useArtPresentation = (): ArtPresentation => useContext(Context).value;
export const usePresentArt = (): PresentationContext['update'] => useContext(Context).update;
