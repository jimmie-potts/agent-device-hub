import {readFileSync} from 'node:fs';
import {SCHEMA_BASE, type Message, type MessageKind, type MessageValidator, type PayloadCheck} from './index.js';

/** The first version of every family this package defines. A later minor version, such as `device/2.1`, names its own. */
export const FAMILY_VERSION = '2.0';

/** A payload family at one version: its kind, its one type, its schema and the check for rules the schema cannot state. */
export type PayloadFamily = {family: string; kind: MessageKind; type: string; dataschema: string; schema: object; check?: PayloadCheck};

/**
 * Defines a family of this package at `version`, whose schema is `schemas/v2/families/<family>.schema.json` for 2.0 and
 * `<family>.<major>.<minor>.schema.json` for a later version, which registers beside the earlier ones.
 */
export const defineFamily = (family: string, kind: MessageKind, type: string, check?: PayloadCheck, version: string = FAMILY_VERSION): PayloadFamily => ({
  family, kind, type, dataschema: `${SCHEMA_BASE}${family}/${version}`,
  schema: JSON.parse(readFileSync(new URL(`../../schemas/v2/families/${version === FAMILY_VERSION ? family : `${family}.${version}`}.schema.json`,
    import.meta.url), 'utf8')) as object,
  ...(check === undefined ? {} : {check}),
});

/** Registers families in order. A family's messages must use its kind and type, then pass its check. */
export function registerFamilies(validator: MessageValidator, families: readonly PayloadFamily[]): void {
  for (const {family, kind, type, dataschema, schema, check} of families) {
    validator.register(dataschema, schema, message => {
      if (message.kind !== kind) return `envelope /kind ${family} is a ${kind} family`;
      if (message.type !== type) return `envelope /type ${family} uses ${type}`;
      return check?.(message);
    });
  }
}

/** The blocks' `routingId`: an ID that is also the last token of the entity's SDK routing keys (ADR 0012). */
const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Refuses a command whose subject cannot be a routing-key token, naming what the subject should be. */
export const routedSubject = (what: 'device' | 'routing'): PayloadCheck => (message: Message) =>
  message.subject.length <= 128 && ROUTING_ID.test(message.subject) ? undefined : `envelope /subject not a ${what} id`;
