import {z} from 'zod';
import {boundedIdSchema} from './common.js';
import {runnerRegistrationV2Schema} from './v2.js';

export const managedProjectCatalogSchema=z.object({
  schemaVersion:z.literal(1),next:boundedIdSchema.nullable(),
  entries:z.array(z.object({
    projectId:boundedIdSchema,targetId:boundedIdSchema,connectionId:boundedIdSchema,
    token:z.string().regex(/^odp_live_[A-Za-z0-9_-]{43}$/),
    expiresAt:z.number().int().positive(),queued:z.boolean(),registration:runnerRegistrationV2Schema,
  }).strict()).max(20),
}).strict();
