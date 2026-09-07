import { bindDeviceTools, bindServiceTools, createDeviceRegistry, createMcpHandler } from '@jimmie-potts/device-mcp';
import type { ControllerService, MachinePrincipal, ServiceExtension } from '@jimmie-potts/device-mcp';

/** Generic adoption: a registered service already owns API 1.0 admission and its device queue. */
export function sharedController(service: ControllerService, authenticate: (token: string, signal: AbortSignal) => Promise<MachinePrincipal | null>) {
  const registry = createDeviceRegistry([{ controllerId: 'configured-controller', deviceId: 'configured-device', service }]);
  return createMcpHandler({ enabled: true, registry, tools: bindDeviceTools(registry, { deviceId: 'configured-device', prefix: 'device' }),
    authenticate, allowedHosts: ['127.0.0.1:4000'], allowedOrigins: [] });
}

/** Pixoo adoption: the supplied extension owns its existing request_id/replay and player behavior. */
export function existingPlayer(extensions: { status: ServiceExtension; screen: ServiceExtension; brightness: ServiceExtension;
  media: ServiceExtension; playlists: ServiceExtension; show: ServiceExtension; play: ServiceExtension; control: ServiceExtension },
  authenticate: (token: string, signal: AbortSignal) => Promise<MachinePrincipal | null>) {
  const registry = createDeviceRegistry([{ controllerId: 'pixoo-controller', deviceId: 'pixoo-device', extensions }]);
  const tools = bindServiceTools(registry, { deviceId: 'pixoo-device', bindings: [
    { extension: 'status', name: 'get_status' }, { extension: 'screen', name: 'set_screen' }, { extension: 'brightness', name: 'set_brightness' },
    { extension: 'media', name: 'list_media' }, { extension: 'playlists', name: 'list_playlists' }, { extension: 'show', name: 'show_media' },
    { extension: 'play', name: 'play_playlist' }, { extension: 'control', name: 'control_playback' },
  ] });
  return createMcpHandler({ enabled: true, registry, tools, authenticate, allowedHosts: ['127.0.0.1:4000'], allowedOrigins: [] });
}
