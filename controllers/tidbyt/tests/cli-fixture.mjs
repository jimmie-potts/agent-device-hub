// Run the real runner and CLI with an in-memory connection and no network access.
import { mock } from 'node:test';
import { dirname, join } from 'node:path';
import { loadRunnerConfig, startStatusRunner } from '../dist/runner.js';

const connection={capabilities:{backend:'tidbyt-cloud',backgroundPush:{supported:true},foregroundPush:{supported:false},installationRead:{supported:true},installationRemove:{supported:true}},
 async push(){return {outcome:'sent'};},async remove(){return {outcome:'sent'};},async readInstallation(){return {ok:true,present:false};}};
globalThis.fetch=async()=>{throw new Error('fixture-feed-unavailable');};
mock.module(new URL('../dist/runner.js',import.meta.url).href,{namedExports:{
 loadRunnerConfig:path=>{
  if(process.env.TEST_START_SIGNAL) process.emit(process.env.TEST_START_SIGNAL);
  return loadRunnerConfig(path);
 },
 startStatusRunner:config=>startStatusRunner(config,{connection,leaseRoot:join(dirname(process.argv[2]),'locks')}),
}});
