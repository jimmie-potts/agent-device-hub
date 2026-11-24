// Which allowlisted tools each profile's model is offered (Hub #2026), in a module the engine and the page share: it
// reads no contract registry, so the browser bundle can import it. Device and catalog tools stay B.U.N.N.Y.'s.
import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';
import {isCatalogTool} from './catalog-tools.js';

export const READ_LIFX = 'read_lifx';
export const SET_LIFX_POWER = 'set_lifx_power';
export const SET_LIFX_BRIGHTNESS = 'set_lifx_brightness';
export const READ_WEMO = 'read_wemo';
export const SET_WEMO_POWER = 'set_wemo_power';
/** The tools that read or command a configured device owner directly; `deviceToolOwner` names each one's owner. */
export const DEVICE_TOOLS: readonly string[] = [READ_LIFX, SET_LIFX_POWER, SET_LIFX_BRIGHTNESS, READ_WEMO, SET_WEMO_POWER];
/**
 * Whether a profile's model is offered an allowlisted tool. Reachy and MicroDuck get the configured model (Hub #2026)
 * but no device or catalog tool; whether they ever do is a later owner decision.
 */
export const offeredTo = (name: string, profile: AssistantProfile): boolean => profile === 'bunny' || !DEVICE_TOOLS.includes(name) && !isCatalogTool(name);
/** The allowlisted tool names a profile's model is offered, in the allowlist's order, as Conversation details lists them. */
export const profileTools = (allowed: readonly string[], profile: AssistantProfile): string[] => allowed.filter(name => offeredTo(name, profile));
