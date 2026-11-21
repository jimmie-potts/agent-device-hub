// The glass layer's WebGL 2 plumbing (#1929): one program, the backdrop texture and the panel table. It reads nothing
// from the page; the layer hands it a scene and the skin's colors for every frame it draws.
import {MAX_PANELS, MAX_VEILS, type GlassRgb, type GlassScene} from './glass-scene.ts';
import {litRows, MAX_LIGHTS, type EasedLight} from './glass-light.ts';
import {FRAGMENT, PANEL_TEXELS, VERTEX} from './glass-shader.ts';
import type {GlassThumb, ThumbBox} from './glass-thumb.ts';

/** A color as 0-1 channels and an alpha that the shader reads as an amount. */
export type GlassColor = readonly [number, number, number, number];
/** Parses a computed color, which browsers serialize as rgb() or rgba() with 0-255 channels; anything else is black. */
export function parseColor(value: string): GlassColor {
  const numbers = /rgba?\(([^)]*)\)/.exec(value)?.[1]?.split(/[\s,/]+/).filter(part => part !== '').map(Number) ?? [];
  const [r = 0, g = 0, b = 0, a = 1] = numbers;
  return [r / 255, g / 255, b / 255, a];
}
/** WCAG relative luminance of a color's channels. */
export function luminance([r, g, b]: GlassColor): number {
  const linear = (value: number): number => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
/** The skin's values for one appearance, read from the --glass-* tokens (see glass-layer.tsx). */
export type GlassTokens = {
  dark: boolean; ink: number;
  veil: GlassColor; veilDeep: GlassColor; tone: GlassColor; rim: GlassColor; shadow: GlassColor; edge: GlassColor;
  bg: GlassColor; washStart: GlassColor; washEnd: GlassColor;
  /** The warm white of a light whose module reports no color (#1931). */
  lamp: GlassColor;
};
export type GlassFrame = {
  scene: GlassScene; tokens: GlassTokens; width: number; height: number; dpr: number;
  /** 0 to 1 over the first appearance; the bevel starts stronger and relaxes. */
  appear: number;
  /** 0 to 1 as the page scrolls its first 40% of a window; the dark veil deepens. */
  depth: number;
  /** The scrolling page's box, which the wash is laid out on. */
  washBox: readonly [number, number, number, number];
  /** The join between panels (0 keeps them apart). */
  merge: number;
  /** A switch's thumb, drawn as its own glass capsule, or null for none. */
  thumb: GlassThumb | null;
  /** Each lit panel's eased level and press by panel id (#1931); a panel missing here draws no light. */
  lights: ReadonlyMap<string, EasedLight>;
  /** Each liquid panel's state from 0 to 1 by panel id (#1932); a panel missing here is at rest. */
  liquid: ReadonlyMap<string, number>;
  /** Seconds on a steady clock; the liquid edge flows with it. */
  clock: number;
};
/** The backdrop texture's source: a decoded picture the caller owns and keeps open while it is current. */
export type GlassPicture = {bitmap: ImageBitmap; width: number; height: number};
export type GlassRenderer = {
  /** Uploads a picture, or null for the wash. Reads the bitmap now and keeps no reference to it. */
  backdrop: (picture: GlassPicture | null) => void;
  draw: (frame: GlassFrame) => void;
  dispose: () => void;
};

const NO_THUMB: ThumbBox = [0, 0, 0, 0];
/** A light's color in the shader's linear channels, as the reference converts its tints. */
export const lightChannels = (color: GlassRgb): GlassRgb => [color[0] ** 2.2, color[1] ** 2.2, color[2] ** 2.2];
/** The color a panel's light is drawn in: its own, or the skin's warm white. */
export const lightColor = (color: GlassRgb | null, tokens: GlassTokens): GlassRgb => color ?? [tokens.lamp[0], tokens.lamp[1], tokens.lamp[2]];

/** WCAG's target is 4.5:1; the veil aims a little higher so the grain and rounding never take it below. */
const CONTRAST = 5;

/** Builds the program on a WebGL 2 context. Throws when the context cannot compile it; the caller falls back. */
export function createGlassRenderer(gl: WebGL2RenderingContext): GlassRenderer {
  const shaders: WebGLShader[] = [];
  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);if (shader === null) throw new Error('glass-shader-unavailable');shaders.push(shader);
    gl.shaderSource(shader, source);gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true && !gl.isContextLost()) throw new Error(`glass-shader: ${gl.getShaderInfoLog(shader) ?? ''}`);
    return shader;
  };
  const program = gl.createProgram();
  const release = (): void => {for (const shader of shaders) gl.deleteShader(shader);gl.deleteProgram(program);};
  try {
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true && !gl.isContextLost()) throw new Error(`glass-program: ${gl.getProgramInfoLog(program) ?? ''}`);
  } catch (error) {release();throw error;}
  gl.useProgram(program);
  const locations = new Map<string, WebGLUniformLocation | null>();
  const at = (name: string): WebGLUniformLocation | null => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  };
  const texture = (unit: number): WebGLTexture => {
    const value = gl.createTexture();gl.activeTexture(gl.TEXTURE0 + unit);gl.bindTexture(gl.TEXTURE_2D, value);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, unit === 0 ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, unit === 0 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    const wrap = unit === 0 ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return value;
  };
  const art = texture(0), panels = texture(1);
  gl.activeTexture(gl.TEXTURE0);gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  gl.uniform1i(at('uArt'), 0);gl.uniform1i(at('uPanels'), 1);
  const table = new Float32Array(PANEL_TEXELS * MAX_PANELS * 4), lightIndex = new Int32Array(MAX_LIGHTS), veils = new Float32Array(MAX_VEILS * 4), edges = new Float32Array(MAX_VEILS);
  let size: readonly [number, number] | null = null;

  const color4 = (name: string, value: GlassColor): void => {gl.uniform4f(at(name), value[0], value[1], value[2], value[3]);};
  return {
    backdrop: picture => {
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D, art);
      if (picture === null) {size = null;gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));return;}
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture.bitmap);gl.generateMipmap(gl.TEXTURE_2D);
      size = [picture.width, picture.height];
    },
    draw: frame => {
      const {scene, tokens} = frame, count = Math.min(scene.panels.length, MAX_PANELS);
      table.fill(0);lightIndex.fill(0);
      scene.panels.slice(0, count).forEach((panel, index) => {
        table.set([panel.rect.x, panel.rect.y, panel.rect.width, panel.rect.height, panel.radius, frame.liquid.get(panel.id) ?? 0, 0, 0], index * PANEL_TEXELS * 4);
      });
      // Only the lit panels' light goes in, and the shader visits only their rows.
      const lit = litRows(scene.panels, frame.lights, count);
      lit.forEach((index, slot) => {
        const panel = scene.panels[index], eased = panel === undefined ? undefined : frame.lights.get(panel.id);
        if (panel?.light === undefined || eased === undefined) return;
        lightIndex[slot] = index;
        table.set([...lightChannels(lightColor(panel.light.color, tokens)), eased.level, panel.light.lamp.x, panel.light.lamp.y, eased.press, 0], index * PANEL_TEXELS * 4 + 8);
      });
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D, panels);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, PANEL_TEXELS, MAX_PANELS, 0, gl.RGBA, gl.FLOAT, table);
      veils.fill(0);edges.fill(0);scene.veils.slice(0, MAX_VEILS).forEach((veil, index) => {veils.set([veil.rect.x, veil.rect.y, veil.rect.width, veil.rect.height], index * 4);edges[index] = veil.edge ? 1 : 0;});
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(at('uRes'), frame.width, frame.height);gl.uniform1f(at('uDpr'), frame.dpr);
      gl.uniform2f(at('uArtSize'), size?.[0] ?? 1, size?.[1] ?? 1);gl.uniform1f(at('uHasArt'), size === null ? 0 : 1);
      gl.uniform1f(at('uDark'), tokens.dark ? 1 : 0);gl.uniform1f(at('uInk'), tokens.ink);gl.uniform1f(at('uContrast'), CONTRAST);
      gl.uniform1f(at('uAppear'), frame.appear);gl.uniform1f(at('uDepth'), frame.depth);gl.uniform1f(at('uMerge'), frame.merge);gl.uniform1f(at('uClock'), frame.clock);
      gl.uniform1i(at('uCount'), count);gl.uniform1i(at('uLights'), lit.length);gl.uniform1iv(at('uLightIndex'), lightIndex);gl.uniform1i(at('uVeilCount'), Math.min(scene.veils.length, MAX_VEILS));gl.uniform4fv(at('uVeils'), veils);gl.uniform1fv(at('uVeilEdges'), edges);
      color4('uVeil', tokens.veil);color4('uVeilDeep', tokens.veilDeep);color4('uTone', tokens.tone);color4('uRim', tokens.rim);color4('uShadow', tokens.shadow);
      color4('uWashStart', tokens.washStart);color4('uWashEnd', tokens.washEnd);gl.uniform4f(at('uWashBox'), ...frame.washBox);
      gl.uniform4f(at('uThumbA'), ...frame.thumb?.lead ?? NO_THUMB);gl.uniform4f(at('uThumbB'), ...frame.thumb?.lag ?? NO_THUMB);
      gl.uniform3f(at('uEdge'), tokens.edge[0], tokens.edge[1], tokens.edge[2]);gl.uniform3f(at('uBg'), tokens.bg[0], tokens.bg[1], tokens.bg[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose: () => {gl.deleteTexture(art);gl.deleteTexture(panels);release();},
  };
}
