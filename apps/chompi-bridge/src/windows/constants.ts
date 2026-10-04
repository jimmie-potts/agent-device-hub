import type { Client } from '../os-adapter.js';

/** Package family names of the qualified Desktop clients (docs/chompi-controller-qualification.md). */
export const CODEX_PACKAGE_FAMILY = 'OpenAI.Codex_2p2nqsd0c76g0';
export const CLAUDE_PACKAGE_FAMILY = 'Claude_pzs8sxrjxfjjc';

export const PACKAGE_FAMILIES: Readonly<Record<Client, string>> = Object.freeze({
  codex: CODEX_PACKAGE_FAMILY,
  claude: CLAUDE_PACKAGE_FAMILY,
});
