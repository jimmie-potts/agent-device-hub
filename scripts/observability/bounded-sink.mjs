import { MAX_QUEUE_RECORDS, MAX_QUEUE_BYTES, MAX_RECORD_BYTES, MAX_FLUSH_MS } from '@jimmie-potts/bunny-observability';
const add = (value, amount = 1) => Math.min(Number.MAX_SAFE_INTEGER, value + amount);
function limit(value, ceiling) {
  if (value === undefined) return ceiling;
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new TypeError('Invalid telemetry queue limit');
  return value;
}

/** Serial, drop-newest transport queue. The injected sink must return promptly and honor abort. */
export function createBoundedSink(sink, options = {}, observe) {
  if(observe!==undefined && typeof observe!=='function')throw new TypeError('Invalid queue observer');
  const maxRecords = limit(options.maxRecords, MAX_QUEUE_RECORDS);
  const maxBytes = limit(options.maxBytes, MAX_QUEUE_BYTES);
  const flushMs = limit(options.flushMs, MAX_FLUSH_MS);
  const queue = [];
  let bytes = 0, attempted = 0, accepted = 0, rejected = 0, dropped = 0, failed = 0, exported = 0;
  let active, closed = false, closing, finishClose, flushing, finishFlush;
  let observationFailed=0;
  function observed(identity,phase) {
    if(!observe)return;
    try {
      const result=observe(identity,phase);
      if(result && typeof result.then==='function'){Promise.resolve(result).catch(()=>{});observationFailed=add(observationFailed);}
    }catch{observationFailed=add(observationFailed);}
  }
  function drain() {
    if (active || closed) return;
    const item = queue[0];
    if (!item) { finishFlush?.(true); finishClose?.(); return; }
    active = new AbortController();
    const signal = active.signal;
    // Neither synchronous network setup nor a throwing sink runs in the producer call.
    void Promise.resolve().then(() => {
      if (closed) return;
      return sink(item.line, signal);
    }).then(() => settle(false), () => settle(true));
    function settle(error) {
      if (closed) return;
      if (error) failed = add(failed); else exported = add(exported);
      observed(item.identity,error?'failed':'exported');
      queue.shift(); bytes -= item.bytes; active = undefined;
      drain();
    }
  }
  return {
    push(line, identity) {
      attempted = add(attempted);
      const size = typeof line === 'string' ? Buffer.byteLength(line) : 0;
      if (closed || closing || size === 0 || size > MAX_RECORD_BYTES ||
        queue.length >= maxRecords || bytes + size > maxBytes) {
        rejected = add(rejected); dropped = add(dropped);observed(identity,'dropped'); return false;
      }
      queue.push({ line, bytes: size,identity }); bytes += size; accepted = add(accepted);
      drain(); return true;
    },
    counts: () => ({ attempted, accepted, rejected, dropped, failed, exported, queued: queue.length, bytes,observationFailed }),
    flush() {
      if (flushing) return flushing;
      flushing = Promise.resolve().then(() => new Promise(resolve => {
        let timer;
        finishFlush = success => {
          clearTimeout(timer); finishFlush = undefined; flushing = undefined; resolve(success);
        };
        if (!queue.length) finishFlush(true);
        else timer = setTimeout(() => finishFlush?.(false), flushMs);
      }));
      return flushing;
    },
    close() {
      if (closing) return closing;
      // Defer finalization so the same promise is installed even for an empty queue.
      closing = Promise.resolve().then(() => new Promise(resolve => {
        let timer;
        finishClose = () => {
          if (closed) return;
          closed = true; clearTimeout(timer);
          finishFlush?.(queue.length === 0);
          dropped = add(dropped, queue.length);
          for(const item of queue)observed(item.identity,'dropped');
          queue.length = 0; bytes = 0;
          active?.abort(); active = undefined; finishClose = undefined;
          resolve();
        };
        if (!queue.length) finishClose();
        else timer = setTimeout(finishClose, flushMs);
      }));
      return closing;
    },
  };
}
