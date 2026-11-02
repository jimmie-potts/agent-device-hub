import type {ChildProcess} from 'node:child_process';
export class VendorPair {
  #closing:Promise<void>|undefined;
  readonly #members:ChildProcess[]=[];
  constructor(readonly invalidate:()=>void) {}
  add(child:ChildProcess):void {
    if(this.#closing!==undefined)throw new Error('MicroDuck pair already ended');
    this.#members.push(child);child.once('exit',()=>{void this.stop();});child.once('error',()=>{void this.stop();});
  }
  get ended():boolean {return this.#closing!==undefined;}
  stop():Promise<void> {this.#closing??=this.#finish();return this.#closing;}
  async #finish():Promise<void> {
    let invalidationFailed=false;try{this.invalidate();}catch{invalidationFailed=true;}
    await Promise.all(this.#members.map(async child=>{
      if(child.exitCode!==null||child.signalCode!==null)return;
      await new Promise<void>(resolve=>{
        const timer=setTimeout(()=>{child.kill('SIGKILL');},5000);
        child.once('exit',()=>{clearTimeout(timer);resolve();});
        child.once('error',()=>{clearTimeout(timer);resolve();});
        child.kill('SIGTERM');
      });
    }));
    if(invalidationFailed)throw new Error('MicroDuck witness invalidation failed after pair cleanup');
  }
}
