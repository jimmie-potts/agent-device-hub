import { z } from 'zod';
import {buildIdentitySchema} from './build.js';
export * from './build.js';
export const healthSchema = z.object({
  build: buildIdentitySchema,
  status: z.literal('ready'),
  mode: z.enum(['simulator','device']),
  device: z.object({ connected: z.boolean().nullable() }),
  canvas: z.object({ width: z.literal(64), height: z.literal(64) }),
});
export type Health = z.infer<typeof healthSchema>;
export * from './api.js';
export * from './integration.js';
export * from './now-playing.js';
export * from './catalog-integration.js';
