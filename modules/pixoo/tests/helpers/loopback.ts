import type {AddressInfo,Server} from 'node:net';

/**
 * Ports of the owner's installed services on this PC, from divoom-app-upgrade
 * scripts/verify/installed-ports.ts. Linux's ephemeral range includes 41230
 * and 41231, so the kernel can hand one to a test that listens on port 0.
 */
export const installedPorts:readonly number[]=[8765,8787,8788,8791,41230,41231];

/**
 * Open something that binds an ephemeral port. While the port is an installed
 * service's, close it and open another, so a test never holds that port
 * (divoom-app-upgrade#125).
 */
export async function outsideInstalledPorts<T>(open:()=>Promise<T>,port:(opened:T)=>number,close:(opened:T)=>Promise<void>,attempts=20):Promise<T> {
 for(let attempt=0;attempt<attempts;attempt++){
  const opened=await open();
  if(!installedPorts.includes(port(opened)))return opened;
  await close(opened);
 }
 throw new Error('no ephemeral loopback port outside the installed ports');
}

/** Listen on an ephemeral 127.0.0.1 port outside the installed services' ports, as divoom-app-upgrade 1b4115c (#124) did for its stand-in Hub. */
export async function listenLoopback(server:Server):Promise<number> {
 const port=()=>(server.address() as AddressInfo).port;
 await outsideInstalledPorts(
  ()=>new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});}),
  port,
  ()=>new Promise<void>(resolve=>{server.close(()=>resolve());}),
 );
 return port();
}
