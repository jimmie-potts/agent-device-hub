import { validate } from '@jimmie-potts/device-contracts';
import type { DeviceRegistration, ServiceExtension } from './types.js';

function freezeSchema<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freezeSchema); Object.freeze(value); }
  return value;
}

/** Immutable configured destinations. Registrations never come from a tool argument. */
export class DeviceRegistry {
  readonly #registrations = new Map<string, Readonly<DeviceRegistration>>();
  constructor(registrations: readonly DeviceRegistration[]) {
    if (!Array.isArray(registrations) || registrations.length > 64) throw new Error('Invalid registry size');
    for (const registration of registrations as readonly DeviceRegistration[]) {
      const { deviceId, controllerId, label, service, extensions } = registration;
      if (!validate('identity', { deviceId, controllerId, sourceId: 'registry', controllerEpoch: 'registry', ...(label === undefined ? {} : { label }) })
          || this.#registrations.has(deviceId) || (!service && !Object.keys(extensions ?? {}).length)
          || (service !== undefined && (typeof service.readSnapshot !== 'function' || typeof service.submit !== 'function'))) {
        throw new Error('Invalid or duplicate device registration');
      }
      this.#registrations.set(deviceId, Object.freeze({ deviceId, controllerId, ...(label === undefined ? {} : { label }),
        ...(service ? { service: Object.freeze({ readSnapshot: service.readSnapshot.bind(service), submit: service.submit.bind(service) }) } : {}),
        extensions: Object.freeze(Object.fromEntries(Object.entries(extensions ?? {} as Record<string, ServiceExtension>).map(([name, extension]) => [name,
          Object.freeze({ ...extension, inputSchema: freezeSchema(structuredClone(extension.inputSchema)), outputSchema: freezeSchema(structuredClone(extension.outputSchema)),
            annotations: Object.freeze({ ...extension.annotations }), invoke: extension.invoke.bind(extension) })]))) }));
    }
    Object.freeze(this);
  }
  get size(): number { return this.#registrations.size; }
  get(deviceId: string): Readonly<DeviceRegistration> | undefined { return this.#registrations.get(deviceId); }
  list(): readonly Readonly<DeviceRegistration>[] { return [...this.#registrations.values()]; }
}
export function createDeviceRegistry(registrations: readonly DeviceRegistration[]): DeviceRegistry {
  return new DeviceRegistry(registrations);
}
