// A file read stuck in a file system call, loaded into a hook process with `--import` before the hook (Hub #926). A
// blocking open of a FIFO with no writer never returns, as an open on a stalled mount does not, so it stands in for a
// title read stuck there: agent-state opens the transcript without blocking, so a FIFO alone does not stall that read.
import {readFile} from 'node:fs/promises';

const path = process.env.BUNNY_STALLED_READ;
if (path !== undefined) void readFile(path).catch(() => {});
