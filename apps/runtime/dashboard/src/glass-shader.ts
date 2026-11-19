// The glass layer's shaders (#1929). One full-screen triangle; the fragment shader draws the backdrop and every panel.
// The look follows the accepted Clear reference (docs/design-references/home-clear): its FRAG shader with the flat and
// sharp options, the far light model and a join of k = 20. Lengths are CSS pixels. Colors arrive as uniforms read from
// the skin's --glass-* tokens; the few constants left here are material amounts, not colors of the interface.
import {MAX_PANELS, MAX_VEILS} from './glass-scene.ts';

/** Texels per panel in the panel table: 0 is the box (x, y, width, height), 1 holds the corner radius. */
export const PANEL_TEXELS = 2;

export const VERTEX = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}`;

export const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uArt, uPanels;
uniform vec2 uRes, uArtSize;
uniform float uDpr, uHasArt, uDark, uAppear, uDepth, uMerge, uInk, uContrast;
uniform int uCount, uVeilCount;
uniform vec4 uVeils[${String(MAX_VEILS)}];
uniform vec4 uVeil, uVeilDeep, uTone, uRim, uShadow, uWashStart, uWashEnd, uWashBox;
uniform vec3 uEdge, uBg;
out vec4 color;
const vec2 LIGHT = vec2(-.5547, -.8321);
float luma(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
float lum(vec3 c){ return luma(pow(clamp(c, 0., 1.), vec3(2.2))); }
vec3 sat(vec3 c, float s){ return mix(vec3(luma(c)), c, s); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdRound(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }

// The Quiet glass wash, as the shell draws it behind every page: two soft corner glows over the page color, laid out
// on the scrolling page (uWashBox) rather than the window.
vec3 wash(vec2 p){
  vec2 q = p - uWashBox.xy, size = uWashBox.zw * 1.4142;
  float end = 1. - clamp(length((q - uWashBox.zw) / size) / .65, 0., 1.), start = 1. - clamp(length(q / size) / .65, 0., 1.);
  vec3 c = mix(uBg, uWashEnd.rgb, uWashEnd.a * end);
  return mix(c, uWashStart.rgb, uWashStart.a * start);
}
// The artwork covering the window, blurred over a disc of about radius CSS pixels. The disc is a golden-angle spiral
// of twelve taps on a lower mip level, turned per pixel so it never bands.
vec3 art(vec2 p, float radius){
  if (uHasArt < .5) return wash(p);
  float scale = max(uRes.x / uArtSize.x, uRes.y / uArtSize.y);
  vec2 uv = (p - uRes * .5) / (uArtSize * scale) + .5;
  float texels = radius / scale, lod = log2(max(texels / 2.3, 1e-4)), sharp = max(0., log2(1. / (scale * uDpr)));
  if (lod < .7) return textureLod(uArt, uv, sharp).rgb;
  vec3 c = textureLod(uArt, uv, lod).rgb; float turn = h21(gl_FragCoord.xy * .37) * 6.2832;
  for (int i = 0; i < 12; i++){ float a = float(i) * 2.39996 + turn, d = sqrt((float(i) + .5) / 12.);
    c += textureLod(uArt, uv + vec2(cos(a), sin(a)) * d * texels / uArtSize, max(lod - 1.2, sharp)).rgb; }
  return c / 13.;
}
// The backdrop at p: the artwork, livelier and under the page's veil, or the wash as it is.
vec3 backdrop(vec2 p, float radius){
  if (uHasArt < .5) return wash(p);
  vec4 veil = mix(uVeil, uVeilDeep, uDepth);
  return mix(sat(art(p, radius), 1.5), veil.rgb, veil.a);
}
// The automatic veil: how much of the veil color brings c to the target contrast with the faintest text drawn over
// it. Light text needs a darker ground and dark text a lighter one; the mix is in linear light, so the amount is exact.
float needed(vec3 c){
  float L = lum(c), light = step(.18, uInk);
  float goal = mix(uContrast * (uInk + .05) - .05, (uInk + .05) / uContrast - .05, light), gap = mix(goal - L, L - goal, light);
  return gap <= 0. ? 0. : clamp(gap / max(abs(L - lum(uVeil.rgb)), 1e-4), 0., 1.);
}
vec3 veiled(vec3 c, float t){ return pow(mix(pow(clamp(c, 0., 1.), vec3(2.2)), pow(uVeil.rgb, vec3(2.2)), t), vec3(1. / 2.2)); }

vec4 panelBox(int i){ return texelFetch(uPanels, ivec2(0, i), 0); }
float panel(vec2 p, int i){ vec4 r = panelBox(i); vec2 h = r.zw * .5; return sdRound(p - r.xy - h, h, texelFetch(uPanels, ivec2(1, i), 0).x); }
// Every panel is one distance field. With uMerge > 0 neighbors join with a smooth minimum, so they lean together.
float field(vec2 p){ float d = 1e5;
  for (int i = 0; i < ${String(MAX_PANELS)}; i++){ if (i >= uCount) break; float e = panel(p, i); d = uMerge > 0. ? smin(d, e, uMerge) : min(d, e); }
  return d; }

// A slab of flat glass: a thin bevel that bends and splits the view, a slightly tinted edge with a faint dark band,
// a soft reflection, a rim of light facing the upper left. Inside, the automatic veil keeps the panel's text readable.
vec3 glass(vec2 p, float d, vec2 g, vec3 behind){
  float u = 1. - clamp(-d / 12., 0., 1.), slope = min(u / sqrt(max(1. - u * u, .02)), 3.) / 3.;
  vec2 off = -g * slope * 10.2 * mix(2.6, 1., uAppear);
  vec3 a = length(off) < .25 ? art(p, 4.6) : vec3(art(p + off * 1.2, 4.6).r, art(p + off, 4.6).g, art(p + off * .8, 4.6).b);
  a = sat(a, 1.7);
  vec3 c = mix(a, uTone.rgb, uTone.a);
  c *= mix(1., mix(1.06, .74, smoothstep(.42, .85, luma(a))), uDark);
  c = mix(c, c * uEdge, slope * .225);
  c *= 1. - smoothstep(2.5, 5.5, -d) * (1. - smoothstep(6., 13., -d)) * .048;
  float sheen = sin((p.x * .6 + p.y) * .011 + 1.) * .5 + .5; c += sheen * sheen * .035 * (1. - slope);
  c = veiled(c, needed(c));
  float ndl = dot(g, LIGHT), rim = 1. - smoothstep(0., 1.7, -d);
  c += art(vec2(uRes.x - p.x, p.y) + g * 60., 94.) * slope * slope * .22;
  c += uRim.rgb * uRim.a * (rim * (max(ndl, 0.) * .75 + max(-ndl, 0.) * .3 + .1) + slope * max(ndl, 0.) * .2) - slope * max(-ndl, 0.) * .08;
  return mix(behind, c, (1. - smoothstep(-1., .5, d)) * smoothstep(0., .35, uAppear));
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y * uDpr - gl_FragCoord.y) / uDpr;
  vec3 col = backdrop(p, 0.);
  // Veils behind text on the backdrop: as strong as the brighter of the local ground and the pixel itself needs.
  float t = 0.;
  for (int i = 0; i < ${String(MAX_VEILS)}; i++){ if (i >= uVeilCount) break;
    vec2 h = uVeils[i].zw * .5 + 6.; float mask = 1. - smoothstep(0., 36., sdRound(p - uVeils[i].xy - uVeils[i].zw * .5, h, 18.));
    if (mask > 0.) t = max(t, mask * max(needed(col), needed(backdrop(p, 40.)))); }
  col = veiled(col, t);
  float D = field(p), appear = smoothstep(0., .6, uAppear);
  float shade = (1. - smoothstep(-8., 36., field(p - vec2(0., 12.)))) * uShadow.a * appear;
  col = mix(col, uShadow.rgb, shade);
  vec2 g = vec2(0., 1.);
  if (D < 20.) g = normalize(vec2(field(p + vec2(1., 0.)) - field(p - vec2(1., 0.)), field(p + vec2(0., 1.)) - field(p - vec2(0., 1.))) + 1e-5);
  // The lip of light a slab focuses just past its far edge.
  if (D > 0. && D < 20.) col += col * exp(-D / 5.) * max(dot(g, -LIGHT), 0.) * .55 * appear;
  if (D < 1.) col = glass(p, D, g, col);
  color = vec4(col + (h21(gl_FragCoord.xy) - .5) * .018, 1.);
}`;
