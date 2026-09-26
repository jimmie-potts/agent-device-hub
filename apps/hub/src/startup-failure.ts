/** A stable, path-free operator code for a failed start, or undefined when the cause has none. */
export function startupFailureCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message === 'Tool catalog exceeds response limit') return 'mcp-tool-catalog-too-large';
  return /^[a-z][a-z0-9-]{2,63}$/.test(error.message) ? error.message : undefined;
}
