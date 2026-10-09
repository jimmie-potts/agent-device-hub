import type {ModuleRegistration} from '@jimmie-potts/sdk';
import {wisprFactory} from './factory.js';
/** Fixed registration, no device simulation transport, schemas, broadcasts or dynamic loader. */
export const registration: ModuleRegistration = {...wisprFactory, shipped: true, order: 700};
