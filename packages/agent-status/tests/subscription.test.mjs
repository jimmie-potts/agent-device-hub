import test from 'node:test';
import assert from 'node:assert/strict';
import {FeedListener} from '../dist/index.js';
import {flush} from './helpers/streams.mjs';

test('optional feed consumption is single-owned, closes once and cannot resubscribe after stop',async()=>{
  let subscriptions=0,closes=0,returns=0,resolve,updates=0;
  const feed={subscribe(){subscriptions++;return {[Symbol.asyncIterator](){return this;},next(){return new Promise(r=>{resolve=r;});},close(){closes++;resolve({done:true});},return(){returns++;return Promise.resolve({done:true});}};}};
  const listener=new FeedListener(feed,()=>updates++);listener.start();listener.start();assert.equal(subscriptions,1);
  resolve({done:false,value:1});await flush();assert.equal(updates,1);
  listener.stop();listener.stop();await flush();listener.start();assert.equal(subscriptions,1);assert.equal(closes,1);assert.equal(returns,1);
});

test('a broken iterator setup releases its subscription and a later evaluation may retry',()=>{
  let closes=0;const listener=new FeedListener({subscribe(){return {close(){closes++;},[Symbol.asyncIterator](){throw new Error('failed');}};}},()=>{});
  listener.start();listener.start();assert.equal(closes,2);listener.stop();listener.start();assert.equal(closes,2);
});
