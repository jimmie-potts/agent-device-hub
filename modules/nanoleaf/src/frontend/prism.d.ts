export type PrismLayout = {version: number; nodes: unknown[]; lines: unknown[]};
export const Prism: {Renderer: new (host: HTMLElement, layout: PrismLayout, options: {animate: boolean}) => {setMode(mode: string): void; destroy(): void}};
