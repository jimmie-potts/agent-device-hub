/** Native read extension. Commands and event streams retain integration 1.0. */
export const catalogVersion='pixoo-integration/1.1' as const;
export const maximumPreviewManifestBytes=128*1024;
export const maximumPreviewFrames=1000;
export interface CurrentMedia {
 renditionId:string;itemId:string;playlistId:string|null;playlistRevision:number|null;
 itemIndex:number;itemCount:number;state:'idle'|'loading'|'playing'|'paused'|'reconnecting'|'error';intent:'active'|'paused'|'stopped';generation:number;uncertain:boolean;
}
export interface PreviewManifest {
 apiVersion:typeof catalogVersion;renditionId:string;width:64;height:64;frameCount:number;durationMs:number|null;
 frames:Array<{index:number;delayMs:number|null}>;
 warnings:Array<{frame:number;code:'missing-delay'|'zero-delay';effectiveDelayMs:100}>;
}
export const catalogCapability={supported:true,preview:'png-frames',maximumPageSize:100} as const;
/** Match finite native route families, including malformed IDs so errors remain authenticated. */
export function nativeReadPath(path:string):boolean {
 return /^\/controller\/pixoo-integration\/v1\/(?:catalog\/(?:renditions|playlists(?:\/[^/]+)?)|renditions\/[^/]+\/(?:preview\.(?:png|json)|frames\/[^/]+\.png))$/.test(path);
}

export interface CatalogRendition {
 assetId:string;renditionId:string;name:string;format:'png'|'jpeg'|'gif';frameCount:number;durationMs:number|null;compatible:boolean;
}
export interface CatalogPlaylistSummary {id:string;name:string;revision:number;itemCount:number;repeat:boolean;shuffle:boolean}
export type CatalogPlaybackPolicy={mode:'duration';durationMs:number}|{mode:'plays';totalPlays:number};
export interface CatalogPlaylist {
 id:string;name:string;revision:number;repeat:boolean;shuffle:boolean;createdAt:string;updatedAt:string;
 items:Array<{id:string;renditionId:string;playback:CatalogPlaybackPolicy}>;
}
export interface CatalogPage<T> {apiVersion:typeof catalogVersion;catalogRevision:number;items:T[];total:number;offset:number;limit:number}
export interface CatalogPlaylistDetail {apiVersion:typeof catalogVersion;catalogRevision:number;playlist:CatalogPlaylist}
