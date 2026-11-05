import React, {useEffect, useState} from 'react';
import {forecastTime, noticeExpiry, noticeMatchesImage} from './notice.js';
import {useArtNotice, type PresentedArt} from './presentation.js';

export function ArtNotice({image, ready}: {image: PresentedArt | undefined; ready: boolean}): React.JSX.Element | null {
  const {notice, timeZone} = useArtNotice();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (notice === undefined) return;
    const timer = setTimeout(() => {setNow(Date.now());}, Math.max(0, noticeExpiry(notice) - Date.now()));
    return () => {clearTimeout(timer);};
  }, [notice]);
  if (!noticeMatchesImage(notice, image, ready, Math.max(now, Date.now()))) return null;
  return <span className="art-notice" role="status" data-art-opportunity={notice.opportunityId}>
    <strong>Rain forecast</strong><span>{notice.forecast.likelihood === 'likely' ? 'Rain likely' : 'Chance of rain'} at {forecastTime(notice, timeZone)} · {timeZone}</span>
    <span className="hint">Weather forecast, separate from the imagined artwork.</span>
  </span>;
}
