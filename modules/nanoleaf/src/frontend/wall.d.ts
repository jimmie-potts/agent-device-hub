import type {LegacyWall} from './model.js';

/** The retained controller accepts only projected data and explicit actions from the typed React host. */
export type WallPorts = {
  action(path: string, payload: Record<string, unknown>): void;
  selectDevice(id: string): void;
};
export type MountedWall = {update(view: LegacyWall, editable: boolean): void; dispose(): void};
export function mountWall(host: HTMLElement, ports: WallPorts): MountedWall;
