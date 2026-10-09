// Read projection of the existing runtime configuration; the configuration file remains its only writer.
import type {ModuleSettings} from '@jimmie-potts/sdk';
import type {PixooConfig} from './configuration.js';

export function pixooSettings(simulated: boolean): ModuleSettings<PixooConfig> {
  return {
    schema: {type: 'object', additionalProperties: false, required: ['device', 'limits', 'simulated', 'hostedConfigured'], properties: {
      device: {type: 'object', additionalProperties: false, required: ['id', 'address', 'profile'], properties: {
        id: {type: 'string'}, address: {type: 'string'}, profile: {type: 'string'}, model: {type: 'string'}, firmware: {type: 'string'},
      }},
      limits: {type: 'object', additionalProperties: false, required: ['maxFrames', 'minDelayMs', 'maxDelayMs', 'uniformTiming'], properties: {
        maxFrames: {type: 'integer'}, minDelayMs: {type: 'integer'}, maxDelayMs: {type: 'integer'}, uniformTiming: {type: 'boolean'},
      }},
      simulated: {type: 'boolean'}, hostedConfigured: {type: 'boolean'},
    }},
    show: ({device, hostedGif}) => ({
      device: {id: device.id, address: device.address, profile: device.profile.name,
        ...(device.model === undefined ? {} : {model: device.model}), ...(device.firmware === undefined ? {} : {firmware: device.firmware})},
      limits: {maxFrames: device.profile.maxFrames, minDelayMs: device.profile.minDelayMs,
        maxDelayMs: device.profile.maxDelayMs, uniformTiming: device.profile.uniformTiming},
      simulated, hostedConfigured: hostedGif !== undefined,
    }),
  };
}
