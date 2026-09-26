// Deliver a stop while the real hub is still starting, before the CLI gets its handle.
import { mock } from 'node:test';
import { startHub } from '../dist/server.js';
mock.module(new URL('../dist/server.js',import.meta.url).href,{namedExports:{
 startHub:async(...args)=>{
  process.emit(process.env.TEST_START_SIGNAL);
  return await startHub(...args);
 },
}});
