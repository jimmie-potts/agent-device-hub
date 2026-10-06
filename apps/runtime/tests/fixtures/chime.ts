// A consume-only fixture module (Hub #846): a simulated chime that rings once for each approval prompt.
/** One ring: the session and the approval it rang for. */
export type ChimeRing = {session: string; attention: string};
export type ChimeDeviceState = {rings: ChimeRing[]};
