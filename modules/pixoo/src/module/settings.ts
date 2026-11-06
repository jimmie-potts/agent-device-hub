// Read projection of the existing runtime configuration; the configuration file remains its only writer.
import type {ModuleSettings} from '@jimmie-potts/sdk';
import {animationRoute, DIRECT_FRAME_LIMIT} from '../device/animation-policy.js';
import type {PixooConfig} from './configuration.js';

export function pixooSettings(simulated: boolean): ModuleSettings<PixooConfig> {
  return {
    schema: {type: 'object', additionalProperties: false, required: ['device', 'limits', 'simulated', 'hostedConfigured'], properties: {
      device: {type: 'object', additionalProperties: false, required: ['id', 'address', 'profile'], properties: {
        id: {type: 'string'}, address: {type: 'string'}, profile: {type: 'string'}, model: {type: 'string'}, firmware: {type: 'string'},
      }},
      limits: {type: 'object', additionalProperties: false, required: ['route', 'maxFrames', 'minDelayMs', 'maxDelayMs', 'uniformTiming'], properties: {
        route: {enum: ['direct', 'hosted', 'simulator']}, maxFrames: {type: ['integer', 'null']},
        minDelayMs: {type: ['integer', 'null']}, maxDelayMs: {type: ['integer', 'null']}, uniformTiming: {type: 'boolean'},
      }},
      simulated: {type: 'boolean'}, hostedConfigured: {type: 'boolean'},
    }},
    show: ({device, hostedGif}) => {
      const route = animationRoute(device.profile.name);
      return {
        device: {id: device.id, address: device.address, profile: device.profile.name,
          ...(device.model === undefined ? {} : {model: device.model}), ...(device.firmware === undefined ? {} : {firmware: device.firmware})},
        limits: {route, maxFrames: route === 'direct' ? DIRECT_FRAME_LIMIT : null,
          minDelayMs: route === 'hosted' ? 10 : null, maxDelayMs: route === 'hosted' ? 655350 : null, uniformTiming: route !== 'simulator'},
        simulated, hostedConfigured: hostedGif !== undefined,
      };
    },
  };
}
