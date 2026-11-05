import type {ArtScheduleNotice} from '@jimmie-potts/event-contracts/v2/art-schedule';
import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';

export type PresentedArt = {artworkId: string; compositionId: string; renditionId: string; palette: readonly string[]};
export type ArtPresentation = {presented: PresentedArt | null; status: 'idle' | 'loading' | 'ready' | 'stale' | 'unavailable'};
type PresentationContext = {value: ArtPresentation; update: (value: ArtPresentation) => void};
const empty: ArtPresentation = {presented: null, status: 'idle'};
const Context = createContext<PresentationContext>({value: empty, update: () => {}});
type NoticeContext = {notice: ArtScheduleNotice | undefined; timeZone: string};
const Notices = createContext<NoticeContext>({notice: undefined, timeZone: 'UTC'});

/** Transient visible-image evidence only. The art module and core retain catalog and layout ownership. */
export function ArtPresentationProvider({children, notice, timeZone = 'UTC'}: {children: React.ReactNode; notice?: ArtScheduleNotice | undefined; timeZone?: string | undefined}): React.JSX.Element {
  const [value, setValue] = useState(empty);
  const update = useCallback((next: ArtPresentation) => {setValue(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);}, []);
  const context = useMemo(() => ({value, update}), [value, update]);
  const notices = useMemo(() => ({notice, timeZone}), [notice, timeZone]);
  return <Context.Provider value={context}><Notices.Provider value={notices}>{children}</Notices.Provider></Context.Provider>;
}
export const useArtPresentation = (): ArtPresentation => useContext(Context).value;
export const usePresentArt = (): PresentationContext['update'] => useContext(Context).update;

export const useArtNotice = (): NoticeContext => useContext(Notices);
