// Temporary negative control for #765; removed in the next commit.
async function work(): Promise<void> {}
export function probe(): void { work(); }
