declare module 'gifenc' {
  export type Palette = number[][];
  export function GIFEncoder(): {
    writeFrame(pixels: Uint8Array, width: number, height: number, options: {palette?: Palette; delay: number; dispose: number; transparent: boolean; repeat: number}): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(rgba: Uint8Array, maxColors: number, options?: {format?: 'rgb565' | 'rgb444' | 'rgba4444'}): Palette;
  export function applyPalette(rgba: Uint8Array, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
}
