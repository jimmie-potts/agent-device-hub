import React, {useState} from 'react';
import './music.css';

export type MusicAction = 'previous' | 'play' | 'pause' | 'next';
export type MusicCardProps = {
  id: string; availability: 'available' | 'stale' | 'unavailable';
  title: string; artist?: string | undefined; album?: string | undefined; player: string;
  artworkUrl?: string | undefined; controls: readonly MusicAction[]; disabled: boolean;
  onAction: (action: MusicAction) => void; status: string; locked: boolean; refresh?: (() => void) | undefined;
};
/** Keyed by its complete observation URL; a retired image cannot update the replacement. */
function Artwork({src}: {src: string}): React.JSX.Element {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return <div className="playback-artwork" aria-hidden="true" data-loaded={state === 'loaded'}>
    <span className="music-placeholder">♫</span>
    <img src={src} alt="" onLoad={() => {setState(current => current === 'failed' ? current : 'loaded');}} onError={() => {setState('failed');}}/>
  </div>;
}
/** Presentation only: the shell adapter supplies observations, capabilities and guarded actions. */
export function MusicCard(props: MusicCardProps): React.JSX.Element {
  const {id, availability, title, artist, album, player, controls, disabled, onAction, status, locked, refresh} = props;
  const exceptional = availability !== 'available';
  const primary: MusicAction = player === 'playing' ? 'pause' : 'play';
  return <article className="music-card" aria-label={`Music ${id}`}>
    <header className="music-heading"><span className={exceptional ? 'warning' : undefined}>
      {exceptional && <span className="music-warning" aria-hidden="true">!</span>}
      <span>{exceptional ? availability === 'stale' ? 'Stale' : 'Unavailable' : 'Now playing'}</span>
    </span>{!exceptional && <span>{player.charAt(0).toUpperCase() + player.slice(1)}</span>}</header>
    {props.artworkUrl !== undefined ? <Artwork key={`${id}:${props.artworkUrl}`} src={props.artworkUrl}/> : <div className="playback-artwork" aria-hidden="true"><span className="music-placeholder">♫</span></div>}
    <div className="music-metadata"><h2>{title}</h2>{artist !== undefined && <p className="music-artist">{artist}</p>}{album !== undefined && <p className="music-album">{album}</p>}</div>
    <fieldset className="music-transport" aria-label="Playback controls" disabled={disabled}>
      {(['previous', primary, 'next'] as const).map(value => <button type="button" key={value} disabled={!controls.includes(value)} onClick={() => {onAction(value);}}>
        {value.charAt(0).toUpperCase() + value.slice(1)}
      </button>)}
    </fieldset>
    <p className="music-output">Audio output · Not reported</p>
    {availability === 'available' && player === 'paused' && !controls.includes('play') && <p className="music-note">Resume from your iPhone.</p>}
    <p className="music-note" role="status">{status}</p>
    {locked && refresh !== undefined && <button type="button" className="secondary" onClick={refresh}>Refresh current state</button>}
  </article>;
}
