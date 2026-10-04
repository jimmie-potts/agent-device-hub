import type { HidDeviceInfo } from './transport.js';

/** The controller firmware's USB identity from the protocol contract. Nothing else is ever opened. */
export const CONTROLLER_IDENTITY = Object.freeze({
  vendorId: 0x1209,
  productId: 0x000c,
  product: 'Agent Controller',
  usagePage: 0xff00,
  usage: 0x01,
});

/**
 * True only for the vendor-defined HID collection of the controller firmware. Every field must match exactly,
 * so the stock CHOMPI (MIDI, `0483:5740`), the USB-storage firmware and other vendor HID devices never match.
 * With `serialNumber`, the serial must match too.
 */
export function matchesController(device: HidDeviceInfo, serialNumber?: string): boolean {
  return device.vendorId === CONTROLLER_IDENTITY.vendorId
    && device.productId === CONTROLLER_IDENTITY.productId
    && device.product === CONTROLLER_IDENTITY.product
    && device.usagePage === CONTROLLER_IDENTITY.usagePage
    && device.usage === CONTROLLER_IDENTITY.usage
    && (serialNumber === undefined || device.serialNumber === serialNumber);
}
