import React, {useEffect, useState} from 'react';
import type {ArtScheduleNotice} from '@jimmie-potts/event-contracts/v2/art-schedule';
import {forecastTime, noticeExpiry, noticeMatchesImage} from './notice.js';
import {useArtNotice, useArtPresentation, type PresentedArt} from './presentation.js';

/** The current notice for `image` while it is visible and ready; it clears itself when the notice expires. */
function useMatchedNotice(image: PresentedArt | undefined, ready: boolean): {notice: ArtScheduleNotice; timeZone: string} | undefined {
  const {notice, timeZone} = useArtNotice();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (notice === undefined) return;
    const timer = setTimeout(() => {setNow(Date.now());}, Math.max(0, noticeExpiry(notice) - Date.now()));
    return () => {clearTimeout(timer);};
  }, [notice]);
  return noticeMatchesImage(notice, image, ready, Math.max(now, Date.now())) ? {notice, timeZone} : undefined;
}

const forecastText = (notice: ArtScheduleNotice, timeZone: string): string =>
  `${notice.forecast.likelihood === 'likely' ? 'Rain likely' : 'Chance of rain'} at ${forecastTime(notice, timeZone)} · ${timeZone}`;
const SEPARATE = 'Weather forecast, separate from the imagined artwork.';

/** The notice's words, the same wherever it is shown: what it is, the forecast and its separation from the art. */
function NoticeWords({notice, timeZone}: {notice: ArtScheduleNotice; timeZone: string}): React.JSX.Element {
  return <><strong>Rain forecast</strong><span>{forecastText(notice, timeZone)}</span><span className="hint">{SEPARATE}</span></>;
}

export function ArtNotice({image, ready}: {image: PresentedArt | undefined; ready: boolean}): React.JSX.Element | null {
  const matched = useMatchedNotice(image, ready);
  if (matched === undefined) return null;
  return <span className="art-notice" role="status" data-art-opportunity={matched.notice.opportunityId}><NoticeWords {...matched}/></span>;
}

/**
 * The forecast notice for the artwork the page presents now (the widget's, or the backdrop the shell reports drawn),
 * as a compact chip for the shell to place, such as Home's hero (Hub #1930). It states the notice in the widget's words
 * and follows the same rules: only beside the exact presented artwork, ready, and only until the notice expires. The
 * chip shows the forecast; its kind and its separation from the artwork are in its accessible text and its title.
 * With `href` the chip is a link, so it takes keyboard focus.
 */
export function PresentedArtNotice({className, href}: {className?: string; href?: string}): React.JSX.Element | null {
  const {presented, status} = useArtPresentation();
  const matched = useMatchedNotice(presented ?? undefined, status === 'ready');
  if (matched === undefined) return null;
  const {notice, timeZone} = matched, words = <NoticeWords notice={notice} timeZone={timeZone}/>;
  const title = `Rain forecast: ${forecastText(notice, timeZone)}. ${SEPARATE}`;
  const name = `art-notice-chip${className === undefined ? '' : ` ${className}`}`;
  return <span role="status" className="art-notice-status" data-art-opportunity={notice.opportunityId} data-artwork={notice.artworkId}>
    {href === undefined ? <span className={name} title={title}>{words}</span> : <a className={name} href={href} title={title}>{words}</a>}
  </span>;
}
