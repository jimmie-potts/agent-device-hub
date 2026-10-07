/**
 * The next-step band locator (#907) over a synthetic UI Automation tree. It is the reference for the helper's
 * `SuggestionBand` and `BandLevel` in `src/windows/uia-helper.ps1`, with the same rule and bounds (a static test holds
 * the constants equal), so the simulated desktop and the router tests find the band the way the helper does, in the
 * tree shape the live client showed:
 *
 * - On Claude Desktop 2.19675.0.0 (2026-10-07) the composer `Edit` sits in its group (depth 15) under a common ancestor
 *   (depth 14), and the band's group, which directly holds the `Text` "next:", the suggestion buttons and "dismiss",
 *   sits two `Group`s below that ancestor's other child (depth 15 -> 16 -> 17).
 * - The locator takes every `Text` named "next:" (at most `MAX_BAND_LABELS`), its parent `Group` when that has the
 *   band's shape, and the level of the first of the composer's `MAX_COMPOSER_ANCESTORS` nearest ancestors the group
 *   hangs under, at most `BAND_SEARCH_DEPTH` groups below the branch beside it and never inside the composer's own
 *   branch. The lowest level wins; two there are ambiguous.
 */

export type NodeType = 'Window' | 'Document' | 'Group' | 'Text' | 'Button' | 'Edit';
export interface UiaNode {
  type: NodeType;
  name?: string;
  /** Buttons: enabled, keyboard-focusable and invokable, as qualified; false makes the band unqualified. */
  actionable?: boolean;
  children: UiaNode[];
  parent?: UiaNode;
}

export const BAND_LABEL = 'next:';
export const BAND_DISMISS = 'dismiss';
/** Ancestors of the composer the band may hang under (the helper's `$MaxComposerAncestors`). */
export const MAX_COMPOSER_ANCESTORS = 8;
/** Groups the band may sit below the branch beside the composer's ancestor (the helper's `$BandSearchDepth`). */
export const BAND_SEARCH_DEPTH = 3;
/** Text elements named "next:" in the window above this are refused (the helper's `$MaxBandLabels`). */
export const MAX_BAND_LABELS = 32;
/** Suggestion buttons in a band (the helper's `$MaxSuggestions`). */
export const MAX_BAND_SUGGESTIONS = 8;
/** Text and Button children above this make a group no band (the helper's `$MaxBandChildren`). */
export const MAX_BAND_CHILDREN = 16;

/** A refusal the helper reports as a reason code. */
export class BandRefusal extends Error {}

export const node = (type: NodeType, children: UiaNode[] = [], extra: Partial<UiaNode> = {}): UiaNode => {
  const made: UiaNode = { type, children, ...extra };
  for (const child of children) child.parent = made;
  return made;
};

/** The suggestion buttons of a band-shaped group, or null for any other group (`BandSuggestions`). */
export function bandSuggestions(group: UiaNode): UiaNode[] | null {
  const children = group.children.filter(child => child.type === 'Text' || child.type === 'Button');
  if (children.length > MAX_BAND_CHILDREN) return null;
  const labels = children.filter(child => child.type === 'Text' && child.name?.trim() === BAND_LABEL).length;
  const dismiss = children.filter(child => child.type === 'Button' && child.name?.trim() === BAND_DISMISS).length;
  if (labels !== 1 || dismiss !== 1) return null;
  const buttons = children.filter(child => child.type === 'Button' && child.name?.trim() !== BAND_DISMISS);
  if (buttons.length < 1 || buttons.length > MAX_BAND_SUGGESTIONS || buttons.some(button => button.actionable === false)) throw new BandRefusal('suggestion-band-unqualified');
  return buttons;
}

/** The level of the composer ancestor the group hangs under, through another branch, or -1 (`BandLevel`). */
export function bandLevel(group: UiaNode, chain: readonly UiaNode[]): number {
  let at = group;
  for (let step = 0; step <= BAND_SEARCH_DEPTH; step++) {
    const up = at.parent;
    if (!up) return -1;
    const j = chain.indexOf(up);
    if (j >= 1) return chain[j - 1] === at ? -1 : j - 1;
    at = up;
  }
  return -1;
}

function descendants(root: UiaNode): UiaNode[] {
  return root.children.flatMap(child => [child, ...descendants(child)]);
}

/** The band and its level, or null without one (`SuggestionBand`). Throws `BandRefusal` as the helper fails. */
export function locateBand(window: UiaNode, composer: UiaNode): { buttons: UiaNode[]; level: number } | null {
  const chain: UiaNode[] = [];
  let current: UiaNode | undefined = composer;
  for (let depth = 0; depth <= MAX_COMPOSER_ANCESTORS && current; depth++) {
    chain.push(current);
    if (current === window) break;
    current = current.parent;
  }
  const labels = descendants(window).filter(item => item.type === 'Text' && item.name === BAND_LABEL);
  if (labels.length > MAX_BAND_LABELS) throw new BandRefusal('suggestion-band-ambiguous');
  let best: { buttons: UiaNode[]; level: number } | null = null;
  let tied = 0;
  for (const label of labels) {
    const group = label.parent;
    if (group?.type !== 'Group') continue;
    const level = bandLevel(group, chain);
    if (level < 0) continue;
    const buttons = bandSuggestions(group);
    if (!buttons) continue;
    if (!best || level < best.level) { best = { buttons, level }; tied = 1; }
    else if (level === best.level) tied++;
  }
  if (tied > 1) throw new BandRefusal('suggestion-band-ambiguous');
  return best;
}

/**
 * Where the band sits in the synthetic Claude window: `observed`, two groups below the branch beside the composer's
 * group, as on the live client (2026-10-07); `sibling`, that branch itself; `too-deep`, one group further than
 * `BAND_SEARCH_DEPTH` allows, which the locator must not find.
 */
export type BandNesting = 'observed' | 'sibling' | 'too-deep';

/**
 * A synthetic Claude window in the live layout (2026-10-07): the composer `Edit` in its group under a common ancestor,
 * and, when `labels` is not empty, the band in another branch of that ancestor at the chosen nesting. Labels are
 * synthetic.
 */
export function claudeWindowTree(labels: readonly string[], nesting: BandNesting = 'observed'): { window: UiaNode; composer: UiaNode } {
  const composer = node('Edit', [], { name: 'Prompt' });
  const branch: UiaNode[] = [];
  if (labels.length > 0) {
    let band = node('Group', [
      node('Text', [], { name: BAND_LABEL }),
      ...labels.map(label => node('Button', [], { name: label, actionable: true })),
      node('Button', [], { name: BAND_DISMISS, actionable: true }),
    ]);
    const wraps = nesting === 'sibling' ? 0 : nesting === 'observed' ? 2 : BAND_SEARCH_DEPTH + 1;
    for (let i = 0; i < wraps; i++) band = node('Group', [band]);
    branch.push(band);
  }
  // A transcript branch with a message group, which is never the band, beside the band's branch.
  const transcript = node('Group', [node('Group', [node('Text', [], { name: 'Synthetic message' }), node('Button', [], { name: 'Copy', actionable: true })])]);
  const common = node('Group', [transcript, ...branch, node('Group', [composer])]);
  const window = node('Window', [node('Document', [node('Group', [node('Group', [node('Group', [common])])])])]);
  return { window, composer };
}
