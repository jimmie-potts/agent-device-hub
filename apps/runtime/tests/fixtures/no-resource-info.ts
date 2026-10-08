// A hook process whose check for a pending file read cannot tell (Hub #926), loaded with `--import` before the hook:
// `process.getActiveResourcesInfo` throws, as a runtime without it or with a broken one would. The hook must stay
// fail-open and exit 0.
process.getActiveResourcesInfo = (): string[] => {
  throw new Error('no resource information');
};
