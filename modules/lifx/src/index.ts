// The LIFX runtime module (Hub #928): the module and its factory, its configuration and the cutover's conversion, its
// families, the simulated bulbs tests and disposable runs use, and the LAN protocol it speaks.
export {COMMAND_FAMILIES, createLifxModule, MODULE_NAME, PROBE_FIRST_MS, PROBE_MAX_MS, READ_INTERVAL_MS, reportsUnavailable, udpNetwork} from './module.js';
export type {CommandFamily, LifxModuleOptions} from './module.js';
export {configureLifx, NATIVE_MODES, qualified} from './configuration.js';
export type {LifxBulbConfig, LifxConfig, NativeMode, StatusCaps} from './configuration.js';
export {convertLegacyConfiguration, readLegacyModes, routingIdOf} from './conversion.js';
export type {Conversion, LegacyMode} from './conversion.js';
export {
  DEVICE_SCHEMA, KELVIN, LIFX_COLOR_SET_SCHEMA, LIFX_LIGHT_SCHEMA, LIFX_TEMPERATURE_SET_SCHEMA, lifxSchemas, lifxValidator, OUTCOME_SCHEMA,
  registerLifxFamilies,
} from './families.js';
export type {LifxColorSetRequest, LifxLight, LifxTemperatureSetRequest} from './families.js';
export {SimulatedLifx} from './simulated.js';
export type {LifxDeviceState, LifxNetwork, SimulatedBulb} from './simulated.js';
export {colorFor} from './status.js';
export type {PaintKey} from './status.js';
export {decodeState, encodeColor, encodePower, PACKET, UdpTransport, unicastAddress} from './protocol.js';
export type {Hsbk, LightState, Transport} from './protocol.js';
export {LIFX_SIMULATED_SECTION, lifxModuleFactory} from './factory.js';
