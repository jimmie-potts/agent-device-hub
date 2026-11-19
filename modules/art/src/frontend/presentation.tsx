import type {ArtScheduleNotice} from '@jimmie-potts/event-contracts/v2/art-schedule';
import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';
import {backdropEvidence, NO_BACKDROP, type ArtBackdrop} from './backdrop.js';

export type PresentedArt = {artworkId: string; compositionId: string; renditionId: string; palette: readonly string[]};
export type ArtPresentation = {presented: PresentedArt | null; status: 'idle' | 'loading' | 'ready' | 'stale' | 'unavailable'};
type PresentationContext = {value: ArtPresentation; update: (value: ArtPresentation) => void};
const empty: ArtPresentation = {presented: null, status: 'idle'};
const Context = createContext<PresentationContext>({value: empty, update: () => {}});
type BackdropContext = {backdrop: ArtBackdrop; publish: (value: ArtBackdrop) => void; show: (renditionId: string | null) => void};
const Backdrop = createContext<BackdropContext>({backdrop: NO_BACKDROP, publish: () => {}, show: () => {}});
type NoticeContext = {notice: ArtScheduleNotice | undefined; timeZone: string};
const Notices = createContext<NoticeContext>({notice: undefined, timeZone: 'UTC'});

/**
 * One value from the widget's and the backdrop's evidence, so one surface going idle never erases the other's.
 * Ready displayed art wins, then any displayed art; with neither, the widget's status stands.
 */
export function combinePresentation(widget: ArtPresentation, backdrop: ArtPresentation): ArtPresentation {
  if (backdrop.status === 'idle') return widget;
  if (widget.status === 'idle') return backdrop;
  const ready = (value: ArtPresentation): boolean => value.presented !== null && value.status === 'ready';
  if (ready(widget)) return widget;
  if (ready(backdrop)) return backdrop;
  return widget.presented === null && backdrop.presented !== null ? backdrop : widget;
}

/** Transient visible-image evidence only. The art module and core retain catalog and layout ownership. */
export function ArtPresentationProvider({children, notice, timeZone = 'UTC'}: {children: React.ReactNode; notice?: ArtScheduleNotice | undefined; timeZone?: string | undefined}): React.JSX.Element {
  const [widget, setWidget] = useState(empty), [backdrop, setBackdrop] = useState(NO_BACKDROP), [shown, setShown] = useState<string | null>(null);
  const update = useCallback((next: ArtPresentation) => {setWidget(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);}, []);
  const drawn = useMemo(() => backdropEvidence(backdrop, shown), [backdrop, shown]);
  const context = useMemo(() => ({value: combinePresentation(widget, drawn), update}), [widget, drawn, update]);
  const backdrops = useMemo(() => ({backdrop, publish: setBackdrop, show: setShown}), [backdrop]);
  const notices = useMemo(() => ({notice, timeZone}), [notice, timeZone]);
  return <Context.Provider value={context}><Backdrop.Provider value={backdrops}><Notices.Provider value={notices}>{children}</Notices.Provider></Backdrop.Provider></Context.Provider>;
}
export const useArtPresentation = (): ArtPresentation => useContext(Context).value;
export const usePresentArt = (): PresentationContext['update'] => useContext(Context).update;
/** The decoded presented composition for the shell's Home backdrop; `none` while no source is mounted. */
export const useArtBackdrop = (): ArtBackdrop => useContext(Backdrop).backdrop;
/** The shell reports the backdrop rendition it has drawn, or null when it draws none. */
export const useShowArtBackdrop = (): BackdropContext['show'] => useContext(Backdrop).show;
export const usePublishArtBackdrop = (): BackdropContext['publish'] => useContext(Backdrop).publish;

export const useArtNotice = (): NoticeContext => useContext(Notices);
