export const READ_LIFX = 'read_lifx';
export const SET_LIFX_POWER = 'set_lifx_power';
export const SET_LIFX_BRIGHTNESS = 'set_lifx_brightness';
export const READ_WEMO = 'read_wemo';
export const SET_WEMO_POWER = 'set_wemo_power';
/** The tools that read or command a configured device owner directly; `deviceToolOwner` names each one's owner. */
export const DEVICE_TOOLS: readonly string[] = [READ_LIFX, SET_LIFX_POWER, SET_LIFX_BRIGHTNESS, READ_WEMO, SET_WEMO_POWER];
