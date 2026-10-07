import {z} from 'zod';

export const buildIdentitySchema=z.object({
 sourceRevision:z.string().regex(/^(?:[a-f0-9]{40}|unknown)$/),
 version:z.string().regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/).max(128),
}).strict();
export type BuildIdentity=Readonly<z.infer<typeof buildIdentitySchema>>;
