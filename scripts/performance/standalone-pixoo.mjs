// All imports and state are confined by the launcher before this module runs.
import {mkdir} from 'node:fs/promises';
import Fastify from '/runtime/pixoo/node_modules/fastify/fastify.js';
import {Player} from '/runtime/pixoo/packages/playback/dist/index.js';
import {FakeDeviceAdapter} from '/runtime/pixoo/packages/device/dist/index.js';
import {MemoryPlaybackStore} from '/runtime/pixoo/tests/helpers/playback-store.ts';
import {ControlService} from '/runtime/pixoo/apps/server/dist/control-service.js';
import {Commands} from '/runtime/pixoo/apps/server/dist/commands.js';
import {MonitorPresentation} from '/runtime/pixoo/apps/server/dist/monitor-presentation.js';
import {registerController} from '/runtime/pixoo/apps/server/dist/controller.js';
import {provisionCredential} from '/runtime/pixoo/apps/server/dist/mcp-config.js';
export async function startPixoo(){
 const directory='/state/pixoo-control';await mkdir(directory,{mode:0o700});
 const token=await provisionCredential(directory,'qualification',['read','control']);
 const device=new FakeDeviceAdapter(),store=new MemoryPlaybackStore();
 const player=await Player.open({store,device}),commands=new Commands();
 const service=new ControlService(player,commands,'simulator');
 const monitor=new MonitorPresentation(player,{save:async()=>{}});service.monitor=monitor;
 const app=Fastify({logger:false});
 await registerController(app,directory,service,{controllerId:'qualification-pixoo',deviceId:'pixoo-local',sourceId:'qualification'});
 await app.listen({host:'127.0.0.1',port:0});
 await monitor.configure({operation:'mode',mode:'monitor'});
 return {config:{id:'pixoo',kind:'pixoo',controllerId:'qualification-pixoo',deviceId:'pixoo-local',endpoint:`http://127.0.0.1:${app.server.address().port}/controller/v1`,token},
  submit(view){monitor.submit(view);monitor.tick();},
  frames:()=>device.effects.filter(e=>e.kind==='frame').length,
  async close(){await app.close();await monitor.close();await player.close();}
 };
}
